// Site público — rota /site/:slug (sem auth).
// Renderiza o template configurado pra esse restaurante.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { SiteConfig } from "../../core/types";
import { SiteRenderer } from "./templates/SiteRenderer";

// slugFromHost: opcional, usado quando o site é acessado via domínio
// próprio (ex: lobozo.com.br) — a gente já sabe qual restaurante é
// pelo host e não precisa do path /site/<slug>. Tem prioridade sobre
// o param da URL.
export function SitePublicaPage({ slugFromHost }: { slugFromHost?: string }) {
  const params = useParams<{ slug: string }>();
  const slug = slugFromHost || params.slug;
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<"nao_encontrado" | "nao_publicado" | "" >("");

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        // Resolve slug → siteConfig
        const snap = await getDocs(query(collection(db, "sitesConfig"), where("slug", "==", slug)));
        if (snap.empty) {
          setErro("nao_encontrado");
          return;
        }
        const d = snap.docs[0];
        const cfg = { id: d.id, ...d.data() } as SiteConfig;
        if (!cfg.publicado) {
          setErro("nao_publicado");
          return;
        }
        setConfig(cfg);
        // Define title
        document.title = cfg.slug;
      } catch (e) {
        console.error(e);
        setErro("nao_encontrado");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>Carregando...</div>;
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
