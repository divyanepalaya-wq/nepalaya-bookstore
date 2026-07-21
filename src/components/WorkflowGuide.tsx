import { useEffect, useState, useCallback } from 'react'
import {
  FileUp, ArrowRightLeft, Store, ShoppingCart, HelpCircle,
  ScanBarcode, Printer, Warehouse, Boxes, ChevronRight, Keyboard, Package,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const GUIDE_SEEN_KEY = 'nepalaya-guide-seen-v3'

const FLOW_STEPS = [
  {
    n: 1,
    title: 'Import stock (or add cartons)',
    body: 'Download the sheet template, fill titles / boxes / pieces, upload under Import. Print barcode labels and stick them on cartons.',
    action: '/import',
    actionLabel: 'Import',
    icon: FileUp,
  },
  {
    n: 2,
    title: 'Move Warehouse → Backroom',
    body: 'Scan a carton under Move, choose Backroom. One tap moves the whole carton.',
    action: '/move',
    actionLabel: 'Move',
    icon: ArrowRightLeft,
  },
  {
    n: 3,
    title: 'Put pieces on sale',
    body: 'Scan a Backroom carton → Store sale → enter how many copies. Those pieces become sellable at POS.',
    action: '/move',
    actionLabel: 'Put on sale',
    icon: Store,
  },
  {
    n: 4,
    title: 'Sell at the till',
    body: 'Open Sell (POS). Stock comes from the store floor only — not from sealed warehouse cartons.',
    action: '/pos',
    actionLabel: 'Sell',
    icon: ShoppingCart,
  },
]

const SHORTCUTS = [
  { keys: '?', desc: 'Open this help guide' },
  { keys: '[', desc: 'Collapse / expand sidebar' },
  { keys: 'G then H', desc: 'Stock overview' },
  { keys: 'G then B', desc: 'Books' },
  { keys: 'G then S', desc: 'Scan' },
  { keys: 'G then M', desc: 'Move' },
  { keys: 'G then I', desc: 'Import' },
  { keys: 'G then P', desc: 'Sell (POS)' },
  { keys: 'G then D', desc: 'Data' },
  { keys: 'Esc', desc: 'Close camera / modals' },
]

interface WorkflowGuideProps {
  open: boolean
  onClose: () => void
}

export function WorkflowGuide({ open, onClose }: WorkflowGuideProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'flow' | 'roles' | 'keys' | 'help'>('flow')

  const go = (path: string) => {
    navigate(path)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Nepalaya Books — Publishing ops" size="lg">
      <div className="space-y-4">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
          {([
            { id: 'flow' as const, label: 'The journey' },
            { id: 'roles' as const, label: 'Who does what' },
            { id: 'keys' as const, label: 'Keyboard' },
            { id: 'help' as const, label: 'If stuck' },
          ]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors',
                tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'flow' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Simple path: Import → Move → Put on sale → Sell. Check Stock anytime for cartons and pieces.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-2 py-3 px-2 rounded-xl bg-gradient-to-r from-blue-50 via-orange-50 to-green-50 border border-gray-100">
              {[
                { label: 'Import', icon: Printer, color: 'text-gray-700 bg-gray-100' },
                { label: 'Warehouse', icon: Warehouse, color: 'text-blue-700 bg-blue-100' },
                { label: 'Backroom', icon: Boxes, color: 'text-orange-700 bg-orange-100' },
                { label: 'Store', icon: Store, color: 'text-green-700 bg-green-100' },
                { label: 'Sell', icon: ShoppingCart, color: 'text-brand-700 bg-brand-100' },
              ].map((s, i) => (
                <div key={s.label} className="flex items-center gap-1 sm:gap-2">
                  {i > 0 && <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />}
                  <div className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold', s.color)}>
                    <s.icon className="h-3.5 w-3.5" />
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            <ol className="space-y-3">
              {FLOW_STEPS.map((step) => (
                <li key={step.n} className="flex gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-700 font-bold text-sm">
                    {step.n}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                      <step.icon className="h-4 w-4 text-accent-600" />
                      {step.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{step.body}</p>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => go(step.action)}>
                      {step.actionLabel}
                    </Button>
                  </div>
                </li>
              ))}
            </ol>

            <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800 flex gap-2">
              <Package className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                <strong>Stock</strong> shows cartons + pieces by Warehouse / Backroom / Store. Use <strong>Data</strong> to browse everything.
              </span>
            </div>

            <div className="rounded-lg border border-gray-100 px-3 py-2 text-xs text-gray-600">
              <p className="font-semibold text-gray-800 mb-1">Quick checklist</p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Import a small sheet and print labels</li>
                <li>Move one carton Warehouse → Backroom</li>
                <li>Put a few pieces on sale → confirm Store stock rose</li>
                <li>Sell one copy in Sell (POS)</li>
              </ul>
            </div>
          </div>
        )}

        {tab === 'roles' && (
          <div className="space-y-3">
            <div className="rounded-xl border border-green-100 bg-green-50/50 p-4">
              <p className="font-semibold text-green-900 text-sm flex items-center gap-2">
                <Store className="h-4 w-4" /> Cashier
              </p>
              <p className="text-xs text-green-800 mt-1 leading-relaxed">
                Dashboard, Books (read), Store POS, Settings. Sell from Bookstore Floor only.
              </p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
              <p className="font-semibold text-blue-900 text-sm flex items-center gap-2">
                <Warehouse className="h-4 w-4" /> Warehouse
              </p>
              <p className="text-xs text-blue-800 mt-1 leading-relaxed">
                Stock, Cartons, Move, Scan, Import. Put books on sale when the floor is low.
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
              <p className="font-semibold text-gray-900 text-sm">Admin</p>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                Everything above, plus Data, staff, discounts, and advanced tools in Settings.
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 px-3 py-2 text-xs text-gray-600 flex gap-2">
              <ScanBarcode className="h-4 w-4 shrink-0 mt-0.5 text-accent-600" />
              Tip: press <kbd className="px-1.5 py-0.5 rounded bg-gray-100 font-mono text-[10px]">?</kbd> anytime to reopen this guide.
            </div>
          </div>
        )}

        {tab === 'keys' && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 flex items-center gap-2">
              <Keyboard className="h-4 w-4" /> Shortcuts (desktop)
            </p>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden">
              {SHORTCUTS.map((s) => (
                <li key={s.keys} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm bg-white">
                  <span className="text-gray-600">{s.desc}</span>
                  <kbd className="shrink-0 rounded-md bg-gray-100 px-2 py-1 font-mono text-[11px] text-gray-700">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'help' && (
          <div className="space-y-3 text-sm text-gray-700">
            <div className="rounded-lg border border-gray-100 px-3 py-2.5">
              <p className="font-semibold text-gray-900">Carton already moved / in transit</p>
              <p className="text-xs text-gray-600 mt-1">
                Open Settings → Advanced → Transfers, find the transfer, and Receive it. Or scan the carton under Scan.
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 px-3 py-2.5">
              <p className="font-semibold text-gray-900">Sale failed after payment</p>
              <p className="text-xs text-gray-600 mt-1">
                Don’t tap Pay again with a new cart. Refresh POS, check Sales / Reports for the receipt. If missing, contact Admin — retries use the same request so stock won’t double.
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 px-3 py-2.5">
              <p className="font-semibold text-gray-900">Forgot password</p>
              <p className="text-xs text-gray-600 mt-1">
                Ask an Admin (Settings → Staff accounts) to reset your password or send a reset email.
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button onClick={onClose}>Got it</Button>
        </div>
      </div>
    </Modal>
  )
}

export function useFirstRunGuide() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(GUIDE_SEEN_KEY)) {
        setOpen(true)
      }
    } catch { /* ignore */ }
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    try { localStorage.setItem(GUIDE_SEEN_KEY, '1') } catch { /* ignore */ }
  }, [])

  const openGuide = useCallback(() => setOpen(true), [])

  return { open, setOpen, close, openGuide }
}

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50 px-2.5 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-100 transition-colors"
      title="How to use (press ?)"
      aria-label="Open help guide"
    >
      <HelpCircle className="h-3.5 w-3.5" />
      Help
    </button>
  )
}
