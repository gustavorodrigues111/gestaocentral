import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Versão do build: usa o SHA do commit injetado pelo Vercel
// (VERCEL_GIT_COMMIT_SHA), caindo no `git rev-parse` local quando rodando
// fora do Vercel. Sempre formatado como SHA curto (7 chars). Se nada estiver
// disponível, "dev".
function resolveCommitShort(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA
  if (fromVercel) return fromVercel.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
}

const APP_COMMIT = resolveCommitShort()
const APP_BUILD_DATE = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA — só o REGISTRO é escopado (feito à mão em src/main.tsx apenas no host
    // das comandas: comandas.planejamento.app). Nos demais hosts o service worker
    // NÃO é registrado, então o app admin segue sem cache/offline. autoUpdate +
    // skipWaiting/clientsClaim: nunca fica preso numa versão velha.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Planejamento PDV — Comandas',
        short_name: 'Comandas',
        description: 'PDV de balcão (planejamento.app) — comandas, caixa e nota fiscal',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,json}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/sites\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __APP_COMMIT__: JSON.stringify(APP_COMMIT),
    __APP_BUILD_DATE__: JSON.stringify(APP_BUILD_DATE),
  },
})
