'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Smartphone, WifiOff, MessageCircle, Send, RefreshCw,
  CheckCircle2, LogOut, Phone, Wifi,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'

interface Contact {
  _id: string
  name: string
  phone: string
}

type WAStatus = 'disconnected' | 'connecting' | 'connected'

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
  const esRef = useRef<EventSource | null>(null)

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

  const startSSE = useCallback(() => {
    stopSSE()
    const token = getToken()
    if (!token) return

    setStatus('connecting')
    setQRDataURL(null)

    const es = new EventSource(`/api/whatsapp/qr?t=${Date.now()}&token=${encodeURIComponent(token)}`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)

        if (data.type === 'qr') {
          setQRDataURL(data.qrDataURL)
          setStatus('connecting')
        }

        if (data.type === 'connected') {
          setQRDataURL(null)
          setStatus('connected')
          setConnectedPhone(data.phone)
          toast.success('WhatsApp connected!')
          stopSSE()
        }

        if (data.type === 'status') {
          if (data.status === 'connected') {
            setStatus('connected')
          } else if (data.status === 'disconnected') {
            setStatus('disconnected')
          }
        }

        if (data.type === 'logged-out') {
          setStatus('disconnected')
          setQRDataURL(null)
          setConnectedPhone(null)
          stopSSE()
        }
      } catch {}
    }

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null
      }
    }
  }, [stopSSE])

  // Check initial status on mount; resume SSE if the backend is still connecting
  useEffect(() => {
    api.get<{ status: WAStatus; phone: string | null }>('/whatsapp/status')
      .then((res) => {
        setStatus(res.status)
        setConnectedPhone(res.phone)
        if (res.status === 'connecting') {
          startSSE()
        }
      })
      .catch(() => {})
  }, [startSSE])

  // Cleanup on unmount
  useEffect(() => () => stopSSE(), [stopSSE])

  const handleConnect = () => startSSE()

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await api.post('/whatsapp/disconnect', {})
      setStatus('disconnected')
      setConnectedPhone(null)
      setQRDataURL(null)
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

  const StatusIndicator = () => {
    if (status === 'connected') return (
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Connected</span>
      </div>
    )
    if (status === 'connecting') return (
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse" />
        <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">Connecting...</span>
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
              <StatusIndicator />
            </div>
            <CardDescription>
              {status === 'connected'
                ? 'Your WhatsApp account is linked and ready'
                : 'Scan the QR code with your phone to connect'}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col items-center">
            {/* QR Code area */}
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
            ) : status === 'connecting' && qrDataURL ? (
              <div className="flex flex-col items-center gap-4 w-full">
                <div className="p-3 bg-white rounded-2xl shadow-md border border-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataURL}
                    alt="WhatsApp QR Code"
                    width={240}
                    height={240}
                    className="rounded-lg"
                  />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Scan with WhatsApp</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Open WhatsApp → <strong>⋮</strong> → Linked Devices → Link a Device
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-400">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Waiting for scan... QR expires in 60s</span>
                </div>
                <Button variant="outline" size="sm" onClick={startSSE}>
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh QR
                </Button>
              </div>
            ) : status === 'connecting' && !qrDataURL ? (
              <div className="flex flex-col items-center gap-4 py-6">
                <Skeleton className="w-[240px] h-[240px] rounded-2xl" />
                <p className="text-sm text-gray-500 animate-pulse">Generating QR code...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-5 py-4 w-full">
                <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <WifiOff className="w-10 h-10 text-gray-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Not connected</p>
                  <p className="text-xs text-gray-400 mt-1">Click below to generate your QR code</p>
                </div>
                <Button className="w-full" onClick={handleConnect}>
                  <Wifi className="w-4 h-4" /> Connect WhatsApp
                </Button>
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
            <CardDescription>Send a direct WhatsApp message to any contact</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Recipient</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="+91 9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="flex-1"
                />
              </div>
              {contactsData?.contacts?.length ? (
                <div>
                  <Label className="text-xs text-gray-400">Or pick a contact</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    onChange={(e) => { if (e.target.value) setPhone(e.target.value) }}
                    defaultValue=""
                  >
                    <option value="" disabled>Select a contact...</option>
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
                placeholder="Type your WhatsApp message..."
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
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sending...</>
                : <><Send className="w-4 h-4" /> Send WhatsApp Message</>}
            </Button>

            {status !== 'connected' && (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <WifiOff className="w-4 h-4 text-yellow-600 flex-shrink-0" />
                <p className="text-xs text-yellow-700 dark:text-yellow-400">
                  Connect WhatsApp on the left to enable sending
                </p>
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
                { step: '1', title: 'Click Connect', desc: 'Press the Connect WhatsApp button to generate your QR code' },
                { step: '2', title: 'Open WhatsApp', desc: 'On your phone, tap ⋮ (menu) → Linked Devices' },
                { step: '3', title: 'Link Device', desc: 'Tap "Link a Device" and point camera at the QR code' },
                { step: '4', title: 'Ready!', desc: 'Your account links and you can start sending messages' },
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

      {/* Stats when connected */}
      {status === 'connected' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Session Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Status', value: <Badge variant="default">Live</Badge> },
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
