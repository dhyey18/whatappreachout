'use client'
import { useQuery } from '@tanstack/react-query'
import { Users, MessageSquare, Megaphone, TrendingUp, ArrowRight, Clock } from 'lucide-react'
import Link from 'next/link'
import { StatsCard } from '@/components/dashboard/stats-card'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
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
  recentCampaigns: { _id: string; name: string; status: string; stats: { total: number; sent: number; delivered: number }; createdAt: string }[]
}

const statusColors: Record<string, 'default' | 'warning' | 'info' | 'destructive' | 'secondary'> = {
  completed: 'default',
  running: 'info',
  scheduled: 'warning',
  draft: 'secondary',
  failed: 'destructive',
  paused: 'secondary',
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['analytics'],
    queryFn: () => api.get('/analytics'),
  })

  const overview = data?.overview

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))
        ) : (
          <>
            <StatsCard title="Total Contacts" value={overview?.totalContacts || 0} icon={Users} color="emerald" change="+12% this month" trend="up" />
            <StatsCard title="Messages Sent" value={overview?.totalSent || 0} icon={MessageSquare} color="blue" change="+8% this month" trend="up" />
            <StatsCard title="Campaigns" value={overview?.totalCampaigns || 0} icon={Megaphone} color="purple" />
            <StatsCard
              title="Response Rate"
              value={overview?.totalSent ? `${Math.round((overview.totalReplied / Math.max(overview.totalSent, 1)) * 100)}%` : '0%'}
              icon={TrendingUp}
              color="orange"
              change="+3% this month"
              trend="up"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Message Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data?.monthlyData || []}>
                  <defs>
                    <linearGradient id="sent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="delivered" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="replied" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="sent" stroke="#10b981" fill="url(#sent)" strokeWidth={2} />
                  <Area type="monotone" dataKey="delivered" stroke="#3b82f6" fill="url(#delivered)" strokeWidth={2} />
                  <Area type="monotone" dataKey="replied" stroke="#8b5cf6" fill="url(#replied)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Campaigns</CardTitle>
              <Link href="/campaigns">
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  View all <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : data?.recentCampaigns?.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No campaigns yet</p>
                <Link href="/campaigns">
                  <Button variant="outline" size="sm" className="mt-3">Create Campaign</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {data?.recentCampaigns?.map((c) => (
                  <div key={c._id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate text-gray-900 dark:text-gray-100">{c.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3 text-gray-400" />
                        <span className="text-xs text-gray-500">{formatDateTime(c.createdAt)}</span>
                      </div>
                    </div>
                    <Badge variant={statusColors[c.status] || 'secondary'} className="ml-2 flex-shrink-0">
                      {c.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { title: 'Total Delivered', value: overview?.totalDelivered || 0, color: 'text-blue-600' },
          { title: 'Total Replied', value: overview?.totalReplied || 0, color: 'text-purple-600' },
          { title: 'Total Failed', value: overview?.totalFailed || 0, color: 'text-red-500' },
        ].map((s) => (
          <Card key={s.title} className="p-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">{s.title}</p>
            <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value.toLocaleString()}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}
