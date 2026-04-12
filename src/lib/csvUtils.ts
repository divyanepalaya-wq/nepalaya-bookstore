/** Download rows as a UTF-8 CSV file. */
export function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number | boolean)[][]
): void {
  const escape = (val: string | number | boolean) =>
    `"${String(val ?? '').replace(/"/g, '""')}"`

  const csv = [headers.map(escape), ...rows.map((r) => r.map(escape))]
    .map((r) => r.join(','))
    .join('\r\n')

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
