# Hybrid PDF Parsing Feature — AI Agent Prompt Sequence

> **Purpose of this document:** This is a chronological, step-by-step list of **self-contained prompts** to be given to an AI coding agent to implement the Hybrid PDF Parsing feature as specified in `docs/HYBRID_PARSING_FEATURE_SPEC.md`. Each prompt must be executed in order. The agent must have read and internalized `docs/SPECS.md`, `docs/INSTRUCTIONS.md`, and `docs/HYBRID_PARSING_FEATURE_SPEC.md` before starting.

> **How to use:** Copy each prompt (the content inside the fenced block) and paste it as a message to the AI agent. Wait for the agent to fully complete and verify each step before proceeding to the next one.

> **Notation:** `@[file]` means the file should be attached/referenced in the agent's context.

> **Current Architecture Summary (for agent context):**
> - `server/utils/prompts.ts` — exports `SYSTEM_PROMPT` and `USER_PROMPT` (blob-mode prompts)
> - `server/utils/gemini.ts` — exports `parseWithGemini(pdfBuffer: Buffer)` and `GeminiError`. The function contains a monolithic 140-line retry loop that handles config loading, API call construction, retry logic, JSON extraction, and validation — all in one function.
> - `server/utils/csv.ts` — exports `convertToCSV()`. Untouched by this feature.
> - `server/api/parse.post.ts` — imports `parseWithGemini` and `GeminiError` from `gemini.ts`, calls `parseWithGemini(pdfBuffer)` on line 63, handles errors with Polish messages.
> - `package.json` — dependencies: `@google/genai`, `@nuxtjs/tailwindcss`, `nuxt`, `vue`, `vue-router`. No `pdf-parse` yet.

---

## Prompt 1 — Install `pdf-parse` dependency

```
Read @[docs/HYBRID_PARSING_FEATURE_SPEC.md] section 3 and @[docs/INSTRUCTIONS.md].

Your task is to add the `pdf-parse` library to the project. This is the ONLY change in this step — do NOT create or modify any source files.

Steps:
1. Run `npm install pdf-parse` to add it to `dependencies` in `package.json`.
2. Check if `@types/pdf-parse` exists on npm. If it does, run `npm install -D @types/pdf-parse`. If it does NOT exist, skip this — we will handle types in the next step.
3. Verify that `package.json` now lists `"pdf-parse": "^1.1.1"` (or compatible version) in `dependencies`.
4. Run `npm run build` to confirm the project still compiles without errors.

Do NOT create any new files or modify any source code. Only install the package and verify the build.
```

---

## Prompt 2 — Create `server/utils/pdfExtract.ts`

```
Read @[docs/HYBRID_PARSING_FEATURE_SPEC.md] section 5 (all subsections 5.1–5.5).
Also read @[docs/INSTRUCTIONS.md] for code quality rules.

Create a NEW file: `server/utils/pdfExtract.ts`

This file is a standalone module with ZERO dependencies on any other project file (no imports from gemini.ts, prompts.ts, or csv.ts). It encapsulates PDF text extraction and quality assessment.

Requirements:

### Type Declaration
If `@types/pdf-parse` was installed in Step 1, just import normally. If NOT, add a module declaration at the TOP of the file (or in a separate `server/types/pdf-parse.d.ts` file):
```ts
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

### Export 1: `extractTextFromPDF(pdfBuffer: Buffer): Promise<string>`
- Import `pdf-parse` (default import) and call it with the buffer.
- Return `data.text` (the extracted text string).
- If `pdf-parse` throws ANY error, catch it, log a warning: `[pdfExtract] Failed to extract text from PDF: <error.message>`, and return an empty string `""`.
- This function must NEVER throw. It is safe to call on any input.

### Export 2: `isTextUsable(text: string, pdfSizeBytes: number): boolean`
- Determines whether extracted text is "good enough" to use text-mode parsing instead of blob-mode.
- All three heuristic checks must pass for the function to return `true`:

1. **Minimum absolute length:** `text.trim().length >= 100`. Below 100 chars, there's not enough content.
2. **Density check (chars per KB):** Calculate `charsPerKB = text.trim().length / (pdfSizeBytes / 1024)`. Must be >= 5. This catches scanned/image PDFs where pdf-parse returns only stray metadata chars.
3. **Printable content ratio:** Count printable characters using regex `/[\x20-\x7E\u00A0-\uFFFF\n\r\t]/g`. The ratio `printableChars / text.length` must be >= 0.8 (80%). This catches mojibake/garbled binary data.

- Log the assessment result for debugging:
  ```ts
  console.log(
    `[pdfExtract] Text quality assessment: length=${text.trim().length}, ` +
    `charsPerKB=${charsPerKB.toFixed(1)}, printableRatio=${(printableRatio * 100).toFixed(1)}%, ` +
    `usable=${result}`
  )
  ```

### Code Quality
- Add a file-level JSDoc comment explaining the module's purpose.
- Add JSDoc on each exported function explaining parameters, return value, and behavior.
- Internal comments in English.
- Only named exports — no default export.

### Verification
Run `npm run build` after creating the file. Fix any TypeScript errors before considering this step complete.
```

---

## Prompt 3 — Add text-mode prompts to `server/utils/prompts.ts`

```
Read @[docs/HYBRID_PARSING_FEATURE_SPEC.md] section 6 (all subsections 6.1–6.4).
Read the current @[server/utils/prompts.ts] to understand the existing prompts.
Also read @[docs/INSTRUCTIONS.md] for prompt discipline rules.

Modify the file: `server/utils/prompts.ts`

CRITICAL: Do NOT modify the existing `SYSTEM_PROMPT` or `USER_PROMPT` constants. They must remain EXACTLY as they are — they are used for the blob-mode fallback path.

Add TWO new exported constants AFTER the existing ones:

### 1. `SYSTEM_PROMPT_TEXT_MODE`

This prompt is based on the existing `SYSTEM_PROMPT` with these specific differences:

a) **Replace the opening line:**
   - CURRENT: "...specialized in parsing industrial automation price lists from PDF files. Your sole purpose is to analyze PDF documents containing product catalogs..."
   - NEW: "...specialized in parsing industrial automation price lists. Your sole purpose is to analyze pre-extracted text from PDF documents containing product catalogs, price lists, and technical specification tables, and extract ALL structured data from them."

b) **Add a new section** after the existing `CRITICAL OUTPUT RULES` section, titled `TEXT INPUT CONTEXT`:
   ```
   TEXT INPUT CONTEXT:
   1. You are receiving pre-extracted text from a PDF, NOT the visual PDF itself.
   2. Table structure may be indicated by whitespace alignment (spaces, tabs), consistent character positions, or repeating line patterns. Reconstruct the tabular structure by analyzing these patterns.
   3. Column headers may appear as a line of space-separated or tab-separated labels. Data rows follow the same alignment pattern.
   4. If the text appears to have lost some formatting during extraction, use your best judgment to reconstruct the intended table structure based on context clues (repeating patterns, data types, numeric columns, etc.).
   5. Category or section headers may appear as standalone lines between groups of product rows — use them to populate a category/subcategory column.
   ```

c) **In DATA EXTRACTION RULES rule 4:** Replace any reference to "visual" grouping. Change "hierarchical/grouped structure" phrasing to reference "logical grouping in the text" instead of visual grouping.

d) **All other rules remain identical:** JSON schema, zero hallucination policy, data formatting, content filtering, language handling — copied verbatim from `SYSTEM_PROMPT`.

### 2. `USER_PROMPT_TEXT_MODE`

Content (verbatim):
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

### Verification
After modification, verify that all four constants are importable:
```ts
import { SYSTEM_PROMPT, USER_PROMPT, SYSTEM_PROMPT_TEXT_MODE, USER_PROMPT_TEXT_MODE } from './prompts'
```

Run `npm run build` to confirm no TypeScript errors.
```

---

## Prompt 4 — Refactor `server/utils/gemini.ts` — Extract shared retry logic

```
Read @[docs/HYBRID_PARSING_FEATURE_SPEC.md] section 7 (all subsections 7.1–7.5).
Read the current @[server/utils/gemini.ts] carefully — understand every line of the existing `parseWithGemini` function (lines 208–344).
Also read @[docs/INSTRUCTIONS.md].

This is the most complex step. You will refactor `gemini.ts` in a single pass. The goal is to split the monolithic `parseWithGemini` into three parts WITHOUT changing any existing behavior.

### What MUST stay UNCHANGED (section 7.1):
All of these internal functions remain exactly as they are — do NOT modify them:
- `interface ParsedData` (lines 7–10)
- `class GeminiError` (lines 15–23)
- `function isRetryableError(error: unknown): boolean` (lines 28–48)
- `function categorizeError(error: unknown): GeminiError` (lines 53–85)
- `function extractJSON(text: string): string` (lines 94–106)
- `function validateParsedData(data: unknown): ParsedData` (lines 112–165)
- `function delay(ms: number): Promise<void>` (lines 170–172)
- `function calculateBackoffDelay(attempt: number): number` (lines 184–191)

### Step A: Update the import statement (line 2)
Change:
```ts
import { SYSTEM_PROMPT, USER_PROMPT } from './prompts'
```
To:
```ts
import { SYSTEM_PROMPT, USER_PROMPT, SYSTEM_PROMPT_TEXT_MODE, USER_PROMPT_TEXT_MODE } from './prompts'
```

### Step B: Create internal helper `callGeminiWithRetry` (NOT exported)
Extract the shared logic from `parseWithGemini` (lines 208–344) into a new internal function:

```ts
async function callGeminiWithRetry(
  buildContents: () => { role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }[],
  systemInstruction: string,
  mode: 'text' | 'blob',
): Promise<ParsedData>
```

This function must contain ALL of the following logic currently in `parseWithGemini`:
1. Read API key, model, timeout from runtime config / env vars (current lines 209–234).
2. Validate API key exists (current lines 236–241).
3. Initialize the `GoogleGenAI` client (current line 244).
4. Run the retry loop (current lines 253–340):
   - Build the request using `buildContents()` for `contents` and `systemInstruction` for `config.systemInstruction`.
   - Set `temperature: 0` (same as current).
   - Handle timeout via `AbortController` (same as current).
   - Extract JSON from response via `extractJSON()` (same as current).
   - Validate via `validateParsedData()` (same as current).
   - On retryable errors, retry with backoff (same as current).
5. Update the success log message to include the mode:
   ```ts
   console.log(
     `[Gemini] Successfully parsed PDF (${mode} mode): ${validatedData.columns.length} columns, ${validatedData.rows.length} rows (attempt ${attempt}/${maxAttempts})`
   )
   ```

NOTE: The base64 conversion (`pdfBuffer.toString('base64')`) is NOT in this function — it's in the caller.

### Step C: Create exported function `parseWithGeminiBlob`
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

### Step D: Create exported function `parseWithGeminiText`
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

### Step E: Add backward-compatible alias
```ts
export const parseWithGemini = parseWithGeminiBlob
```

### Step F: Keep the existing re-export
```ts
export { GeminiError }
```

### Final Exports Summary
After refactoring, `gemini.ts` must export exactly:
| Export | Type | Description |
|--------|------|-------------|
| `parseWithGeminiBlob` | async function | Blob-mode (existing behavior, renamed) |
| `parseWithGeminiText` | async function | Text-mode (new) |
| `parseWithGemini` | const (alias) | Alias for `parseWithGeminiBlob` (backward compat) |
| `GeminiError` | class | Custom error class (unchanged) |

### Verification
Run `npm run build` to confirm no TypeScript errors. The existing behavior (blob-mode) must be preserved exactly.
```

---

## Prompt 5 — Update `server/api/parse.post.ts` with hybrid orchestration

```
Read @[docs/HYBRID_PARSING_FEATURE_SPEC.md] section 8 (all subsections 8.1–8.3).
Read the current @[server/api/parse.post.ts].
Also read @[docs/INSTRUCTIONS.md].

Modify the file: `server/api/parse.post.ts`

### What MUST stay UNCHANGED (section 8.1):
- File validation logic (lines 20–50): multipart form data reading, file existence check, MIME type check — all unchanged.
- Buffer creation (line 53): unchanged.
- Filename logic (lines 57–59): unchanged.
- CSV conversion (line 66): unchanged.
- Response headers and return (lines 71–78): unchanged.
- Error handling catch block (lines 79–113): unchanged structure. The Polish error messages remain the same.

### Change 1: Update imports (line 1–3)
Replace:
```ts
import { parseWithGemini, GeminiError } from '../utils/gemini'
```
With:
```ts
import { parseWithGeminiBlob, parseWithGeminiText, GeminiError } from '../utils/gemini'
import { extractTextFromPDF, isTextUsable } from '../utils/pdfExtract'
```
Keep the existing `import { convertToCSV } from '../utils/csv'` unchanged.
Keep the existing `import { readMultipartFormData, createError, setResponseHeaders } from 'h3'` unchanged.

### Change 2: Replace the single `parseWithGemini` call
Replace line 63:
```ts
const parsedData = await parseWithGemini(pdfBuffer)
```
With the following hybrid orchestration logic:
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

### Fallback Behavior — CRITICAL RULES (section 8.2.3):
1. **Text-mode fallback:** If `parseWithGeminiText` throws ANY error (after its own 15 internal retries), catch it and immediately try `parseWithGeminiBlob`. This is the second-chance mechanism.
2. **Blob-mode errors are final:** If `parseWithGeminiBlob` throws (after its own internal retries), the error propagates to the existing catch block (lines 79–113), which maps it to the appropriate Polish error message. No further fallback.
3. **Never double-retry internally:** Each mode runs its own independent retry cycle. Worst case = 15 text-mode attempts + 15 blob-mode attempts = 30 total API calls. This is acceptable.

### No Other Changes
The rest of the file (CSV conversion, response headers, error handling catch block with Polish messages) remains EXACTLY as it is.

### Verification
Run `npm run build` to confirm no TypeScript errors.
```

---

## Prompt 6 — Full integration verification

```
Read @[docs/HYBRID_PARSING_FEATURE_SPEC.md] sections 10, 11, 12, and 13.
Read @[docs/INSTRUCTIONS.md] for testing rules.

Perform a complete verification of the Hybrid Parsing implementation:

### Build Verification
1. Run `npm run build` — it must pass with ZERO errors.
2. If there are any TypeScript errors, fix them and re-run until clean.

### Dev Server Verification
3. Run `npm run dev` and verify the application starts without errors.

### Code Review Checklist
4. Open `server/utils/pdfExtract.ts` and verify:
   - `extractTextFromPDF` never throws (always returns a string)
   - `isTextUsable` checks all three heuristics (min length, density, printable ratio)
   - Console logging matches the patterns in SPEC section 11
   - JSDoc comments are present on both exported functions

5. Open `server/utils/prompts.ts` and verify:
   - The original `SYSTEM_PROMPT` and `USER_PROMPT` are UNTOUCHED
   - `SYSTEM_PROMPT_TEXT_MODE` exists and contains the `TEXT INPUT CONTEXT` section
   - `SYSTEM_PROMPT_TEXT_MODE` does NOT reference "visual layout" or "visual proximity"
   - `USER_PROMPT_TEXT_MODE` exists and mentions "pre-extracted text" and "whitespace alignment"
   - All four constants are properly exported

6. Open `server/utils/gemini.ts` and verify:
   - The internal helper `callGeminiWithRetry` is NOT exported
   - `parseWithGeminiBlob` is exported and sends PDF as base64 inlineData
   - `parseWithGeminiText` is exported and sends text as plain text parts
   - `parseWithGemini` alias exists: `export const parseWithGemini = parseWithGeminiBlob`
   - `GeminiError` is still exported
   - Success log includes `(${mode} mode)` in the message
   - All internal helper functions (isRetryableError, categorizeError, extractJSON, validateParsedData, delay, calculateBackoffDelay) are unchanged

7. Open `server/api/parse.post.ts` and verify:
   - Imports `parseWithGeminiBlob`, `parseWithGeminiText`, `GeminiError` from gemini.ts
   - Imports `extractTextFromPDF`, `isTextUsable` from pdfExtract.ts
   - The hybrid orchestration flow is correct: extract text → check quality → text-mode with blob fallback OR direct blob-mode
   - Text-mode errors are caught and fall back to blob-mode
   - Blob-mode errors propagate to the existing catch block
   - All Polish error messages in the catch block are unchanged
   - File validation, CSV conversion, response headers — all unchanged

### Edge Case Review (SPEC section 12)
8. Trace through each edge case mentally and confirm correct behavior:
   - `pdf-parse` throws → `extractTextFromPDF` returns "" → `isTextUsable` returns false → blob-mode
   - `pdf-parse` returns "" → `isTextUsable` returns false (length < 100) → blob-mode
   - `pdf-parse` returns mojibake → `isTextUsable` returns false (printable ratio < 80%) → blob-mode
   - Text-mode Gemini returns invalid JSON → retries exhaust → throws → catch → blob-mode fallback
   - Blob-mode also fails → error propagates → Polish error message shown
   - Empty pdfBuffer (0 bytes) → caught by existing validation at line 34 → never reaches hybrid logic

### Backward Compatibility
9. Verify that `parseWithGemini` alias works: any code calling `parseWithGemini(buffer)` would still function correctly (it's an alias to `parseWithGeminiBlob`).

Report every check and its result. Fix any issues found, re-run build, and confirm all clear.
```

---

## Summary — Prompt Execution Order

| # | Prompt Focus | Files Created / Modified | Verification |
|---|---|---|---|
| 1 | Install `pdf-parse` dependency | `package.json`, `package-lock.json` | `npm run build` |
| 2 | Create PDF text extraction utility | `server/utils/pdfExtract.ts` [NEW] | `npm run build` |
| 3 | Add text-mode prompts | `server/utils/prompts.ts` [MODIFY] | `npm run build` |
| 4 | Refactor Gemini client (extract shared logic, add text-mode) | `server/utils/gemini.ts` [MODIFY] | `npm run build` |
| 5 | Update API endpoint with hybrid orchestration | `server/api/parse.post.ts` [MODIFY] | `npm run build` |
| 6 | Full integration verification | Any files needing fixes | `npm run build` + `npm run dev` |

---

## Design Rationale — Why This Order?

1. **Dependency first (Prompt 1):** `pdf-parse` must be installed before any code can import it.
2. **Standalone utility first (Prompt 2):** `pdfExtract.ts` has zero dependencies on other project files. It can be created and tested independently.
3. **Prompts before Gemini refactor (Prompt 3):** The new text-mode prompts must exist before `gemini.ts` can import them.
4. **Gemini refactor before endpoint update (Prompt 4):** The new `parseWithGeminiBlob` and `parseWithGeminiText` exports must exist before `parse.post.ts` can import them. The backward-compatible `parseWithGemini` alias ensures the existing endpoint continues to work during the transition — if Prompt 4 is completed but Prompt 5 has not yet started, the app still functions.
5. **Endpoint update last (Prompt 5):** The orchestration logic in `parse.post.ts` depends on ALL previous changes being in place.
6. **Verification as final step (Prompt 6):** Catches any wiring issues, edge cases, or inconsistencies across all modified files.

---

## Key Differences from Current Implementation

| Aspect | Current State | After Hybrid Feature |
|---|---|---|
| **Dependencies** | No `pdf-parse` | `pdf-parse` ^1.1.1 added |
| **New files** | — | `server/utils/pdfExtract.ts` |
| **Prompts** | 2 constants (`SYSTEM_PROMPT`, `USER_PROMPT`) | 4 constants (+ `SYSTEM_PROMPT_TEXT_MODE`, `USER_PROMPT_TEXT_MODE`) |
| **Gemini exports** | `parseWithGemini` (single function) | `parseWithGeminiBlob`, `parseWithGeminiText`, `parseWithGemini` (alias) |
| **Gemini internals** | Monolithic 140-line function | Shared `callGeminiWithRetry` helper + two thin wrappers |
| **API endpoint flow** | `pdfBuffer → parseWithGemini → CSV` | `pdfBuffer → extractText → quality check → text-mode (with blob fallback) OR blob-mode → CSV` |
| **Unchanged files** | — | `csv.ts`, all Vue components, `nuxt.config.ts`, `tailwind.config.ts`, `main.css` |
