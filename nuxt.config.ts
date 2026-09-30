// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@nuxtjs/tailwindcss'],

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-pro-preview',
    geminiTimeout: parseInt(process.env.GEMINI_TIMEOUT || '120000'),
  },
})
