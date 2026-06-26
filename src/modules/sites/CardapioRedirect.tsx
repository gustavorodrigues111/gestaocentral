// Atalho de cardápio no domínio próprio: ex. lobozo.com.br/cardapio → PDF PT,
// /menu → PDF EN. Carrega o config do restaurante (Firestore ao vivo, pra URL
// do PDF sempre fresca; JSON estático como fallback) e redireciona direto pro
// PDF. Se o sub-path não for um atalho, renderiza o site normal.
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { SiteConfig } from "../../core/types";
import { SitePublicaPage } from "./SitePublicaPage";
import { idiomaDoAtalho, urlCardapioPorIdioma } from "./shared/cardapioAtalhos";

async function carregarConfigPorSlug(slug: string): Promise<SiteConfig | null> {
  try {
    const snap = await getDocs(query(collection(db, "sitesConfig"), where("slug", "==", slug)));
    if (!snap.empty) return { id: snap.docs[0]!.id, ...snap.docs[0]!.data() } as SiteConfig;
  } catch { /* cai pro JSON estático */ }
  try {
    const res = await fetch(`/sites/${slug}.json`, { cache: "default" });
    if (res.ok) return (await res.json()) as SiteConfig;
  } catch { /* nada */ }
  return null;
}

export function CardapioRedirect({ slug, sub }: { slug: string; sub: string }) {
  const [fallbackSite, setFallbackSite] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const cfg = await carregarConfigPorSlug(slug);
      if (cancelado) return;
      const idioma = cfg ? idiomaDoAtalho(cfg, sub) : null;
      const url = cfg && idioma ? urlCardapioPorIdioma(cfg, idioma) : undefined;
      if (url) { window.location.replace(url); return; }
      setFallbackSite(true); // não é atalho (ou sem PDF) → site normal
    })();
    return () => { cancelado = true; };
  }, [slug, sub]);

  if (fallbackSite) return <SitePublicaPage slugFromHost={slug} />;
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f7f3e9", color: "#666", fontFamily: "system-ui", fontSize: 14 }}>
      Abrindo cardápio…
    </div>
  );
}
