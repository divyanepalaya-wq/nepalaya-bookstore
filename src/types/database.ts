/**
 * Minimal typed Database shape for Supabase client.
 * Column names use snake_case to match Postgres.
 *
 * Every table entry includes `Relationships: []` and the schema includes an
 * (empty) `Views` map — both required for the installed `@supabase/postgrest-js`
 * generic constraints (`GenericTable` / `GenericSchema`). Omitting either causes
 * the whole `Database` type to fail its structural check silently, which makes
 * every `.from(...)`/`.rpc(...)` call resolve to `never` throughout the app.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          display_name: string
          role: 'superadmin' | 'admin' | 'cashier'
          is_active: boolean
          created_at: string
          created_by: string | null
        }
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & {
          id: string
          email: string
          role: 'superadmin' | 'admin' | 'cashier'
        }
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
        Relationships: []
      }
      books: {
        Row: {
          id: string
          name: string
          author: string | null
          isbn: string | null
          language: string
          category: string
          publisher: string | null
          mrp: number
          cost_price: number
          in_stock: number
          min_stock_alert: number
          description: string | null
          cover_url: string | null
          isbn_locked: boolean
          metadata_source: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          is_deleted: boolean
          deleted_at: string | null
          deleted_by: string | null
        }
        Insert: Partial<Database['public']['Tables']['books']['Row']> & { name: string }
        Update: Partial<Database['public']['Tables']['books']['Row']>
        Relationships: []
      }
      warehouses: {
        Row: {
          id: string
          name: string
          code: string
          type: 'bookstore' | 'primary_warehouse' | 'buffer_warehouse'
          address: string | null
          is_active: boolean
          is_default: boolean
          created_at: string
          created_by: string | null
        }
        Insert: Partial<Database['public']['Tables']['warehouses']['Row']> & {
          id: string
          name: string
          code: string
          type: 'bookstore' | 'primary_warehouse' | 'buffer_warehouse'
        }
        Update: Partial<Database['public']['Tables']['warehouses']['Row']>
        Relationships: []
      }
      book_inventory: {
        Row: {
          book_id: string
          by_warehouse: Record<string, number>
          total_warehouse_qty: number
          retail_qty: number
          updated_at: string
        }
        Insert: Database['public']['Tables']['book_inventory']['Row']
        Update: Partial<Database['public']['Tables']['book_inventory']['Row']>
        Relationships: []
      }
      boxes: {
        Row: {
          id: string
          barcode: string
          book_id: string
          book_name: string
          warehouse_id: string
          quantity: number
          initial_quantity: number
          status: 'sealed' | 'open' | 'empty' | 'in_transit'
          shelf_location: string | null
          shelf_note: string | null
          batch_ref: string | null
          notes: string | null
          created_at: string
          created_by: string | null
          opened_at: string | null
          is_deleted: boolean
        }
        Insert: Partial<Database['public']['Tables']['boxes']['Row']> & {
          barcode: string
          book_id: string
          book_name: string
          warehouse_id: string
          quantity: number
          initial_quantity: number
          status: 'sealed' | 'open' | 'empty' | 'in_transit'
        }
        Update: Partial<Database['public']['Tables']['boxes']['Row']>
        Relationships: []
      }
      transfers: {
        Row: {
          id: string
          from_warehouse_id: string
          to_warehouse_id: string
          status: 'draft' | 'picked' | 'in_transit' | 'received' | 'cancelled'
          items: Json
          notes: string | null
          created_by: string | null
          created_by_name: string | null
          received_by: string | null
          received_by_name: string | null
          created_at: string
          picked_at: string | null
          received_at: string | null
        }
        Insert: Partial<Database['public']['Tables']['transfers']['Row']> & {
          from_warehouse_id: string
          to_warehouse_id: string
          status: 'draft' | 'picked' | 'in_transit' | 'received' | 'cancelled'
        }
        Update: Partial<Database['public']['Tables']['transfers']['Row']>
        Relationships: []
      }
      inventory_movements: {
        Row: {
          id: string
          type: string
          book_id: string
          book_name: string
          quantity: number
          warehouse_id: string | null
          from_warehouse_id: string | null
          to_warehouse_id: string | null
          box_id: string | null
          transfer_id: string | null
          sale_id: string | null
          reason: string
          performed_by: string | null
          performed_by_name: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['inventory_movements']['Row']> & {
          type: string
          book_id: string
          book_name: string
          quantity: number
          reason: string
        }
        Update: Partial<Database['public']['Tables']['inventory_movements']['Row']>
        Relationships: []
      }
      stocktakes: {
        Row: {
          id: string
          name: string
          warehouse_id: string
          status: 'draft' | 'in_progress' | 'completed' | 'cancelled'
          method: 'by_box' | 'by_location'
          items: Json
          created_by: string | null
          created_by_name: string | null
          started_at: string | null
          completed_at: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['stocktakes']['Row']> & {
          name: string
          warehouse_id: string
          status: 'draft' | 'in_progress' | 'completed' | 'cancelled'
          method: 'by_box' | 'by_location'
        }
        Update: Partial<Database['public']['Tables']['stocktakes']['Row']>
        Relationships: []
      }
      stocktake_lines: {
        Row: {
          id: string
          stocktake_id: string
          line_index: number
          book_id: string
          book_name: string
          box_id: string | null
          box_barcode: string | null
          warehouse_id: string
          shelf_location: string | null
          expected_qty: number
          counted_qty: number | null
          counted_by: string | null
          counted_by_name: string | null
          counted_at: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['stocktake_lines']['Row']> & {
          stocktake_id: string
          line_index: number
          book_id: string
          book_name: string
          warehouse_id: string
          expected_qty: number
        }
        Update: Partial<Database['public']['Tables']['stocktake_lines']['Row']>
        Relationships: []
      }
      shelf_locations: {
        Row: {
          id: string
          warehouse_id: string
          aisle: string
          rack: string
          bin: string
          label: string
          description: string | null
          capacity: number | null
          is_active: boolean
          created_at: string
          created_by: string | null
        }
        Insert: Partial<Database['public']['Tables']['shelf_locations']['Row']> & {
          warehouse_id: string
          aisle: string
          rack: string
          bin: string
          label: string
        }
        Update: Partial<Database['public']['Tables']['shelf_locations']['Row']>
        Relationships: []
      }
      sales: {
        Row: Record<string, unknown>
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
        Relationships: []
      }
      audit_logs: {
        Row: Record<string, unknown>
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
        Relationships: []
      }
      [key: string]: {
        Row: Record<string, unknown>
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      apply_inventory_delta: {
        Args: {
          p_book_id: string
          p_warehouse_id: string
          p_bookstore_id: string
          p_delta: number
        }
        Returns: Json
      }
      next_box_seqs: {
        Args: { p_warehouse_code: string; p_count: number }
        Returns: number[]
      }
      receive_cartons: {
        Args: Record<string, unknown>
        Returns: Json
      }
      put_on_sale: {
        Args: {
          p_box_id: string
          p_quantity: number
          p_bookstore_id: string
          p_client_request_id?: string | null
        }
        Returns: Json
      }
      pick_transfer: {
        Args: { p_transfer_id: string; p_bookstore_id: string; p_client_request_id?: string | null }
        Returns: Json
      }
      receive_transfer: {
        Args: { p_transfer_id: string; p_bookstore_id: string; p_client_request_id?: string | null }
        Returns: Json
      }
      complete_sale: {
        Args: Record<string, unknown>
        Returns: string
      }
      create_and_pick_transfer: {
        Args: Record<string, unknown>
        Returns: Json
      }
      return_sale_items: {
        Args: Record<string, unknown>
        Returns: Json
      }
      split_box: {
        Args: {
          p_box_id: string
          p_quantity: number
          p_client_request_id?: string | null
        }
        Returns: Json
      }
      complete_stocktake: {
        Args: {
          p_stocktake_id: string
          p_bookstore_id: string
          p_client_request_id?: string | null
        }
        Returns: Json
      }
      update_stocktake_line: {
        Args: {
          p_stocktake_id: string
          p_line_index: number
          p_counted_qty: number
          p_client_request_id?: string | null
        }
        Returns: Json
      }
      receive_vendor_stock: {
        Args: {
          p_book_id: string
          p_book_name: string
          p_quantity: number
          p_bookstore_id: string
          p_notes?: string
          p_client_request_id?: string | null
        }
        Returns: Json
      }
    }
  }
}
