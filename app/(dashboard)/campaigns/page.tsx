'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Plus, Trash2, Eye, Megaphone, Loader2, X, Play, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'

interface Campaign {
  _id: string
  name: string
  message: string
  status: string
  contacts: string[]
  stats: { total: number; sent: number; delivered: number; failed: number; replied: number }
  scheduledAt?: string
  createdAt: string
}

interface Template {
  _id: string
  name: string
  content: string
}

const schema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  message: z.string().min(1, 'Message is required'),
  templateId: z.string().optional(),
  scheduledAt: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const statusColors: Record<string, 'default' | 'warning' | 'info' | 'destructive' | 'secondary'> = {
  completed: 'default',
  running: 'info',
  scheduled: 'warning',
  draft: 'secondary',
  failed: 'destructive',
  paused: 'secondary',
}

export default function CampaignsPage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewCampaign, setViewCampaign] = useState<Campaign | null>(null)

  const params = new URLSearchParams({ page: String(page), limit: '10' })
  if (statusFilter !== 'all') params.set('status', statusFilter)

  const { data, isLoading } = useQuery<{ campaigns: Campaign[]; total: number; pages: number }>({
    queryKey: ['campaigns', statusFilter, page],
    queryFn: () => api.get(`/campaigns?${params}`),
  })

  const { data: templatesData } = useQuery<{ templates: Template[] }>({
    queryKey: ['templates'],
    queryFn: () => api.get('/templates'),
  })

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.post('/campaigns', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Campaign created'); setDialogOpen(false); reset() },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Campaign deleted') },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/campaigns/${id}`, { status })
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success(`Campaign ${status}`)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }

  const onSubmit = (data: FormData) => {
    createMutation.mutate({ ...data, contacts: [] })
  }

  const selectedTemplate = watch('templateId')
  const handleTemplateSelect = (id: string) => {
    setValue('templateId', id)
    const tpl = templatesData?.templates.find((t) => t._id === id)
    if (tpl) setValue('message', tpl.content)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Campaigns</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.total || 0} total campaigns</p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4" /> New Campaign
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', 'draft', 'scheduled', 'running', 'completed', 'failed'].map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              statusFilter === s
                ? 'bg-emerald-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            {s === 'all' ? 'All' : s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : data?.campaigns?.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          <Megaphone className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 dark:text-gray-400 mb-3">No campaigns found</p>
          <Button onClick={() => setDialogOpen(true)}>Create your first campaign</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data?.campaigns?.map((c) => (
            <Card key={c._id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{c.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(c.createdAt)}</p>
                  </div>
                  <Badge variant={statusColors[c.status] || 'secondary'} className="capitalize">{c.status}</Badge>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 line-clamp-2">{c.message}</p>
                <div className="grid grid-cols-4 gap-2 mb-4 text-center">
                  {[
                    ['Total', c.stats.total, 'text-gray-600'],
                    ['Sent', c.stats.sent, 'text-blue-600'],
                    ['Delivered', c.stats.delivered, 'text-emerald-600'],
                    ['Replied', c.stats.replied, 'text-purple-600'],
                  ].map(([l, v, col]) => (
                    <div key={String(l)} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2">
                      <p className={`text-lg font-bold ${col}`}>{v}</p>
                      <p className="text-xs text-gray-500">{l}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => setViewCampaign(c)}>
                    <Eye className="w-3.5 h-3.5" /> View
                  </Button>
                  {c.status === 'draft' && (
                    <Button size="sm" className="flex-1" onClick={() => updateStatus(c._id, 'running')}>
                      <Play className="w-3.5 h-3.5" /> Launch
                    </Button>
                  )}
                  {c.status === 'running' && (
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => updateStatus(c._id, 'paused')}>
                      Pause
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={() => { if (confirm('Delete this campaign?')) deleteMutation.mutate(c._id) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Campaign</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Campaign Name *</Label>
              <Input placeholder="Summer Promo 2024" {...register('name')} />
              {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
            </div>

            {templatesData?.templates?.length ? (
              <div className="space-y-1.5">
                <Label>Use Template (optional)</Label>
                <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templatesData.templates.map((t) => (
                      <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Message *</Label>
              <Textarea
                placeholder="Hi {{name}}, I wanted to reach out about..."
                className="min-h-[100px]"
                {...register('message')}
              />
              {errors.message && <p className="text-xs text-red-500">{errors.message.message}</p>}
              <p className="text-xs text-gray-400">Use {'{{name}}'}, {'{{company}}'} for personalization</p>
            </div>

            <div className="space-y-1.5">
              <Label><Calendar className="w-4 h-4 inline mr-1" />Schedule (optional)</Label>
              <Input type="datetime-local" {...register('scheduledAt')} />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => { setDialogOpen(false); reset() }}>
                <X className="w-4 h-4" /> Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Campaign'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewCampaign} onOpenChange={() => setViewCampaign(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{viewCampaign?.name}</DialogTitle>
          </DialogHeader>
          {viewCampaign && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={statusColors[viewCampaign.status] || 'secondary'} className="capitalize">{viewCampaign.status}</Badge>
                <span className="text-sm text-gray-500">{formatDateTime(viewCampaign.createdAt)}</span>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{viewCampaign.message}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Total Contacts', viewCampaign.stats.total, 'text-gray-600'],
                  ['Sent', viewCampaign.stats.sent, 'text-blue-600'],
                  ['Delivered', viewCampaign.stats.delivered, 'text-emerald-600'],
                  ['Failed', viewCampaign.stats.failed, 'text-red-500'],
                  ['Replied', viewCampaign.stats.replied, 'text-purple-600'],
                ].map(([l, v, col]) => (
                  <div key={String(l)} className="bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                    <p className={`text-2xl font-bold ${col}`}>{v}</p>
                    <p className="text-xs text-gray-500">{l}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
