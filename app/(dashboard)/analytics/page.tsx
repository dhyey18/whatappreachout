'use client'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, TrendingUp, MessageSquare, Users, CheckCircle2, Reply } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts'

interface AnalyticsData {
  overview: {
    totalContacts: number
    totalCampaigns: number
    totalSent: number
    totalDelivered: number
    totalReplied: number
    totalFailed: number
  }
  monthlyData: { month: string; sent: number; delivered: number; replied: number }[]
  recentCampaigns: {
    _id: string; name: string; status: string;
    stats: { total: number; sent: number; delivered: number; replied: number; failed: number }
    createdAt: string
  }[]
}

const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#ef4444']

const statusColors: Record<string, 'default' | 'warning' | 'info' | 'destructive' | 'secondary'> = {
  completed: 'default', running: 'info', scheduled: 'warning', draft: 'secondary', failed: 'destructive',
}

export default function AnalyticsPage() {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['analytics'],
    queryFn: () => api.get('/analytics'),
  })

  const ov = data?.overview

  const deliveryRate = ov?.totalSent
    ? Math.round((ov.totalDelivered / ov.totalSent) * 100)
    : 0
  const replyRate = ov?.totalDelivered
    ? Math.round((ov.totalReplied / Math.max(ov.totalDelivered, 1)) * 100)
    : 0

  const pieData = ov ? [
    { name: 'Delivered', value: ov.totalDelivered },
    { name: 'Replied', value: ov.totalReplied },
    { name: 'Failed', value: ov.totalFailed },
    { name: 'Pending', value: Math.max(0, ov.totalSent - ov.totalDelivered - ov.totalFailed) },
  ] : []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : [
          { label: 'Contacts', value: ov?.totalContacts || 0, icon: Users, color: 'text-emerald-600' },
          { label: 'Campaigns', value: ov?.totalCampaigns || 0, icon: BarChart3, color: 'text-blue-600' },
          { label: 'Sent', value: ov?.totalSent || 0, icon: MessageSquare, color: 'text-purple-600' },
          { label: 'Delivered', value: ov?.totalDelivered || 0, icon: CheckCircle2, color: 'text-emerald-600' },
          { label: 'Replied', value: ov?.totalReplied || 0, icon: Reply, color: 'text-orange-500' },
          { label: 'Reply Rate', value: `${replyRate}%`, icon: TrendingUp, color: 'text-pink-500' },
        ].map((s) => {
          const Icon = s.icon
          return (
            <Card key={s.label} className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${s.color}`} />
                <span className="text-xs text-gray-500">{s.label}</span>
              </div>
              <p className={`text-2xl font-bold ${s.color}`}>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</p>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Monthly Breakdown</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-64" /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data?.monthlyData || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="sent" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="delivered" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="replied" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Message Outcomes</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-64" /> : (
              <div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {pieData.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-xs text-gray-600 dark:text-gray-400">{item.name}: <strong>{item.value}</strong></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Delivery Rate Trend</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-48" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data?.monthlyData?.map((m) => ({
                ...m,
                deliveryRate: m.sent > 0 ? Math.round((m.delivered / m.sent) * 100) : 0,
                replyRate: m.delivered > 0 ? Math.round((m.replied / m.delivered) * 100) : 0,
              })) || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit="%" />
                <Tooltip formatter={(v) => `${v}%`} />
                <Legend />
                <Line type="monotone" dataKey="deliveryRate" stroke="#10b981" strokeWidth={2} name="Delivery Rate" dot={{ r: 4 }} />
                <Line type="monotone" dataKey="replyRate" stroke="#8b5cf6" strokeWidth={2} name="Reply Rate" dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Campaign Performance</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : data?.recentCampaigns?.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No campaigns yet</p>
          ) : (
            <div className="space-y-3">
              {data?.recentCampaigns?.map((c) => {
                const deliveryRate = c.stats.sent > 0 ? Math.round((c.stats.delivered / c.stats.sent) * 100) : 0
                const replyRate = c.stats.delivered > 0 ? Math.round((c.stats.replied / c.stats.delivered) * 100) : 0
                return (
                  <div key={c._id} className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <Badge variant={statusColors[c.status] || 'secondary'} className="text-xs capitalize flex-shrink-0">{c.status}</Badge>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{formatDate(c.createdAt)}</p>
                    </div>
                    <div className="hidden sm:flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className="font-semibold text-blue-600">{c.stats.sent}</p>
                        <p className="text-xs text-gray-500">Sent</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-emerald-600">{deliveryRate}%</p>
                        <p className="text-xs text-gray-500">Delivered</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-purple-600">{replyRate}%</p>
                        <p className="text-xs text-gray-500">Replied</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
