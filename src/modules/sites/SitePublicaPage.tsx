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

// Atualiza o <link rel="icon"> com o favicon do restaurante. Se cfg
// não tem faviconUrl, usa logoUrl como fallback (browsers renderizam
// PNG/JPG como favicon sem problema). Se nada disponível, deixa o
// favicon padrão do projeto (/favicon.svg).
function atualizarFavicon(cfg: SiteConfig | null) {
  if (typeof document === "undefined") return;
  const url = cfg?.faviconUrl || cfg?.logoUrl;
  if (!url) return;
  // Remove TODOS os links de icon antigos (incluindo o /favicon.svg
  // hardcoded no index.html). Sem isso, o browser pode preferir o
  // primeiro em vez do dinâmico.
  document.querySelectorAll('link[rel~="icon"]').forEach(el => el.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = url;
  document.head.appendChild(link);
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

  // Sempre que config muda (injetado, JSON, Firestore), atualiza favicon
  // e title. Concentrado num único effect — mais simples que duplicar
  // setDocumentTitle/Favicon em cada caminho de fetch.
  useEffect(() => {
    if (!config) return;
    atualizarFavicon(config);
  }, [config]);

  useEffect(() => {
    if (!slug) return;

    // Fluxo em camadas, do mais rápido pro mais lento:
    //   1. __SITE_CONFIG__ (já lido em injectedInicial) — instante
    //   2. /sites/<slug>.json — CDN-cached, ~50-200ms (fallback quando o
    //      HTML pré-renderizado não foi servido — ex: rewrite do host
    //      não capturou e veio o /index.html genérico do SPA)
    //   3. Firestore query — ~500ms-2s (rede + long-polling fallback)
    let cancelado = false;

    async function tentarJsonEstatico() {
      try {
        const res = await fetch(`/sites/${slug}.json`, { cache: "default" });
        if (!res.ok) return null;
        const data = await res.json() as SiteConfig;
        if (!data.publicado) return null;
        return data;
      } catch {
        return null;
      }
    }

    type FirestoreResult =
      | { ok: true; cfg: SiteConfig }
      | { ok: false; erro: "nao_encontrado" | "nao_publicado" };

    async function tentarFirestore(): Promise<FirestoreResult> {
      const snap = await getDocs(query(collection(db, "sitesConfig"), where("slug", "==", slug)));
      if (snap.empty) return { ok: false, erro: "nao_encontrado" };
      const d = snap.docs[0]!;
      const cfg = { id: d.id, ...d.data() } as SiteConfig;
      if (!cfg.publicado) return { ok: false, erro: "nao_publicado" };
      return { ok: true, cfg };
    }

    (async () => {
      // Se já tem injetado, ainda assim valida com Firestore em background
      // (silencioso) pra detectar mudanças pós-build. Tela já renderizou.
      if (injectedInicial) {
        try {
          const res = await tentarFirestore();
          if (cancelado) return;
          if (res.ok) {
            setConfig(res.cfg);
            document.title = res.cfg.slug;
          }
        } catch (e) {
          // Silencioso — injetado já renderizou
          console.warn("[site] Firestore background validation falhou", e);
        }
        setLoading(false);
        return;
      }

      // Sem injetado: tenta JSON estático primeiro (CDN-rápido)
      const jsonData = await tentarJsonEstatico();
      if (cancelado) return;
      if (jsonData) {
        setConfig(jsonData);
        setLoading(false);
        document.title = jsonData.slug;
        // Continua e valida com Firestore em background (silencioso)
        try {
          const res = await tentarFirestore();
          if (cancelado) return;
          if (res.ok) {
            setConfig(res.cfg);
            document.title = res.cfg.slug;
          }
        } catch {}
        return;
      }

      // Último recurso: Firestore (mais lento, mas autoritativo)
      try {
        const res = await tentarFirestore();
        if (cancelado) return;
        if (res.ok) {
          setConfig(res.cfg);
          document.title = res.cfg.slug;
        } else {
          setErro(res.erro);
        }
      } catch (e) {
        if (cancelado) return;
        console.error(e);
        setErro("nao_encontrado");
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();

    return () => { cancelado = true; };
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
