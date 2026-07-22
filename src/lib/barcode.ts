/**
 * Box barcode helpers.
 * Format: NPBX-{warehouseCode}-{zeroPaddedSeq}  e.g. NPBX-PW-00000042
 */

const BARCODE_PREFIX = 'NPBX'
const SEQ_PAD = 8

export function generateBoxBarcode(warehouseCode: string, seq: number): string {
  const code = warehouseCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'XX'
  return `${BARCODE_PREFIX}-${code}-${String(seq).padStart(SEQ_PAD, '0')}`
}

export function parseScanInput(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!cleaned) return null
  // Accept full barcode or just paste with lowercase
  if (/^NPBX-[A-Z0-9]+-\d+$/.test(cleaned)) return cleaned
  // Soft accept: if it looks like our format with minor issues
  const match = cleaned.match(/^(NPBX-[A-Z0-9]+-\d+)$/)
  return match ? match[1] : cleaned.length >= 4 ? cleaned : null
}

export function isValidBoxBarcode(barcode: string): boolean {
  return /^NPBX-[A-Z0-9]+-\d{1,12}$/.test(barcode.trim().toUpperCase())
}

/**
 * Build a structured shelf label from aisle/rack/bin parts.
 * e.g. ("A", "03", "12") => "A-03-12"
 */
export function buildShelfLabel(aisle: string, rack: string, bin: string): string {
  const a = aisle.trim().toUpperCase()
  const r = rack.trim().padStart(2, '0')
  const b = bin.trim().padStart(2, '0')
  return `${a}-${r}-${b}`
}

/** Parse a shelf label like "A-03-12" back into parts (best-effort). */
export function parseShelfLabel(label: string): { aisle: string; rack: string; bin: string } | null {
  const m = label.trim().toUpperCase().match(/^([A-Z0-9]+)[-_ ]?(\d{1,3})[-_ ]?(\d{1,3})$/)
  if (!m) return null
  return { aisle: m[1], rack: m[2], bin: m[3] }
}
