// Pré-renderiza HTMLs estáticos pra cada site publicado.
//
// Roda DEPOIS do `vite build`. Pra cada doc em /sitesConfig com
// publicado=true, gera `dist/site/<slug>/index.html` = cópia do
// dist/index.html com:
//   1. <script>window.__SITE_CONFIG__ = {...}</script> injetado no head
//      → SitePublicaPage usa direto, sem precisar fazer query no Firestore
//      no first paint (economiza 500ms-2s)
//   2. Meta tags (title, description, og:image) renderizadas com dados do
//      restaurante → SEO + previews bonitos em link sharing
//
// Custom domains (lobozo.com.br) são roteados pra esses HTMLs via
// vercel.json rewrites.
//
// USA Firestore REST API com API KEY pública — não precisa de service
// account (algumas orgs Google Cloud bloqueiam criação de chaves de
// service account via policy). A API key é a mesma usada pelo cliente
// web (VITE_FIREBASE_API_KEY) — é pública por design, e a leitura
// respeita as Firestore Rules (sitesConfig já tem read público).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const TEMPLATE_HTML = path.join(DIST_DIR, "index.html");

async function main() {
  console.log("[prerender-sites] iniciando...");

  // Lê env (Vite expõe com prefixo VITE_ no client, mas no build server
  // estão disponíveis sem prefixo no process.env).
  const projectId =
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    "gestaocentral-85b13";
  const apiKey =
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY;

  if (!apiKey) {
    console.log("[prerender-sites] VITE_FIREBASE_API_KEY ausente — pulando SSG (build segue como SPA puro)");
    return;
  }

  // Carrega o template HTML uma vez
  let template;
  try {
    template = await fs.readFile(TEMPLATE_HTML, "utf8");
  } catch (e) {
    console.error("[prerender-sites] dist/index.html não encontrado — rode `vite build` antes");
    throw e;
  }

  // Busca todos os sitesConfig via Firestore REST API.
  // Rules permitem read público em sitesConfig, então API key basta.
  const restUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/sitesConfig?key=${apiKey}&pageSize=100`;
  const res = await fetch(restUrl);
  if (!res.ok) {
    const errorText = await res.text();
    console.warn(`[prerender-sites] Firestore REST falhou (HTTP ${res.status}): ${errorText.slice(0, 200)}`);
    console.warn("[prerender-sites] pulando SSG (build segue como SPA puro)");
    return;
  }

  const restData = await res.json();
  const docs = restData.documents || [];
  console.log(`[prerender-sites] ${docs.length} doc(s) em sitesConfig`);

  let gerados = 0;
  for (const doc of docs) {
    // doc.name = "projects/.../databases/.../documents/sitesConfig/<docId>"
    const docId = doc.name.split("/").pop();
    const data = parseFirestoreFields(doc.fields || {});

    if (!data.publicado) {
      console.log(`[prerender-sites] - ${docId} (slug=${data.slug || "?"}) não publicado — pulando`);
      continue;
    }

    const slug = data.slug;
    if (!slug || typeof slug !== "string") {
      console.warn(`[prerender-sites] doc ${docId} sem slug — pulando`);
      continue;
    }

    // Sanitiza JSON pra inline no script tag (escapa </ pra evitar XSS-like)
    const fullData = { id: docId, ...data };
    const dataJson = JSON.stringify(fullData).replace(/</g, "\\u003c");

    // Constrói meta tags pra SEO + social preview. O título (og:title) é o que
    // aparece no preview do WhatsApp/redes — precisa ser o NOME do restaurante,
    // nunca "Gestão Central". `restaurants` não é lido aqui (rules exigem auth),
    // então: metaTitulo (se setado) → nome conhecido (com acento) → Title-case.
    const DISPLAY_NAMES = { lobozo: "Lobozó", sororoca: "Sororoca" };
    const restNome = data.metaTitulo
      || DISPLAY_NAMES[slug]
      || (slug.charAt(0).toUpperCase() + slug.slice(1));
    const descricao = data.metaDescricao
      || data.heroSubtitulo
      || data.slogan
      || `Site oficial do restaurante ${restNome}`;
    const ogImage = data.heroImagemUrl || data.logoUrl || "";

    // Favicon: usa faviconUrl se setado, senão tenta logoUrl. Em vez de
    // remover o link default + injetar um novo (regex frágil dependendo da
    // ordem de atributos), SUBSTITUÍMOS o href do link com id="__favicon"
    // que o template já tem. Garante 1 só link rel=icon no HTML final.
    const faviconUrl = data.faviconUrl || data.logoUrl || "";

    const headInjections = [
      `<title>${escapeHtml(restNome)}</title>`,
      `<meta name="description" content="${escapeHtml(descricao)}" />`,
      `<meta property="og:title" content="${escapeHtml(restNome)}" />`,
      `<meta property="og:description" content="${escapeHtml(descricao)}" />`,
      ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}" />` : "",
      `<meta property="og:type" content="website" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<script id="__site_config__">window.__SITE_CONFIG__ = ${dataJson};</script>`,
    ].filter(Boolean).join("\n    ");

    let html = template
      .replace(/<title>[^<]*<\/title>/, "")
      .replace(/<\/head>/, `${headInjections}\n  </head>`);

    // Substitui o link __favicon (default /favicon.svg) pelo favicon do
    // restaurante. Match permissivo: pega qualquer <link ... id="__favicon" ...>
    // independente da ordem dos atributos. Se faviconUrl vazio, deixa
    // como está (default svg).
    if (faviconUrl) {
      html = html.replace(
        /<link\b[^>]*id="__favicon"[^>]*\/?>/,
        `<link id="__favicon" rel="icon" href="${escapeHtml(faviconUrl)}" />`,
      );
    }

    const outDir = path.join(DIST_DIR, "site", slug);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");

    // Também escreve JSON puro em /sites/<slug>.json — usado pelo
    // SitePublicaPage como fallback quando o HTML pré-renderizado não é
    // servido (ex: rewrite do host não captura). CDN-cached, instante.
    const jsonDir = path.join(DIST_DIR, "sites");
    await fs.mkdir(jsonDir, { recursive: true });
    await fs.writeFile(path.join(jsonDir, `${slug}.json`), JSON.stringify(fullData), "utf8");

    gerados++;
    console.log(`[prerender-sites] ✓ /site/${slug}/ + /sites/${slug}.json`);
  }

  console.log(`[prerender-sites] concluído — ${gerados} HTML(s) gerado(s)`);
}

// Converte a estrutura "fields" do Firestore REST API pra objeto JS normal.
// Cada campo vem como { stringValue, integerValue, booleanValue, mapValue,
// arrayValue, ... } dependendo do tipo. Recursivo pra mapValue/arrayValue.
function parseFirestoreFields(fields) {
  const result = {};
  for (const [key, val] of Object.entries(fields)) {
    result[key] = parseFirestoreValue(val);
  }
  return result;
}

function parseFirestoreValue(val) {
  if (!val || typeof val !== "object") return val;
  if ("stringValue" in val) return val.stringValue;
  if ("integerValue" in val) return parseInt(val.integerValue, 10);
  if ("doubleValue" in val) return val.doubleValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("nullValue" in val) return null;
  if ("timestampValue" in val) return val.timestampValue;
  if ("mapValue" in val) return parseFirestoreFields(val.mapValue.fields || {});
  if ("arrayValue" in val) {
    return (val.arrayValue.values || []).map(parseFirestoreValue);
  }
  if ("referenceValue" in val) return val.referenceValue;
  // Tipo desconhecido — devolve o objeto original pra debug
  return val;
}

// Escape HTML pra atributos de meta tags
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Engole qualquer erro inesperado pra NÃO BLOQUEAR o build do Vercel.
// SSG é optimization, não requirement — site funciona como SPA puro
// se o prerender falhar.
main().catch((e) => {
  console.error("[prerender-sites] falhou (build continua sem SSG):", e);
  process.exit(0);
});
