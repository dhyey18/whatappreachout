'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Smartphone, WifiOff, MessageCircle, Send, RefreshCw,
  CheckCircle2, LogOut, Phone, Wifi, AlertTriangle, Hash,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'

interface Contact {
  _id: string
  name: string
  phone: string
}

type WAStatus = 'disconnected' | 'connecting' | 'connected'

interface StatusPayload {
  status: WAStatus
  phone: string | null
  hasQR: boolean
  qrDataURL: string | null
  isAutoReconnecting: boolean
  pairingCode?: string | null
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = localStorage.getItem('auth-store')
    if (!stored) return null
    return JSON.parse(stored).state?.token || null
  } catch {
    return null
  }
}

export default function WhatsAppPage() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<WAStatus>('disconnected')
  const [qrDataURL, setQRDataURL] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [isAutoReconnecting, setIsAutoReconnecting] = useState(false)
  const [connectMethod, setConnectMethod] = useState<'qr' | 'phone'>('qr')
  const [pairingPhone, setPairingPhone] = useState('')
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [gettingCode, setGettingCode] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const prevStatusRef = useRef<WAStatus>('disconnected')
  const connectedPhoneRef = useRef<string | null>(null)
  // When user clicks Connect, ignore 'disconnected' from status poll for 20 s
  // so stale-creds recovery and retries don't reset the UI mid-flow.
  const connectingUntilRef = useRef<number>(0)

  const { data: contactsData } = useQuery<{ contacts: Contact[] }>({
    queryKey: ['contacts-wa'],
    queryFn: () => api.get('/contacts?limit=100'),
  })

  const stopSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
  }, [])

  const applyStatus = useCallback((payload: StatusPayload) => {
    const prev = prevStatusRef.current
    // During an active connect attempt, suppress spurious 'disconnected' signals
    // (e.g. stale-creds recovery, lock release) so the QR flow isn't interrupted.
    const effectiveStatus =
      payload.status === 'disconnected' && Date.now() < connectingUntilRef.current
        ? 'connecting'
        : payload.status
    setStatus(effectiveStatus)
    setConnectedPhone(payload.phone)
    connectedPhoneRef.current = payload.phone
    setIsAutoReconnecting(payload.isAutoReconnecting)
    prevStatusRef.current = effectiveStatus

    // Show QR from poll response if SSE hasn't delivered it yet
    if (payload.qrDataURL) {
      setQRDataURL(payload.qrDataURL)
    }
    if (payload.status === 'connected') {
      setQRDataURL(null)
      setPairingCode(null)
      setGettingCode(false)
    }

    // Pairing code arrives async via the status poll (works on Vercel Hobby)
    if (payload.pairingCode && !pairingCode) {
      setPairingCode(payload.pairingCode)
      setGettingCode(false)
      toast.success('Pairing code ready — enter it in WhatsApp')
    }

    // Background pairing failed — reset spinner
    if (payload.status === 'disconnected' && !payload.pairingCode) {
      setGettingCode(false)
    }

    if (prev !== 'connected' && payload.status === 'connected') {
      toast.success('WhatsApp connected!')
    }
    if (prev === 'connected' && payload.status !== 'connected') {
      toast('WhatsApp disconnected — reconnecting…', { icon: '⚠️' })
    }
  }, [pairingCode])

  const startSSE = useCallback(() => {
    stopSSE()
    const token = getToken()
    if (!token) return

    const es = new EventSource(`/api/whatsapp/qr?t=${Date.now()}&token=${encodeURIComponent(token)}`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)

        if (data.type === 'qr') {
          setQRDataURL(data.qrDataURL)
          setStatus('connecting')
          setIsAutoReconnecting(false)
          prevStatusRef.current = 'connecting'
        }

        if (data.type === 'connected') {
          setQRDataURL(null)
          setPairingCode(null)
          applyStatus({ status: 'connected', phone: data.phone, hasQR: false, qrDataURL: null, isAutoReconnecting: false })
          stopSSE()
        }

        if (data.type === 'status') {
          if (data.status === 'connected') {
            applyStatus({ status: 'connected', phone: data.phone || connectedPhoneRef.current, hasQR: false, qrDataURL: null, isAutoReconnecting: false })
            stopSSE()
          }
        }

        if (data.type === 'logged-out') {
          setStatus('disconnected')
          setQRDataURL(null)
          setPairingCode(null)
          setConnectedPhone(null)
          setIsAutoReconnecting(false)
          prevStatusRef.current = 'disconnected'
          stopSSE()
        }
      } catch {}
    }

    es.onerror = () => {
      // EventSource auto-retries on error — only clear our ref if permanently closed
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null
      }
    }
  }, [stopSSE, applyStatus])

  // Periodic status poll — primary delivery mechanism on Vercel Hobby.
  // Poll faster while connecting (2 s) so QR codes and pairing codes arrive
  // promptly. Back off to 5 s once connected (just keep-alive checks).
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await api.get<StatusPayload>('/whatsapp/status')
        applyStatus(res)

        // If backend is connecting and we're not watching via SSE, open it
        if (res.status === 'connecting' && !esRef.current) {
          startSSE()
        }
        // If backend became connected and SSE is still open, close it
        if (res.status === 'connected' && esRef.current) {
          stopSSE()
        }
      } catch {}
    }

    poll() // immediate check on mount
    const interval = status === 'connecting' ? 1_000 : 5_000
    const id = setInterval(poll, interval)
    return () => clearInterval(id)
  }, [applyStatus, startSSE, stopSSE, status])

  // Cleanup SSE on unmount
  useEffect(() => () => stopSSE(), [stopSSE])

  const handleConnect = async () => {
    setStatus('connecting')
    setQRDataURL(null)
    setPairingCode(null)
    setIsAutoReconnecting(false)
    prevStatusRef.current = 'connecting'
    // Suppress 'disconnected' from the status poll for 20 s so stale-creds
    // recovery and lock-release events don't reset the UI mid-flow.
    connectingUntilRef.current = Date.now() + 20_000

    try {
      // Reconnect waits up to 8 s for Baileys to generate a QR, then returns it.
      // This works on Vercel Hobby (10 s limit) and avoids fire-and-forget races.
      const res = await api.post<{ qrDataURL?: string | null; connected?: boolean; isAutoReconnecting?: boolean }>(
        '/whatsapp/reconnect', {}
      )
      if (res.qrDataURL) {
        setQRDataURL(res.qrDataURL)
      }
      if (res.connected) {
        applyStatus({ status: 'connected', phone: null, hasQR: false, qrDataURL: null, isAutoReconnecting: false })
      }
      if (res.isAutoReconnecting) {
        setIsAutoReconnecting(true)
      }
    } catch {}

    // Open SSE alongside the poll for push delivery of connection confirmation
    startSSE()
  }

  const handleGetPairingCode = async () => {
    const raw = pairingPhone.replace(/\D/g, '')
    if (!raw) { toast.error('Enter your WhatsApp phone number first'); return }
    // Require at least 10 digits — guard against missing country code
    if (raw.length < 10) {
      toast.error('Include your country code, e.g. 919429184788 for India (+91)')
      return
    }
    setGettingCode(true)
    setPairingCode(null)
    setStatus('connecting')
    setQRDataURL(null)
    prevStatusRef.current = 'connecting'
    // Suppress spurious 'disconnected' from the status poll for 60 s — the
    // handshake takes 3-15 s and code entry takes more time after that.
    connectingUntilRef.current = Date.now() + 60_000

    try {
      // The server awaits the full Noise Protocol handshake + pairing code
      // request and returns { code } directly — typically in 3-15 s.
      const res = await api.post<{ code?: string; error?: string }>('/whatsapp/pair', { phone: raw })
      if (res.code) {
        setPairingCode(res.code)
        setGettingCode(false)
        toast.success('Pairing code ready — enter it in WhatsApp')
      }
      // Open SSE so we get a push notification when WhatsApp confirms the link
      startSSE()
    } catch (e: unknown) {
      const msg = (e as Error).message || 'Failed to get pairing code'
      toast.error(msg)
      setStatus('disconnected')
      prevStatusRef.current = 'disconnected'
      connectingUntilRef.current = 0
      setGettingCode(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await api.post('/whatsapp/disconnect', {})
      setStatus('disconnected')
      setConnectedPhone(null)
      setQRDataURL(null)
      setIsAutoReconnecting(false)
      prevStatusRef.current = 'disconnected'
      stopSSE()
      toast.success('Disconnected from WhatsApp')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setDisconnecting(false)
    }
  }

  const handleSend = async () => {
    if (!phone || !message) { toast.error('Phone and message are required'); return }
    setSending(true)
    try {
      await api.post('/whatsapp/send', { phone, message })
      toast.success('Message sent!')
      setMessage('')
      qc.invalidateQueries({ queryKey: ['analytics'] })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const StatusDot = () => {
    if (status === 'connected') return (
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Connected</span>
      </div>
    )
    if (status === 'connecting') return (
      <div className="flex items-center gap-2">
        <RefreshCw className="w-3.5 h-3.5 text-yellow-500 animate-spin" />
        <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
          {isAutoReconnecting ? 'Auto-reconnecting…' : 'Connecting…'}
        </span>
      </div>
    )
    return (
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
        <span className="text-sm font-medium text-gray-500">Disconnected</span>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Connection Card */}
        <Card className={`border-2 transition-colors ${
          status === 'connected' ? 'border-emerald-400 dark:border-emerald-600' :
          status === 'connecting' ? 'border-yellow-300 dark:border-yellow-600' :
          'border-gray-200 dark:border-gray-700'
        }`}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="w-5 h-5" /> WhatsApp
              </CardTitle>
              <StatusDot />
            </div>
            <CardDescription>
              {status === 'connected'
                ? 'Your WhatsApp account is linked and ready'
                : isAutoReconnecting
                ? 'Restoring previous session — no scan needed'
                : connectMethod === 'phone'
                ? 'Enter your number, get a code, enter it in WhatsApp'
                : 'Scan the QR code with your phone to connect'}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col items-center gap-4">
            {status === 'connected' ? (
              <div className="w-full space-y-4">
                <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">Connected!</p>
                    {connectedPhone && (
                      <p className="text-sm text-emerald-600 dark:text-emerald-500 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> +{connectedPhone}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting
                    ? <RefreshCw className="w-4 h-4 animate-spin" />
                    : <><LogOut className="w-4 h-4" /> Disconnect WhatsApp</>}
                </Button>
              </div>

            ) : connectMethod === 'qr' && status === 'connecting' && qrDataURL ? (
              <>
                <div className="p-3 bg-white rounded-2xl shadow-md border border-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataURL} alt="WhatsApp QR Code" width={240} height={240} className="rounded-lg" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Scan with WhatsApp</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Open WhatsApp → <strong>⋮</strong> → Linked Devices → Link a Device
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Waiting for scan… QR refreshes every 60s</span>
                </div>
                <div className="flex flex-col gap-2 w-full">
                  <Button variant="outline" size="sm" className="w-full" onClick={handleConnect}>
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh QR
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <><LogOut className="w-3.5 h-3.5" /> Force Quit Session</>}
                  </Button>
                </div>
              </>

            ) : connectMethod === 'qr' && status === 'connecting' && !qrDataURL ? (
              <div className="flex flex-col items-center gap-4 py-6 w-full">
                {isAutoReconnecting ? (
                  <>
                    <div className="w-16 h-16 rounded-full bg-yellow-50 dark:bg-yellow-900/20 flex items-center justify-center">
                      <RefreshCw className="w-8 h-8 text-yellow-500 animate-spin" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Restoring session…</p>
                      <p className="text-xs text-gray-500 mt-1">Found saved credentials — reconnecting without QR</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Skeleton className="w-[240px] h-[240px] rounded-2xl" />
                    <p className="text-sm text-gray-500 animate-pulse">Generating QR code…</p>
                  </>
                )}
                <div className="flex flex-col gap-2 w-full">
                  <Button variant="outline" size="sm" className="w-full" onClick={handleConnect}>
                    <RefreshCw className="w-3.5 h-3.5" /> Force New QR
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <><LogOut className="w-3.5 h-3.5" /> Force Quit Session</>}
                  </Button>
                </div>
              </div>

            ) : (
              <div className="flex flex-col items-center gap-4 py-2 w-full">
                {/* Method toggle */}
                <div className="flex w-full rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-sm font-medium">
                  <button
                    onClick={() => { setConnectMethod('qr'); setPairingCode(null) }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                      connectMethod === 'qr'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white dark:bg-gray-900 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Wifi className="w-3.5 h-3.5" /> QR Code
                  </button>
                  <button
                    onClick={() => { setConnectMethod('phone'); setQRDataURL(null) }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
                      connectMethod === 'phone'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white dark:bg-gray-900 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Hash className="w-3.5 h-3.5" /> Phone Number
                  </button>
                </div>

                {connectMethod === 'qr' ? (
                  <>
                    <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      <WifiOff className="w-9 h-9 text-gray-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm text-gray-500 dark:text-gray-400">Not connected</p>
                      <p className="text-xs text-gray-400 mt-1">Generate a QR code and scan it with WhatsApp</p>
                    </div>
                    <Button className="w-full" onClick={handleConnect}>
                      <Wifi className="w-4 h-4" /> Generate QR Code
                    </Button>
                  </>
                ) : (
                  <div className="w-full space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-sm">Your WhatsApp phone number <span className="text-gray-400 font-normal">(with country code)</span></Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="919429184788 (no + or spaces)"
                          value={pairingPhone}
                          onChange={(e) => setPairingPhone(e.target.value)}
                          disabled={gettingCode}
                          type="tel"
                        />
                        <Button onClick={handleGetPairingCode} disabled={gettingCode || !pairingPhone || !!pairingCode} className="shrink-0">
                          {gettingCode ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Get Code'}
                        </Button>
                      </div>
                    </div>

                    {pairingCode ? (
                      <div className="flex flex-col items-center gap-2 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">Enter this code in WhatsApp</p>
                        <p className="text-3xl font-bold tracking-widest text-emerald-700 dark:text-emerald-300 font-mono">{pairingCode}</p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-500 text-center leading-relaxed">
                          WhatsApp → <strong>⋮</strong> → Linked Devices → Link with Phone Number
                        </p>
                        <div className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Waiting for confirmation…
                        </div>
                      </div>
                    ) : gettingCode ? (
                      <div className="flex items-center justify-center gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl border border-yellow-200 dark:border-yellow-800">
                        <RefreshCw className="w-5 h-5 text-yellow-500 animate-spin flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">Connecting to WhatsApp…</p>
                          <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-0.5">This can take up to 30 seconds</p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs text-gray-500 dark:text-gray-400 space-y-1">
                        <p className="font-medium text-gray-700 dark:text-gray-300">How it works</p>
                        <p>1. Enter your number <strong>with country code</strong> (e.g. 919429… for India) and click <strong>Get Code</strong></p>
                        <p>2. Wait ~10 seconds for the 8-digit code to appear</p>
                        <p>3. Open WhatsApp → <strong>⋮</strong> → Linked Devices → <strong>Link with Phone Number</strong></p>
                      </div>
                    )}

                    {status === 'connecting' && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full"
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                      >
                        {disconnecting
                          ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          : <><LogOut className="w-3.5 h-3.5" /> Cancel</>}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Send Message Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5" /> Send Message
            </CardTitle>
            <CardDescription>Send a direct WhatsApp message to any number</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Recipient</Label>
              <Input
                placeholder="+91 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {contactsData?.contacts?.length ? (
                <div>
                  <Label className="text-xs text-gray-400">Or pick a contact</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    onChange={(e) => { if (e.target.value) setPhone(e.target.value) }}
                    defaultValue=""
                  >
                    <option value="" disabled>Select a contact…</option>
                    {contactsData.contacts.map((c) => (
                      <option key={c._id} value={c.phone}>{c.name} — {c.phone}</option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea
                placeholder="Type your WhatsApp message…"
                className="min-h-[120px] resize-none"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <p className="text-xs text-gray-400 text-right">{message.length} chars</p>
            </div>

            <Button
              className="w-full"
              onClick={handleSend}
              disabled={status !== 'connected' || sending || !phone || !message}
            >
              {sending
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sending…</>
                : <><Send className="w-4 h-4" /> Send WhatsApp Message</>}
            </Button>

            {status !== 'connected' && (
              <div className={`flex items-center gap-2 p-3 rounded-lg border text-xs ${
                status === 'connecting'
                  ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500'
              }`}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {status === 'connecting'
                  ? isAutoReconnecting
                    ? 'Restoring session — sending will work once reconnected'
                    : connectMethod === 'phone'
                    ? (pairingCode ? 'Enter the code shown above in WhatsApp to finish connecting' : 'Get a pairing code on the left to connect')
                    : 'Waiting for QR scan…'
                  : 'Connect WhatsApp on the left to enable sending'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* How to connect guide */}
      {status !== 'connected' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How to Connect</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              {[
                { step: '1', title: 'Click Connect', desc: 'Press "Connect WhatsApp" to generate your QR code' },
                { step: '2', title: 'Open WhatsApp', desc: 'On your phone, tap ⋮ (menu) → Linked Devices' },
                { step: '3', title: 'Link Device', desc: 'Tap "Link a Device" and point your camera at the QR' },
                { step: '4', title: 'Ready!', desc: 'Once linked, the session is saved — auto-reconnects on restart' },
              ].map((s) => (
                <div key={s.step} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
                    {s.step}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white text-sm">{s.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session info when connected */}
      {status === 'connected' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Status', value: <span className="inline-flex items-center gap-1 text-emerald-600 font-medium text-sm"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" /> Live</span> },
                { label: 'Phone', value: connectedPhone ? `+${connectedPhone}` : '—' },
                { label: 'Protocol', value: 'Baileys WS' },
                { label: 'Encryption', value: 'End-to-End' },
              ].map((s) => (
                <div key={s.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{s.value}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
