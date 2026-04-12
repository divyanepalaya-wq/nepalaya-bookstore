import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  className?: string
}

export function Avatar({ name, className }: AvatarProps) {
  const seed = encodeURIComponent(name || 'user')
  return (
    <img
      src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}`}
      alt={name}
      className={cn('rounded-full object-cover bg-accent-50', className)}
      onError={(e) => {
        const img = e.currentTarget
        img.style.display = 'none'
        const fallback = img.nextElementSibling as HTMLElement | null
        if (fallback) fallback.style.display = 'flex'
      }}
    />
  )
}

/** Renders DiceBear avatar with a text-initial fallback in one component */
export function UserAvatar({ name, className, fallbackClass }: AvatarProps & { fallbackClass?: string }) {
  const seed = encodeURIComponent(name || 'user')
  return (
    <span className={cn('relative inline-flex items-center justify-center shrink-0', className)}>
      <img
        src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}`}
        alt={name}
        className="h-full w-full rounded-full object-cover bg-accent-50"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
          const fallback = e.currentTarget.nextElementSibling as HTMLElement | null
          if (fallback) fallback.style.display = 'flex'
        }}
      />
      <span
        className={cn(
          'absolute inset-0 hidden items-center justify-center rounded-full bg-accent-100 text-accent-700 font-semibold text-sm',
          fallbackClass
        )}
      >
        {name?.charAt(0)?.toUpperCase()}
      </span>
    </span>
  )
}
