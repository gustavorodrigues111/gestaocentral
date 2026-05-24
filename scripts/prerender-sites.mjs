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
// Credenciais: lê FIREBASE_SERVICE_ACCOUNT do ambiente (JSON string).
// No Vercel, configurar como secret env var.
// Local: criar .env.local ou exportar FIREBASE_SERVICE_ACCOUNT antes
// de rodar `npm run build`.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const TEMPLATE_HTML = path.join(DIST_DIR, "index.html");

async function main() {
  console.log("[prerender-sites] iniciando...");

  // Inicializa Firebase Admin SDK
  if (getApps().length === 0) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      try {
        const credentials = JSON.parse(serviceAccountJson);
        initializeApp({ credential: cert(credentials) });
        console.log("[prerender-sites] usando FIREBASE_SERVICE_ACCOUNT (cert)");
      } catch (e) {
        console.error("[prerender-sites] FIREBASE_SERVICE_ACCOUNT mal formado:", e.message);
        // Sai com sucesso (não bloqueia build em dev local sem creds)
        return;
      }
    } else {
      // Tenta application default (gcloud auth / VM metadata). Em dev local
      // sem gcloud configurado, falha — mas não bloqueia o build.
      try {
        initializeApp({ credential: applicationDefault() });
        console.log("[prerender-sites] usando applicationDefault()");
      } catch (e) {
        console.warn("[prerender-sites] sem credenciais Firebase Admin — pulando pre-render");
        console.warn("[prerender-sites] (defina FIREBASE_SERVICE_ACCOUNT pra ativar)");
        return;
      }
    }
  }

  const db = getFirestore();

  // Carrega o template HTML uma vez
  let template;
  try {
    template = await fs.readFile(TEMPLATE_HTML, "utf8");
  } catch (e) {
    console.error("[prerender-sites] dist/index.html não encontrado — rode `vite build` antes");
    throw e;
  }

  // Busca todos os sitesConfig publicados
  const snap = await db.collection("sitesConfig").where("publicado", "==", true).get();
  console.log(`[prerender-sites] ${snap.size} site(s) publicado(s) encontrado(s)`);

  let gerados = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const slug = data.slug;
    if (!slug || typeof slug !== "string") {
      console.warn(`[prerender-sites] doc ${doc.id} sem slug — pulando`);
      continue;
    }

    // Sanitiza JSON pra inline no script tag (escapa </ pra evitar XSS-like)
    // O JSON.stringify já cuida da maior parte; só precisamos do </
    const dataJson = JSON.stringify({ id: doc.id, ...data })
      .replace(/</g, "\\u003c");

    // Constrói meta tags pra SEO + social preview
    const restNome = data.metaTitulo || slug;
    const descricao = data.metaDescricao
      || data.heroSubtitulo
      || data.slogan
      || `Site oficial do restaurante ${restNome}`;
    const ogImage = data.heroImagemUrl || data.logoUrl || "";

    const headInjections = [
      `<title>${escapeHtml(restNome)}</title>`,
      `<meta name="description" content="${escapeHtml(descricao)}" />`,
      `<meta property="og:title" content="${escapeHtml(restNome)}" />`,
      `<meta property="og:description" content="${escapeHtml(descricao)}" />`,
      ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}" />` : "",
      `<meta property="og:type" content="website" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      // Site config injetado pro client picar
      `<script id="__site_config__">window.__SITE_CONFIG__ = ${dataJson};</script>`,
    ].filter(Boolean).join("\n    ");

    // Substitui o <title> padrão e injeta as tags antes do </head>
    let html = template
      .replace(/<title>[^<]*<\/title>/, "")
      .replace(/<\/head>/, `${headInjections}\n  </head>`);

    // Escreve em dist/site/<slug>/index.html (rota /site/<slug>)
    const outDir = path.join(DIST_DIR, "site", slug);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");
    gerados++;
    console.log(`[prerender-sites] ✓ /site/${slug}/`);
  }

  console.log(`[prerender-sites] concluído — ${gerados} HTML(s) gerado(s)`);
}

// Escape HTML pra atributos de meta tags. Cobre o caso comum sem usar
// dependência externa. Note: o JSON do __SITE_CONFIG__ não passa por aqui
// — já é stringificado e o `<` cobre o </
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

main().catch((e) => {
  console.error("[prerender-sites] falhou:", e);
  process.exit(1);
});
