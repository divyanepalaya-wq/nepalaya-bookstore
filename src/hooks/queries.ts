import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { mapBox, mapTransfer } from '@/lib/mappers'
import type { Box, BoxStatus, Transfer } from '@/types'

export function useBoxesQuery(filters?: { warehouseId?: string; status?: string }) {
  return useQuery({
    queryKey: ['boxes', filters?.warehouseId ?? '', filters?.status ?? ''],
    queryFn: async () => {
      let q = supabase.from('boxes').select('*')
      if (filters?.warehouseId) q = q.eq('warehouse_id', filters.warehouseId)
      if (filters?.status) q = q.eq('status', filters.status as BoxStatus)
      const { data, error } = await q.order('created_at', { ascending: false }).limit(500)
      if (error) throw new Error(error.message)
      return (data ?? [])
        .map((r) => mapBox(r as Record<string, unknown>))
        .filter((b) => !b.isDeleted) as (Box & { id: string })[]
    },
  })
}

export function useTransfersQuery(limit = 50) {
  return useQuery({
    queryKey: ['transfers', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transfers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => mapTransfer(r as Record<string, unknown>)) as (Transfer & { id: string })[]
    },
  })
}
