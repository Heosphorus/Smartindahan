import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Vercel and local development serve the app from "/". GitHub Pages serves it from "/<repository>/",
// so the Pages workflow sets VITE_BASE_PATH (for example "/Smartindahan/") at build time.
function resolveBase(): string {
  const configured = process.env.VITE_BASE_PATH?.trim()
  if (!configured || configured === '/') return '/'
  return `/${configured.replace(/^\/+|\/+$/g, '')}/`
}

// https://vite.dev/config/
// In development the app calls the relative "/api" and Vite forwards it to the local Express server,
// which avoids CORS entirely. This proxy is development-only and is not part of the production build.
const apiProxy = {
  '/api': { target: process.env.DEV_API_PROXY ?? 'http://localhost:5000', changeOrigin: true },
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
