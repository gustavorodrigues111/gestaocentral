// Mapeamento de DOMÍNIOS PRÓPRIOS de restaurantes → slug do site.
//
// Quando o cliente acessa o site via domínio próprio (ex: lobozo.com.br),
// o app detecta o host e renderiza o SitePublicaPage do restaurante
// correspondente direto na raiz, sem precisar do path /site/<slug>.
//
// Pra adicionar um novo restaurante com domínio próprio:
//  1) DNS do registrador → Vercel (CNAME e/ou A records)
//  2) No painel Vercel → Settings → Domains, adicionar o domínio
//  3) Adicionar o mapeamento aqui (cobrir com e sem "www")
//  4) Deploy
//
// Domínio raiz E www apontam pro MESMO slug — usuário típico chega via
// ambos. Forms públicos (/reservas/:rid, /eventos/:rid, /trabalhe/:rid,
// /politica/:slug, /r/excluir-dados/:rid) funcionam em qualquer domínio
// sem mudança porque usam parâmetros da URL.
const RESTAURANT_HOSTS: Record<string, string> = {
  "lobozo.com.br":     "lobozo",
  "www.lobozo.com.br": "lobozo",
  "sororoca.com.br":   "sororoca",
  "www.sororoca.com.br": "sororoca",
};

// Hosts internos do admin/preview — NUNCA renderizar site público.
const ADMIN_HOSTS = new Set([
  "admin.planejamento.app",
  "planejamento.app",
  "www.planejamento.app",
  "localhost",
  "127.0.0.1",
]);

// Retorna o slug do restaurante se o host atual for de um domínio próprio
// mapeado. Senão retorna null (host admin/preview/dev).
export function getSlugFromHost(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();
  if (ADMIN_HOSTS.has(host)) return null;
  // Hosts de preview do Vercel (ex: *.vercel.app) — não tratar como custom
  if (host.endsWith(".vercel.app")) return null;
  return RESTAURANT_HOSTS[host] || null;
}

// Reverso: domínio próprio (sem www) de um slug, se houver. Usado pra montar
// os links rápidos do cardápio na aba (ex: "lobozo.com.br"). null se o
// restaurante ainda não tem domínio próprio mapeado.
export function hostDoSlug(slug: string): string | null {
  const semWww = Object.entries(RESTAURANT_HOSTS).find(([h, s]) => s === slug && !h.startsWith("www."));
  if (semWww) return semWww[0];
  const qualquer = Object.entries(RESTAURANT_HOSTS).find(([, s]) => s === slug);
  return qualquer ? qualquer[0] : null;
}
