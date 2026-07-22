# Nepalaya Books

### Complete Publishing, Inventory & Retail Operations Platform

---

## Product vision

**Nepalaya Books** is the single operating system for **Nepalaya Publication**.

It manages the complete lifecycle of a book after printing—from receiving inventory into the main warehouse, organizing cartons, transferring stock to the bookstore, replenishing shelves, selling through POS, and producing management reports.

Designed for Nepalaya’s current operations:

- 1 retail store  
- 1 backroom  
- 1 main warehouse  
- small team (3–5 staff)  
- barcode-based workflow  
- simple enough to learn within **one day**

### What this is *not*

This is **not** a general warehouse management system.  
It is **not** SAP, Oracle, Odoo Inventory, or a complex WMS.

### What this *is*

Purpose-built for a **book publisher**.

Feel: **Square POS + Notion + a tiny warehouse app**—not an ERP.

---

## Core principle

Every physical copy exists in **exactly one place**.

```text
Printer
   ↓
Main Warehouse
   ↓
Backroom
   ↓
Bookstore Shelf
   ↓
Customer
```

Inventory always **moves**. It never **duplicates**.

**Books first, locations second, cartons third.**  
Every workflow starts with a book or a barcode and ends with a completed task in as few steps as possible.

---

## Physical locations

### 1. Main Warehouse

Long-term storage. Contains almost every printed book.

- Receive new print runs  
- Create cartons  
- Print labels  
- Store cartons  
- Count inventory  
- Transfer cartons to backroom  

### 2. Store Backroom

Short-term buffer near the shop.

- Receive transfers  
- Hold unopened cartons  
- Open cartons  
- Replenish bookstore shelves  

### 3. Bookstore Floor

Retail stock. **The only inventory POS can sell.**

- Sell books  
- Return books  
- Adjust shelf stock  

POS **never** touches warehouse inventory.

---

## Inventory model

### Book (master product)

Title, author, ISBN, category, cost, MRP, barcode, publisher, print edition, minimum stock.

### Carton

Container of copies of **one** title.

Example: `BOX-00182` · Palpasa Cafe · 50 copies · Main Warehouse · Shelf A4 · **Full**

Statuses (simple):

- **Full** (sealed)  
- **Open**  
- **Empty**  
- *(in transit during transfers)*  

### Loose copies

Copies outside cartons (e.g. remainder after receive, or opened cartons). Tracked as location stock / open cartons.

---

## Primary workflows

| # | Workflow | Result |
|---|----------|--------|
| 1 | **Receive print run** | Choose book + qty + copies/carton → cartons (+ loose) → print labels |
| 2 | **Put away** | Scan carton → assign shelf |
| 3 | **Transfer** | Main warehouse → backroom (scan cartons, ship, receive) |
| 4 | **Replenish store** | Scan carton → move N copies to store shelf; carton becomes Open |
| 5 | **Sell** | POS only sees bookstore floor stock |
| 6 | **Returns** | Back to store inventory (not warehouse) unless moved later |
| 7 | **Stock count** | By location → count → adjust → audit |

---

## Navigation (target IA)

Minimal top-level structure:

```text
Dashboard
Books
Warehouse
Store POS
Reports
Settings
```

- **Warehouse** — Receive, Transfers, Cartons, Scan, Cycle Count, Locations (no POS)  
- **Store POS** — Search, cart, payment, receipt, customer, returns, shift close  
- **Books** — Heart of the app: detail, inventory by location, cartons, movement, sales  

---

## Dashboard

Answers: **“What needs attention today?”**

- Today’s sales · Books sold · Pending transfers  
- Books running low · Inventory value  
- Recent receipts · Open cartons · Recent activity  

---

## Permissions

| Role (UI) | Firestore | Access |
|-----------|-----------|--------|
| **Cashier** | `cashier` | Dashboard, Books (read), Scan, Store POS, Settings |
| **Warehouse** | `admin` | + Receive, transfers, cartons, cycle count, locations, reports |
| **Admin** | `superadmin` | Everything including users & full reports |

---

## UX principles

Never feel like ERP.

- One question per screen  
- Large, obvious buttons · one primary action  
- Scanning faster than typing  
- Menus ≤ 2 levels deep  
- No horizontal-scroll tables  
- Tablet-complete workflows  
- Always clear: where books are, where they’re moving, what to do next  

If a new warehouse employee starts tomorrow with no experience, they should receive, scan, transfer, replenish, and stock-count after **less than an hour** of training.

---

## Reports

**Inventory** — stock, by location, value, low / out of stock  

**Sales** — daily / weekly / monthly, by title, category, cashier  

**Warehouse** — transfers, movements, receiving, adjustments  

**Publishing** — fast / slow movers, recommended reprint, dead stock  

---

## Barcode system

- Product barcode on the book (ISBN / custom)  
- Carton barcode on every carton  
- Scan → open detail immediately  

---

## Current implementation status

**Backend:** Supabase (Auth + Postgres + RLS + RPCs). Firebase has been removed from the app.

Reliability layer: atomic inventory RPCs with idempotency keys, admin password reset / role change, ErrorBoundary, route code-splitting, and simplified **Send → Receive** transfers.

The live app supports the **core publisher ops loop**:

Receive → label cartons → store → transfer to backroom → put on sale → POS → reports  

Plus: multi-location inventory, scan (USB + camera), Excel exports, help guide, role-based access, audit trails, Books hub, ops dashboard, Reports.

Production data cutover: see [`scripts/migrate/README.md`](scripts/migrate/README.md).
---

## Future phase (not MVP)

Leave room in the data model; do **not** build now:

Printer management · print run history · POs to printers · multi-branch · online store · author royalties · ISBN suite · editions/translations · reservations · wholesale/distributors · consignment · loyalty · accounting · AI forecasting · auto-replenishment  

---

## Final philosophy

Complexity stays behind defaults and automation.  
A three-person team runs efficiently today, with structure and traceability for growth tomorrow.

*Nepalaya Books — publishing operations, not a warehouse product.*
