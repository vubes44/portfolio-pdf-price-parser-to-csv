/**
 * PDF Text Extraction & Quality Assessment Module
 *
 * Standalone utility for extracting raw text content from PDF files and evaluating
 * the quality of the extracted text to determine if it's suitable for
 * text-mode parsing (as opposed to blob-mode/vision-based parsing).
 *
 * This module has ZERO dependencies on any other project file (no imports
 * from gemini.ts, prompts.ts, or csv.ts). It relies solely on the `pdf-parse`
 * library for PDF text extraction.
 */

declare module 'pdf-parse' {
  interface PDFData {
    numpages: number
    numrender: number
    info: Record<string, unknown>
    metadata: unknown
    text: string
    version: string
  }
  function pdfParse(dataBuffer: Buffer): Promise<PDFData>
  export = pdfParse
}

import pdfParse from 'pdf-parse'

/**
 * Extracts raw text content from a PDF buffer using the pdf-parse library.
 *
 * This function is designed to be safe — it will NEVER throw an error.
 * If pdf-parse fails for any reason (malformed PDF, corrupted file, etc.),
 * it catches the error, logs a warning, and returns an empty string.
 *
 * @param pdfBuffer - The raw PDF file as a Buffer
 * @returns The extracted text string, or an empty string if extraction fails
 */
export async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(pdfBuffer)
    return data.text
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[pdfExtract] Failed to extract text from PDF: ${message}`)
    return ''
  }
}

/**
 * Determines whether extracted text is "good enough" to use text-mode parsing
 * instead of blob-mode (sending the raw PDF to Gemini as a vision input).
 *
 * All three heuristic checks must pass for the function to return `true`:
 * 1. Minimum absolute length (≥ 100 characters)
 * 2. Density check (≥ 5 characters per KB of PDF file size)
 * 3. Printable content ratio (≥ 80% printable characters)
 *
 * @param text - The extracted text from the PDF
 * @param pdfSizeBytes - The size of the original PDF file in bytes
 * @returns true if the text quality is sufficient for text-mode parsing
 */
export function isTextUsable(text: string, pdfSizeBytes: number): boolean {
  const trimmedLength = text.trim().length

  // Check 1: Minimum absolute length
  if (trimmedLength < 100) {
    const result = false
    console.log(
      `[pdfExtract] Text quality assessment: length=${trimmedLength}, ` +
      `charsPerKB=N/A, printableRatio=N/A, ` +
      `usable=${result}`,
    )
    return result
  }

  // Check 2: Density check (characters per KB of PDF)
  const pdfSizeKB = pdfSizeBytes / 1024
  const charsPerKB = trimmedLength / pdfSizeKB

  if (charsPerKB < 5) {
    const result = false
    console.log(
      `[pdfExtract] Text quality assessment: length=${trimmedLength}, ` +
      `charsPerKB=${charsPerKB.toFixed(1)}, printableRatio=N/A, ` +
      `usable=${result}`,
    )
    return result
  }

  // Check 3: Printable content ratio
  const printableChars = text.match(/[\x20-\x7E\u00A0-\uFFFF\n\r\t]/g)?.length ?? 0
  const printableRatio = printableChars / text.length

  const result = printableRatio >= 0.8

  console.log(
    `[pdfExtract] Text quality assessment: length=${trimmedLength}, ` +
    `charsPerKB=${charsPerKB.toFixed(1)}, printableRatio=${(printableRatio * 100).toFixed(1)}%, ` +
    `usable=${result}`,
  )

  return result
}
