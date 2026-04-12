import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type FormData = z.infer<typeof schema>

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setServerError('')
    try {
      await signIn(data.email, data.password)
      navigate('/')
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Sign in failed. Please try again.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-orange-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/logo.svg" alt="Nepalaya Publication" className="h-20 w-auto mx-auto object-contain mb-4" />
          <h1 className="text-2xl font-bold text-gray-900">Book Central - Staff Portal</h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
              placeholder="you@nepalaya.com"
              error={errors.email?.message}
              {...register('email')}
            />

            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                error={errors.password?.message}
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-8 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {serverError && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {serverError}
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
              Sign in
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Access restricted to authorised staff only.
        </p>
      </div>
    </div>
  )
}
