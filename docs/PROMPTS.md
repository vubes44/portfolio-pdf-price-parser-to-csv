# AI Agent Prompt Sequence — Build Plan

> **Purpose of this document:** This is a chronological, step-by-step list of prompts to be given to an AI coding agent (Claude Opus 4.6 or Claude Sonnet 4.6) to build the PDF Price List Parser application from scratch. Each prompt must be executed in order. The agent must have access to `docs/SPECS.md` and `docs/INSTRUCTIONS.md` at all times.

> **How to use:** Copy each prompt (the content inside the quoted block) and paste it as a message to the AI agent. Wait for the agent to fully complete and verify each step before proceeding to the next one.

> **Notation:** `@[file]` means the file should be attached/referenced in the agent's context.

---

## Prompt 1 — Project Initialization & Scaffolding

```
Read @[docs/SPECS.md] and @[docs/INSTRUCTIONS.md] carefully and internalize all requirements.

Initialize a new Nuxt 3 project in the current workspace directory (pdf_parser_to_csv_tv). Use the following settings:
- Package manager: npm
- TypeScript: enabled
- Nuxt 3 latest stable version

After initialization:
1. Install the required dependencies: tailwindcss (with @nuxtjs/tailwindcss module), @google/genai
2. Configure Tailwind CSS properly in the Nuxt project (nuxt.config.ts, tailwind.config.ts, and the base CSS file at assets/css/main.css with Tailwind directives)
3. Create the .env.example file with all environment variable fields as defined in SPECS.md section 4.1
4. Create a .gitignore that includes .env, node_modules, .nuxt, .output, and dist
5. Configure nuxt.config.ts with the runtimeConfig for Gemini API settings exactly as specified in SPECS.md section 4.3

Do NOT create any components, pages, or server routes yet — only the project skeleton and configuration.

After completing, verify by running `npm run build` (or `npx nuxi build`) to confirm the project compiles without errors.
```

---

## Prompt 2 — Server Utilities: Gemini Client & Prompt Templates

```
Read @[docs/SPECS.md] sections 5.2, 8, and 10 (and remember all @[docs/SPECS.md], all previous things that are done in the project and @[docs/INSTRUCTIONS.md])

Create the following server utility files:

### 1. server/utils/gemini.ts
- Initialize the Google Generative AI client using the @google/genai SDK.
- Use the Gemini API key and model name from Nuxt's runtimeConfig (useRuntimeConfig()).
- Export a function `parseWithGemini(pdfBuffer: Buffer): Promise<{ columns: string[]; rows: string[][] }>` that:
  a. Takes a raw PDF file buffer as input
  b. Converts it to base64
  c. Sends it to Gemini 3.8 Flash as inline data (mimeType: "application/pdf") along with the system and user prompts (imported from prompts.ts)
  d. Implements automatic retry logic: on API timeout or 429 rate limit errors, retry up to 2 times with a 2-second delay between attempts
  e. Extracts the JSON from the AI response using robust extraction (regex to find content between first `{` and last `}`) — do NOT rely on raw JSON.parse() directly on the response text
  f. Validates that the parsed JSON has the expected structure ({ columns: string[], rows: string[][] })
  g. Returns the validated parsed data
  h. Throws descriptive errors for each failure scenario (rate limit, timeout, invalid response, network error, etc.)

### 2. server/utils/prompts.ts
- Export two constants: `SYSTEM_PROMPT` and `USER_PROMPT`
- The SYSTEM_PROMPT must define the AI's role as an expert data extraction system specialized in parsing industrial automation price lists from PDF files. It must:
  - Instruct the model to return ONLY pure JSON — no markdown, no explanations, no conversational text
  - Specify the exact JSON schema: { "columns": [...], "rows": [[...], ...] }
  - Instruct the model to extract ALL data from the PDF — every single row, every single field
  - Instruct the model to determine column names dynamically based on the data present in the PDF
  - Instruct the model to normalize data formatting (consistent decimals, units, etc.)
  - Instruct the model to handle any language
  - Instruct the model to ignore non-data content (headers, footers, logos, legal text, page numbers)
  - Instruct the model to handle multi-page documents as a single unified dataset
  - Explicitly forbid hallucination — if a field is empty or unreadable, use an empty string, never invent data
- The USER_PROMPT should contain concise task-specific instructions referencing the schema

Make sure to write these prompts with extreme precision — they are the most critical part of the application. Be very detailed and leave zero ambiguity.

After creating both files, verify there are no TypeScript errors by running `npx vue-tsc --noEmit` or `npm run build`.
```

---

## Prompt 3 — Server Utility: CSV Converter

```
Read @[docs/SPECS.md] section 5.3. (and remember all @[docs/SPECS.md], all previous things that are done in the project and @[docs/INSTRUCTIONS.md])

Create the file server/utils/csv.ts with the following:

Export a function `convertToCSV(data: { columns: string[]; rows: string[][] }): string` that:
1. Takes the parsed AI output (columns + rows) as input
2. Generates a semicolon-delimited (`;`) CSV string
3. Prepends a UTF-8 BOM (`\uFEFF`) for Excel compatibility
4. Uses CRLF (`\r\n`) line endings
5. The first row is the header row (from `columns`)
6. Properly quotes any field that contains:
   - Semicolons (`;`)
   - Double quotes (`"`) — escaped by doubling them (`""`)
   - Newline characters (`\n` or `\r`)
7. Returns the complete CSV string

This is a pure utility function with no external dependencies. Make sure edge cases are handled (empty data, special characters in values, etc.).

Verify with `npm run build`.
```

---

## Prompt 4 — Server API Endpoint: POST /api/parse

```
Read @[docs/SPECS.md] sections 7 and 9. (and remember all @[docs/SPECS.md], all previous things that are done in the project and @[docs/INSTRUCTIONS.md], context)

Create the file server/api/parse.post.ts — the main API endpoint.

This endpoint must:
1. Accept a POST request with multipart/form-data containing a single file field named "file"
2. Validate that a file was uploaded — if not, return 400 with { error: "Nie przesłano pliku." }
3. Validate that the file is a PDF (check MIME type for "application/pdf") — if not, return 400 with { error: "Nieprawidłowy typ pliku. Akceptowane są wyłącznie pliki PDF." }
4. Read the file into a Buffer
5. Call the parseWithGemini() function from server/utils/gemini.ts
6. Convert the result to CSV using convertToCSV() from server/utils/csv.ts
7. Determine the output filename: take the original uploaded filename, remove the .pdf extension, append "_parsed.csv"
8. Return the CSV as a file download response with:
   - Content-Type: "text/csv; charset=utf-8"
   - Content-Disposition: attachment; filename="<output_filename>"
   - The CSV string as the response body
9. Handle all errors from parseWithGemini() and return appropriate 500 responses with Polish error messages:
   - Rate limit → "Przekroczono limit zapytań API. Spróbuj ponownie później."
   - Timeout → "Przetwarzanie trwało zbyt długo. Spróbuj ponownie."
   - Invalid AI response → "AI zwróciło nieoczekiwany format odpowiedzi."
   - Network error → "Nie można połączyć się z usługą AI."
   - Generic error → "Nie udało się przetworzyć pliku PDF."

Use Nuxt 3's readMultipartFormData() for handling file uploads. Do NOT install multer or any additional file upload library.

Verify with `npm run build`.
```

---

## Prompt 5 — Frontend Component: FileUpload.vue

```
Read @[docs/SPECS.md] section 6 (all subsections) (and remember all @[docs/SPECS.md], all previous things that are done in the project and @[docs/INSTRUCTIONS.md], context).

Create the file components/FileUpload.vue — the PDF upload dropzone component.

Requirements:
1. A large, centered dropzone area with:
   - Dashed border (Tailwind: border-dashed)
   - An upload/cloud-upload SVG icon (use inline SVG, do NOT install icon libraries)
   - Primary text in Polish: "Upuść plik PDF z cennikiem tutaj lub kliknij, aby przeglądać"
   - Secondary text: "Akceptowane: pliki PDF"
2. Supports both drag-and-drop and click-to-browse (hidden file input triggered on click)
3. Accepts only .pdf files (accept=".pdf" on the input)
4. Visual feedback on drag hover (e.g., border color change, subtle background change)
5. Emits an event `file-selected` with the File object when a valid PDF is selected
6. Client-side validation: if user drops a non-PDF file, show a brief error message in Polish within the dropzone
7. Styled with Tailwind CSS only — clean, professional, neutral look with a primary accent color (blue tones)

Do NOT implement any upload logic (API calls) — this component only handles file selection and emits the file.

Verify with `npm run build`.
```

---

## Prompt 6 — Frontend Component: ProcessingStatus.vue

```
Read @[docs/SPECS.md] section 6.2, State 2. (and remember all @[docs/SPECS.md], all previous things that are done in the project and @[docs/INSTRUCTIONS.md], context).

Create the file components/ProcessingStatus.vue — the loading/processing indicator.

Requirements:
1. Props: `fileName` (string) — the name of the file being processed
2. Displays:
   - An animated spinner (CSS animation with Tailwind, use animate-spin on a circular SVG — inline SVG, no icon library)
   - Text in Polish: "Analizowanie cennika za pomocą AI..."
   - The filename displayed below in smaller, muted text
3. Clean, centered layout
4. Styled with Tailwind CSS only — consistent with the overall design

This is a purely presentational component with no logic.

Verify with `npm run build`.
```

---

## Prompt 7 — Frontend Component: DownloadResult.vue

```
Read @[docs/SPECS.md] sections 6.2 (State 3) and 6.2 (Error State). (and remember all @[docs/SPECS.md], all previous things that are done in the project and @[docs/INSTRUCTIONS.md], context).

Create the file components/DownloadResult.vue — the result/download component.

Requirements:
1. Props:
   - `csvBlob` (Blob | null) — the CSV data as a Blob (for creating download URL)
   - `fileName` (string) — the output CSV filename
   - `rowCount` (number) — number of data rows extracted
   - `columnCount` (number) — number of columns extracted
   - `error` (string | null) — error message if parsing failed

2. SUCCESS state (when csvBlob is not null and error is null):
   - Green checkmark SVG icon (inline SVG)
   - Success message in Polish: "Plik CSV został wygenerowany pomyślnie!"
   - Summary info in Polish: "Nazwa pliku: ...", "Wiersze: ...", "Kolumny: ..."
   - Prominent download button in Polish: "Pobierz CSV" — creates a temporary download URL from the Blob using URL.createObjectURL() and triggers download
   - Secondary button in Polish: "Przetwórz kolejny plik" — emits `reset` event

3. ERROR state (when error is not null):
   - Red X or warning SVG icon (inline SVG)
   - Error message displayed in a red-tinted container
   - Button in Polish: "Spróbuj ponownie" — emits `reset` event

4. Styled with Tailwind CSS only — consistent with overall design.
5. Clean up the object URL (URL.revokeObjectURL) when the component is unmounted or when csvBlob changes.

Verify with `npm run build`.
```

---

## Prompt 8 — Main Page: pages/index.vue

```
Read @[docs/SPECS.md] sections 6.1, 6.2, and 9. (and remember all @[docs/SPECS.md], all previous things that are done in the project and @[docs/INSTRUCTIONS.md], context).

Create the file pages/index.vue — the main (and only) page of the application.

This page integrates all three components and manages the application state machine.

Requirements:
1. Application header/title in Polish at the top: "Parser Cenników PDF" with a short subtitle: "Konwertuj cenniki PDF na pliki CSV za pomocą AI"
2. State management using a reactive variable: `state: 'idle' | 'processing' | 'complete' | 'error'`
3. State transitions:
   - **idle**: Show `<FileUpload />`. On `file-selected` event → transition to `processing`
   - **processing**: Show `<ProcessingStatus />`. Send the file to `POST /api/parse` using fetch(). On success → transition to `complete`. On error → transition to `error`
   - **complete**: Show `<DownloadResult />` in success mode with CSV blob, filename, row count, column count
   - **error**: Show `<DownloadResult />` in error mode with error message
4. On `reset` event from DownloadResult → transition back to `idle`, clear all data
5. The fetch call to /api/parse:
   - Create FormData, append the file as "file"
   - Send POST request
   - On success (response.ok): read the response as Blob, parse the row/column counts from the CSV content (count lines for rows, split first line by semicolons for columns)
   - On error: read the response as JSON, extract the error message
6. Page layout: centered content, max-width container (e.g., max-w-2xl), vertically centered or near-top with generous padding
7. Styled with Tailwind CSS — professional, minimal, clean

Verify by running `npm run dev` and confirming the page loads without errors in the browser. Test the visual layout.
```

---

## Prompt 9 — Integration Testing & Bug Fixing

```
Read @[docs/SPECS.md] and @[docs/INSTRUCTIONS.md].

Now perform a full integration check of the entire application:

1. Run `npm run build` and fix any TypeScript or compilation errors
2. Run `npm run dev` and verify:
   a. The page loads at http://localhost:3000 without console errors
   b. The UI displays the dropzone correctly with all Polish text
   c. File selection works (both click-to-browse and drag-and-drop)
   d. The Processing state shows the spinner and filename
   e. Error handling works (try uploading a non-PDF file)

3. Review the complete data flow against SPECS.md section 9 — verify every step is correctly implemented
4. Review the error handling against SPECS.md section 10 — verify all error scenarios return proper Polish messages
5. Verify the .env.example file exists and has the correct fields
6. Verify the runtimeConfig in nuxt.config.ts correctly reads from .env

Fix any bugs, type errors, or issues found during this review. Do not skip any check. Run the build again after all fixes to confirm zero errors.

Report what was checked and what (if anything) was fixed.
```

---

## Prompt 10 — Final Review, README & Documentation

```
Read @[docs/SPECS.md].

Perform the following final tasks:

1. Create a README.md in the project root with:
   - Project name and one-line description (in English)
   - Tech stack badges or list
   - Prerequisites (Node.js, npm, Gemini API key)
   - Installation steps:
     a. Clone/download the repository
     b. Run `npm install`
     c. Copy `.env.example` to `.env` and fill in `GEMINI_API_KEY`
     d. Run `npm run dev`
     e. Open http://localhost:3000
   - Brief usage description
   - Project structure overview

2. Review the entire project structure against SPECS.md section 3.2 and verify all expected files exist

3. Run a final `npm run build` to confirm everything compiles cleanly

4. Provide a summary of the complete, ready-to-use application.
```

---

## Summary — Prompt Execution Order

| #  | Prompt Focus                              | Files Created / Modified                                                  | Verification Step          |
| -- | ----------------------------------------- | ------------------------------------------------------------------------- | -------------------------- |
| 1  | Project init, deps, Tailwind, config      | `nuxt.config.ts`, `tailwind.config.ts`, `assets/css/main.css`, `.env.example`, `.gitignore`, `package.json` | `npm run build`            |
| 2  | Gemini client + AI prompt templates       | `server/utils/gemini.ts`, `server/utils/prompts.ts`                       | `npm run build`            |
| 3  | CSV conversion utility                    | `server/utils/csv.ts`                                                     | `npm run build`            |
| 4  | API endpoint                              | `server/api/parse.post.ts`                                                | `npm run build`            |
| 5  | Upload dropzone component                 | `components/FileUpload.vue`                                               | `npm run build`            |
| 6  | Processing spinner component              | `components/ProcessingStatus.vue`                                         | `npm run build`            |
| 7  | Download/error result component           | `components/DownloadResult.vue`                                           | `npm run build`            |
| 8  | Main page (state machine + integration)   | `pages/index.vue`                                                         | `npm run dev` + browser    |
| 9  | Full integration test & bug fixing        | Any files needing fixes                                                   | `npm run build` + `dev`    |
| 10 | README, final review, docs                | `README.md`                                                               | `npm run build`            |

---

## Design Rationale — Why This Order?

1. **Foundation first** (Prompt 1): You cannot build anything without a working Nuxt project with dependencies installed and configured.
2. **Backend before frontend** (Prompts 2–4): The server utilities and API endpoint are the core of the application. Building them first ensures the data pipeline works before adding a UI on top.
3. **Utilities before endpoint** (Prompts 2–3 before 4): The API endpoint depends on `gemini.ts` and `csv.ts`, so those must exist first.
4. **Prompts before Gemini client** (both in Prompt 2): The prompt templates are imported by the Gemini client, so they're co-created.
5. **Components before page** (Prompts 5–7 before 8): The main page imports and orchestrates all components, so they must exist first.
6. **Components in UI flow order** (5→6→7): Upload → Processing → Result mirrors the user journey and makes each component independently verifiable.
7. **Integration test after assembly** (Prompt 9): Once all pieces exist, a dedicated pass catches wiring issues between components.
8. **Documentation last** (Prompt 10): README and final review happen when the application is complete and stable.
