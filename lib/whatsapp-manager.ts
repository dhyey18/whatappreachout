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
   * Fire-and-forget: wipes creds, starts a fresh connection, requests the
   * pairing code from WhatsApp, and stores the result in MongoDB.
   * The caller returns immediately; the frontend polls the status endpoint
   * for `pairingCode`. This avoids Vercel Hobby's 10 s function timeout.
   */
  startPairingCode: (phone: string) => void
}

// Bump whenever the manager's internal structure changes.
const MANAGER_VERSION = 15

// Unique identifier for this process/Vercel instance — used for the connect lock.
const INSTANCE_ID = `${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// How long the connect lock is valid without a heartbeat refresh.
const LOCK_TTL_MS = 45_000

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
// On Vercel, multiple function instances can independently call connect() for the
// same user (e.g. after a cold start while another instance already holds the WA
// socket). Two simultaneous Baileys connections for the same account cause WhatsApp
// to close one or both. The lock uses MongoDB as a shared mutex: one instance sets
// connectingAt + connectingInstanceId; others check and back off.
//
// The lock TTL (45 s) is long enough for normal connect flows and short enough that
// if the owning instance dies the next instance can take over within a minute.

/**
 * Try to atomically acquire the connect lock.
 * Returns true if this instance now holds the lock, false if another holds it.
 */
async function tryAcquireConnectLock(userId: string): Promise<boolean> {
  const stale = new Date(Date.now() - LOCK_TTL_MS)
  try {
    const WASession = await getSessionModel()
    // Step 1: Ensure the document exists so step 2 never needs upsert.
    await WASession.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId } },
      { upsert: true },
    )
    // Step 2: Claim the lock only if it is absent, stale, or already ours.
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
    // DB failure — allow connect so a MongoDB outage doesn't hard-block the user.
    return true
  }
}

/** Forcibly acquire the lock regardless of who holds it (used for force=true connects). */
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

/** Release the lock — called when this instance finishes connecting or disconnects. */
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
      // Prevents multiple Vercel instances from simultaneously connecting the
      // same WhatsApp account, which would cause WA to close one or both sockets.
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
      // long connection flows (QR scan, exponential backoff retries, etc.)
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
        // If /tmp is empty (cold start or new Vercel instance), pull from MongoDB.
        // This avoids forcing a QR re-scan on every function cold start.
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

        // creds.registered is only true after a completed QR scan + auth handshake.
        // If it's false the session was never fully established — wipe so Baileys
        // generates a fresh QR instead of entering the open→close loop.
        if (state.creds?.me && !state.creds?.registered) {
          console.log(`[WhatsApp][${userId}] Stale creds (registered=false) — clearing auth dir`)
          if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true })
          getSessionModel()
            .then(W => W.findOneAndUpdate({ userId }, { $set: { authData: null, status: 'disconnected', qrDataURL: null } }))
            .catch(() => {})
          manager.status = 'disconnected'
          manager.isAutoReconnecting = false
          manager.qrDataURL = null
          emitter.emit('status', 'disconnected')
          clearLock()
          return
        }

        const { version } = await fetchLatestBaileysVersion()

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

        // saveCreds is called by Baileys whenever auth state changes (QR scan,
        // reconnect, key rotation). We also back up to MongoDB so a new Vercel
        // instance can restore without re-scanning the QR.
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
            // Release lock and clear lock fields from DB
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
            // 401 = loggedOut (user removed web session from phone)
            // 500 = badSession (creds are corrupted — clear them, force a fresh QR)
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

            // 428 = connectionClosed (Baileys' routine "please reconnect" signal)
            // 408 = connectionLost / timedOut
            // 515 = restartRequired (post-QR-scan handshake restart)
            // undefined = no Boom error attached (treat as reconnectable)
            // <12 s uptime = something crashed right after opening
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
                // Wipe DB backup too — otherwise restoreAuthFromDB will put stale
                // creds straight back on the next connect() and loop indefinitely.
                getSessionModel()
                  .then(WASession => WASession.findOneAndUpdate({ userId }, { $set: { authData: null } }))
                  .catch(() => {})
              }
              manager.status = 'connecting'
              manager.isAutoReconnecting = manager.hasSavedCreds()
              emitter.emit('status', 'connecting')
              // Keep the lock — we're reconnecting immediately
              const sessionAtSoftRestart = currentSession
              setTimeout(() => {
                if (sessionAtSoftRestart !== currentSession) return
                manager.connect(true)
              }, 1_500)
            } else {
              // Server-side error (440 replaced, etc.) — back off and retry.
              manager.status = 'connecting'
              manager.isAutoReconnecting = true
              emitter.emit('status', 'connecting')
              syncStatusToDB(userId, { status: 'connecting', isAutoReconnecting: true, qrDataURL: null }).catch(() => {})
              const delay = Math.min(5_000 * 2 ** retryCount, 60_000)
              retryCount++
              // Keep the lock during backoff — heartbeat keeps it alive
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

      // Wipe session and release lock so other instances don't auto-reconnect
      clearSessionInDB(userId).catch(() => {})
      releaseConnectLock(userId).catch(() => {})

      emitter.emit('logged-out')
      getManagerMap().delete(userId)
    },

    startPairingCode(phone: string): void {
      if (manager.status === 'connected') return

      const authDir = getAuthDir(userId)

      // Wipe stale creds and mark as starting in MongoDB immediately so the
      // frontend's status poll shows 'connecting' right away.
      if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true })
      getSessionModel()
        .then(W => W.findOneAndUpdate(
          { userId },
          { $set: { authData: null, status: 'connecting', qrDataURL: null, pairingCode: null } },
          { upsert: true },
        ))
        .catch(() => {})

      // All heavy work is fire-and-forget so the pair route can return in < 1 s,
      // safely within Vercel Hobby's 10 s function limit. The result is written
      // to MongoDB and picked up by the frontend's 2 s status poll.
      ;(async () => {
        try {
          // connect(true): force-acquires lock, starts fresh Baileys socket
          await manager.connect(true)

          if (!manager.sock) throw new Error('Socket did not start')

          const { default: makeWASocket } = await import('@whiskeysockets/baileys')
          const cleanPhone = phone.replace(/\D/g, '')

          // Wait for the manager's 'qr' event before calling requestPairingCode.
          //
          // The 'qr' event fires from inside connection.update AFTER Baileys has
          // completed the full Noise Protocol handshake (validateConnection →
          // noise.finishInit). Only after finishInit does noise.encodeFrame
          // encrypt outgoing frames. Calling requestPairingCode earlier sends
          // the IQ node unencrypted, which WhatsApp silently drops — no code,
          // no error, just silence.
          //
          // Using the manager emitter (not sock.ev) means we correctly handle
          // reconnects: if the first socket closes and a new one generates a
          // fresh QR, onQR fires again on the new socket.
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
              reject(new Error('Timed out waiting for WhatsApp handshake — please try again.'))
            }, 30_000)

            const onQR = async () => {
              if (done) return
              cleanup()
              const sock = manager.sock as Awaited<ReturnType<typeof makeWASocket>> | null
              if (!sock) {
                reject(new Error('WhatsApp socket closed before pairing code could be requested.'))
                return
              }
              try {
                const code = await sock.requestPairingCode(cleanPhone)
                resolve(code)
              } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)))
              }
            }

            const onLoggedOut = () => {
              if (done) return
              cleanup()
              reject(new Error('WhatsApp disconnected before pairing code could be requested.'))
            }

            emitter.on('qr', onQR)
            emitter.on('logged-out', onLoggedOut)
          })

          const code = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw

          console.log(`[WhatsApp][${userId}] Pairing code ready: ${code}`)
          // Store in MongoDB — the frontend's 2 s status poll picks it up
          getSessionModel()
            .then(W => W.findOneAndUpdate(
              { userId },
              { $set: { pairingCode: code } },
              { upsert: true },
            ))
            .catch(() => {})
        } catch (err) {
          console.error(`[WhatsApp][${userId}] startPairingCode error:`, err)
          manager.status = 'disconnected'
          manager.isAutoReconnecting = false
          emitter.emit('status', 'disconnected')
          getSessionModel()
            .then(W => W.findOneAndUpdate(
              { userId },
              { $set: { status: 'disconnected', pairingCode: null } },
            ))
            .catch(() => {})
        }
      })()
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

// ─── Credential validation ───────────────────────────────────────────────────

/**
 * Returns true only when saved credentials have completed registration.
 * creds.registered is set to true by Baileys only after a successful QR scan
 * and server-side registration. If it's false the keys are unusable and will
 * cause an open→close loop — we must wipe them and start fresh.
 */
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
  // Clear the DB backup so restoreAuthFromDB cannot put the stale creds back
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
      // Stale / incomplete registration — wipe before connecting so Baileys
      // generates a fresh QR instead of entering the open→close loop.
      wipeCredsSync(userId, authDir)
    } else {
      console.log(`[WhatsApp][${userId}] Valid creds found — auto-reconnecting…`)
      m.connect().catch(() => {})
    }
  } else {
    // Cold start: /tmp is empty. Try restoring from MongoDB so the user
    // doesn't need to re-scan the QR after every Vercel function cold start.
    restoreAuthFromDB(userId, authDir)
      .then(restored => {
        if (!restored) return
        if (m.status !== 'disconnected') return
        // Validate what we just restored before connecting
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
