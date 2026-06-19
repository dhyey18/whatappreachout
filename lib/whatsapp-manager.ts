import { EventEmitter } from 'events'
import fs from 'fs'
import connectDB from './mongodb'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

interface WAManager {
  status: ConnectionStatus
  qrDataURL: string | null
  phoneNumber: string | null
  emitter: EventEmitter
  sock: unknown
  /** true when reconnecting with saved creds (no QR needed) */
  isAutoReconnecting: boolean
  connect: (force?: boolean) => Promise<void>
  disconnect: () => Promise<void>
  sendMessage: (phone: string, message: string) => Promise<void>
  waitForConnected: (timeoutMs?: number) => Promise<void>
  hasSavedCreds: () => boolean
}

// Bump whenever the manager's internal structure changes.
const MANAGER_VERSION = 11

declare global {
  // eslint-disable-next-line no-var
  var __waManagers: Map<string, WAManager & { __v: number }> | undefined
}

type NoopLogger = {
  level: 'silent'
  trace: () => void
  debug: () => void
  info: () => void
  warn: () => void
  error: () => void
  fatal: () => void
  child: () => NoopLogger
}

const noopLogger: NoopLogger = {
  level: 'silent',
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
}

// Vercel's lambda filesystem is read-only except for /tmp.
// Each user gets their own subdirectory so sessions are fully isolated.
function getAuthDir(userId: string): string {
  const base = process.env.VERCEL ? '/tmp/whatsapp-auth' : process.cwd() + '/whatsapp-auth'
  return `${base}/${userId}`
}

function getManagerMap(): Map<string, WAManager & { __v: number }> {
  if (!global.__waManagers) {
    global.__waManagers = new Map()
  }
  return global.__waManagers
}

// ─── MongoDB session helpers ────────────────────────────────────────────────
// All helpers are fire-and-forget from the manager's perspective (errors logged,
// never bubble up) so a MongoDB outage cannot break an active WhatsApp session.

async function getSessionModel() {
  await connectDB()
  const { WASession } = await import('./models/WASession')
  return WASession
}

/** Serialise the entire auth directory to a JSON string and store it in MongoDB. */
async function backupAuthToDB(userId: string, authDir: string): Promise<void> {
  try {
    if (!fs.existsSync(authDir)) return
    const files: Record<string, string> = {}
    for (const file of fs.readdirSync(authDir)) {
      const full = `${authDir}/${file}`
      if (fs.statSync(full).isFile()) {
        files[file] = fs.readFileSync(full, 'utf-8')
      }
    }
    const authData = JSON.stringify(files)
    if (authData.length > 5_000_000) {
      console.warn(`[WhatsApp][${userId}] Auth data too large (${authData.length} bytes) — skipping DB backup`)
      return
    }
    const WASession = await getSessionModel()
    await WASession.findOneAndUpdate(
      { userId },
      { $set: { authData } },
      { upsert: true },
    )
  } catch (err) {
    console.error(`[WhatsApp][${userId}] backupAuthToDB error:`, err)
  }
}

/**
 * Restore auth files from MongoDB into the given directory.
 * Returns true if creds were found and written, false otherwise.
 */
async function restoreAuthFromDB(userId: string, authDir: string): Promise<boolean> {
  // Fast path: already on disk (warm instance or just written)
  if (fs.existsSync(`${authDir}/creds.json`)) return true
  try {
    const WASession = await getSessionModel()
    const session = await WASession.findOne({ userId }, { authData: 1 }).lean()
    if (!session?.authData) return false
    const files = JSON.parse(session.authData as string) as Record<string, string>
    if (!files['creds.json']) return false
    fs.mkdirSync(authDir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(`${authDir}/${name}`, content, 'utf-8')
    }
    console.log(`[WhatsApp][${userId}] Auth files restored from DB`)
    return true
  } catch (err) {
    console.error(`[WhatsApp][${userId}] restoreAuthFromDB error:`, err)
    return false
  }
}

/** Persist connection state so other Vercel instances can read it. */
async function syncStatusToDB(
  userId: string,
  update: Partial<{
    status: ConnectionStatus
    phoneNumber: string | null
    qrDataURL: string | null
    isAutoReconnecting: boolean
  }>,
): Promise<void> {
  try {
    const WASession = await getSessionModel()
    await WASession.findOneAndUpdate(
      { userId },
      { $set: update },
      { upsert: true },
    )
  } catch (err) {
    console.error(`[WhatsApp][${userId}] syncStatusToDB error:`, err)
  }
}

/** Wipe the MongoDB session row on explicit disconnect. */
async function clearSessionInDB(userId: string): Promise<void> {
  try {
    const WASession = await getSessionModel()
    await WASession.findOneAndUpdate(
      { userId },
      {
        $set: {
          authData: null,
          status: 'disconnected',
          phoneNumber: null,
          qrDataURL: null,
          isAutoReconnecting: false,
        },
      },
    )
  } catch (err) {
    console.error(`[WhatsApp][${userId}] clearSessionInDB error:`, err)
  }
}

// ─── Manager factory ────────────────────────────────────────────────────────

function createManager(userId: string): WAManager {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(100)

  let retryCount = 0
  let lastOpenedAt = 0
  let softRestartCount = 0
  let currentSession = 0

  const manager: WAManager = {
    status: 'disconnected',
    qrDataURL: null,
    phoneNumber: null,
    emitter,
    sock: null,
    isAutoReconnecting: false,

    hasSavedCreds() {
      return fs.existsSync(getAuthDir(userId) + '/creds.json')
    },

    async waitForConnected(timeoutMs = 30_000) {
      if (manager.status === 'connected') return
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          emitter.off('connected', onConnected)
          emitter.off('logged-out', onLoggedOut)
          reject(new Error('WhatsApp connection timed out. Please reconnect.'))
        }, timeoutMs)

        const onConnected = () => {
          clearTimeout(timer)
          emitter.off('logged-out', onLoggedOut)
          resolve()
        }
        const onLoggedOut = () => {
          clearTimeout(timer)
          emitter.off('connected', onConnected)
          reject(new Error('WhatsApp was logged out'))
        }

        emitter.once('connected', onConnected)
        emitter.once('logged-out', onLoggedOut)

        if (manager.status === 'disconnected') {
          manager.connect().catch(() => {})
        }
      })
    },

    async connect(force = false) {
      if (!force && manager.sock !== null) return

      // Close any existing socket before starting fresh
      if (manager.sock) {
        try {
          const s = manager.sock as { ws?: { terminate?: () => void; close?: () => void } }
          s.ws?.terminate?.() ?? s.ws?.close?.()
        } catch {}
        manager.sock = null
      }

      manager.status = 'connecting'
      manager.isAutoReconnecting = manager.hasSavedCreds()
      emitter.emit('status', 'connecting')

      const mySession = ++currentSession

      try {
        const {
          default: makeWASocket,
          DisconnectReason,
          useMultiFileAuthState,
          makeCacheableSignalKeyStore,
          fetchLatestBaileysVersion,
        } = await import('@whiskeysockets/baileys')
        const { Boom } = await import('@hapi/boom')
        const QRCode = await import('qrcode')

        if (mySession !== currentSession) return

        const authDir = getAuthDir(userId)

        // ── Credential restoration ────────────────────────────────────────
        // If /tmp is empty (cold start or new Vercel instance), pull from MongoDB.
        // This avoids forcing a QR re-scan on every function cold start.
        if (!fs.existsSync(`${authDir}/creds.json`)) {
          const restored = await restoreAuthFromDB(userId, authDir)
          if (restored) {
            // We now have saved creds — reflect this in the connecting state
            manager.isAutoReconnecting = true
            emitter.emit('status', 'connecting')
          }
        }

        if (mySession !== currentSession) return

        const { state, saveCreds } = await useMultiFileAuthState(authDir)
        const { version } = await fetchLatestBaileysVersion()

        if (mySession !== currentSession) return

        const sock = makeWASocket({
          version,
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, noopLogger),
          },
          printQRInTerminal: false,
          logger: noopLogger as Parameters<typeof makeWASocket>[0]['logger'],
          browser: ['WA Reach', 'Chrome', '124.0'],
          connectTimeoutMs: 60_000,
          defaultQueryTimeoutMs: 30_000,
          keepAliveIntervalMs: 15_000,
          retryRequestDelayMs: 2_000,
          markOnlineOnConnect: false,
          syncFullHistory: false,
          generateHighQualityLinkPreview: false,
        })

        manager.sock = sock

        // ── Credential save + DB backup ───────────────────────────────────
        // saveCreds is called by Baileys whenever auth state changes (QR scan,
        // reconnect, key rotation). We also back up to MongoDB so a new Vercel
        // instance can restore without re-scanning the QR.
        const saveCredsAndBackup = async () => {
          await saveCreds()
          // Non-blocking — a DB hiccup must not interrupt the connection
          backupAuthToDB(userId, authDir).catch(() => {})
        }
        sock.ev.on('creds.update', saveCredsAndBackup)

        sock.ev.on('connection.update', async (update) => {
          if (mySession !== currentSession) return

          const { connection, lastDisconnect, qr } = update

          if (qr) {
            softRestartCount = 0
            manager.isAutoReconnecting = false
            try {
              const dataURL = await QRCode.default.toDataURL(qr, { width: 300, margin: 2 })
              manager.qrDataURL = dataURL
              emitter.emit('qr', dataURL)
              // Store QR in DB so other Vercel instances deliver it via status polls
              syncStatusToDB(userId, { status: 'connecting', qrDataURL: dataURL, isAutoReconnecting: false }).catch(() => {})
            } catch {}
          }

          if (connection === 'open') {
            retryCount = 0
            softRestartCount = 0
            lastOpenedAt = Date.now()
            manager.status = 'connected'
            manager.qrDataURL = null
            manager.isAutoReconnecting = false
            manager.phoneNumber = sock.user?.id?.split(':')[0] ?? null
            emitter.emit('status', 'connected')
            emitter.emit('connected', manager.phoneNumber)
            console.log(`[WhatsApp][${userId}] Connected as`, manager.phoneNumber)
            syncStatusToDB(userId, {
              status: 'connected',
              phoneNumber: manager.phoneNumber,
              qrDataURL: null,
              isAutoReconnecting: false,
            }).catch(() => {})
          }

          if (connection === 'close') {
            manager.sock = null
            manager.qrDataURL = null

            const statusCode = (lastDisconnect?.error as InstanceType<typeof Boom>)?.output?.statusCode
            const isLoggedOut = statusCode === DisconnectReason.loggedOut

            console.log(`[WhatsApp][${userId}] Closed — code=${statusCode} loggedOut=${isLoggedOut}`)

            if (isLoggedOut) {
              retryCount = 0
              manager.status = 'disconnected'
              manager.phoneNumber = null
              manager.isAutoReconnecting = false
              emitter.emit('status', 'disconnected')
              emitter.emit('logged-out')
              syncStatusToDB(userId, { status: 'disconnected', phoneNumber: null, qrDataURL: null }).catch(() => {})
              return
            }

            const isSoftRestart =
              statusCode === DisconnectReason.restartRequired ||
              statusCode === 408 ||
              (Date.now() - lastOpenedAt < 12_000)

            if (isSoftRestart) {
              softRestartCount++
              if (softRestartCount >= 3) {
                softRestartCount = 0
                const authDir = getAuthDir(userId)
                if (fs.existsSync(authDir)) {
                  fs.rmSync(authDir, { recursive: true, force: true })
                  console.log(`[WhatsApp][${userId}] Cleared stale auth after repeated restartRequired`)
                }
                // Wipe DB backup too — otherwise restoreAuthFromDB will put stale
                // creds straight back on the next connect() and loop indefinitely.
                getSessionModel()
                  .then(WASession => WASession.findOneAndUpdate({ userId }, { $set: { authData: null } }))
                  .catch(() => {})
              }
              manager.status = 'connecting'
              manager.isAutoReconnecting = manager.hasSavedCreds()
              emitter.emit('status', 'connecting')
              const sessionAtSoftRestart = currentSession
              setTimeout(() => {
                if (sessionAtSoftRestart !== currentSession) return
                manager.connect(true)
              }, 1_500)
            } else {
              manager.status = 'disconnected'
              manager.isAutoReconnecting = false
              emitter.emit('status', 'disconnected')
              syncStatusToDB(userId, { status: 'disconnected', qrDataURL: null }).catch(() => {})
              const delay = Math.min(5_000 * 2 ** retryCount, 60_000)
              retryCount++
              const sessionAtRetry = currentSession
              setTimeout(() => {
                if (sessionAtRetry !== currentSession) return
                manager.connect(true)
              }, delay)
            }
          }
        })
      } catch (err) {
        if (mySession !== currentSession) return
        console.error(`[WhatsApp][${userId}] connect() error:`, err)
        manager.status = 'disconnected'
        manager.isAutoReconnecting = false
        emitter.emit('status', 'disconnected')
        const delay = Math.min(5_000 * 2 ** retryCount, 60_000)
        retryCount++
        const sessionAtError = currentSession
        setTimeout(() => {
          if (sessionAtError !== currentSession) return
          manager.connect(true)
        }, delay)
      }
    },

    async disconnect() {
      retryCount = 0
      softRestartCount = 0
      manager.isAutoReconnecting = false
      currentSession++

      const sockToClose = manager.sock as {
        logout?: () => Promise<void>
        ws?: { terminate?: () => void; close?: () => void }
      } | null
      manager.sock = null
      manager.status = 'disconnected'
      manager.qrDataURL = null
      manager.phoneNumber = null
      emitter.emit('status', 'disconnected')

      if (sockToClose) {
        try {
          await Promise.race([
            sockToClose.logout?.() ?? Promise.resolve(),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('logout timeout')), 5_000)
            ),
          ])
        } catch {}
        try {
          sockToClose.ws?.terminate?.() ?? sockToClose.ws?.close?.()
        } catch {}
      }

      const authDir = getAuthDir(userId)
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true })
      }

      // Wipe saved session so other instances don't try to auto-reconnect
      clearSessionInDB(userId).catch(() => {})

      emitter.emit('logged-out')
      getManagerMap().delete(userId)
    },

    async sendMessage(phone: string, message: string) {
      if (manager.status === 'connecting') {
        await manager.waitForConnected(30_000)
      }

      if (!manager.sock || manager.status !== 'connected') {
        throw new Error('WhatsApp is not connected. Please scan the QR code.')
      }

      const { default: makeWASocket } = await import('@whiskeysockets/baileys')
      const sock = manager.sock as Awaited<ReturnType<typeof makeWASocket>>

      const ws = (sock as unknown as { ws?: { readyState?: number } }).ws
      if (ws && typeof ws.readyState === 'number' && ws.readyState !== 1) {
        manager.status = 'disconnected'
        manager.sock = null
        emitter.emit('status', 'disconnected')
        const sessionAtWsClose = currentSession
        setTimeout(() => {
          if (sessionAtWsClose !== currentSession) return
          manager.connect()
        }, 1_500)
        throw new Error('WhatsApp socket closed. Reconnecting — please retry in a moment.')
      }

      const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net'
      try {
        await sock.sendMessage(jid, { text: message })
      } catch (err: unknown) {
        const msg = (err as Error).message ?? ''
        if (/connection closed|connection lost|boom/i.test(msg)) {
          manager.status = 'disconnected'
          manager.sock = null
          emitter.emit('status', 'disconnected')
          const sessionAtDrop = currentSession
          setTimeout(() => {
            if (sessionAtDrop !== currentSession) return
            manager.connect()
          }, 1_500)
          throw new Error('WhatsApp connection dropped. Reconnecting — please retry in a moment.')
        }
        throw err
      }
    },
  }

  return manager
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getWAManager(userId: string): WAManager {
  const map = getManagerMap()
  const existing = map.get(userId)
  if (existing && existing.__v === MANAGER_VERSION) return existing

  const m = createManager(userId) as WAManager & { __v: number }
  m.__v = MANAGER_VERSION
  map.set(userId, m)

  if (m.hasSavedCreds()) {
    // Warm instance: /tmp still has creds from the previous invocation
    console.log(`[WhatsApp][${userId}] Saved creds found — auto-reconnecting…`)
    m.connect().catch(() => {})
  } else {
    // Cold start: /tmp is empty. Try restoring from MongoDB so the user
    // doesn't need to re-scan the QR after every Vercel function cold start.
    const authDir = getAuthDir(userId)
    restoreAuthFromDB(userId, authDir)
      .then(restored => {
        if (!restored) return
        // Only start if nothing else already kicked off a connect
        if (m.status !== 'disconnected') return
        console.log(`[WhatsApp][${userId}] Cold-start: restored creds from DB — auto-reconnecting…`)
        m.connect().catch(() => {})
      })
      .catch(() => {})
  }

  return m
}
