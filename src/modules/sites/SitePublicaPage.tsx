// Site público — rota /site/:slug (sem auth).
// Renderiza o template configurado pra esse restaurante.
//
// Fluxo de loading (SSG):
//   1. scripts/prerender-sites.mjs gera dist/site/<slug>/index.html com
//      <script>window.__SITE_CONFIG__ = {...}</script> injetado.
//   2. SitePublicaPage lê window.__SITE_CONFIG__ na PRIMEIRA renderização
//      — se o slug bate, renderiza INSTANTÂNEO sem fetch.
//   3. Em paralelo, faz query no Firestore pra validar (live update se
//      admin mudou o site entre o build e o acesso). Se vier diferente,
//      atualiza silenciosamente.
//
// Resultado: first paint em ~200ms (CDN entrega HTML + JS reads cache)
// em vez de 1.5-3s antes.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { SiteConfig } from "../../core/types";
import { SiteRenderer } from "./templates/SiteRenderer";

// Tipa o config injetado em build time
declare global {
  interface Window {
    __SITE_CONFIG__?: SiteConfig;
  }
}

// Tenta pegar siteConfig injetado pelo prerender. Só vale se o slug do
// config bate com o que a URL pede (proteção contra HTML cacheado de
// um slug diferente sendo servido por engano).
function getInjectedConfig(slug: string | undefined): SiteConfig | null {
  if (typeof window === "undefined") return null;
  const injected = window.__SITE_CONFIG__;
  if (!injected) return null;
  if (slug && injected.slug !== slug) return null;
  if (!injected.publicado) return null;
  return injected;
}

// slugFromHost: opcional, usado quando o site é acessado via domínio
// próprio (ex: lobozo.com.br) — a gente já sabe qual restaurante é
// pelo host e não precisa do path /site/<slug>. Tem prioridade sobre
// o param da URL.
export function SitePublicaPage({ slugFromHost }: { slugFromHost?: string }) {
  const params = useParams<{ slug: string }>();
  const slug = slugFromHost || params.slug;
  // Inicializa state já com config injetado se disponível — render
  // imediato sem spinner.
  const injectedInicial = getInjectedConfig(slug);
  const [config, setConfig] = useState<SiteConfig | null>(injectedInicial);
  const [loading, setLoading] = useState(!injectedInicial);
  const [erro, setErro] = useState<"nao_encontrado" | "nao_publicado" | "" >("");

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        // Resolve slug → siteConfig
        const snap = await getDocs(query(collection(db, "sitesConfig"), where("slug", "==", slug)));
        if (snap.empty) {
          // Se não tem config injetado, é erro. Se tem (de prerender),
          // mantém o injetado — pode ser que o doc tenha sido deletado
          // depois do build mas ainda está cacheado na CDN.
          if (!injectedInicial) setErro("nao_encontrado");
          return;
        }
        const d = snap.docs[0]!;
        const cfg = { id: d.id, ...d.data() } as SiteConfig;
        if (!cfg.publicado) {
          if (!injectedInicial) setErro("nao_publicado");
          return;
        }
        // Atualiza com dados frescos (silencioso) — pode ter mudado
        // entre o build e o acesso. SiteRenderer re-renderiza diff.
        setConfig(cfg);
        // Define title
        document.title = cfg.slug;
      } catch (e) {
        console.error(e);
        // Só mostra erro se não tinha injetado
        if (!injectedInicial) setErro("nao_encontrado");
      } finally {
        setLoading(false);
      }
    })();
    // injectedInicial só lida no mount — não vira dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (loading) {
    // Splash bege com spinner suave + texto discreto. Bege é a cor
    // padrão dos templates então combina com qualquer site (logo
    // dispara o spinner enquanto o Firestore retorna). Mobile lento
    // não fica com tela branca enquanto espera.
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        backgroundColor: "#f7f3e9",
        color: "#666", fontFamily: "system-ui",
        gap: 16,
      }}>
        <div style={{
          width: 32, height: 32,
          border: "3px solid #d4af3740",
          borderTopColor: "#1a5c2a",
          borderRadius: "50%",
          animation: "loboro-spin 0.8s linear infinite",
        }} />
        <div style={{ fontSize: 13, opacity: 0.7 }}>Carregando...</div>
        <style>{`@keyframes loboro-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (erro || !config) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
          <p style={{ fontWeight: 500 }}>
            {erro === "nao_publicado" ? "Site em manutenção" : "Página não encontrada"}
          </p>
          <p style={{ fontSize: 14, color: "#666", marginTop: 8 }}>
            {erro === "nao_publicado"
              ? "Esse site ainda não foi publicado."
              : "Confere o link ou contata o restaurante."}
          </p>
        </div>
      </div>
    );
  }

  return <SiteRenderer siteConfig={config} />;
}
