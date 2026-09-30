<template>
  <div
    class="w-full cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-all duration-200"
    :class="[
      isDragOver
        ? 'border-blue-500 bg-blue-50'
        : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-gray-50',
    ]"
    @click="triggerFileInput"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input
      ref="fileInputRef"
      type="file"
      accept=".pdf"
      class="hidden"
      @change="onFileInputChange"
    />

    <!-- Upload icon (cloud-upload SVG) -->
    <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-16 w-16"
        :class="isDragOver ? 'text-blue-500' : 'text-gray-400'"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M7 16a4 4 0 0 1-.88-7.903A5 5 0 1 1 15.9 6h.1a5 5 0 0 1 1 9.9M15 13l-3-3m0 0-3 3m3-3v12"
        />
      </svg>
    </div>

    <!-- Primary text -->
    <p
      class="mb-2 text-lg font-semibold"
      :class="isDragOver ? 'text-blue-600' : 'text-gray-700'"
    >
      Upuść plik PDF z cennikiem tutaj lub kliknij, aby przeglądać
    </p>

    <!-- Secondary text -->
    <p class="text-sm text-gray-500">Akceptowane: pliki PDF</p>

    <!-- Error message -->
    <p
      v-if="errorMessage"
      class="mt-4 text-sm font-medium text-red-600"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  'file-selected': [file: File]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)
const errorMessage = ref<string | null>(null)

function triggerFileInput() {
  fileInputRef.value?.click()
}

function onDragOver() {
  isDragOver.value = true
  errorMessage.value = null
}

function onDragLeave() {
  isDragOver.value = false
}

function onDrop(event: DragEvent) {
  isDragOver.value = false
  errorMessage.value = null

  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  const file = files[0]
  validateAndEmit(file)
}

function onFileInputChange(event: Event) {
  errorMessage.value = null
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  const file = files[0]
  validateAndEmit(file)

  // Reset the input so the same file can be re-selected
  target.value = ''
}

function validateAndEmit(file: File) {
  if (file.type !== 'application/pdf') {
    errorMessage.value = 'Tylko pliki PDF są akceptowane.'
    return
  }

  emit('file-selected', file)
}
</script>
