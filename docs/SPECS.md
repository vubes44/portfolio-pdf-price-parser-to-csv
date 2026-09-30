# PDF Price List Parser — Technical Specification (MVP)

## 1. Project Overview

### 1.1 Purpose

This application solves a critical problem faced by industrial automation wholesalers: extracting structured, machine-readable data from complex, inconsistent PDF price lists provided by various suppliers. Price lists in this industry vary wildly in format, layout, language, and data structure — making manual data entry error-prone and time-consuming.

The application leverages Google Gemini 3.6 Flash AI to intelligently identify, extract, and normalize all relevant data from any PDF price list, regardless of its structure, language, or complexity, and outputs a clean, standardized CSV file.

It has an UI in Polish made in Nuxt.js.

### 1.2 Problem Statement

Industrial automation suppliers distribute product catalogs and price lists as PDF files. These PDFs:

- Come from **many different suppliers**, each with a unique layout and format.
- Contain **complex structures**: multi-level headers, merged cells, nested tables, footnotes, grouped categories, multi-page spanning tables, and mixed content (images, diagrams, text blocks alongside tabular data).
- Are written in **various languages** (Polish, English, German, etc.).
- May be **digitally generated** (selectable text) or **scanned** (requiring OCR-level interpretation by the AI).
- Vary in **size** from a few pages to hundreds of pages.

The AI model must act as the intelligent decision-maker that determines which data is meaningful pricing/product data and which is noise (headers, footers, decorative elements, legal disclaimers, etc.).

### 1.3 Solution Summary

A web-based tool built with **Nuxt 3** and **Tailwind CSS** that provides a simple GUI for uploading a PDF file. The file is sent to the Nuxt server backend, which processes it using the **Google Gemini 2.5 Flash** API. The AI analyzes the entire PDF, identifies all product/pricing data, determines the appropriate column structure, and returns a normalized dataset. The server then converts this into a **semicolon-delimited UTF-8 CSV** file and serves it to the user for download.

---

## 2. Technology Stack

| Layer        | Technology                | Notes                                      |
| ------------ | ------------------------- | ------------------------------------------ |
| Framework    | **Nuxt 3**                | Full-stack Vue.js framework                |
| UI Styling   | **Tailwind CSS**          | Utility-first CSS framework                |
| AI Model     | **Google Gemini 2.5 Flash** | Via Google Generative AI REST API        |
| Runtime      | **Node.js**               | Server-side execution environment          |
| Language     | **TypeScript**            | Preferred for type safety                  |
| Deployment   | **Local**                 | Development server (`npm run dev`)         |

### 2.1 Key Dependencies (Expected)

- `nuxt` (v3.x)
- `@google/genai` — Official Google Generative AI SDK for JavaScript/TypeScript
- `tailwindcss` (v3.x or v4.x)
- `pdf-parse` or equivalent — For PDF text extraction as a pre-processing step (if needed alongside AI)

---

## 3. Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                   │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────┐  │
│  │  Upload PDF  │───▶│  Processing  │───▶│  Download   │  │
│  │   Dropzone   │    │   Spinner    │    │  CSV Link   │  │
│  └─────────────┘    └──────────────┘    └────────────┘  │
└────────────────────────────┬────────────────────────────┘
                             │ HTTP POST (multipart/form-data)
                             ▼
┌─────────────────────────────────────────────────────────┐
│                NUXT 3 SERVER (API Routes)                │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │            /api/parse  (POST endpoint)           │    │
│  │                                                   │    │
│  │  1. Receive uploaded PDF file                     │    │
│  │  2. Convert PDF to format suitable for AI         │    │
│  │  3. Send to Gemini 2.5 Flash with detailed prompt │    │
│  │  4. Receive structured JSON response from AI      │    │
│  │  5. Convert JSON to semicolon-delimited CSV       │    │
│  │  6. Return CSV file to client                     │    │
│  └──────────────────────┬──────────────────────────┘    │
└─────────────────────────┼───────────────────────────────┘
                          │ HTTPS (API call)
                          ▼
┌─────────────────────────────────────────────────────────┐
│              GOOGLE GEMINI 2.5 FLASH API                │
│                                                         │
│  - Receives PDF content (as base64 or extracted text)   │
│  - Analyzes structure, identifies all product data      │
│  - Determines optimal column schema                     │
│  - Returns structured JSON with all extracted data      │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Project Directory Structure

```
pdf_parser_to_csv_tv/
├── docs/
│   ├── SPECS.md              # This file — technical specification
│   ├── INSTRUCTIONS.md       # Instructions for AI agent
│   └── PROMPTS.md            # Prompts for AI agent that creates app - step by step, prompt by prompt
├── server/
│   ├── api/
│   │   └── parse.post.ts     # Main API endpoint for PDF parsing
│   └── utils/
│       ├── gemini.ts         # Gemini API client initialization & helpers
│       ├── csv.ts            # JSON-to-CSV conversion utility
│       └── prompts.ts        # AI prompt templates (system & user)
├── pages/
│   └── index.vue             # Main (and only) page — upload UI
├── components/
│   ├── FileUpload.vue        # PDF upload dropzone component
│   ├── ProcessingStatus.vue  # Loading/progress indicator component
│   └── DownloadResult.vue    # CSV download link component
├── assets/
│   └── css/
│       └── main.css          # Tailwind base styles
├── public/                   # Static assets (favicon, etc.)
├── .env                      # Environment variables (API key)
├── .env.example              # Template for .env file
├── nuxt.config.ts            # Nuxt configuration
├── tailwind.config.ts        # Tailwind configuration
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies and scripts
└── README.md                 # Project overview and quick start
```

---

## 4. Configuration & Environment

### 4.1 Environment Variables (`.env`)

```env
# Google Gemini API Configuration
GEMINI_API_KEY=your_api_key_here

# Model Configuration
GEMINI_MODEL=gemini-2.5-flash

# Optional: Request timeout in milliseconds (default: 120000 = 2 minutes)
GEMINI_TIMEOUT=120000
```

### 4.2 `.env.example`

An `.env.example` file must be provided as a template with all required fields listed (values left blank or with placeholder text) so that any developer can set up the project by copying it to `.env` and filling in their credentials.

### 4.3 Runtime Configuration

Environment variables must be accessed via Nuxt 3 `runtimeConfig` in `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    geminiTimeout: parseInt(process.env.GEMINI_TIMEOUT || '120000'),
  },
})
```

These values are **server-only** (`runtimeConfig`, not `runtimeConfig.public`) — the API key must never be exposed to the client.

---

## 5. Feature Specification

### 5.1 PDF Upload

| Property            | Value                                           |
| ------------------- | ----------------------------------------------- |
| Accepted file types | `.pdf` only                                     |
| Max file size       | No hard limit in MVP (practical limit ~20MB for Gemini API) |
| Upload method       | `multipart/form-data` via HTTP POST             |
| Files per request   | **1** (single file, MVP)                        |
| Drag & drop         | Yes                                             |
| Click to browse     | Yes                                             |
| File validation     | Client-side: file type check. Server-side: MIME type verification |

### 5.2 AI-Powered PDF Parsing

This is the **core feature** and the primary value proposition of the application.

#### 5.2.1 Input to AI

The PDF file is sent to Gemini 2.5 Flash. Gemini's multimodal capabilities allow sending the PDF directly as a binary file (base64-encoded) in the API request. This is the preferred approach because:

- It preserves the visual layout, which is critical for understanding complex table structures.
- It handles scanned PDFs without needing a separate OCR step.
- It captures context that pure text extraction would lose (column alignment, grouping by visual proximity, etc.).

#### 5.2.2 AI Responsibilities

The Gemini 2.5 Flash model is responsible for:

1. **Identifying all product/pricing data** — distinguishing actual catalog entries from headers, footers, page numbers, legal text, logos, decorative elements, and other non-data content.
2. **Determining the column schema** — based on what data fields are present in the PDF (e.g., part number, product name, price, unit, category, description, weight, dimensions, voltage, etc.). The columns are **not predefined** — the AI must infer them from the content.
3. **Extracting ALL data** — every single data point from the PDF must be captured. No data may be omitted or summarized.
4. **Normalizing the data** — ensuring consistent formatting across rows (e.g., consistent decimal separators, consistent unit notation, etc.).
5. **Handling multi-page content** — the AI must process the entire PDF and merge data from all pages into a single unified dataset.
6. **Handling various languages** — the AI must correctly process PDFs in any language and preserve the original language of product names and descriptions.

#### 5.2.3 Output from AI

The AI must return a **structured JSON response** in the following format:

```json
{
  "columns": ["Column1", "Column2", "Column3", "..."],
  "rows": [
    ["value1", "value2", "value3", "..."],
    ["value1", "value2", "value3", "..."]
  ]
}
```

- `columns`: An array of strings representing the header names for the CSV. Determined by the AI based on the PDF content.
- `rows`: An array of arrays, where each inner array represents one row of data, with values in the same order as `columns`.

#### 5.2.4 Prompt Engineering

The AI prompts are **critical** to the success of this application. They must be:

- **Extremely detailed and precise** — leaving no room for ambiguity.
- **Thoroughly tested** against various PDF formats.
- **Documented** in the `docs/PROMPTS.md` file with rationale for each instruction.

- **Zero-Tolerance for AI Hallucinations & Chatter:** The system prompt must explicitly forbid the AI from adding conversational filler, greetings, explanations, or any markdown wrappers around the JSON. The model output must start with `{` and end with `}`. If data is missing or ambiguous, the model must handle it deterministically (e.g., leaving the field empty or null) rather than inventing data.

The prompt structure should include:

1. **System prompt** — Defines the AI's role as a specialized industrial automation price list parser. Sets expectations for output format and completeness.
2. **User prompt** — Contains the specific instructions for the current parsing task, including the required JSON output schema.

Prompt templates are stored in `server/utils/prompts.ts` and documented in `docs/PROMPTS.md`.


### 5.3 CSV Generation

| Property          | Value                                  |
| ----------------- | -------------------------------------- |
| Delimiter         | **Semicolon** (`;`)                    |
| Encoding          | **UTF-8** (with BOM for Excel compatibility) |
| Line endings      | CRLF (`\r\n`)                          |
| Header row        | Yes (first row contains column names)  |
| Quoting           | Fields containing semicolons, quotes, or newlines must be quoted with double quotes (`"`) |
| Filename          | Based on original PDF filename: `{original_name}_parsed.csv` |

### 5.4 CSV Download

After successful parsing, the client receives the CSV file and triggers an automatic download in the browser. The user must also have a visible download button/link to re-download the file.

---

## 6. User Interface Specification

### 6.1 Layout

The application is a **single-page application** with one main view. The UI must be clean, professional, and minimal.

### 6.2 Application States

The UI transitions through three states:

#### State 1: IDLE — Ready for Upload

- Large centered dropzone area with:
  - Dashed border
  - Upload icon
  - Text: "Drop your PDF price list here or click to browse"
  - Accepted format note: "Accepts: PDF files"
- Application title/heading at the top

#### State 2: PROCESSING — Parsing in Progress

- The dropzone is replaced by (or visually transitions to) a processing indicator:
  - Animated spinner or progress animation
  - Text: "Analyzing your price list with AI..." or similar
  - The original filename displayed
- Upload area is disabled (no new uploads during processing)

#### State 3: COMPLETE — CSV Ready for Download

- Success message with checkmark icon
- Download button for the CSV file (prominent, primary action)
- Summary info: filename, number of rows extracted, number of columns
- "Parse another file" button to reset to State 1

#### Error State

- If processing fails, display an error message with:
  - Clear error description
  - "Try again" button to reset to State 1

### 6.3 Styling Guidelines

- **Tailwind CSS** for all styling — no custom CSS files beyond Tailwind base setup.
- Color scheme: Professional, clean. Neutral tones with a primary accent color.
- Responsive: Must work on desktop screens (mobile optimization is not required for MVP but layout should not break).
- Dark mode: Not required for MVP.

### 6.4 Localization / Language
- **UI Language:** All user interface elements (buttons, dropzone instructions, processing status messages, error notifications, success screens, and download descriptions) must be written **exclusively in Polish**.
---

## 7. API Endpoint Specification

### 7.1 `POST /api/parse`

#### Request

- **Method**: `POST`
- **Content-Type**: `multipart/form-data`
- **Body**: Form data with a single file field

| Field  | Type   | Required | Description         |
| ------ | ------ | -------- | ------------------- |
| `file` | `File` | Yes      | The PDF file to parse |

#### Response — Success (200)

- **Content-Type**: `text/csv; charset=utf-8`
- **Content-Disposition**: `attachment; filename="{original_name}_parsed.csv"`
- **Body**: UTF-8 encoded CSV content with BOM

#### Response — Error (400)

```json
{
  "error": "No file uploaded"
}
```

```json
{
  "error": "Invalid file type. Only PDF files are accepted."
}
```

#### Response — Error (500)

```json
{
  "error": "Failed to parse PDF. The AI could not extract structured data from this file.",
  "details": "Optional additional error context"
}
```

---

## 8. AI Integration Details

### 8.1 Gemini API Usage

- **SDK**: `@google/genai` (official Google Generative AI JavaScript/TypeScript SDK)
- **Model**: `gemini-2.5-flash`
- **Pricing tier**: Free tier (rate limits apply — see section 8.2)
- **Input method**: Direct PDF file upload via the API's multimodal capabilities (inline data as base64)
- **Response format**: JSON mode (structured output) — the model is instructed to return valid JSON matching the defined schema

### 8.2 Free Tier Considerations

The Gemini 2.5 Flash free tier has rate limits. The application must:

- Handle rate limit errors gracefully (HTTP 429) and inform the user.
- Handle rate limit errors gracefully... The application implements automatic retry logic for temporary failures as specified in section 10.1.
- Log API usage for awareness.

### 8.3 Large PDF Handling

For very large PDFs that may exceed the Gemini API's input token limit:

- The application should attempt to send the full PDF first.
- If the API returns a token limit error, the application should report this to the user with a clear message.
- Future versions may implement chunking strategies (splitting PDF by pages and merging results), but this is **out of scope for MVP**.

---

## 9. Data Flow (Step-by-Step)

```
1. User drops/selects a PDF file in the browser UI
2. Client validates file type (.pdf)
3. Client sends file to POST /api/parse as multipart/form-data
4. Server receives and validates the file (MIME type check)
5. Server reads the PDF file into a Buffer
6. Server converts the PDF Buffer to base64
7. Server constructs the Gemini API request:
   a. System prompt (from prompts.ts)
   b. User prompt with parsing instructions (from prompts.ts)
   c. PDF file as inline base64 data (mimeType: "application/pdf")
8. Server sends request to Gemini 2.5 Flash API
9. Gemini analyzes the entire PDF and returns structured JSON
10. Server validates the JSON response (has "columns" and "rows")
11. Server converts JSON to semicolon-delimited CSV:
    a. UTF-8 BOM prepended
    b. Header row from "columns"
    c. Data rows from "rows"
    d. Proper quoting of special characters
12. Server returns CSV as file download response
13. Client triggers file download in the browser
14. UI transitions to "Complete" state showing download link
```

---

## 10. Error Handling (MVP)

| Scenario                    | Handling                                              |
| --------------------------- | ----------------------------------------------------- |
| No file uploaded            | 400 error, client shows message                       |
| Wrong file type             | 400 error, client shows message                       |
| File too large for API      | 500 error with descriptive message                    |
| Gemini API key missing      | Server startup warning, 500 on request                |
| Gemini API rate limit (429) | 500 error, message: "API rate limit reached, try later" |
| Gemini API timeout          | 500 error, message: "Processing timed out"            |
| Invalid AI response (bad JSON) | 500 error, message: "AI returned unexpected format" |
| Network error to Gemini API | 500 error, message: "Could not reach AI service"      |
NOTE: ALL HANDLINGS ARE WRITTEN ENGLISH HERE, BUT GUI SHOULD TRANSLATE IT TO POLISH

### 10.1 Error Mitigation & Robustness (Required for Implementation)

To minimize false-positive errors and ensure application stability when dealing with AI outputs and large PDFs, the implementation must include the following strategies:

1. **Robust JSON Extraction (Cleaning AI Output):**
   - LLMs often wrap JSON responses in markdown code blocks (e.g., ```json ... ```) or include conversational prefix/suffix text.
   - The backend must not rely on raw `JSON.parse()` directly on the response. Instead, it should use a regex or string manipulation helper to extract text strictly between the first `{` and the last `}` before parsing.

2. **Automatic Retry Mechanism:**
   - For temporary failures such as **API Timeouts** or **Rate Limits (429)**, the server-side API endpoint (`/api/parse`) should automatically retry the Gemini API call up to **2 times** with a short delay (e.g., 2 seconds) before failing and returning an error to the client.

3. **Strict System Prompting:**
   - The system prompt in `prompts.ts` must explicitly instruct the Gemini model to return **pure JSON only**, with no introductory text, no explanations, and no markdown formatting wrappers, ensuring the highest possible rate of valid JSON responses.

---

## 11. Security Considerations (MVP)

- **API key** is stored in `.env` and accessed only server-side via `runtimeConfig`. It is never sent to the client.
- **File uploads** are processed in memory (no persistent storage on disk in MVP).
- **No authentication** — the application is intended for local/internal use only in MVP.
- **Input validation** — only PDF MIME type is accepted.

---

## 12. Constraints & Limitations (MVP)

- Single file processing only (no batch uploads).
- No database or history of previous parsings.
- No user authentication or access control.
- No manual review/editing of parsed results before CSV export.
- No PDF chunking for very large files.
- No dark mode.
- No mobile-optimized UI.
- Local deployment only (no production hosting).
- Dependent on Gemini API free tier rate limits.

---

## 13. Future Enhancements (Post-MVP)

The following features are explicitly **out of scope** for MVP but are anticipated for future versions:

- Batch upload and processing of multiple PDFs.
- Preview/edit parsed data in the UI before CSV export.
- Processing history with database storage.
- User authentication and multi-user support.
- Intelligent PDF chunking for very large files.
- Retry logic with exponential backoff for API errors.
- Export to additional formats (XLSX, JSON).
- Webhook/integration with ERP systems.
- Dark mode and mobile-responsive UI.
- Production deployment configuration (Docker, cloud hosting).

---

## 14. Glossary

| Term            | Definition                                                                 |
| --------------- | -------------------------------------------------------------------------- |
| **CSV**         | Comma-Separated Values (in this project, semicolon-separated)              |
| **Gemini**      | Google's family of multimodal AI models                                    |
| **MVP**         | Minimum Viable Product — the first functional version with core features   |
| **OCR**         | Optical Character Recognition — extracting text from images/scans          |
| **Parser**      | Software that analyzes input data and extracts structured information       |
| **Price list**  | A document listing products with their prices and specifications           |
| **Wholesaler**  | A business that buys goods in bulk and sells to retailers or other businesses |
