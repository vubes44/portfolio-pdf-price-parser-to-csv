/**
 * CSV conversion utility.
 *
 * Converts the structured AI output (columns + rows) into a
 * semicolon-delimited, UTF-8 BOM-prefixed CSV string suitable
 * for Excel and other spreadsheet applications.
 *
 * Specification reference: docs/SPECS.md section 5.3
 */

/**
 * Escapes and quotes a single CSV field value if necessary.
 *
 * A field is wrapped in double quotes when it contains:
 * - Semicolons (`;`)        — the delimiter
 * - Double quotes (`"`)     — escaped by doubling them (`""`)
 * - Newline characters (`\n` or `\r`)
 *
 * @param value - The raw field value
 * @returns The properly escaped field string
 */
function escapeField(value: string): string {
  if (
    value.includes(';') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    // Escape double quotes by doubling them, then wrap in quotes
    return `"${value.replace(/"/g, '""')}"`
  }

  return value
}

/**
 * Converts parsed AI output into a semicolon-delimited CSV string.
 *
 * @param data - The parsed data containing `columns` (header names) and `rows` (data values)
 * @returns A complete CSV string with UTF-8 BOM, CRLF line endings, and proper quoting
 *
 * @example
 * ```ts
 * const csv = convertToCSV({
 *   columns: ['Name', 'Price', 'Unit'],
 *   rows: [
 *     ['Widget A', '12.50', 'szt.'],
 *     ['Widget B', '24.00', 'szt.'],
 *   ],
 * })
 * ```
 */
export function convertToCSV(data: { columns: string[]; rows: string[][] }): string {
  const { columns, rows } = data

  // Handle empty data gracefully — return BOM-only string with no rows
  if (!columns || columns.length === 0) {
    return '\uFEFF'
  }

  const lines: string[] = []

  // Header row
  lines.push(columns.map(escapeField).join(';'))

  // Data rows
  for (const row of rows) {
    // Pad or trim each row to match column count for consistency
    const normalizedRow = columns.map((_, index) => {
      const value = index < row.length ? row[index] : ''
      // Treat null/undefined values as empty strings
      return escapeField(value ?? '')
    })
    lines.push(normalizedRow.join(';'))
  }

  // Prepend UTF-8 BOM (\uFEFF) and use CRLF line endings
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}
