import { useState } from 'react'
import {
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { updateDoc, doc } from 'firebase/firestore'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Lock, User, Mail, KeyRound, Shield } from 'lucide-react'
import { auth, db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { writeAuditLog } from '@/lib/auditLog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your new password'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})
type PasswordForm = z.infer<typeof passwordSchema>

const profileSchema = z.object({
  displayName: z.string().min(1, 'Name is required').max(60),
})
type ProfileForm = z.infer<typeof profileSchema>

export default function AccountSettings() {
  const { appUser } = useAuth()
  const [changingPassword, setChangingPassword] = useState(false)
  const [updatingProfile, setUpdatingProfile] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)

  const {
    register: registerPw,
    handleSubmit: handlePwSubmit,
    reset: resetPw,
    formState: { errors: pwErrors },
  } = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) })

  const {
    register: registerProfile,
    handleSubmit: handleProfileSubmit,
    formState: { errors: profileErrors },
  } = useForm<ProfileForm>({
    defaultValues: { displayName: appUser?.displayName ?? '' },
  })

  const handleChangePassword = async (data: PasswordForm) => {
    const user = auth.currentUser
    if (!user || !user.email) { toast.error('Not authenticated'); return }
    setChangingPassword(true)
    try {
      // Re-authenticate first
      const credential = EmailAuthProvider.credential(user.email, data.currentPassword)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, data.newPassword)
      await writeAuditLog({
        action: 'password_changed',
        entity: 'user',
        entityId: appUser?.uid,
        details: `${appUser?.displayName} changed their password`,
        performedBy: appUser?.uid ?? '',
        performedByName: appUser?.displayName ?? '',
        role: appUser?.role ?? 'cashier',
      })
      toast.success('Password updated successfully')
      resetPw()
    } catch (e) {
      const msg = (e as { code?: string })?.code
      if (msg === 'auth/wrong-password' || msg === 'auth/invalid-credential') {
        toast.error('Current password is incorrect')
      } else {
        toast.error('Failed to update password')
      }
    } finally {
      setChangingPassword(false)
    }
  }

  const handleUpdateProfile = async (data: ProfileForm) => {
    if (!appUser) return
    setUpdatingProfile(true)
    try {
      await updateDoc(doc(db, 'users', appUser.uid), { displayName: data.displayName })
      await writeAuditLog({
        action: 'profile_updated',
        entity: 'user',
        entityId: appUser.uid,
        details: `${appUser.displayName} updated their profile name to "${data.displayName}"`,
        performedBy: appUser.uid,
        performedByName: appUser.displayName,
        role: appUser.role,
      })
      toast.success('Profile updated — refresh to see changes')
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setUpdatingProfile(false)
    }
  }

  const handleForgotPassword = async () => {
    const user = auth.currentUser
    if (!user?.email) { toast.error('No email found'); return }
    setSendingReset(true)
    try {
      await sendPasswordResetEmail(auth, user.email)
      toast.success(`Reset email sent to ${user.email}`)
    } catch {
      toast.error('Failed to send reset email')
    } finally {
      setSendingReset(false)
    }
  }

  const roleBadgeColor = appUser?.role === 'superadmin'
    ? 'bg-purple-100 text-purple-700'
    : appUser?.role === 'admin'
    ? 'bg-blue-100 text-blue-700'
    : 'bg-gray-100 text-gray-600'

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Account Settings</h1>
        <p className="text-sm text-gray-500">Manage your profile and security settings</p>
      </div>

      {/* Profile Info Card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <User className="h-4 w-4" /> Profile
        </h2>
        <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xl font-bold shrink-0">
            {appUser?.displayName?.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-gray-900">{appUser?.displayName}</p>
            <p className="text-sm text-gray-500 flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" /> {appUser?.email}
            </p>
            <span className={`mt-1 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${roleBadgeColor}`}>
              <Shield className="h-3 w-3 inline mr-1" />{appUser?.role}
            </span>
          </div>
        </div>

        <form onSubmit={handleProfileSubmit(handleUpdateProfile)} className="space-y-3">
          <Input
            label="Display Name"
            error={profileErrors.displayName?.message}
            {...registerProfile('displayName')}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={updatingProfile} size="sm">
              Update Name
            </Button>
          </div>
        </form>
      </div>

      {/* Change Password Card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Lock className="h-4 w-4" /> Change Password
        </h2>
        <form onSubmit={handlePwSubmit(handleChangePassword)} className="space-y-3">
          <Input
            label="Current Password"
            type="password"
            error={pwErrors.currentPassword?.message}
            {...registerPw('currentPassword')}
          />
          <Input
            label="New Password"
            type="password"
            hint="At least 8 characters"
            error={pwErrors.newPassword?.message}
            {...registerPw('newPassword')}
          />
          <Input
            label="Confirm New Password"
            type="password"
            error={pwErrors.confirmPassword?.message}
            {...registerPw('confirmPassword')}
          />
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={sendingReset}
              className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 hover:underline disabled:opacity-50"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {sendingReset ? 'Sending…' : 'Forgot password? Send reset email'}
            </button>
            <Button type="submit" loading={changingPassword} size="sm">
              Update Password
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
