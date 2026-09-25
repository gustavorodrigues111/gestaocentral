// ════════════════════════════════════════════════════════════════════════════
//  /api/pagina-og — serve o HTML do SPA para /pages/<slug> COM as meta tags
//  Open Graph da página (título, descrição, imagem), pra o preview do link no
//  WhatsApp/redes mostrar o nome certo em vez do genérico "Gestão Central".
//  O robô social não roda JS, então precisa das metas no HTML servido.
//  Usuários reais recebem o mesmo index.html e o SPA assume normalmente.
//  Só expõe descrição/imagem de páginas PÚBLICAS e ativas (privadas não vazam).
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreConsultarUm } from "./_firestoreRest.js";

const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Texto de descrição a partir do HTML da página (tira tags, colapsa espaços).
function excerto(html: string): string {
  const txt = String(html || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return txt.length > 180 ? txt.slice(0, 177) + "…" : txt;
}
// Primeira imagem http(s) do HTML (ignora data: e relativos).
function primeiraImagem(html: string): string {
  const m = String(html || "").match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  return m ? m[1] : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "www.planejamento.app");
  const slug = String((req.query.slug as string) || "").trim().toLowerCase();

  // Base do SPA: pega o index.html estático servido pela própria CDN.
  let html = "";
  try {
    const r = await fetch(`https://${host}/index.html`, { headers: { "x-og": "1" } });
    if (r.ok) html = await r.text();
  } catch { /* usa fallback abaixo */ }

  // Metadados da página (só título de páginas privadas; descrição/imagem só públicas).
  let titulo = "planejamento.app";
  let descricao = "Página hospedada no planejamento.app";
  let imagem = "";
  try {
    const doc = slug ? await firestoreConsultarUm("hostedPages", "slug", slug) : null;
    // Título do preview: campo dedicado (ogTitulo) se preenchido; senão o título da página.
    const ogT = doc && doc.ogTitulo ? String(doc.ogTitulo).trim() : "";
    if (ogT) titulo = ogT;
    else if (doc && doc.titulo) titulo = String(doc.titulo);
    const publica = doc && doc.ativo && doc.visibilidade === "publico";
    if (publica) {
      const ex = excerto(String(doc!.html || ""));
      if (ex) descricao = ex;
      const img = primeiraImagem(String(doc!.html || ""));
      if (img) imagem = img;
    }
  } catch { /* mantém genérico */ }

  const url = `https://${host}/pages/${slug}`;
  const ogBlock = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="planejamento.app" />`,
    `<meta property="og:title" content="${esc(titulo)}" />`,
    `<meta property="og:description" content="${esc(descricao)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    imagem ? `<meta property="og:image" content="${esc(imagem)}" />` : "",
    `<meta name="twitter:card" content="${imagem ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(titulo)}" />`,
    `<meta name="twitter:description" content="${esc(descricao)}" />`,
    imagem ? `<meta name="twitter:image" content="${esc(imagem)}" />` : "",
    `<meta name="description" content="${esc(descricao)}" />`,
  ].filter(Boolean).join("\n    ");

  if (!html) {
    // Fallback mínimo se não deu pra ler o index.html (raro).
    html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8" /><title>${esc(titulo)}</title>\n    ${ogBlock}\n</head><body><script>location.reload()</script></body></html>`;
  } else {
    // Remove og/twitter/description antigos e troca o <title>, injeta o bloco.
    html = html
      .replace(/<meta[^>]+(property|name)=["'](og:|twitter:)[^"']*["'][^>]*>\s*/gi, "")
      .replace(/<meta[^>]+name=["']description["'][^>]*>\s*/gi, "")
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(titulo)}</title>`)
      .replace(/<\/head>/i, `    ${ogBlock}\n  </head>`);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  res.status(200).send(html);
}
