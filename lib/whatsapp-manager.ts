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
  /**
   * Wipes creds, starts a fresh connection, waits for the Noise Protocol
   * handshake to complete, then requests and returns the pairing code.
   * Resolves in ~3-15 s on Railway. Rejects with a user-friendly error on
   * timeout or WhatsApp-side rejection.
   */
  getPairingCode: (phone: string) => Promise<string>
}

// Bump whenever the manager's internal structure changes.
const MANAGER_VERSION = 17

// Unique identifier for this process/instance — used for the connect lock.
const INSTANCE_ID = `${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// Lock TTL: how long a connect lock is considered valid without a heartbeat.
const LOCK_TTL_MS = 30_000

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

// Use /tmp in production (always writable on Railway/Vercel/Render) and
// fall back to the project dir only for local dev.
function getAuthDir(userId: string): string {
  const base = process.env.NODE_ENV === 'production' ? '/tmp/whatsapp-auth' : process.cwd() + '/whatsapp-auth'
  return `${base}/${userId}`
}

function getManagerMap(): Map<string, WAManager & { __v: number }> {
  if (!global.__waManagers) {
    global.__waManagers = new Map()
  }
  return global.__waManagers
}

// ─── MongoDB session helpers ────────────────────────────────────────────────

async function getSessionModel() {
  await connectDB()
  const { WASession } = await import('./models/WASession')
  return WASession
}

/** Serialise the entire auth directory to JSON and store it in MongoDB. */
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

/** Persist connection state so other instances (or status polls) can read it. */
async function syncStatusToDB(
  userId: string,
  update: Partial<{
    status: ConnectionStatus
    phoneNumber: string | null
    qrDataURL: string | null
    isAutoReconnecting: boolean
    connectingAt: Date | null
    connectingInstanceId: string | null
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
          pairingCode: null,
          connectingAt: null,
          connectingInstanceId: null,
        },
      },
    )
  } catch (err) {
    console.error(`[WhatsApp][${userId}] clearSessionInDB error:`, err)
  }
}

// ─── Distributed connect lock ─────────────────────────────────────────────────
// On multi-instance deployments (Vercel), two simultaneous Baileys connections
// for the same account cause WhatsApp to close one or both sockets.
// The lock uses MongoDB as a shared mutex. On single-instance deployments
// (Railway) this is redundant but harmless.

async function tryAcquireConnectLock(userId: string): Promise<boolean> {
  const stale = new Date(Date.now() - LOCK_TTL_MS)
  try {
    const WASession = await getSessionModel()
    await WASession.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true },
    )
    const result = await WASession.findOneAndUpdate(
      {
        userId,
        $or: [
          { connectingAt: null },
          { connectingAt: { $exists: false } },
          { connectingAt: { $lt: stale } },
          { connectingInstanceId: INSTANCE_ID },
        ],
      },
      { $set: { connectingAt: new Date(), connectingInstanceId: INSTANCE_ID } },
    )
    return !!result
  } catch {
    return true
  }
}

async function forceAcquireConnectLock(userId: string): Promise<void> {
  try {
    const WASession = await getSessionModel()
    await WASession.findOneAndUpdate(
      { userId },
      { $set: { connectingAt: new Date(), connectingInstanceId: INSTANCE_ID } },
      { upsert: true },
    )
  } catch {}
}

async function releaseConnectLock(userId: string): Promise<void> {
  try {
    const WASession = await getSessionModel()
    await WASession.updateOne(
      { userId, connectingInstanceId: INSTANCE_ID },
      { $set: { connectingAt: null, connectingInstanceId: null } },
    )
  } catch {}
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

      // ── Distributed connect lock ───────────────────────────────────────────
      if (force) {
        await forceAcquireConnectLock(userId)
      } else {
        const acquired = await tryAcquireConnectLock(userId)
        if (!acquired) {
          if (mySession !== currentSession) return
          console.log(`[WhatsApp][${userId}] Connect lock held by another instance — deferring`)
          manager.isAutoReconnecting = true
          manager.status = 'connecting'
          emitter.emit('status', 'connecting')
          return
        }
      }

      if (mySession !== currentSession) { releaseConnectLock(userId).catch(() => {}); return }

      // Heartbeat: refresh the lock every 20 s so it doesn't expire during
      // long connection flows (QR scan, backoff retries, etc.)
      const lockHeartbeat = setInterval(async () => {
        if (mySession !== currentSession) { clearInterval(lockHeartbeat); return }
        if (manager.status === 'disconnected') { clearInterval(lockHeartbeat); return }
        try {
          const W = await getSessionModel()
          await W.updateOne(
            { userId, connectingInstanceId: INSTANCE_ID },
            { $set: { connectingAt: new Date() } },
          )
        } catch {}
      }, 20_000)

      const clearLock = () => {
        clearInterval(lockHeartbeat)
        releaseConnectLock(userId).catch(() => {})
      }

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

        if (mySession !== currentSession) { clearLock(); return }

        const authDir = getAuthDir(userId)

        // ── Credential restoration ────────────────────────────────────────
        // If /tmp is empty (cold start or new container), pull from MongoDB.
        if (!fs.existsSync(`${authDir}/creds.json`)) {
          const restored = await restoreAuthFromDB(userId, authDir)
          if (restored) {
            manager.isAutoReconnecting = true
            emitter.emit('status', 'connecting')
            syncStatusToDB(userId, { status: 'connecting', isAutoReconnecting: true, qrDataURL: null }).catch(() => {})
          }
        }

        if (mySession !== currentSession) { clearLock(); return }

        const { state, saveCreds } = await useMultiFileAuthState(authDir)

        // Stale creds: creds.me is set but registered=false means the session was
        // never fully established. Wipe and restart for a fresh QR.
        if (state.creds?.me && !state.creds?.registered) {
          console.log(`[WhatsApp][${userId}] Stale creds (registered=false) — wiping and restarting`)
          if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true })
          getSessionModel()
            .then(W => W.findOneAndUpdate({ userId }, { $set: { authData: null, qrDataURL: null } }))
            .catch(() => {})
          manager.qrDataURL = null
          const sessionAtWipe = currentSession
          setTimeout(() => {
            if (sessionAtWipe !== currentSession) return
            manager.connect(true)
          }, 200)
          clearLock()
          return
        }

        // fetchLatestBaileysVersion hits raw.githubusercontent.com on every connect.
        // On cloud platforms this often times out. Fall back to bundled version.
        let version: [number, number, number] = [2, 3000, 1035194821]
        try {
          const fetched = await Promise.race([
            fetchLatestBaileysVersion(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('version fetch timeout')), 5_000)),
          ])
          version = fetched.version as [number, number, number]
        } catch {
          console.log(`[WhatsApp][${userId}] Using bundled Baileys version ${version.join('.')}`)
        }

        if (mySession !== currentSession) { clearLock(); return }

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

        const saveCredsAndBackup = async () => {
          await saveCreds()
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
            clearLock()
            syncStatusToDB(userId, {
              status: 'connected',
              phoneNumber: manager.phoneNumber,
              qrDataURL: null,
              isAutoReconnecting: false,
              connectingAt: null,
              connectingInstanceId: null,
            }).catch(() => {})
          }

          if (connection === 'close') {
            manager.sock = null
            manager.qrDataURL = null

            const statusCode = (lastDisconnect?.error as InstanceType<typeof Boom>)?.output?.statusCode
            const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 500

            console.log(`[WhatsApp][${userId}] Closed — code=${statusCode} loggedOut=${isLoggedOut}`)

            if (isLoggedOut) {
              retryCount = 0
              manager.status = 'disconnected'
              manager.phoneNumber = null
              manager.isAutoReconnecting = false
              emitter.emit('status', 'disconnected')
              emitter.emit('logged-out')
              clearLock()
              syncStatusToDB(userId, {
                status: 'disconnected',
                phoneNumber: null,
                qrDataURL: null,
                connectingAt: null,
                connectingInstanceId: null,
              }).catch(() => {})
              return
            }

            const isSoftRestart =
              statusCode === DisconnectReason.restartRequired ||
              statusCode === 428 ||
              statusCode === 408 ||
              statusCode === undefined ||
              (Date.now() - lastOpenedAt < 12_000)

            if (isSoftRestart) {
              softRestartCount++
              if (softRestartCount >= 3) {
                softRestartCount = 0
                const dir = getAuthDir(userId)
                if (fs.existsSync(dir)) {
                  fs.rmSync(dir, { recursive: true, force: true })
                  console.log(`[WhatsApp][${userId}] Cleared stale auth after repeated restartRequired`)
                }
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
              manager.status = 'connecting'
              manager.isAutoReconnecting = true
              emitter.emit('status', 'connecting')
              syncStatusToDB(userId, { status: 'connecting', isAutoReconnecting: true, qrDataURL: null }).catch(() => {})
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
        if (mySession !== currentSession) { clearInterval(lockHeartbeat); return }
        clearLock()
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

      clearSessionInDB(userId).catch(() => {})
      releaseConnectLock(userId).catch(() => {})

      emitter.emit('logged-out')
      getManagerMap().delete(userId)
    },

    async getPairingCode(phone: string): Promise<string> {
      if (manager.status === 'connected') {
        throw new Error('Already connected. Disconnect first.')
      }

      const authDir = getAuthDir(userId)

      // Wipe auth dir synchronously — no stale creds on disk
      if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true })

      // IMPORTANT: await the DB wipe before calling connect().
      //
      // connect() → restoreAuthFromDB() reads from MongoDB. If we only fire-and-forget
      // the wipe, the DB update may not have completed by the time restoreAuthFromDB
      // runs. It would then restore the old auth data, Baileys would auto-reconnect
      // with stale creds (no QR event), and this function would hang until the 30s
      // timeout. Awaiting here guarantees the DB is clean before connect() reads it.
      try {
        const W = await getSessionModel()
        await W.findOneAndUpdate(
          { userId },
          { $set: { authData: null, status: 'connecting', qrDataURL: null, pairingCode: null } },
          { upsert: true },
        )
      } catch { /* DB outage — proceed; local auth dir is already clean */ }

      // Start a fresh Baileys connection
      await manager.connect(true)

      if (!manager.sock) throw new Error('Socket failed to start — please try again.')

      const { default: makeWASocket } = await import('@whiskeysockets/baileys')
      const cleanPhone = phone.replace(/\D/g, '')

      // Wait for the manager's 'qr' event, which fires AFTER Baileys completes
      // the Noise Protocol handshake (validateConnection → noise.finishInit).
      //
      // Only after finishInit does noise.encodeFrame encrypt outgoing frames.
      // Calling requestPairingCode before that sends the IQ node unencrypted —
      // WhatsApp silently drops it. No code, no error, just silence.
      //
      // We listen on the manager emitter (not sock.ev) so that if the first socket
      // closes with restartRequired and a new socket opens, the onQR handler fires
      // on the new socket's QR event automatically.
      const raw = await new Promise<string>((resolve, reject) => {
        let done = false

        const cleanup = () => {
          done = true
          clearTimeout(timeout)
          emitter.off('qr', onQR)
          emitter.off('logged-out', onLoggedOut)
        }

        const timeout = setTimeout(() => {
          cleanup()
          reject(new Error('Timed out waiting for WhatsApp to respond. Check your internet connection and try again.'))
        }, 30_000)

        const onQR = async () => {
          if (done) return
          cleanup()
          const sock = manager.sock as Awaited<ReturnType<typeof makeWASocket>> | null
          if (!sock) {
            reject(new Error('WhatsApp socket closed unexpectedly. Please try again.'))
            return
          }
          try {
            const code = await sock.requestPairingCode(cleanPhone)
            resolve(code)
          } catch (err) {
            const msg = (err instanceof Error ? err.message : String(err)) || 'requestPairingCode failed'
            reject(new Error(msg))
          }
        }

        const onLoggedOut = () => {
          if (done) return
          cleanup()
          reject(new Error('WhatsApp disconnected before the pairing code could be generated.'))
        }

        emitter.on('qr', onQR)
        emitter.on('logged-out', onLoggedOut)
      })

      const code = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw

      console.log(`[WhatsApp][${userId}] Pairing code ready: ${code}`)

      // Store in DB as a fallback for status polls (e.g. slow networks)
      getSessionModel()
        .then(W => W.findOneAndUpdate(
          { userId },
          { $set: { pairingCode: code } },
          { upsert: true },
        ))
        .catch(() => {})

      return code
    },

    async sendMessage(phone: string, message: string) {
      if (manager.status === 'connecting') {
        await manager.waitForConnected(30_000)
      }

      if (!manager.sock || manager.status !== 'connected') {
        throw new Error('WhatsApp is not connected. Please scan the QR code or link with your phone number.')
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

// ─── Credential validation ───────────────────────────────────────────────────

function credsAreValid(authDir: string): boolean {
  const credsPath = `${authDir}/creds.json`
  if (!fs.existsSync(credsPath)) return false
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'))
    return creds.registered === true
  } catch {
    return false
  }
}

function wipeCredsSync(userId: string, authDir: string): void {
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true })
    console.log(`[WhatsApp][${userId}] Wiped stale auth dir (registered=false)`)
  }
  getSessionModel()
    .then(W => W.findOneAndUpdate(
      { userId },
      { $set: { authData: null, status: 'disconnected', phoneNumber: null, qrDataURL: null } },
    ))
    .catch(() => {})
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getWAManager(userId: string): WAManager {
  const map = getManagerMap()
  const existing = map.get(userId)
  if (existing && existing.__v === MANAGER_VERSION) return existing

  const m = createManager(userId) as WAManager & { __v: number }
  m.__v = MANAGER_VERSION
  map.set(userId, m)

  const authDir = getAuthDir(userId)

  if (m.hasSavedCreds()) {
    if (!credsAreValid(authDir)) {
      wipeCredsSync(userId, authDir)
    } else {
      console.log(`[WhatsApp][${userId}] Valid creds found — auto-reconnecting…`)
      m.connect().catch(() => {})
    }
  } else {
    restoreAuthFromDB(userId, authDir)
      .then(restored => {
        if (!restored) return
        if (m.status !== 'disconnected') return
        if (!credsAreValid(authDir)) {
          wipeCredsSync(userId, authDir)
          return
        }
        console.log(`[WhatsApp][${userId}] Cold-start: restored valid creds from DB — auto-reconnecting…`)
        m.connect().catch(() => {})
      })
      .catch(() => {})
  }

  return m
}
