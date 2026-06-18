'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { MessageCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore, isTokenExpired } from '@/store/auth'
import { api } from '@/lib/api'

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const login = useAuthStore((s) => s.login)
  const token = useAuthStore((s) => s.token)
  const _hasHydrated = useAuthStore((s) => s._hasHydrated)
  const [showPassword, setShowPassword] = useState(false)

  // Redirect already-authenticated users away from login
  useEffect(() => {
    if (_hasHydrated && token && !isTokenExpired(token)) {
      router.replace('/dashboard')
    }
  }, [_hasHydrated, token, router])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    try {
      const res = await api.post<{ token: string; user: { id: string; name: string; email: string } }>(
        '/auth/login',
        data
      )
      login(res.user, res.token)
      toast.success('Welcome back!')
      router.push('/dashboard')
    } catch (e: unknown) {
      toast.error((e as Error).message || 'Login failed')
    }
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-emerald-600 to-emerald-800 items-center justify-center p-12">
        <div className="text-white max-w-md">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <MessageCircle className="w-7 h-7" />
            </div>
            <span className="text-2xl font-bold">WA Reach</span>
          </div>
          <h2 className="text-4xl font-bold mb-4 leading-tight">
            Connect with your customers at scale
          </h2>
          <p className="text-emerald-100 text-lg leading-relaxed">
            Send personalized WhatsApp campaigns, track engagement, and grow your business with powerful outreach tools.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-6">
            {[['10K+', 'Messages Sent'], ['98%', 'Delivery Rate'], ['3x', 'Response Rate']].map(([v, l]) => (
              <div key={l} className="text-center">
                <div className="text-2xl font-bold">{v}</div>
                <div className="text-emerald-200 text-sm">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-white dark:bg-gray-950">
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-white">WA Reach</span>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Welcome back</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">Sign in to your account to continue</p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" suppressHydrationWarning>
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" type="email" placeholder="you@example.com" {...register('email')} />
              {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
            </div>

            <Button type="submit" className="w-full h-11" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign In'}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-emerald-600 hover:text-emerald-700 font-medium">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
