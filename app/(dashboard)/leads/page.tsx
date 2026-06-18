'use client'
import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Download, Search, Send, RefreshCw, ChevronLeft, ChevronRight,
  Building2, Globe, MapPin, Star, Phone, Zap,
  CheckCircle2, XCircle, Clock, SkipForward, MessageSquare, Loader2,
  Settings2, Eye, Edit3, X, AlertCircle, ArrowRight,
  TrendingUp, Users, Target, MessageCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { buildOutreachMessage, DEFAULT_TEMPLATE_CONFIG } from '@/lib/message-templates'
import type { TemplateConfig } from '@/lib/message-templates'

function isSocialUrl(url?: string): boolean {
  return !!url && /facebook\.com|fb\.com|fb\.me|instagram\.com/i.test(url)
}

interface Lead {
  _id: string
  name: string
  phone: string
  website?: string
  address?: string
  rating?: number
  reviews?: number
  industry: string
  city: string
  stage: 0 | 1 | 2
  status: string
  lastContactedAt?: string
  notes?: string
  sourceFile: string
}

interface LeadFile {
  relativePath: string
  city: string
  industry: string
  filename: string
  total: number
  withPhone: number
  imported: number
}

interface LeadsData {
  leads: Lead[]
  total: number
  pages: number
  statusCounts: Record<string, number>
}

const STATUS_CONFIG: Record<string, { label: string; color: 'default' | 'secondary' | 'info' | 'warning' | 'destructive' | 'outline'; emoji: string }> = {
  pending: { label: 'Pending', color: 'secondary', emoji: '⏳' },
  stage1_sent: { label: 'Contacted', color: 'info', emoji: '📨' },
  stage2_sent: { label: 'Followed Up', color: 'warning', emoji: '🔄' },
  replied: { label: 'Replied', color: 'default', emoji: '💬' },
  converted: { label: 'Converted', color: 'default', emoji: '✅' },
  not_whatsapp: { label: 'Not on WA', color: 'outline', emoji: '🚫' },
  failed: { label: 'Failed', color: 'destructive', emoji: '❌' },
  skipped: { label: 'Skipped', color: 'outline', emoji: '⏭️' },
}

const CITIES = ['ahmedabad', 'surat', 'vadodara']
const INDUSTRIES = [
  'automobile', 'ca', 'clinic', 'clothing', 'dental', 'education', 'events',
  'fitness', 'hotel', 'immigration', 'interior', 'jewellery', 'manufacturing',
  'pharmacy', 'photography', 'realestate', 'restaurant',
]
const WEBSITE_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'no_website', label: 'No website' },
  { value: 'has_website', label: 'Has website' },
  { value: 'social_only', label: 'Social only' },
]

const TEMPLATE_CONFIG_KEY = 'wa_template_config'

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try { return JSON.parse(localStorage.getItem('auth-store') || '{}').state?.token || null } catch { return null }
}

function loadTemplateConfig(): TemplateConfig {
  if (typeof window === 'undefined') return DEFAULT_TEMPLATE_CONFIG
  try { return { ...DEFAULT_TEMPLATE_CONFIG, ...JSON.parse(localStorage.getItem(TEMPLATE_CONFIG_KEY) || '{}') } } catch { return DEFAULT_TEMPLATE_CONFIG }
}
function saveTemplateConfig(cfg: TemplateConfig) {
  if (typeof window !== 'undefined') localStorage.setItem(TEMPLATE_CONFIG_KEY, JSON.stringify(cfg))
}
function getWebsiteType(website?: string): 'has_website' | 'no_website' | 'social_only' {
  if (!website) return 'no_website'
  if (isSocialUrl(website)) return 'social_only'
  return 'has_website'
}

export default function LeadsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('all')
  const [industryFilter, setIndustryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [websiteTypeFilter, setWebsiteTypeFilter] = useState('all')
  const [minRating, setMinRating] = useState(0)
  const [page, setPage] = useState(1)

  const [templateConfig, setTemplateConfig] = useState<TemplateConfig>(DEFAULT_TEMPLATE_CONFIG)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [configDraft, setConfigDraft] = useState<TemplateConfig>(DEFAULT_TEMPLATE_CONFIG)

  const [importDialogOpen, setImportDialogOpen] = useState(false)

  const [previewState, setPreviewState] = useState<{ lead: Lead; stage: 1 | 2; message: string } | null>(null)
  const [editingMessage, setEditingMessage] = useState(false)
  const [editedMessage, setEditedMessage] = useState('')

  const [detailLead, setDetailLead] = useState<Lead | null>(null)
  const [notesDraft, setNotesDraft] = useState('')

  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [batchCity, setBatchCity] = useState('all')
  const [batchIndustry, setBatchIndustry] = useState('all')
  const [batchWebsiteType, setBatchWebsiteType] = useState('all')
  const [batchMinRating, setBatchMinRating] = useState(0)
  const [batchStage, setBatchStage] = useState<1 | 2>(1)
  const [batchSize, setBatchSize] = useState(20)
  const [batchDelay, setBatchDelay] = useState(20)
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ sent: number; failed: number; total: number; current?: string } | null>(null)

  const [sendingId, setSendingId] = useState<string | null>(null)

  useEffect(() => { setTemplateConfig(loadTemplateConfig()) }, [])

  const buildPreview = useCallback((lead: Lead, stage: 1 | 2): string => {
    const socialOnly = isSocialUrl(lead.website)
    const hasWebsite = !!lead.website && !socialOnly
    return buildOutreachMessage(lead.name, lead.industry, hasWebsite, socialOnly, lead.city, stage, templateConfig)
  }, [templateConfig])

  const filterParams = new URLSearchParams({ page: String(page), limit: '25' })
  if (search) filterParams.set('search', search)
  if (cityFilter !== 'all') filterParams.set('city', cityFilter)
  if (industryFilter !== 'all') filterParams.set('industry', industryFilter)
  if (statusFilter !== 'all') filterParams.set('status', statusFilter)
  if (websiteTypeFilter !== 'all') filterParams.set('websiteType', websiteTypeFilter)
  if (minRating > 0) filterParams.set('minRating', String(minRating))

  const { data, isLoading } = useQuery<LeadsData>({
    queryKey: ['leads', search, cityFilter, industryFilter, statusFilter, websiteTypeFilter, minRating, page],
    queryFn: () => api.get(`/leads?${filterParams}`),
  })

  const { data: filesData, isLoading: filesLoading } = useQuery<{ files: LeadFile[] }>({
    queryKey: ['lead-files'],
    queryFn: () => api.get('/leads/files'),
    enabled: importDialogOpen,
  })

  const importMutation = useMutation({
    mutationFn: (relativePath: string) => api.post<{ imported: number }>('/leads/import', { relativePath }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['lead-files'] })
      toast.success(`Imported ${res.imported} leads from ${vars.split('/').pop()}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sendMutation = useMutation({
    mutationFn: ({ leadId, stage, customMessage }: { leadId: string; stage: 1 | 2; customMessage?: string }) =>
      api.post<{ success: boolean }>('/leads/send', { leadId, stage, customMessage, templateConfig }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success('Message sent!'); setPreviewState(null) },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSendingId(null),
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Lead> }) => api.patch(`/leads/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success('Lead updated'); setDetailLead(null) },
    onError: (e: Error) => toast.error(e.message),
  })

  const openPreview = (lead: Lead, stage: 1 | 2) => {
    const msg = buildPreview(lead, stage)
    setPreviewState({ lead, stage, message: msg })
    setEditedMessage(msg)
    setEditingMessage(false)
  }

  const handleSendConfirm = () => {
    if (!previewState) return
    setSendingId(previewState.lead._id)
    sendMutation.mutate({
      leadId: previewState.lead._id,
      stage: previewState.stage,
      customMessage: editingMessage ? editedMessage : undefined,
    })
  }

  const startBatchSend = () => {
    setBatchRunning(true)
    setBatchProgress({ sent: 0, failed: 0, total: 0 })
    const token = getToken()
    const body = {
      stage: batchStage, batchSize, delayMs: batchDelay * 1000, templateConfig,
      ...(batchCity !== 'all' && { city: batchCity }),
      ...(batchIndustry !== 'all' && { industry: batchIndustry }),
      ...(batchWebsiteType !== 'all' && { websiteType: batchWebsiteType }),
      ...(batchMinRating > 0 && { minRating: batchMinRating }),
    }
    fetch('/api/leads/batch-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) { const e = await res.json(); toast.error(e.error || 'Batch failed'); setBatchRunning(false); return }
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = dec.decode(value).split('\n').filter((l) => l.startsWith('data:'))
        for (const line of lines) {
          try {
            const d = JSON.parse(line.slice(5))
            if (d.type === 'progress') setBatchProgress({ sent: d.sent, failed: d.failed, total: d.total, current: d.current })
            if (d.type === 'error') { toast.error(d.message); setBatchRunning(false) }
            if (d.type === 'done') { toast.success(`Batch done — ${d.sent} sent, ${d.failed} failed`); setBatchRunning(false); qc.invalidateQueries({ queryKey: ['leads'] }) }
          } catch {}
        }
      }
    }).catch((e) => { toast.error(e.message); setBatchRunning(false) })
  }

  const saveConfig = () => {
    setTemplateConfig(configDraft)
    saveTemplateConfig(configDraft)
    setConfigDialogOpen(false)
    toast.success('Settings saved')
  }

  const statusTotals = data?.statusCounts || {}
  const totalLeads = Object.values(statusTotals).reduce((a, b) => a + b, 0)
  const contacted = (statusTotals.stage1_sent || 0) + (statusTotals.stage2_sent || 0)
  const replies = (statusTotals.replied || 0) + (statusTotals.converted || 0)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Lead Outreach</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{totalLeads.toLocaleString()} leads · sending as <strong>{templateConfig.senderName}</strong></p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setConfigDraft(templateConfig); setConfigDialogOpen(true) }}>
            <Settings2 className="w-4 h-4" /> Settings
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
            <Download className="w-4 h-4" /> Import
          </Button>
          <Button size="sm" onClick={() => setBatchDialogOpen(true)}>
            <Zap className="w-4 h-4" /> Batch Send
          </Button>
        </div>
      </div>

      {/* Pipeline stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Leads', value: totalLeads, icon: Users, color: 'blue' },
          { label: 'Contacted', value: contacted, icon: MessageCircle, color: 'emerald' },
          { label: 'Replies', value: replies, icon: MessageSquare, color: 'purple' },
          { label: 'Converted', value: statusTotals.converted || 0, icon: Target, color: 'amber' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className={`border-0 bg-${color}-50 dark:bg-${color}-900/20`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xs text-${color}-600 dark:text-${color}-400 font-medium`}>{label}</p>
                  <p className={`text-2xl font-bold text-${color}-700 dark:text-${color}-300`}>{value.toLocaleString()}</p>
                </div>
                <Icon className={`w-8 h-8 text-${color}-400`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status filter strip */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => { setStatusFilter('all'); setPage(1) }}
          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all ${
            statusFilter === 'all' ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-transparent' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
          }`}>All ({totalLeads})</button>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <button key={key} onClick={() => { setStatusFilter(statusFilter === key ? 'all' : key); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-all ${
              statusFilter === key ? 'bg-emerald-600 text-white border-transparent' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
            }`}>
            {cfg.emoji} {cfg.label} ({statusTotals[key] || 0})
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="Search name or phone..." className="pl-9 h-8 text-sm"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <Select value={cityFilter} onValueChange={(v) => { setCityFilter(v); setPage(1) }}>
          <SelectTrigger className="h-8 w-36 text-sm"><MapPin className="w-3.5 h-3.5 mr-1 shrink-0" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cities</SelectItem>
            {CITIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={industryFilter} onValueChange={(v) => { setIndustryFilter(v); setPage(1) }}>
          <SelectTrigger className="h-8 w-40 text-sm"><Building2 className="w-3.5 h-3.5 mr-1 shrink-0" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Industries</SelectItem>
            {INDUSTRIES.map((i) => <SelectItem key={i} value={i} className="capitalize">{i}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={websiteTypeFilter} onValueChange={(v) => { setWebsiteTypeFilter(v); setPage(1) }}>
          <SelectTrigger className="h-8 w-36 text-sm"><Globe className="w-3.5 h-3.5 mr-1 shrink-0" /><SelectValue /></SelectTrigger>
          <SelectContent>
            {WEBSITE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(minRating)} onValueChange={(v) => { setMinRating(Number(v)); setPage(1) }}>
          <SelectTrigger className="h-8 w-32 text-sm"><Star className="w-3.5 h-3.5 mr-1 shrink-0" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any Rating</SelectItem>
            <SelectItem value="3">3+ Stars</SelectItem>
            <SelectItem value="4">4+ Stars</SelectItem>
            <SelectItem value="4.5">4.5+ Stars</SelectItem>
          </SelectContent>
        </Select>
        {(cityFilter !== 'all' || industryFilter !== 'all' || websiteTypeFilter !== 'all' || minRating > 0 || search) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-gray-500"
            onClick={() => { setCityFilter('all'); setIndustryFilter('all'); setWebsiteTypeFilter('all'); setMinRating(0); setSearch(''); setPage(1) }}>
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Leads grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      ) : data?.leads?.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          <Building2 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 dark:text-gray-400 mb-3">No leads found</p>
          <Button onClick={() => setImportDialogOpen(true)}>Import your first file</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data?.leads?.map((lead) => {
            const cfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.pending
            const wt = getWebsiteType(lead.website)
            const canSendS1 = lead.status === 'pending'
            const canSendS2 = lead.status === 'stage1_sent'
            const isSending = sendingId === lead._id
            return (
              <div key={lead._id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-2.5">
                  <div className="flex-1 min-w-0 pr-2">
                    <h3 className="font-semibold text-sm text-gray-900 dark:text-white leading-tight truncate">{lead.name}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-500 capitalize">{lead.industry}</span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="text-xs text-gray-500 capitalize">{lead.city}</span>
                      {lead.rating && <><span className="text-gray-300 dark:text-gray-600">·</span><span className="text-xs text-amber-500 flex items-center gap-0.5"><Star className="w-3 h-3" />{lead.rating}</span></>}
                    </div>
                  </div>
                  <Badge variant={cfg.color} className="text-xs flex-shrink-0">{cfg.label}</Badge>
                </div>

                <div className="space-y-1 mb-3">
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <Phone className="w-3 h-3 flex-shrink-0 text-gray-400" /><span className="font-mono">{lead.phone}</span>
                  </div>
                  {lead.website ? (
                    <div className="flex items-center gap-1.5 text-xs truncate">
                      <Globe className="w-3 h-3 flex-shrink-0 text-gray-400" />
                      {wt === 'social_only'
                        ? <span className="text-orange-500">Social only</span>
                        : <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate">{lead.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-gray-400"><Globe className="w-3 h-3 flex-shrink-0" /><span>No website</span></div>
                  )}
                  {lead.lastContactedAt && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-400"><Clock className="w-3 h-3 flex-shrink-0" /><span>Last: {new Date(lead.lastContactedAt).toLocaleDateString()}</span></div>
                  )}
                  {lead.notes && <p className="text-xs text-gray-500 italic truncate">"{lead.notes}"</p>}
                </div>

                <div className="flex gap-1.5">
                  {canSendS1 && (
                    <Button size="sm" className="flex-1 h-8 text-xs gap-1" onClick={() => openPreview(lead, 1)} disabled={isSending}>
                      {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Eye className="w-3 h-3" /> Preview & Send</>}
                    </Button>
                  )}
                  {canSendS2 && (
                    <Button size="sm" variant="outline" className="flex-1 h-8 text-xs gap-1" onClick={() => openPreview(lead, 2)} disabled={isSending}>
                      {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><ArrowRight className="w-3 h-3" /> Follow Up</>}
                    </Button>
                  )}
                  {!canSendS1 && !canSendS2 && (
                    <div className="flex-1 flex items-center justify-center text-xs text-gray-400 gap-1 h-8">
                      {lead.status === 'stage2_sent' && <><TrendingUp className="w-3.5 h-3.5 text-blue-400" /> Both stages sent</>}
                      {lead.status === 'replied' && <><CheckCircle2 className="w-3.5 h-3.5 text-purple-500" /> Replied</>}
                      {lead.status === 'converted' && <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Converted</>}
                      {lead.status === 'not_whatsapp' && <><XCircle className="w-3.5 h-3.5 text-gray-400" /> Not on WA</>}
                      {lead.status === 'failed' && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 px-2" onClick={() => openPreview(lead, 1)}>
                          <AlertCircle className="w-3 h-3" /> Retry
                        </Button>
                      )}
                      {lead.status === 'skipped' && <><SkipForward className="w-3.5 h-3.5 text-gray-400" /> Skipped</>}
                    </div>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-gray-700"
                    onClick={() => { setDetailLead(lead); setNotesDraft(lead.notes || '') }}>
                    <Edit3 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Page {page} of {data.pages} · {data.total.toLocaleString()} results</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* ── Template Config Dialog ── */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Settings2 className="w-5 h-5 text-emerald-500" /> Message Settings</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">These values are injected into every outreach message. Change them to personalise your pitch.</p>
            <div className="space-y-1.5"><Label>Your Name</Label><Input value={configDraft.senderName} onChange={(e) => setConfigDraft({ ...configDraft, senderName: e.target.value })} placeholder="Dhyey" /></div>
            <div className="space-y-1.5"><Label>Your WhatsApp / Contact</Label><Input value={configDraft.senderPhone} onChange={(e) => setConfigDraft({ ...configDraft, senderPhone: e.target.value })} placeholder="+91 94291 84788" /></div>
            <div className="space-y-1.5"><Label>Website Price</Label><Input value={configDraft.websitePrice} onChange={(e) => setConfigDraft({ ...configDraft, websitePrice: e.target.value })} placeholder="₹8,000" /></div>
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs text-gray-500 dark:text-gray-400">
              Preview: <em>&ldquo;I build them for <strong>{configDraft.websitePrice}</strong>, ready in about a week. — {configDraft.senderName} ({configDraft.senderPhone})&rdquo;</em>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfigDialogOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={saveConfig}>Save Settings</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Preview & Send Dialog ── */}
      <Dialog open={!!previewState} onOpenChange={() => { setPreviewState(null); setEditingMessage(false) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-emerald-500" />
              {previewState?.stage === 1 ? 'Stage 1 — Initial Outreach' : 'Stage 2 — Follow-up'}
            </DialogTitle>
          </DialogHeader>
          {previewState && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{previewState.lead.name}</p>
                  <p className="text-xs text-gray-500">{previewState.lead.phone} · {previewState.lead.city} · {previewState.lead.industry}</p>
                </div>
                <Badge variant="secondary" className="text-xs capitalize">{getWebsiteType(previewState.lead.website).replace('_', ' ')}</Badge>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Message Preview</Label>
                  <button className="text-xs text-emerald-600 hover:underline flex items-center gap-1"
                    onClick={() => { setEditingMessage(!editingMessage); setEditedMessage(previewState.message) }}>
                    <Edit3 className="w-3 h-3" />{editingMessage ? 'Use template' : 'Edit message'}
                  </button>
                </div>
                {editingMessage ? (
                  <Textarea className="min-h-[200px] text-sm font-mono resize-none" value={editedMessage}
                    onChange={(e) => setEditedMessage(e.target.value)} />
                ) : (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                    {previewState.message}
                  </div>
                )}
                <p className="text-xs text-gray-400 text-right">{(editingMessage ? editedMessage : previewState.message).length} chars</p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => { setPreviewState(null); setEditingMessage(false) }}>Cancel</Button>
                <Button className="flex-1" onClick={handleSendConfirm} disabled={sendMutation.isPending || (editingMessage && !editedMessage.trim())}>
                  {sendMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Send via WhatsApp</>}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Lead Detail / Edit Dialog ── */}
      <Dialog open={!!detailLead} onOpenChange={() => setDetailLead(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Lead</DialogTitle></DialogHeader>
          {detailLead && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[['Name', detailLead.name], ['Industry', detailLead.industry], ['City', detailLead.city], ['Phone', detailLead.phone]].map(([l, v]) => (
                  <div key={l} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                    <p className="text-xs text-gray-400">{l}</p><p className="font-medium capitalize truncate">{v}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={detailLead.status} onValueChange={(v) => setDetailLead({ ...detailLead, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.emoji} {v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea placeholder="Add notes about this lead..." className="min-h-[80px] resize-none text-sm"
                  value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setDetailLead(null)}>Cancel</Button>
                <Button className="flex-1" disabled={patchMutation.isPending}
                  onClick={() => patchMutation.mutate({ id: detailLead._id, body: { status: detailLead.status, notes: notesDraft } })}>
                  {patchMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Import Dialog ── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Import Lead Files</DialogTitle></DialogHeader>
          {filesLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="space-y-4">
              {CITIES.map((city) => {
                const cityFiles = filesData?.files?.filter((f) => f.city === city) || []
                if (!cityFiles.length) return null
                const cityImported = cityFiles.reduce((a, f) => a + f.imported, 0)
                const cityTotal = cityFiles.reduce((a, f) => a + f.withPhone, 0)
                return (
                  <div key={city}>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 capitalize mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5" />{city}</span>
                      <span className="text-xs font-normal text-gray-400">{cityImported}/{cityTotal} imported</span>
                    </h3>
                    <div className="space-y-2">
                      {cityFiles.map((f) => (
                        <div key={f.relativePath} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white capitalize">{f.industry.replace(/_/g, ' ')}</p>
                            <p className="text-xs text-gray-500">{f.withPhone} with phone · <span className={f.imported > 0 ? 'text-emerald-600' : ''}>{f.imported} imported</span></p>
                          </div>
                          <Button size="sm" variant={f.imported > 0 ? 'outline' : 'default'}
                            disabled={importMutation.isPending && importMutation.variables === f.relativePath}
                            onClick={() => importMutation.mutate(f.relativePath)}>
                            {importMutation.isPending && importMutation.variables === f.relativePath
                              ? <Loader2 className="w-3 h-3 animate-spin" /> : f.imported > 0 ? 'Re-import' : 'Import'}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Batch Send Dialog ── */}
      <Dialog open={batchDialogOpen} onOpenChange={(v) => { if (!batchRunning) setBatchDialogOpen(v) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-emerald-500" /> Batch Outreach</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {([1, 2] as const).map((s) => (
                <button key={s} onClick={() => setBatchStage(s)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${batchStage === s ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
                  <p className="font-semibold text-sm">Stage {s}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s === 1 ? 'Initial pitch · pending leads' : 'Follow-up · contacted leads'}</p>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">City</Label>
                <Select value={batchCity} onValueChange={setBatchCity}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Cities</SelectItem>{CITIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Industry</Label>
                <Select value={batchIndustry} onValueChange={setBatchIndustry}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Industries</SelectItem>{INDUSTRIES.map((i) => <SelectItem key={i} value={i} className="capitalize">{i}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Website Type</Label>
                <Select value={batchWebsiteType} onValueChange={setBatchWebsiteType}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{WEBSITE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Min Rating</Label>
                <Select value={String(batchMinRating)} onValueChange={(v) => setBatchMinRating(Number(v))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="0">Any</SelectItem><SelectItem value="3">3+</SelectItem><SelectItem value="4">4+</SelectItem><SelectItem value="4.5">4.5+</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Batch Size</Label><Input type="number" min={1} max={100} className="h-9" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Delay (seconds)</Label><Input type="number" min={5} max={120} className="h-9" value={batchDelay} onChange={(e) => setBatchDelay(Number(e.target.value))} /></div>
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              Using: {templateConfig.senderName} · {templateConfig.senderPhone} · {templateConfig.websitePrice}
            </p>
            {batchRunning && batchProgress && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-emerald-500" /> Sending…</span>
                  <span className="text-gray-500 tabular-nums">{batchProgress.sent + batchProgress.failed}/{batchProgress.total}</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div className="bg-emerald-500 h-2 rounded-full transition-all"
                    style={{ width: batchProgress.total ? `${((batchProgress.sent + batchProgress.failed) / batchProgress.total) * 100}%` : '0%' }} />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-600">✓ {batchProgress.sent} sent</span>
                  {batchProgress.current && <span className="truncate mx-2 text-gray-500">{batchProgress.current}</span>}
                  <span className="text-red-500">✗ {batchProgress.failed} failed</span>
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" disabled={batchRunning} onClick={() => setBatchDialogOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={startBatchSend} disabled={batchRunning}>
                {batchRunning ? <><RefreshCw className="w-4 h-4 animate-spin" /> Running…</> : <><Zap className="w-4 h-4" /> Start Batch</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
