'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Plus, Trash2, Edit2, FileText, Loader2, X, Eye, Tag } from 'lucide-react'
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
import { formatDate, personalizeMessage } from '@/lib/utils'

interface Template {
  _id: string
  name: string
  content: string
  variables: string[]
  category: string
  createdAt: string
}

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  content: z.string().min(1, 'Content is required'),
  category: z.string().min(1),
})

type FormData = { name: string; content: string; category: string }

const categories = ['general', 'sales', 'support', 'marketing', 'follow-up', 'onboarding']

export default function TemplatesPage() {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTemplate, setEditTemplate] = useState<Template | null>(null)
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null)
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({})

  const { data, isLoading } = useQuery<{ templates: Template[] }>({
    queryKey: ['templates'],
    queryFn: () => api.get('/templates'),
  })

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { category: 'general' },
  })

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.post('/templates', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('Template saved'); closeDialog() },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/templates/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('Template deleted') },
    onError: (e: Error) => toast.error(e.message),
  })

  const openCreate = () => { setEditTemplate(null); reset({ category: 'general' }); setDialogOpen(true) }
  const openEdit = (t: Template) => {
    setEditTemplate(t)
    setValue('name', t.name)
    setValue('content', t.content)
    setValue('category', t.category)
    setDialogOpen(true)
  }
  const closeDialog = () => { setDialogOpen(false); setEditTemplate(null); reset() }

  const onSubmit = async (data: FormData) => {
    if (editTemplate) {
      try {
        await api.patch(`/templates/${editTemplate._id}`, data)
        qc.invalidateQueries({ queryKey: ['templates'] })
        toast.success('Template updated')
        closeDialog()
      } catch (e: unknown) {
        toast.error((e as Error).message)
      }
    } else {
      createMutation.mutate(data)
    }
  }

  const openPreview = (t: Template) => {
    setPreviewTemplate(t)
    const vars: Record<string, string> = {}
    t.variables.forEach((v) => { vars[v] = '' })
    setPreviewVars(vars)
  }

  const content = watch('content') || ''
  const liveVars = content.match(/\{\{(\w+)\}\}/g)?.map((m) => m.replace(/\{\{|\}\}/g, '')) || []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Message Templates</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.templates?.length || 0} templates</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4" /> New Template
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : data?.templates?.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 dark:text-gray-400 mb-3">No templates yet</p>
          <Button onClick={openCreate}>Create your first template</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data?.templates?.map((t) => (
            <Card key={t._id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{t.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDate(t.createdAt)}</p>
                  </div>
                  <Badge variant="outline" className="capitalize text-xs flex items-center gap-1">
                    <Tag className="w-3 h-3" />{t.category}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-3 bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5">
                  {t.content}
                </p>
                {t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {t.variables.map((v) => (
                      <Badge key={v} variant="secondary" className="text-xs font-mono">{`{{${v}}}`}</Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => openPreview(t)}>
                    <Eye className="w-3.5 h-3.5" /> Preview
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={() => { if (confirm('Delete this template?')) deleteMutation.mutate(t._id) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTemplate ? 'Edit Template' : 'Create Template'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Template Name *</Label>
                <Input placeholder="Welcome Message" {...register('name')} />
                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select defaultValue="general" onValueChange={(v) => setValue('category', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Message Content *</Label>
              <Textarea
                placeholder="Hi {{name}}, welcome to {{company}}! We're excited to..."
                className="min-h-[120px]"
                {...register('content')}
              />
              {errors.content && <p className="text-xs text-red-500">{errors.content.message}</p>}
              <p className="text-xs text-gray-400">Use {'{{variable}}'} syntax for dynamic values</p>
            </div>
            {liveVars.length > 0 && (
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-1">Detected variables:</p>
                <div className="flex flex-wrap gap-1">
                  {liveVars.map((v) => (
                    <Badge key={v} variant="default" className="text-xs font-mono">{`{{${v}}}`}</Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={closeDialog}>
                <X className="w-4 h-4" /> Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : editTemplate ? 'Save Changes' : 'Create Template'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Preview — {previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          {previewTemplate && (
            <div className="space-y-4">
              {previewTemplate.variables.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Fill in variables to preview:</p>
                  {previewTemplate.variables.map((v) => (
                    <div key={v} className="space-y-1.5">
                      <Label className="capitalize">{v}</Label>
                      <Input
                        placeholder={`Enter ${v}...`}
                        value={previewVars[v] || ''}
                        onChange={(e) => setPreviewVars({ ...previewVars, [v]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Preview:</p>
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
                  <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                    {personalizeMessage(previewTemplate.content, previewVars)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
