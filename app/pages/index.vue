<template>
  <div class="min-h-screen bg-gray-50">
    <div class="mx-auto max-w-2xl px-4 py-16">
      <!-- Application header -->
      <div class="mb-10 text-center">
        <h1 class="text-3xl font-bold tracking-tight text-gray-900">
          Parser Cenników PDF
        </h1>
        <p class="mt-2 text-base text-gray-500">
          Konwertuj cenniki PDF na pliki CSV za pomocą AI
        </p>
      </div>

      <!-- State: IDLE — show file upload dropzone -->
      <FileUpload
        v-if="state === 'idle'"
        @file-selected="onFileSelected"
      />

      <!-- State: PROCESSING — show spinner -->
      <ProcessingStatus
        v-else-if="state === 'processing'"
        :file-name="selectedFileName"
      />

      <!-- State: COMPLETE — show download result (success) -->
      <DownloadResult
        v-else-if="state === 'complete'"
        :csv-blob="csvBlob"
        :file-name="outputFileName"
        :row-count="rowCount"
        :column-count="columnCount"
        :error="null"
        @reset="onReset"
      />

      <!-- State: ERROR — show download result (error) -->
      <DownloadResult
        v-else-if="state === 'error'"
        :csv-blob="null"
        :file-name="''"
        :row-count="0"
        :column-count="0"
        :error="errorMessage"
        @reset="onReset"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

type AppState = 'idle' | 'processing' | 'complete' | 'error'

const state = ref<AppState>('idle')
const selectedFileName = ref('')
const outputFileName = ref('')
const csvBlob = ref<Blob | null>(null)
const rowCount = ref(0)
const columnCount = ref(0)
const errorMessage = ref<string | null>(null)

async function onFileSelected(file: File) {
  state.value = 'processing'
  selectedFileName.value = file.name
  errorMessage.value = null

  try {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch('/api/parse', {
      method: 'POST',
      body: formData,
    })

    if (response.ok) {
      const blob = await response.blob()
      csvBlob.value = blob

      const contentDisposition = response.headers.get('Content-Disposition')
      let derivedFileName = ''
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^";\n]+)"?/)
        if (match && match[1]) {
          derivedFileName = match[1]
        }
      }
      if (!derivedFileName) {
        derivedFileName = file.name.replace(/\.pdf$/i, '') + '_parsed.csv'
      }
      outputFileName.value = derivedFileName

      const csvText = await blob.text()
      const lines = csvText
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)

      if (lines.length > 0 && lines[0]) {
        columnCount.value = countCsvColumns(lines[0])
        rowCount.value = lines.length - 1
      } else {
        columnCount.value = 0
        rowCount.value = 0
      }

      state.value = 'complete'
    } else {
      let message = 'Nie udało się przetworzyć pliku PDF.'
      try {
        const errorData = await response.json()
        const serverMessage = errorData?.data?.error ?? errorData?.error
        if (typeof serverMessage === 'string') {
          message = serverMessage
        }
      } catch {
        // Fallback
      }

      errorMessage.value = message
      state.value = 'error'
    }
  } catch {
    errorMessage.value = 'Wystąpił błąd sieci. Sprawdź połączenie i spróbuj ponownie.'
    state.value = 'error'
  }
}

function onReset() {
  state.value = 'idle'
  selectedFileName.value = ''
  outputFileName.value = ''
  csvBlob.value = null
  rowCount.value = 0
  columnCount.value = 0
  errorMessage.value = null
}

function countCsvColumns(headerLine: string): number {
  let count = 1
  let inQuotes = false
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ';' && !inQuotes) {
      count++
    }
  }
  return count
}
</script>
