/**
 * PDF Text Extraction & Quality Assessment Utility
 *
 * Standalone module responsible for extracting raw text content from PDF files
 * using the `pdf-parse` library, and evaluating whether the extracted text
 * is of sufficient quality to be sent to Gemini as plain text instead of
 * the raw PDF blob.
 *
 * This module has ZERO dependencies on any other project file (no imports
 * from gemini.ts, prompts.ts, or csv.ts). It is a self-contained utility.
 *
 * Used by the hybrid parsing flow in server/api/parse.post.ts to decide
 * between text-mode (lightweight, fast) and blob-mode (vision-based, heavier)
 * Gemini API calls.
 */

import { PDFParse } from 'pdf-parse'

/**
 * Extracts raw text content from a PDF file buffer.
 *
 * Uses the `pdf-parse` library (v2) to parse the PDF and return all extractable
 * text content. For digitally-generated PDFs, this returns the full text.
 * For scanned/image-based PDFs, this typically returns an empty string
 * or only stray metadata characters.
 *
 * This function is designed to be **safe** — it catches all errors internally
 * and never throws. On any failure (corrupted PDF, malformed structure, etc.),
 * it returns an empty string.
 *
 * @param pdfBuffer - The raw PDF file as a Buffer
 * @returns The extracted text content, or an empty string if extraction fails
 */
export async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: pdfBuffer })
    const result = await parser.getText()
    await parser.destroy()
    return result.text
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[pdfExtract] Failed to extract text from PDF: ${message}`)
    return ''
  }
}

/**
 * Determines whether extracted PDF text is of sufficient quality to use
 * text-mode parsing instead of blob-mode.
 *
 * Applies three heuristic checks — all must pass for the function to return `true`:
 *
 * 1. **Minimum absolute length** — At least 100 characters of trimmed text.
 *    Below this threshold, there is not enough content to parse meaningfully.
 *
 * 2. **Density check (characters per KB of PDF)** — At least 5 characters
 *    per KB of PDF file size. This catches scanned/image-based PDFs where
 *    `pdf-parse` returns only a few stray characters from embedded metadata.
 *
 * 3. **Printable content ratio** — At least 80% of characters must be
 *    printable (letters, digits, punctuation, whitespace). This catches PDFs
 *    where `pdf-parse` returns mojibake or garbled binary data.
 *
 * @param text - The extracted text from `extractTextFromPDF`
 * @param pdfSizeBytes - The size of the original PDF file in bytes
 * @returns `true` if the text is usable for text-mode parsing, `false` otherwise
 */
export function isTextUsable(text: string, pdfSizeBytes: number): boolean {
  // Check 1: Minimum absolute length
  if (text.trim().length < 100) {
    const pdfSizeKB = pdfSizeBytes / 1024
    const charsPerKB = text.trim().length / pdfSizeKB
    const printableChars = text.match(/[\x20-\x7E\u00A0-\uFFFF\n\r\t]/g)?.length ?? 0
    const printableRatio = text.length > 0 ? printableChars / text.length : 0

    console.log(
      `[pdfExtract] Text quality assessment: length=${text.trim().length}, ` +
      `charsPerKB=${charsPerKB.toFixed(1)}, printableRatio=${(printableRatio * 100).toFixed(1)}%, ` +
      `usable=false`,
    )
    return false
  }

  // Check 2: Density check (characters per KB of PDF)
  const pdfSizeKB = pdfSizeBytes / 1024
  const charsPerKB = text.trim().length / pdfSizeKB
  if (charsPerKB < 5) {
    const printableChars = text.match(/[\x20-\x7E\u00A0-\uFFFF\n\r\t]/g)?.length ?? 0
    const printableRatio = printableChars / text.length

    console.log(
      `[pdfExtract] Text quality assessment: length=${text.trim().length}, ` +
      `charsPerKB=${charsPerKB.toFixed(1)}, printableRatio=${(printableRatio * 100).toFixed(1)}%, ` +
      `usable=false`,
    )
    return false
  }

  // Check 3: Printable content ratio
  const printableChars = text.match(/[\x20-\x7E\u00A0-\uFFFF\n\r\t]/g)?.length ?? 0
  const printableRatio = printableChars / text.length
  if (printableRatio < 0.8) {
    console.log(
      `[pdfExtract] Text quality assessment: length=${text.trim().length}, ` +
      `charsPerKB=${charsPerKB.toFixed(1)}, printableRatio=${(printableRatio * 100).toFixed(1)}%, ` +
      `usable=false`,
    )
    return false
  }

  // All checks passed
  console.log(
    `[pdfExtract] Text quality assessment: length=${text.trim().length}, ` +
    `charsPerKB=${charsPerKB.toFixed(1)}, printableRatio=${(printableRatio * 100).toFixed(1)}%, ` +
    `usable=true`,
  )
  return true
}
