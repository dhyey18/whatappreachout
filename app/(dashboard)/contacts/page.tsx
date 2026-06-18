'use client'
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import Papa from 'papaparse'
import {
  Plus, Search, Upload, Trash2, Edit2, X, Loader2, Users, Filter,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'

interface Contact {
  _id: string
  name: string
  phone: string
  email?: string
  company?: string
  tags: string[]
  status: 'active' | 'inactive' | 'blocked'
  createdAt: string
}

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(7, 'Valid phone number required'),
  email: z.string().email().optional().or(z.literal('')),
  company: z.string().optional(),
  tags: z.string().optional(),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export default function ContactsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editContact, setEditContact] = useState<Contact | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const params = new URLSearchParams({ search, page: String(page), limit: '15' })
  if (status !== 'all') params.set('status', status)

  const { data, isLoading } = useQuery<{ contacts: Contact[]; total: number; pages: number }>({
    queryKey: ['contacts', search, status, page],
    queryFn: () => api.get(`/contacts?${params}`),
  })

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.post('/contacts', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts'] }); toast.success('Contact saved'); closeDialog() },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/contacts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contacts'] }); toast.success('Contact deleted') },
    onError: (e: Error) => toast.error(e.message),
  })

  const openCreate = () => { setEditContact(null); reset(); setDialogOpen(true) }
  const openEdit = (c: Contact) => {
    setEditContact(c)
    setValue('name', c.name)
    setValue('phone', c.phone)
    setValue('email', c.email || '')
    setValue('company', c.company || '')
    setValue('tags', c.tags.join(', '))
    setDialogOpen(true)
  }
  const closeDialog = () => { setDialogOpen(false); setEditContact(null); reset() }

  const onSubmit = async (data: FormData) => {
    const payload = {
      ...data,
      tags: data.tags ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    }
    if (editContact) {
      await api.patch(`/contacts/${editContact._id}`, payload)
      qc.invalidateQueries({ queryKey: ['contacts'] })
      toast.success('Contact updated')
      closeDialog()
    } else {
      createMutation.mutate(payload)
    }
  }

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const contacts = results.data.map((r) => ({
          name: r.name || r.Name || '',
          phone: r.phone || r.Phone || r.mobile || r.Mobile || '',
          email: r.email || r.Email || '',
          company: r.company || r.Company || '',
          tags: [],
        })).filter((c) => c.name && c.phone)

        if (!contacts.length) { toast.error('No valid contacts found in CSV'); return }
        try {
          const res = await api.post<{ imported: number }>('/contacts', contacts)
          qc.invalidateQueries({ queryKey: ['contacts'] })
          toast.success(`Imported ${res.imported} contacts`)
        } catch (e: unknown) {
          toast.error((e as Error).message)
        }
      },
    })
    e.target.value = ''
  }

  const statusBadge = (s: string) => {
    const map: Record<string, 'default' | 'secondary' | 'destructive'> = { active: 'default', inactive: 'secondary', blocked: 'destructive' }
    return <Badge variant={map[s] || 'secondary'}>{s}</Badge>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">All Contacts</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{data?.total || 0} total contacts</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSV} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add Contact
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search by name, phone, email..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
          <SelectTrigger className="w-36">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="hidden md:table-cell">Company</TableHead>
              <TableHead className="hidden lg:table-cell">Tags</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Added</TableHead>
              <TableHead className="w-20">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : data?.contacts?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-16">
                  <Users className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p className="text-gray-500 dark:text-gray-400">No contacts found</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={openCreate}>Add your first contact</Button>
                </TableCell>
              </TableRow>
            ) : (
              data?.contacts?.map((c) => (
                <TableRow key={c._id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                  <TableCell className="hidden md:table-cell text-gray-500">{c.company || '—'}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.slice(0, 2).map((t) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                      {c.tags.length > 2 && <Badge variant="outline" className="text-xs">+{c.tags.length - 2}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{statusBadge(c.status)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-gray-500 text-sm">{formatDate(c.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        onClick={() => { if (confirm('Delete this contact?')) deleteMutation.mutate(c._id) }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500">Page {page} of {data.pages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editContact ? 'Edit Contact' : 'Add New Contact'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Full Name *</Label>
                <Input placeholder="John Doe" {...register('name')} />
                {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Phone Number *</Label>
                <Input placeholder="+1 555 000 0000" {...register('phone')} />
                {errors.phone && <p className="text-xs text-red-500">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input placeholder="email@example.com" {...register('email')} />
              </div>
              <div className="space-y-1.5">
                <Label>Company</Label>
                <Input placeholder="Acme Inc." {...register('company')} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Tags (comma separated)</Label>
                <Input placeholder="vip, customer, lead" {...register('tags')} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={closeDialog}>
                <X className="w-4 h-4" /> Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : editContact ? 'Save Changes' : 'Add Contact'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
