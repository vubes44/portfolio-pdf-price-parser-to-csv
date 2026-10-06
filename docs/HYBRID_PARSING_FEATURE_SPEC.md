# Hybrid PDF Parsing Feature — Technical Specification

> **Purpose of this document:** This is a precise, unambiguous implementation specification for the Hybrid PDF Parsing feature. It is intended to be read and executed by an AI coding agent. Every file to create or modify, every function signature, every behavior, and every edge case is documented below. The agent must follow this specification exactly.

> **Prerequisites:** The agent must have read and internalized `docs/SPECS.md` and `docs/INSTRUCTIONS.md` before implementing this feature. All rules from those documents remain in force. This document extends — not replaces — the existing specification.

> **Scope:** This feature modifies only server-side code. Zero frontend/UI changes are required.

---

## 1. Problem Statement

The current implementation sends the entire raw PDF file as a base64-encoded blob (`inlineData` with `mimeType: 'application/pdf'`) to the Gemini API on every request (see `server/utils/gemini.ts` lines 260–283). This causes:

1. **Frequent HTTP 503 "Service Unavailable" errors** — Gemini's servers reject large requests when the model is overloaded. The bigger the PDF, the higher the probability of 503.
2. **Excessive token consumption** — Gemini processes each page of the PDF as an image (vision tokens), which is far more expensive than text tokens.
3. **Slow processing** — vision-based PDF analysis is inherently slower than text-based parsing.
4. **Base64 inflation** — encoding the PDF to base64 inflates its size by ~33% before it even leaves the server.

Most industrial price lists are **digitally generated PDFs** (not scanned images), meaning they contain selectable, extractable text. Sending these as raw blobs forces Gemini to do unnecessary and expensive vision processing.

---

## 2. Solution: Hybrid Text-First Strategy

### 2.1 Core Logic

```
1. Receive PDF buffer from the uploaded file (unchanged)
2. Attempt to extract raw text from the PDF using the `pdf-parse` library
3. Evaluate the quality of the extracted text using a heuristic function
4. IF text is usable (digital PDF with enough extractable text):
     → Send the extracted TEXT to Gemini as a plain text message (lightweight, fast)
     → IF text-mode Gemini call fails with a non-retryable error:
          → Fall back to blob mode (step 5)
5. ELSE (scanned PDF, image-based PDF, or text extraction failed):
     → Send the raw PDF BLOB to Gemini as base64 inline data (current behavior, unchanged)
6. Return the parsed data (unchanged downstream)
```

### 2.2 Why Hybrid (Not Full Replacement)

- **Scanned PDFs** contain no extractable text. The `pdf-parse` library returns empty or garbage strings for them. For these files, the only option is to send the raw PDF blob so Gemini can apply its vision/OCR capabilities.
- **Some complex PDFs** may have text that is extractable but loses critical layout context (e.g., merged cells, visual groupings). If text-mode parsing fails, falling back to blob-mode ensures maximum reliability.
- The hybrid approach ensures **zero regression** — any PDF that worked before will continue to work.

---

## 3. New Dependency

### 3.1 Package: `pdf-parse`

- **npm package:** `pdf-parse` (version `^1.1.1`)
- **Purpose:** Extracts raw text content from digitally-generated PDF files.
- **Why this library:**
  - Pure JavaScript — no native C/C++ dependencies, no build tools required.
  - Works on Windows, Linux, and macOS without platform-specific setup.
  - Already listed as a candidate dependency in `docs/SPECS.md` section 2.1.
  - Lightweight and well-maintained.
- **Install command:** `npm install pdf-parse`
- **Type declarations:** The package does not ship its own TypeScript types. Install `@types/pdf-parse` if available, otherwise create a minimal type declaration (see section 5.1).

### 3.2 Updated `package.json`

Add to the `dependencies` section:

```json
"pdf-parse": "^1.1.1"
```

Run `npm install` after modification.

---

## 4. File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `package.json` | MODIFY | Add `pdf-parse` dependency |
| `server/utils/pdfExtract.ts` | **CREATE** | New utility: PDF text extraction + quality assessment |
| `server/utils/prompts.ts` | MODIFY | Add two new prompt constants for text-mode input |
| `server/utils/gemini.ts` | MODIFY | Refactor to support both text-mode and blob-mode API calls |
| `server/api/parse.post.ts` | MODIFY | Orchestrate the hybrid text-first-then-blob flow |
| All other files | NO CHANGE | Frontend, `csv.ts`, `nuxt.config.ts` — untouched |

---

## 5. New File: `server/utils/pdfExtract.ts`

### 5.1 Purpose

Encapsulates all PDF text extraction logic and quality assessment. This file has no dependency on Gemini, prompts, or any other server utility — it is a standalone module.

### 5.2 Type Declaration for `pdf-parse`

If `@types/pdf-parse` is not available or does not exist on npm, create a minimal type declaration at the top of the file or in a separate `.d.ts` file:

```ts
// If @types/pdf-parse is unavailable, declare the module inline:
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
```

If `@types/pdf-parse` IS available on npm, install it instead: `npm install -D @types/pdf-parse`.

### 5.3 Exports

The file must export exactly two functions:

#### 5.3.1 `extractTextFromPDF(pdfBuffer: Buffer): Promise<string>`

```ts
export async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string>
```

**Behavior:**
1. Call `pdf-parse` (default import) with the `pdfBuffer`.
2. Return `data.text` (the extracted text string).
3. If `pdf-parse` throws any error (malformed PDF, corrupted file, etc.), catch the error, log a warning to the console: `[pdfExtract] Failed to extract text from PDF: <error.message>`, and return an empty string `""`. This function must **never throw**.

#### 5.3.2 `isTextUsable(text: string, pdfSizeBytes: number): boolean`

```ts
export function isTextUsable(text: string, pdfSizeBytes: number): boolean
```

**Purpose:** Determines whether the extracted text is "good enough" to send to Gemini as plain text instead of the raw PDF blob.

**Heuristic rules (all must pass for the function to return `true`):**

1. **Minimum absolute length:** The extracted text must be at least 100 characters long. Below this, there is not enough content to parse meaningfully.
   ```ts
   if (text.trim().length < 100) return false
   ```

2. **Density check (characters per KB of PDF):** The ratio of extracted text length to PDF file size must be at least 5 characters per KB. This catches scanned/image-based PDFs where `pdf-parse` returns only a few stray characters from embedded metadata.
   ```ts
   const pdfSizeKB = pdfSizeBytes / 1024
   const charsPerKB = text.trim().length / pdfSizeKB
   if (charsPerKB < 5) return false
   ```

3. **Printable content ratio:** At least 80% of the characters in the extracted text must be printable (letters, digits, punctuation, whitespace). This catches PDFs where `pdf-parse` returns mojibake or garbled binary data.
   ```ts
   const printableChars = text.match(/[\x20-\x7E\u00A0-\uFFFF\n\r\t]/g)?.length ?? 0
   const printableRatio = printableChars / text.length
   if (printableRatio < 0.8) return false
   ```

4. If all checks pass, return `true`.

**Logging:** Log the decision for debugging:
```ts
console.log(
  `[pdfExtract] Text quality assessment: length=${text.trim().length}, ` +
  `charsPerKB=${charsPerKB.toFixed(1)}, printableRatio=${(printableRatio * 100).toFixed(1)}%, ` +
  `usable=${result}`
)
```

### 5.4 File Structure

```ts
// server/utils/pdfExtract.ts

// 1. Import pdf-parse
// 2. Type declaration (if needed)
// 3. extractTextFromPDF function
// 4. isTextUsable function
// 5. No default export — only named exports
```

### 5.5 Comments and Documentation

- File-level JSDoc comment explaining the module's purpose.
- JSDoc comment on each exported function explaining parameters, return value, and behavior.
- Internal code comments in English.

---

## 6. Modified File: `server/utils/prompts.ts`

### 6.1 What Stays the Same

The existing `SYSTEM_PROMPT` and `USER_PROMPT` constants must remain **exactly as they are**, unchanged. They are used for the blob-mode fallback path.

### 6.2 What Is Added

Two new exported constants:

#### 6.2.1 `SYSTEM_PROMPT_TEXT_MODE`

```ts
export const SYSTEM_PROMPT_TEXT_MODE = `...`
```

This prompt is **almost identical** to the existing `SYSTEM_PROMPT`, with the following differences:

1. **Replace** the opening line:
   - FROM: `"...specialized in parsing industrial automation price lists from PDF files. Your sole purpose is to analyze PDF documents..."`
   - TO: `"...specialized in parsing industrial automation price lists. Your sole purpose is to analyze pre-extracted text from PDF documents containing product catalogs, price lists, and technical specification tables, and extract ALL structured data from them."`

2. **Add** a new section after the existing `CRITICAL OUTPUT RULES` section, titled `TEXT INPUT CONTEXT`:
   ```
   TEXT INPUT CONTEXT:
   1. You are receiving pre-extracted text from a PDF, NOT the visual PDF itself.
   2. Table structure may be indicated by whitespace alignment (spaces, tabs), consistent character positions, or repeating line patterns. Reconstruct the tabular structure by analyzing these patterns.
   3. Column headers may appear as a line of space-separated or tab-separated labels. Data rows follow the same alignment pattern.
   4. If the text appears to have lost some formatting during extraction, use your best judgment to reconstruct the intended table structure based on context clues (repeating patterns, data types, numeric columns, etc.).
   5. Category or section headers may appear as standalone lines between groups of product rows — use them to populate a category/subcategory column.
   ```

3. **Remove or rephrase** any references to "visual layout" or "visual proximity" in the DATA EXTRACTION RULES. Specifically:
   - The existing rule 4 references "hierarchical/grouped structure" — keep it, but do NOT reference "visual" grouping. The text-mode prompt should say "logical grouping in the text" instead.

4. **All other rules remain identical:** The JSON schema, zero hallucination policy, data formatting rules, content filtering rules, and language handling rules are the same as in `SYSTEM_PROMPT`.

#### 6.2.2 `USER_PROMPT_TEXT_MODE`

```ts
export const USER_PROMPT_TEXT_MODE = `...`
```

Content:

```
Analyze the following pre-extracted text from a PDF price list document thoroughly. The text was machine-extracted and may have lost some visual formatting, but the data content is preserved. Extract every single row of product/pricing data.

Return the result as a JSON object with exactly two keys:
- "columns": an array of column name strings (determined from the text content)
- "rows": an array of arrays, each containing string values matching the columns

Remember:
- Extract ALL rows — do not skip, summarize, or truncate any data.
- Return ONLY the JSON object — no other text, no markdown, no explanations.
- If a value is missing or unreadable, use an empty string "".
- Flatten any hierarchical groupings into row-level columns.
- Reconstruct table structure from whitespace alignment patterns in the text.
```

### 6.3 Import Compatibility

The new constants must be importable alongside the existing ones:

```ts
import { SYSTEM_PROMPT, USER_PROMPT, SYSTEM_PROMPT_TEXT_MODE, USER_PROMPT_TEXT_MODE } from './prompts'
```

### 6.4 File Structure After Modification

```ts
// server/utils/prompts.ts

// 1. File-level JSDoc (existing, unchanged)
// 2. SYSTEM_PROMPT (existing, unchanged)
// 3. USER_PROMPT (existing, unchanged)
// 4. SYSTEM_PROMPT_TEXT_MODE (NEW)
// 5. USER_PROMPT_TEXT_MODE (NEW)
```

---

## 7. Modified File: `server/utils/gemini.ts`

### 7.1 What Stays the Same

All of the following internal functions remain **exactly as they are**, unchanged:

- `interface ParsedData` (lines 7–10)
- `class GeminiError` (lines 15–23)
- `function isRetryableError(error: unknown): boolean` (lines 28–48)
- `function categorizeError(error: unknown): GeminiError` (lines 53–85)
- `function extractJSON(text: string): string` (lines 94–106)
- `function validateParsedData(data: unknown): ParsedData` (lines 112–165)
- `function delay(ms: number): Promise<void>` (lines 170–172)
- `function calculateBackoffDelay(attempt: number): number` (lines 184–191)
- The re-export of `GeminiError` at the bottom of the file.

### 7.2 What Is Refactored

The existing `parseWithGemini(pdfBuffer: Buffer)` function (lines 208–344) must be refactored into three parts:

#### 7.2.1 New Internal Helper: `callGeminiWithRetry`

```ts
async function callGeminiWithRetry(
  buildContents: () => { role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }[],
  systemInstruction: string,
  mode: 'text' | 'blob',
): Promise<ParsedData>
```

**Purpose:** Encapsulates the retry loop, API call, JSON extraction, and validation logic that is shared between text-mode and blob-mode. This eliminates code duplication.

**Behavior:** This function must do everything that the current `parseWithGemini` does (lines 208–344), EXCEPT the construction of the `contents` array and the system instruction. Those are provided by the caller via the `buildContents` callback and `systemInstruction` parameter.

Specifically:
1. Read API key, model, and timeout from runtime config / env vars (same logic as current lines 209–234).
2. Initialize the `GoogleGenAI` client (same as current line 244).
3. Run the retry loop (same as current lines 253–340):
   - Build the request using `buildContents()` for `contents` and `systemInstruction` for `config.systemInstruction`.
   - Set `temperature: 0` (same as current).
   - Handle timeout via `AbortController` (same as current).
   - Extract JSON from response via `extractJSON()` (same as current).
   - Validate via `validateParsedData()` (same as current).
   - On retryable errors, retry with backoff (same as current).
4. Log success with the `mode` parameter for debugging:
   ```ts
   console.log(
     `[Gemini] Successfully parsed PDF (${mode} mode): ${validatedData.columns.length} columns, ${validatedData.rows.length} rows (attempt ${attempt}/${maxAttempts})`
   )
   ```

This function is **NOT exported**. It is internal to `gemini.ts`.

#### 7.2.2 Renamed Export: `parseWithGeminiBlob`

```ts
export async function parseWithGeminiBlob(pdfBuffer: Buffer): Promise<ParsedData>
```

**Purpose:** The existing blob-based parsing path. Sends the raw PDF as base64 inline data.

**Implementation:** Calls `callGeminiWithRetry` with:
- `buildContents`: Returns a `contents` array identical to the current implementation (lines 262–275) — a single `user` role message with two parts: `inlineData` (PDF base64) and `text` (USER_PROMPT).
- `systemInstruction`: `SYSTEM_PROMPT` (from `./prompts`).
- `mode`: `'blob'`.

```ts
export async function parseWithGeminiBlob(pdfBuffer: Buffer): Promise<ParsedData> {
  const pdfBase64 = pdfBuffer.toString('base64')

  return callGeminiWithRetry(
    () => [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
          { text: USER_PROMPT },
        ],
      },
    ],
    SYSTEM_PROMPT,
    'blob',
  )
}
```

#### 7.2.3 New Export: `parseWithGeminiText`

```ts
export async function parseWithGeminiText(extractedText: string): Promise<ParsedData>
```

**Purpose:** The new text-based parsing path. Sends the pre-extracted text as a plain text message.

**Implementation:** Calls `callGeminiWithRetry` with:
- `buildContents`: Returns a `contents` array with a single `user` role message containing two `text` parts — the extracted text content and the `USER_PROMPT_TEXT_MODE`.
- `systemInstruction`: `SYSTEM_PROMPT_TEXT_MODE` (from `./prompts`).
- `mode`: `'text'`.

```ts
export async function parseWithGeminiText(extractedText: string): Promise<ParsedData> {
  return callGeminiWithRetry(
    () => [
      {
        role: 'user',
        parts: [
          { text: extractedText },
          { text: USER_PROMPT_TEXT_MODE },
        ],
      },
    ],
    SYSTEM_PROMPT_TEXT_MODE,
    'text',
  )
}
```

### 7.3 Backward Compatibility: `parseWithGemini`

The original `parseWithGemini(pdfBuffer: Buffer)` export must **remain exported** as an alias to `parseWithGeminiBlob` to avoid breaking any existing code or tests that may reference it:

```ts
export const parseWithGemini = parseWithGeminiBlob
```

### 7.4 Updated Imports

The import statement at the top of `gemini.ts` must be updated to include the new prompts:

```ts
import { SYSTEM_PROMPT, USER_PROMPT, SYSTEM_PROMPT_TEXT_MODE, USER_PROMPT_TEXT_MODE } from './prompts'
```

### 7.5 Exports Summary

After modification, `gemini.ts` must export:

| Export | Type | Description |
|--------|------|-------------|
| `parseWithGeminiBlob` | `async function` | Sends raw PDF blob to Gemini (existing behavior, renamed) |
| `parseWithGeminiText` | `async function` | Sends extracted text to Gemini (new) |
| `parseWithGemini` | `const` (alias) | Alias for `parseWithGeminiBlob` (backward compatibility) |
| `GeminiError` | `class` | Custom error class (unchanged) |

---

## 8. Modified File: `server/api/parse.post.ts`

### 8.1 What Stays the Same

- File validation logic (lines 20–50): multipart form data reading, file existence check, MIME type check — all unchanged.
- Buffer creation (line 53): unchanged.
- Filename logic (lines 57–59): unchanged.
- CSV conversion (line 66): unchanged.
- Response headers and return (lines 71–78): unchanged.
- Error handling catch block (lines 79–113): unchanged structure. The error messages in Polish remain the same.

### 8.2 What Is Modified

#### 8.2.1 New Imports

Add imports at the top of the file:

```ts
import { parseWithGeminiBlob, parseWithGeminiText, GeminiError } from '../utils/gemini'
import { extractTextFromPDF, isTextUsable } from '../utils/pdfExtract'
import { convertToCSV } from '../utils/csv'
```

The old import `import { parseWithGemini, GeminiError } from '../utils/gemini'` is replaced.

#### 8.2.2 Replace the Single `parseWithGemini` Call

The current line 63:

```ts
const parsedData = await parseWithGemini(pdfBuffer)
```

Must be replaced with the following hybrid orchestration logic:

```ts
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
```

#### 8.2.3 Fallback Behavior — Critical Rules

1. **Text-mode fallback to blob-mode:** If `parseWithGeminiText` throws ANY error (retryable or not), the endpoint must catch it and immediately try `parseWithGeminiBlob`. This is a second-chance mechanism — the blob-mode call has its own internal retry logic.

2. **Blob-mode errors are final:** If `parseWithGeminiBlob` throws (after its own internal retries), the error propagates to the existing catch block at line 79, which maps it to the appropriate Polish error message. No further fallback.

3. **Never double-retry:** The text-mode call runs its own full retry cycle internally (15 attempts with backoff). Only after ALL text-mode retries are exhausted does it throw, triggering the blob fallback. The blob-mode call then runs its own independent retry cycle. This means worst-case is 15 text-mode attempts + 15 blob-mode attempts = 30 total API calls. This is acceptable for reliability.

### 8.3 No Other Changes

The rest of the file (error handling, CSV conversion, response headers) remains unchanged.

---

## 9. Files NOT Changed

The following files must NOT be modified:

| File | Reason |
|------|--------|
| `nuxt.config.ts` | No new environment variables or configuration needed |
| `server/utils/csv.ts` | Receives the same `{ columns, rows }` structure regardless of parsing mode |
| `app/app.vue` | No UI changes |
| `app/pages/index.vue` | No UI changes |
| `app/components/FileUpload.vue` | No UI changes |
| `app/components/ProcessingStatus.vue` | No UI changes |
| `app/components/DownloadResult.vue` | No UI changes |
| `tailwind.config.ts` | No styling changes |
| `assets/css/main.css` | No styling changes |

---

## 10. Implementation Order

The agent must implement the changes in this exact order:

### Step 1: Install dependency

```bash
npm install pdf-parse
```

If `@types/pdf-parse` exists on npm, also install:
```bash
npm install -D @types/pdf-parse
```

Verify `package.json` was updated. Run `npm run build` to confirm no breakage.

### Step 2: Create `server/utils/pdfExtract.ts`

Create the new file as specified in section 5 of this document. This file has no dependencies on other project files and can be created independently.

After creation, run `npm run build` to verify no TypeScript errors.

### Step 3: Add text-mode prompts to `server/utils/prompts.ts`

Add `SYSTEM_PROMPT_TEXT_MODE` and `USER_PROMPT_TEXT_MODE` as specified in section 6 of this document. Do NOT modify the existing `SYSTEM_PROMPT` or `USER_PROMPT`.

After modification, run `npm run build` to verify no TypeScript errors.

### Step 4: Refactor `server/utils/gemini.ts`

Refactor as specified in section 7 of this document:
1. Extract the shared retry logic into `callGeminiWithRetry` (internal helper).
2. Rename the existing exported function to `parseWithGeminiBlob`.
3. Add the new `parseWithGeminiText` export.
4. Add the `parseWithGemini` alias for backward compatibility.
5. Update the import from `./prompts` to include text-mode prompts.

After modification, run `npm run build` to verify no TypeScript errors.

### Step 5: Update `server/api/parse.post.ts`

Update the hybrid orchestration logic as specified in section 8 of this document.

After modification, run `npm run build` to verify no TypeScript errors.

### Step 6: Full verification

Run `npm run dev` and verify:
1. The application starts without errors.
2. Upload a digitally-generated PDF — console should show `[/api/parse] Text extraction successful ... Using text-mode parsing.` and `[Gemini] Successfully parsed PDF (text mode)`.
3. If text-mode fails, console should show the fallback warning and proceed with blob-mode.
4. The CSV output is correct — same columns and rows as before.
5. All existing error handling (rate limit, timeout, invalid response, network error) still works correctly with Polish error messages.

---

## 11. Logging & Observability

The hybrid feature introduces new console log messages. The full logging flow for a request is:

### Successful text-mode parse:
```
[pdfExtract] Text quality assessment: length=15432, charsPerKB=42.3, printableRatio=97.2%, usable=true
[/api/parse] Text extraction successful (15432 chars). Using text-mode parsing.
[Gemini] Successfully parsed PDF (text mode): 8 columns, 245 rows (attempt 1/15)
```

### Text extraction insufficient (scanned PDF), blob-mode used:
```
[pdfExtract] Text quality assessment: length=23, charsPerKB=0.1, printableRatio=65.0%, usable=false
[/api/parse] Text extraction insufficient. Using blob-mode parsing.
[Gemini] Successfully parsed PDF (blob mode): 8 columns, 245 rows (attempt 1/15)
```

### Text-mode fails, falls back to blob-mode:
```
[pdfExtract] Text quality assessment: length=15432, charsPerKB=42.3, printableRatio=97.2%, usable=true
[/api/parse] Text extraction successful (15432 chars). Using text-mode parsing.
[Gemini] Attempt 1/15 failed (invalid_response): ...
... (retries)
[/api/parse] Text-mode parsing failed. Falling back to blob-mode. GeminiError: ...
[Gemini] Successfully parsed PDF (blob mode): 8 columns, 245 rows (attempt 1/15)
```

### Text extraction crashes (malformed PDF), blob-mode used:
```
[pdfExtract] Failed to extract text from PDF: Invalid PDF structure
[pdfExtract] Text quality assessment: length=0, charsPerKB=0.0, printableRatio=NaN%, usable=false
[/api/parse] Text extraction insufficient. Using blob-mode parsing.
[Gemini] Successfully parsed PDF (blob mode): 8 columns, 245 rows (attempt 1/15)
```

---

## 12. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| `pdf-parse` throws an error (corrupted PDF) | `extractTextFromPDF` catches it, returns `""`. `isTextUsable` returns `false`. Blob-mode is used. |
| `pdf-parse` returns empty string (scanned PDF) | `isTextUsable` returns `false` (fails minimum length check). Blob-mode is used. |
| `pdf-parse` returns garbage/mojibake | `isTextUsable` returns `false` (fails printable ratio check). Blob-mode is used. |
| Text-mode Gemini call returns invalid JSON | `parseWithGeminiText` retries internally. After all retries exhausted, throws. `parse.post.ts` catches and falls back to blob-mode. |
| Text-mode Gemini call returns 503 repeatedly | Same as above — all retries exhausted, throw, fallback to blob. |
| Blob-mode also fails after fallback | Error propagates to the existing catch block in `parse.post.ts`. User sees the appropriate Polish error message. |
| Very large extracted text (>500KB) | Text is still sent. Gemini's text token limit is much higher than its vision token limit. If it somehow exceeds the limit, the error is handled by the existing retry/error mechanism. |
| PDF with mixed content (some pages scanned, some digital) | `pdf-parse` extracts text from the digital pages. If the text passes `isTextUsable`, text-mode is used. If text-mode extraction misses data from scanned pages, the AI will return incomplete data, text-mode response validation passes, but the user gets partial data. This is an accepted limitation — the user can re-upload knowing it's a mixed PDF. |
| `pdfBuffer` is empty (0 bytes) | Already caught by the existing file validation in `parse.post.ts` (line 34 — `fileField.data.length === 0`). Never reaches the hybrid logic. |

---

## 13. Testing Guidance

When testing the implementation, the agent must verify these scenarios:

1. **Digital PDF (normal case):** Text extraction succeeds → text-mode parsing → CSV output matches expected data.
2. **Build verification:** `npm run build` passes with zero errors after all changes.
3. **Dev server:** `npm run dev` starts without errors.
4. **Console output:** Log messages follow the patterns described in section 11.
5. **Backward compatibility:** The `parseWithGemini` alias still works if called directly.

---

## 14. Architectural Decision Records

### ADR-1: Why `pdf-parse` over other libraries?

**Considered:** `pdf2json`, `pdfjs-dist`, `pdf-lib`, `unpdf`.
**Chosen:** `pdf-parse` — pure JS, simple API (`pdfParse(buffer)` → `{ text }`), no canvas/DOM dependencies, no native modules. The simplest tool for the job.

### ADR-2: Why orchestrate in `parse.post.ts` instead of `gemini.ts`?

**Rationale:** The decision of "should I extract text first?" is a business/orchestration concern, not an API-client concern. `gemini.ts` should only know how to talk to Gemini. `pdfExtract.ts` should only know how to extract text. The endpoint ties them together.

### ADR-3: Why not always try text-mode first (even without quality check)?

**Rationale:** Sending empty or garbled text to Gemini wastes an API call and all its retries (up to 15 attempts). The quality heuristic saves API quota by detecting obviously-bad text before sending it.

### ADR-4: Why fall back from text-mode to blob-mode on ANY error?

**Rationale:** Text extraction is lossy. Some PDFs have extractable text that looks reasonable but loses critical structural context. If Gemini can't make sense of it (returns invalid JSON, hallucinate structure), the blob approach — which preserves visual layout — may succeed. Falling back on any error maximizes the chance of returning usable data.

### ADR-5: Why keep `parseWithGemini` as a backward-compatible alias?

**Rationale:** There may be test scripts, documentation, or other code referencing `parseWithGemini`. The alias ensures nothing breaks. It costs nothing to maintain.
