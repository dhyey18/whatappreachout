import { EventEmitter } from 'events'
import fs from 'fs'

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

// Bump this whenever the manager's internal structure changes.
const MANAGER_VERSION = 10

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

function createManager(userId: string): WAManager {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(100)

  let retryCount = 0
  let lastOpenedAt = 0
  let softRestartCount = 0   // consecutive restartRequired (515) without reaching 'open'
  // Incremented on every connect() call — old socket event handlers bail early if they see a stale session
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
      // Only skip when there is already an active socket — NOT just because status is 'connecting'.
      // Without this, the post-515 soft-restart timer calls connect() while status='connecting'
      // and sock=null, and the old guard would swallow it silently (QR never appears).
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

        // Bail out if a newer connect() call has already taken over
        if (mySession !== currentSession) return

        const authDir = getAuthDir(userId)
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
        sock.ev.on('creds.update', saveCreds)

        sock.ev.on('connection.update', async (update) => {
          // Stale session — this socket was superseded by a newer connect() call
          if (mySession !== currentSession) return

          const { connection, lastDisconnect, qr } = update

          if (qr) {
            // A new QR means a genuinely fresh attempt — reset the consecutive-restart
            // counter so a normal post-scan restartRequired doesn't wrongly clear creds.
            softRestartCount = 0
            manager.isAutoReconnecting = false
            try {
              const dataURL = await QRCode.default.toDataURL(qr, { width: 300, margin: 2 })
              manager.qrDataURL = dataURL
              emitter.emit('qr', dataURL)
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
              return
            }

            // restartRequired (408) fires right after QR scan — stay in 'connecting'
            // so the UI doesn't flash "disconnected" and sends don't fail
            const isSoftRestart =
              statusCode === DisconnectReason.restartRequired ||
              statusCode === 408 ||
              (Date.now() - lastOpenedAt < 12_000)

            if (isSoftRestart) {
              softRestartCount++
              // After 3 consecutive restartRequired without ever reaching 'open',
              // the saved creds are corrupt/stale — clear them so fresh QR is shown.
              if (softRestartCount >= 3) {
                softRestartCount = 0
                const authDir = getAuthDir(userId)
                if (fs.existsSync(authDir)) {
                  fs.rmSync(authDir, { recursive: true, force: true })
                  console.log(`[WhatsApp][${userId}] Cleared stale auth after repeated restartRequired — will request fresh QR`)
                }
              }
              manager.status = 'connecting'
              manager.isAutoReconnecting = manager.hasSavedCreds()
              emitter.emit('status', 'connecting')
              // Capture session now — if disconnect() fires before the timer, it increments
              // currentSession, and the check below prevents a ghost reconnect.
              const sessionAtSoftRestart = currentSession
              setTimeout(() => {
                if (sessionAtSoftRestart !== currentSession) return
                manager.connect(true)
              }, 1_500)
            } else {
              manager.status = 'disconnected'
              manager.isAutoReconnecting = false
              emitter.emit('status', 'disconnected')
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
      currentSession++ // Invalidate any in-flight connection handlers + timer callbacks

      // Eagerly clear all state so polls and sends fail fast during logout
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
        // Best-effort logout with a 5-second cap — don't block cleanup if server is unreachable
        try {
          await Promise.race([
            sockToClose.logout?.() ?? Promise.resolve(),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('logout timeout')), 5_000)
            ),
          ])
        } catch {}
        // Force-terminate the underlying WebSocket regardless of logout outcome
        try {
          sockToClose.ws?.terminate?.() ?? sockToClose.ws?.close?.()
        } catch {}
      }

      const authDir = getAuthDir(userId)
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true })
      }

      emitter.emit('logged-out')

      // Remove from global map so next getWAManager() starts with a clean slate
      getManagerMap().delete(userId)
    },

    async sendMessage(phone: string, message: string) {
      // If reconnecting after restartRequired, wait instead of failing immediately
      if (manager.status === 'connecting') {
        await manager.waitForConnected(30_000)
      }

      if (!manager.sock || manager.status !== 'connected') {
        throw new Error('WhatsApp is not connected. Please scan the QR code.')
      }

      const { default: makeWASocket } = await import('@whiskeysockets/baileys')
      const sock = manager.sock as Awaited<ReturnType<typeof makeWASocket>>

      // Check the live WebSocket readyState
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

export function getWAManager(userId: string): WAManager {
  const map = getManagerMap()
  const existing = map.get(userId)

  if (existing && existing.__v === MANAGER_VERSION) {
    return existing
  }

  const m = createManager(userId) as WAManager & { __v: number }
  m.__v = MANAGER_VERSION
  map.set(userId, m)

  if (m.hasSavedCreds()) {
    console.log(`[WhatsApp][${userId}] Saved creds found — auto-reconnecting…`)
    m.connect().catch(() => {})
  }

  return m
}
