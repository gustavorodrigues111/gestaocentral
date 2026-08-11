// Atalhos de URL no domínio próprio (ex. lobozo.com.br/<atalho>). Carrega o
// config do restaurante (Firestore ao vivo; JSON estático como fallback) e
// resolve o sub-path:
//   • /cardapio, /menu → PDF do cardápio (PT/EN)
//   • /eventos, /laje  → página de eventos (/eventos/:rid) — se o site tiver
//   • /reservas        → módulo de reservas (/reservas/:rid) ou URL externa
// Automático conforme as features de cada site. Se não for atalho, cai no site.
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
      const s = sub.toLowerCase();
      // Atalhos de PÁGINA (rota interna/externa), ligados conforme as features
      // do site — assim cada site só tem os atalhos das páginas que ele tem.
      if (cfg) {
        if ((s === "eventos" || s === "laje") && (cfg.features?.hasEventos || cfg.features?.hasLaje)) {
          window.location.replace(`/eventos/${cfg.restaurantId}`); return;
        }
        if (s === "reservas" && cfg.features?.hasReservas) {
          const ext = cfg.reservasModo === "externo" ? (cfg.reservasUrlExterna || "").trim() : "";
          window.location.replace(ext || `/reservas/${cfg.restaurantId}`); return;
        }
      }
      // Atalho de CARDÁPIO → PDF (PT/EN).
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
      Abrindo…
    </div>
  );
}
