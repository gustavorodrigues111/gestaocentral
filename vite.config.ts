import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
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
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(APP_COMMIT),
    __APP_BUILD_DATE__: JSON.stringify(APP_BUILD_DATE),
  },
})
