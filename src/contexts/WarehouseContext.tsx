import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { mapWarehouse, mapInventory } from '@/lib/mappers'
import { fetchAllPages } from '@/lib/fetchAll'
import { debounce } from '@/lib/debounce'
import { WH_IDS } from '@/lib/inventoryService'
import type { BookInventory, Warehouse, WorkspaceMode } from '@/types'

const MODE_STORAGE_KEY = 'nepalaya-workspace-mode'
const INV_COLS = 'book_id,by_warehouse,total_warehouse_qty,retail_qty,updated_at'
const WH_COLS = 'id,name,code,type,address,is_active,is_default,created_at,created_by'

interface WarehouseContextValue {
  warehouses: Warehouse[]
  loading: boolean
  mode: WorkspaceMode
  setMode: (mode: WorkspaceMode) => void
  activeWarehouse: Warehouse | null
  primaryWarehouse: Warehouse | null
  bufferWarehouse: Warehouse | null
  bookstoreWarehouse: Warehouse | null
  bookstoreId: string
  inventoryMap: Record<string, BookInventory>
  inventoryLoading: boolean
  getRetailStock: (bookId: string, fallbackInStock?: number) => number
  getWarehouseStock: (bookId: string, warehouseId: string) => number
  seedReady: boolean
}

const WarehouseContext = createContext<WarehouseContextValue | null>(null)

function modeToType(mode: WorkspaceMode): Warehouse['type'] {
  if (mode === 'bookstore') return 'bookstore'
  if (mode === 'full_warehouse') return 'primary_warehouse'
  return 'buffer_warehouse'
}

function loadStoredMode(): WorkspaceMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY)
    if (v === 'bookstore' || v === 'full_warehouse' || v === 'small_warehouse') return v
  } catch { /* ignore */ }
  return 'bookstore'
}

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const { appUser } = useAuth()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setModeState] = useState<WorkspaceMode>(loadStoredMode)
  const [inventoryMap, setInventoryMap] = useState<Record<string, BookInventory>>({})
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [seedReady, setSeedReady] = useState(false)
  const invGen = useRef(0)

  const setMode = useCallback((m: WorkspaceMode) => {
    setModeState(m)
    try { localStorage.setItem(MODE_STORAGE_KEY, m) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    setSeedReady(!!appUser)
  }, [appUser?.uid])

  useEffect(() => {
    if (!appUser) {
      setWarehouses([])
      setLoading(false)
      return
    }
    let cancelled = false

    async function load() {
      const { data, error } = await supabase.from('warehouses').select(WH_COLS).order('name')
      if (cancelled) return
      if (error) {
        console.warn('warehouses load failed', error)
        setLoading(false)
        return
      }
      setWarehouses(
        (data ?? [])
          .map((r) => mapWarehouse(r as Record<string, unknown>))
          .filter((w) => w.isActive !== false),
      )
      setLoading(false)
    }

    void load()
    const scheduleReload = debounce(() => void load(), 500)
    const channel = supabase
      .channel('warehouses-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouses' }, () => scheduleReload())
      .subscribe()

    return () => {
      cancelled = true
      scheduleReload.cancel()
      void supabase.removeChannel(channel)
    }
  }, [appUser?.uid])

  useEffect(() => {
    if (!appUser) {
      setInventoryMap({})
      setInventoryLoading(false)
      return
    }
    let cancelled = false

    async function load() {
      const gen = ++invGen.current
      try {
        const rows = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
          const res = await supabase
            .from('book_inventory')
            .select(INV_COLS)
            .order('book_id')
            .range(from, to)
          return { data: res.data as Record<string, unknown>[] | null, error: res.error }
        })
        if (cancelled || gen !== invGen.current) return
        const map: Record<string, BookInventory> = {}
        for (const r of rows) {
          const inv = mapInventory(r)
          map[inv.bookId] = inv
        }
        setInventoryMap(map)
      } catch (e) {
        if (!cancelled && gen === invGen.current) console.warn('inventory load failed', e)
      } finally {
        if (!cancelled && gen === invGen.current) setInventoryLoading(false)
      }
    }

    void load()
    const scheduleReload = debounce(() => void load(), 350)

    const channel = supabase
      .channel('inventory-rt')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'book_inventory' },
        (payload) => {
          if (
            (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') &&
            payload.new &&
            typeof payload.new === 'object'
          ) {
            const inv = mapInventory(payload.new as Record<string, unknown>)
            setInventoryMap((prev) => ({ ...prev, [inv.bookId]: inv }))
            return
          }
          if (payload.eventType === 'DELETE' && payload.old && typeof payload.old === 'object') {
            const bookId = (payload.old as { book_id?: string }).book_id
            if (bookId) {
              setInventoryMap((prev) => {
                const next = { ...prev }
                delete next[bookId]
                return next
              })
            }
            return
          }
          scheduleReload()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      scheduleReload.cancel()
      void supabase.removeChannel(channel)
    }
  }, [appUser?.uid])

  const primaryWarehouse = useMemo(
    () => warehouses.find((w) => w.type === 'primary_warehouse' && w.isDefault) ??
      warehouses.find((w) => w.type === 'primary_warehouse') ?? null,
    [warehouses],
  )
  const bufferWarehouse = useMemo(
    () => warehouses.find((w) => w.type === 'buffer_warehouse' && w.isDefault) ??
      warehouses.find((w) => w.type === 'buffer_warehouse') ?? null,
    [warehouses],
  )
  const bookstoreWarehouse = useMemo(
    () => warehouses.find((w) => w.type === 'bookstore' && w.isDefault) ??
      warehouses.find((w) => w.type === 'bookstore') ?? null,
    [warehouses],
  )

  const bookstoreId = bookstoreWarehouse?.id ?? WH_IDS.bookstore

  const activeWarehouse = useMemo(() => {
    const type = modeToType(mode)
    return warehouses.find((w) => w.type === type && w.isDefault) ??
      warehouses.find((w) => w.type === type) ?? null
  }, [warehouses, mode])

  const getRetailStock = useCallback(
    (bookId: string, fallbackInStock?: number) => {
      const inv = inventoryMap[bookId]
      if (inv) return inv.byWarehouse?.[bookstoreId] ?? inv.retailQty ?? 0
      return fallbackInStock ?? 0
    },
    [inventoryMap, bookstoreId],
  )

  const getWarehouseStock = useCallback(
    (bookId: string, warehouseId: string) => {
      const inv = inventoryMap[bookId]
      return inv?.byWarehouse?.[warehouseId] ?? 0
    },
    [inventoryMap],
  )

  const value = useMemo<WarehouseContextValue>(
    () => ({
      warehouses,
      loading,
      mode,
      setMode,
      activeWarehouse,
      primaryWarehouse,
      bufferWarehouse,
      bookstoreWarehouse,
      bookstoreId,
      inventoryMap,
      inventoryLoading,
      getRetailStock,
      getWarehouseStock,
      seedReady,
    }),
    [
      warehouses,
      loading,
      mode,
      setMode,
      activeWarehouse,
      primaryWarehouse,
      bufferWarehouse,
      bookstoreWarehouse,
      bookstoreId,
      inventoryMap,
      inventoryLoading,
      getRetailStock,
      getWarehouseStock,
      seedReady,
    ],
  )

  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>
}

export function useWarehouse() {
  const ctx = useContext(WarehouseContext)
  if (!ctx) throw new Error('useWarehouse must be used within WarehouseProvider')
  return ctx
}
