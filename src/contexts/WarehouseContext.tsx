import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { mapWarehouse, mapInventory } from '@/lib/mappers'
import { WH_IDS } from '@/lib/inventoryService'
import type { BookInventory, Warehouse, WorkspaceMode } from '@/types'

const MODE_STORAGE_KEY = 'nepalaya-workspace-mode'

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

  const setMode = (m: WorkspaceMode) => {
    setModeState(m)
    try { localStorage.setItem(MODE_STORAGE_KEY, m) } catch { /* ignore */ }
  }

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
      const { data, error } = await supabase.from('warehouses').select('*').order('name')
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
    const channel = supabase
      .channel('warehouses-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'warehouses' }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
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
      const { data, error } = await supabase.from('book_inventory').select('*')
      if (cancelled) return
      if (error) {
        console.warn('inventory load failed', error)
        setInventoryLoading(false)
        return
      }
      const map: Record<string, BookInventory> = {}
      ;(data ?? []).forEach((r) => {
        const inv = mapInventory(r as Record<string, unknown>)
        map[inv.bookId] = inv
      })
      setInventoryMap(map)
      setInventoryLoading(false)
    }

    void load()
    const channel = supabase
      .channel('inventory-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'book_inventory' }, () => void load())
      .subscribe()

    return () => {
      cancelled = true
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

  const getRetailStock = (bookId: string, fallbackInStock?: number) => {
    const inv = inventoryMap[bookId]
    if (inv) return inv.byWarehouse?.[bookstoreId] ?? inv.retailQty ?? 0
    return fallbackInStock ?? 0
  }

  const getWarehouseStock = (bookId: string, warehouseId: string) => {
    const inv = inventoryMap[bookId]
    return inv?.byWarehouse?.[warehouseId] ?? 0
  }

  const value: WarehouseContextValue = {
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
  }

  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>
}

export function useWarehouse() {
  const ctx = useContext(WarehouseContext)
  if (!ctx) throw new Error('useWarehouse must be used within WarehouseProvider')
  return ctx
}
