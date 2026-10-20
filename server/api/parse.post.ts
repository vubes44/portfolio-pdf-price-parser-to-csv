import { readMultipartFormData, createError, setResponseHeaders } from 'h3'
import { parseWithGeminiBlob, parseWithGeminiText, GeminiError } from '../utils/gemini'
import { extractTextFromPDF, isTextUsable } from '../utils/pdfExtract'
import { convertToCSV } from '../utils/csv'

/**
 * POST /api/parse
 *
 * Main API endpoint for PDF price list parsing.
 *
 * Accepts a multipart/form-data POST request with a single PDF file,
 * processes it through Google Gemini AI, converts the structured output
 * to a semicolon-delimited CSV, and returns the CSV as a file download.
 *
 * Specification references:
 * - docs/SPECS.md sections 7 and 9
 * - docs/SPECS.md section 10 (error handling)
 */
export default defineEventHandler(async (event) => {
  // 1. Read multipart form data from the request
  const formData = await readMultipartFormData(event)

  // 2. Validate that a file was uploaded
  if (!formData || formData.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { error: 'Nie przesłano pliku.' },
    })
  }

  // Find the file field named "file"
  const fileField = formData.find((field) => field.name === 'file')

  if (!fileField || !fileField.data || fileField.data.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { error: 'Nie przesłano pliku.' },
    })
  }

  // 3. Validate that the file is a PDF (check MIME type)
  const mimeType = fileField.type || ''
  if (mimeType !== 'application/pdf') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { error: 'Nieprawidłowy typ pliku. Akceptowane są wyłącznie pliki PDF.' },
    })
  }

  // 4. Read the file into a Buffer
  const pdfBuffer = Buffer.from(fileField.data)

  // 5. Determine the output filename:
  //    Take the original uploaded filename, remove the .pdf extension, append "_parsed.csv"
  const originalFilename = fileField.filename || 'document.pdf'
  const baseName = originalFilename.replace(/\.pdf$/i, '')
  const outputFilename = `${baseName}_parsed.csv`

  try {
    // 6. Hybrid parsing: attempt text-mode first, fall back to blob-mode

    // Step 1: Attempt to extract text from the PDF
    const extractedText = await extractTextFromPDF(pdfBuffer)

    let parsedData

    // Step 2: Decide which parsing mode to use
    if (isTextUsable(extractedText, pdfBuffer.length)) {
      // Text-mode: lightweight, fast, low 503 risk
      console.log(`[/api/parse] Text extraction successful (${extractedText.length} chars). Using text-mode parsing.`)
      try {
        parsedData = await parseWithGeminiText(extractedText)
      } catch (textError: unknown) {
        // Text-mode failed — fall back to blob-mode
        console.warn(`[/api/parse] Text-mode parsing failed. Falling back to blob-mode.`, textError)
        parsedData = await parseWithGeminiBlob(pdfBuffer)
      }
    } else {
      // Blob-mode: scanned/image PDF or insufficient text
      console.log(`[/api/parse] Text extraction insufficient. Using blob-mode parsing.`)
      parsedData = await parseWithGeminiBlob(pdfBuffer)
    }

    // 7. Convert the result to CSV using convertToCSV()
    const csvContent = convertToCSV(parsedData)

    // 8. Return the CSV as a file download response
    //    Use RFC 5987 encoding for filenames with non-ASCII characters (e.g. Polish diacritics)
    //    to avoid "Invalid character in header content" errors from Node.js
    const safeFilename = outputFilename.replace(/[^\x20-\x7E]/g, '_')
    const encodedFilename = encodeURIComponent(outputFilename)
    setResponseHeaders(event, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
    })

    return csvContent
  } catch (error: unknown) {
    // 9. Handle all errors from parseWithGemini() with appropriate Polish messages
    console.error('[/api/parse] Error processing PDF:', error)

    let errorMessage = 'Nie udało się przetworzyć pliku PDF.'

    if (error instanceof GeminiError) {
      switch (error.type) {
        case 'rate_limit':
          errorMessage = 'Przekroczono limit zapytań API. Spróbuj ponownie później.'
          break
        case 'service_unavailable':
          errorMessage = 'Usługa AI jest tymczasowo przeciążona. Spróbuj ponownie za chwilę.'
          break
        case 'timeout':
          errorMessage = 'Przetwarzanie trwało zbyt długo. Spróbuj ponownie.'
          break
        case 'invalid_response':
          errorMessage = 'AI zwróciło nieoczekiwany format odpowiedzi.'
          break
        case 'network':
          errorMessage = 'Nie można połączyć się z usługą AI.'
          break
        case 'generic':
        default:
          errorMessage = 'Nie udało się przetworzyć pliku PDF.'
          break
      }
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { error: errorMessage },
    })
  }
})
