import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ── Fix definitivo do "Failed to fetch dynamically imported module" ───────────
// Depois de um novo deploy, os chunks com hash mudam de nome. Uma aba aberta há
// um tempo (ou cache/CDN velho) tenta importar o hash ANTIGO → 404 → o erro
// recorrente que aparecia ao gerar PDF (jsPDF/html2canvas são import() sob
// demanda, como dezenas de outros exports). O Vite dispara `vite:preloadError`
// nesse caso; a gente recarrega a página UMA vez (busca o index.html novo, com
// os hashes atuais) e o clique seguinte funciona.
window.addEventListener('vite:preloadError', ((e: Event) => {
  e.preventDefault()   // não estoura pro console/boundary — a gente trata aqui
  if (!sessionStorage.getItem('__chunkReload')) {
    sessionStorage.setItem('__chunkReload', '1')
    window.location.reload()
  }
}) as EventListener)
// Carregou de novo com sucesso → libera o guard pra permitir novo reload num
// próximo deploy (senão o 1º reload "gastaria" a proteção pra sempre).
window.addEventListener('load', () => {
  setTimeout(() => { try { sessionStorage.removeItem('__chunkReload') } catch { /* ok */ } }, 10000)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
