<template>
  <!-- ERROR state -->
  <div
    v-if="error"
    class="flex flex-col items-center justify-center rounded-xl border-2 border-red-200 bg-red-50 p-12 text-center"
  >
    <!-- Red X icon (inline SVG) -->
    <div class="mb-6">
      <svg
        class="h-16 w-16 text-red-500"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
        />
      </svg>
    </div>

    <!-- Error message -->
    <div class="mb-6 w-full max-w-md rounded-lg border border-red-300 bg-red-100 px-4 py-3">
      <p class="text-sm font-medium text-red-800">
        {{ error }}
      </p>
    </div>

    <!-- Retry button -->
    <button
      class="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
      @click="emit('reset')"
    >
      Spróbuj ponownie
    </button>
  </div>

  <!-- SUCCESS state -->
  <div
    v-else-if="csvBlob"
    class="flex flex-col items-center justify-center rounded-xl border-2 border-green-200 bg-green-50 p-12 text-center"
  >
    <!-- Green checkmark icon (inline SVG) -->
    <div class="mb-6">
      <svg
        class="h-16 w-16 text-green-500"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
    </div>

    <!-- Success message -->
    <p class="mb-4 text-lg font-semibold text-gray-700">
      Plik CSV został wygenerowany pomyślnie!
    </p>

    <!-- Summary info -->
    <div class="mb-6 space-y-1 text-sm text-gray-600">
      <p>Nazwa pliku: <span class="font-medium text-gray-800">{{ fileName }}</span></p>
      <p>Wiersze: <span class="font-medium text-gray-800">{{ rowCount }}</span></p>
      <p>Kolumny: <span class="font-medium text-gray-800">{{ columnCount }}</span></p>
    </div>

    <!-- Action buttons -->
    <div class="flex flex-col items-center gap-3 sm:flex-row">
      <!-- Download button (prominent) -->
      <a
        :href="downloadUrl ?? undefined"
        :download="fileName"
        class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        <svg
          class="h-5 w-5"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
        </svg>
        Pobierz CSV
      </a>

      <!-- Reset button (secondary) -->
      <button
        class="rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition-colors duration-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        @click="emit('reset')"
      >
        Przetwórz kolejny plik
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  csvBlob: Blob | null
  fileName: string
  rowCount: number
  columnCount: number
  error: string | null
}>()

const emit = defineEmits<{
  reset: []
}>()

const downloadUrl = ref<string | null>(null)

// Create / revoke object URL when csvBlob changes
watch(
  () => props.csvBlob,
  (newBlob, oldBlob) => {
    // Revoke previous URL
    if (downloadUrl.value) {
      URL.revokeObjectURL(downloadUrl.value)
      downloadUrl.value = null
    }

    // Create new URL if blob exists
    if (newBlob) {
      downloadUrl.value = URL.createObjectURL(newBlob)
    }
  },
  { immediate: true },
)

// Clean up on unmount
onBeforeUnmount(() => {
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value)
    downloadUrl.value = null
  }
})
</script>
