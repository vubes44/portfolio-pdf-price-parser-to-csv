import { GoogleGenAI } from '@google/genai'
import { SYSTEM_PROMPT, USER_PROMPT } from './prompts'

/**
 * Parsed data structure returned by Gemini.
 */
interface ParsedData {
  columns: string[]
  rows: string[][]
}

/**
 * Custom error class for Gemini API errors with categorized types.
 */
class GeminiError extends Error {
  public readonly type: 'rate_limit' | 'service_unavailable' | 'timeout' | 'invalid_response' | 'network' | 'generic'

  constructor(message: string, type: GeminiError['type']) {
    super(message)
    this.name = 'GeminiError'
    this.type = type
  }
}

/**
 * Determines if an error is retryable (rate limit or timeout).
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof GeminiError) {
    return error.type === 'rate_limit' || error.type === 'service_unavailable' || error.type === 'timeout'
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    // Check for HTTP 429 rate limit
    if (message.includes('429') || message.includes('rate limit') || message.includes('resource exhausted') || message.includes('quota')) {
      return true
    }
    // Check for timeout
    if (message.includes('timeout') || message.includes('timed out') || message.includes('deadline exceeded')) {
      return true
    }
    // Check for HTTP 503 service unavailable / overloaded
    if (message.includes('503') || message.includes('service unavailable') || message.includes('overloaded') || message.includes('unavailable')) {
      return true
    }
  }
  return false
}

/**
 * Categorizes an error into a GeminiError with the appropriate type.
 */
function categorizeError(error: unknown): GeminiError {
  if (error instanceof GeminiError) {
    return error
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // Rate limit (429)
    if (message.includes('429') || message.includes('rate limit') || message.includes('resource exhausted') || message.includes('quota')) {
      return new GeminiError('Gemini API rate limit exceeded.', 'rate_limit')
    }

    // Service unavailable (503) / overloaded model
    if (message.includes('503') || message.includes('service unavailable') || message.includes('overloaded') || message.includes('unavailable')) {
      return new GeminiError('Gemini API service is temporarily unavailable.', 'service_unavailable')
    }

    // Timeout
    if (message.includes('timeout') || message.includes('timed out') || message.includes('deadline exceeded') || message.includes('aborted')) {
      return new GeminiError('Gemini API request timed out.', 'timeout')
    }

    // Network errors
    if (message.includes('fetch failed') || message.includes('econnrefused') || message.includes('enotfound') || message.includes('network') || message.includes('dns')) {
      return new GeminiError('Could not connect to Gemini API.', 'network')
    }

    return new GeminiError(error.message, 'generic')
  }

  return new GeminiError('An unknown error occurred while communicating with Gemini API.', 'generic')
}

/**
 * Extracts JSON from a potentially "dirty" AI response.
 *
 * LLMs often wrap JSON in markdown code blocks or add conversational text.
 * This function finds the content between the first `{` and the last `}`
 * to extract the raw JSON string.
 */
function extractJSON(text: string): string {
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new GeminiError(
      'AI response does not contain valid JSON. No JSON object boundaries found.',
      'invalid_response',
    )
  }

  return text.substring(firstBrace, lastBrace + 1)
}

/**
 * Validates that the parsed JSON has the expected structure:
 * { columns: string[], rows: string[][] }
 */
function validateParsedData(data: unknown): ParsedData {
  if (typeof data !== 'object' || data === null) {
    throw new GeminiError(
      'AI response is not a valid JSON object.',
      'invalid_response',
    )
  }

  const obj = data as Record<string, unknown>

  // Validate columns
  if (!Array.isArray(obj.columns)) {
    throw new GeminiError(
      'AI response is missing the "columns" array.',
      'invalid_response',
    )
  }

  if (!obj.columns.every((col: unknown) => typeof col === 'string')) {
    throw new GeminiError(
      'AI response "columns" array contains non-string values.',
      'invalid_response',
    )
  }

  // Validate rows
  if (!Array.isArray(obj.rows)) {
    throw new GeminiError(
      'AI response is missing the "rows" array.',
      'invalid_response',
    )
  }

  for (let i = 0; i < obj.rows.length; i++) {
    const row = obj.rows[i]
    if (!Array.isArray(row)) {
      throw new GeminiError(
        `AI response "rows[${i}]" is not an array.`,
        'invalid_response',
      )
    }
    // Coerce all values to strings (AI might return numbers)
    for (let j = 0; j < row.length; j++) {
      if (typeof row[j] !== 'string') {
        row[j] = String(row[j] ?? '')
      }
    }
  }

  return {
    columns: obj.columns as string[],
    rows: obj.rows as string[][],
  }
}

/**
 * Delays execution for a specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Calculates the retry delay using exponential backoff with jitter.
 *
 * - Base delay starts at 2 seconds and doubles each attempt (2s, 4s, 8s, ...)
 * - Capped at 15 seconds to keep total wait time reasonable
 * - Random jitter of ±25% prevents multiple clients from retrying simultaneously
 *
 * @param attempt - Current attempt number (1-based)
 * @returns Delay in milliseconds
 */
function calculateBackoffDelay(attempt: number): number {
  const baseDelay = 2000
  const maxDelay = 15000
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
  // Apply ±25% jitter: multiply by a random factor between 0.75 and 1.25
  const jitter = 0.75 + Math.random() * 0.5
  return Math.round(exponentialDelay * jitter)
}

/**
 * Parses a PDF file using Google Gemini 3.8 Flash.
 *
 * Takes a raw PDF file buffer, sends it to Gemini as inline base64 data
 * alongside carefully crafted prompts, and returns the extracted data
 * as a structured object with columns and rows.
 *
 * Implements automatic retry logic: on API timeout, 429 rate limit, or 503 errors,
 * retries up to 14 times with exponential backoff (2s → 4s → 8s → 15s cap) and ±25% jitter.
 *
 * @param pdfBuffer - The raw PDF file as a Buffer
 * @returns Parsed data with columns and rows
 * @throws GeminiError with categorized type for each failure scenario
 */

export async function parseWithGemini(pdfBuffer: Buffer): Promise<ParsedData> {
  let apiKey = ''
  let model = 'gemini-3.8-flash'
  let timeout = 30000

  // Bezpieczne pobieranie konfiguracji (działa w Nuxt oraz w skryptach testowych)
  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig()
      apiKey = (config.geminiApiKey as string) || ''
      model = (config.geminiModel as string) || 'gemini-3.8-flash'
      timeout = Number(config.geminiTimeout) || 30000
    }
  } catch {
    // Ignorujemy błąd kontekstu Nuxta
  }

  // Fallback do standardowych zmiennych środowiskowych Node.js dla skryptów testowych
  if (!apiKey) {
    apiKey = process.env.GEMINI_API_KEY || ''
  }
  if (process.env.GEMINI_MODEL) {
    model = process.env.GEMINI_MODEL
  }
  if (process.env.GEMINI_TIMEOUT) {
    timeout = Number(process.env.GEMINI_TIMEOUT)
  }

  if (!apiKey) {
    throw new GeminiError(
      'Gemini API key is not configured. Set GEMINI_API_KEY in .env file.',
      'generic',
    )
  }

  // Initialize the Google Generative AI client
  const ai = new GoogleGenAI({ apiKey })

  // Convert PDF buffer to base64
  const pdfBase64 = pdfBuffer.toString('base64')

  // Maximum number of attempts (1 initial + 14 retries with exponential backoff)
  const maxAttempts = 15
  let lastError: GeminiError | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Create an AbortController for timeout handling
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: pdfBase64,
                  },
                },
                {
                  text: USER_PROMPT,
                },
              ],
            },
          ],
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0,
            abortSignal: controller.signal,
          },
        })

        clearTimeout(timeoutId)

        // Extract text from response
        const responseText = response.text
        if (!responseText) {
          throw new GeminiError(
            'AI returned an empty response.',
            'invalid_response',
          )
        }

        // Extract JSON from potentially dirty response
        const jsonString = extractJSON(responseText)

        // Parse the JSON
        let parsedJSON: unknown
        try {
          parsedJSON = JSON.parse(jsonString)
        }
        catch {
          throw new GeminiError(
            'AI response contains malformed JSON that could not be parsed.',
            'invalid_response',
          )
        }

        // Validate structure
        const validatedData = validateParsedData(parsedJSON)

        console.log(
          `[Gemini] Successfully parsed PDF: ${validatedData.columns.length} columns, ${validatedData.rows.length} rows (attempt ${attempt}/${maxAttempts})`,
        )

        return validatedData
      }
      finally {
        clearTimeout(timeoutId)
      }
    }
    catch (error: unknown) {
      lastError = categorizeError(error)

      // Only retry on retryable errors (rate limit or timeout)
      if (isRetryableError(error) && attempt < maxAttempts) {
        const retryDelay = calculateBackoffDelay(attempt)
        console.warn(
          `[Gemini] Attempt ${attempt}/${maxAttempts} failed (${lastError.type}): ${lastError.message}. Retrying in ${(retryDelay / 1000).toFixed(1)}s...`,
        )
        await delay(retryDelay)
        continue
      }

      // Non-retryable error or last attempt — throw immediately
      throw lastError
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new GeminiError('All retry attempts exhausted.', 'generic')
}

// Re-export the error class for use in the API endpoint
export { GeminiError }
