import { EventEmitter } from 'events'
import fs from 'fs'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

interface WAManager {
  status: ConnectionStatus
  qrDataURL: string | null
  phoneNumber: string | null
  emitter: EventEmitter
  sock: unknown
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  sendMessage: (phone: string, message: string) => Promise<void>
}

// Bump this whenever the manager's internal structure changes.
// Causes the cached global to be discarded on next hot-reload.
const MANAGER_VERSION = 3

declare global {
  // eslint-disable-next-line no-var
  var __waManager: (WAManager & { __v?: number }) | undefined
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

function createManager(): WAManager {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)

  const manager: WAManager = {
    status: 'disconnected',
    qrDataURL: null,
    phoneNumber: null,
    emitter,
    sock: null,

    async connect() {
      if (manager.status === 'connecting' || manager.status === 'connected') return
      manager.status = 'connecting'
      emitter.emit('status', 'connecting')

      try {
        const {
          default: makeWASocket,
          DisconnectReason,
          useMultiFileAuthState,
          fetchLatestBaileysVersion,
          makeCacheableSignalKeyStore,
        } = await import('@whiskeysockets/baileys')
        const { Boom } = await import('@hapi/boom')
        const QRCode = await import('qrcode')

        const authDir = process.cwd() + '/whatsapp-auth'
        const { state, saveCreds } = await useMultiFileAuthState(authDir)
        const { version } = await fetchLatestBaileysVersion()

        const sock = makeWASocket({
          version,
          auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, noopLogger),
          },
          printQRInTerminal: false,
          logger: noopLogger as Parameters<typeof makeWASocket>[0]['logger'],
          browser: ['WA Reach', 'Chrome', '120.0'],
          connectTimeoutMs: 60_000,
          defaultQueryTimeoutMs: 30_000,
          keepAliveIntervalMs: 25_000,
          markOnlineOnConnect: false,
          syncFullHistory: false,
        })

        manager.sock = sock

        sock.ev.on('creds.update', saveCreds)

        sock.ev.on('connection.update', async (update) => {
          const { connection, lastDisconnect, qr } = update

          if (qr) {
            try {
              const dataURL = await QRCode.default.toDataURL(qr, {
                width: 280,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' },
              })
              manager.qrDataURL = dataURL
              emitter.emit('qr', dataURL)
            } catch {}
          }

          if (connection === 'close') {
            manager.status = 'disconnected'
            manager.qrDataURL = null
            emitter.emit('status', 'disconnected')

            const statusCode = (lastDisconnect?.error as InstanceType<typeof Boom>)?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            if (shouldReconnect) {
              setTimeout(() => manager.connect(), 3000)
            } else {
              manager.phoneNumber = null
              emitter.emit('logged-out')
            }
          }

          if (connection === 'open') {
            manager.status = 'connected'
            manager.qrDataURL = null
            manager.phoneNumber = sock.user?.id?.split(':')[0] || null
            emitter.emit('status', 'connected')
            emitter.emit('connected', manager.phoneNumber)
          }
        })
      } catch (err) {
        console.error('[WhatsApp] Connection error:', err)
        manager.status = 'disconnected'
        emitter.emit('status', 'disconnected')
      }
    },

    async disconnect() {
      if (manager.sock) {
        try {
          const { default: makeWASocket } = await import('@whiskeysockets/baileys')
          await (manager.sock as Awaited<ReturnType<typeof makeWASocket>>).logout()
        } catch {}
        manager.sock = null
      }
      manager.status = 'disconnected'
      manager.qrDataURL = null
      manager.phoneNumber = null
      emitter.emit('status', 'disconnected')

      const fs = await import('fs')
      const authDir = process.cwd() + '/whatsapp-auth'
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true })
      }
    },

    async sendMessage(phone: string, message: string) {
      if (!manager.sock || manager.status !== 'connected') {
        throw new Error('WhatsApp is not connected. Please scan the QR code.')
      }
      const { default: makeWASocket } = await import('@whiskeysockets/baileys')
      const sock = manager.sock as Awaited<ReturnType<typeof makeWASocket>>

      // Check live WS readyState — avoids "Connection Closed" from stale sockets
      const ws = (sock as unknown as { ws?: { readyState?: number } }).ws
      if (ws && ws.readyState !== 1) {
        manager.status = 'disconnected'
        emitter.emit('status', 'disconnected')
        throw new Error('WhatsApp connection lost. Please reconnect and try again.')
      }

      const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net'
      try {
        await sock.sendMessage(jid, { text: message })
      } catch (err: unknown) {
        const msg = (err as Error).message || ''
        // Baileys throws "Connection Closed" when WS drops mid-send
        if (msg.includes('Connection Closed') || msg.includes('connection')) {
          manager.status = 'disconnected'
          manager.qrDataURL = null
          emitter.emit('status', 'disconnected')
          // Auto-reconnect after brief delay
          setTimeout(() => manager.connect(), 2000)
          throw new Error('WhatsApp connection dropped. Reconnecting… please retry in a moment.')
        }
        throw err
      }
    },
  }

  return manager
}

export function getWAManager(): WAManager {
  if (!global.__waManager || global.__waManager.__v !== MANAGER_VERSION) {
    const m = createManager() as WAManager & { __v: number }
    m.__v = MANAGER_VERSION
    global.__waManager = m

    // Auto-reconnect using saved credentials without requiring a QR scan
    const credsPath = `${process.cwd()}/whatsapp-auth/creds.json`
    if (fs.existsSync(credsPath)) {
      m.connect().catch(() => {})
    }
  }
  return global.__waManager
}
