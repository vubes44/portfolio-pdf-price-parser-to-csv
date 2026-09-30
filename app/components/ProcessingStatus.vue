<template>
  <div class="flex flex-col items-center justify-center rounded-xl border-2 border-blue-200 bg-blue-50 p-12 text-center">
    <!-- Animated spinner (circular SVG with animate-spin) -->
    <div class="mb-6">
      <svg
        class="h-16 w-16 animate-spin text-blue-500"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          class="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          stroke-width="4"
        />
        <path
          class="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>

    <!-- Processing text in Polish -->
    <p class="mb-2 text-lg font-semibold text-gray-700">
      Analizowanie cennika za pomocą AI...
    </p>

    <!-- Filename in smaller, muted text -->
    <p class="text-sm text-gray-500">
      {{ fileName }}
    </p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  fileName: string
}>()
</script>
