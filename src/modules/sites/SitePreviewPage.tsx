// Rota de PREVIEW do site (admin → iframe). Diferente da /site/:slug:
//   - resolve pelo restaurantId (não slug)
//   - ignora siteConfig.publicado (mostra mesmo quando não publicado)
//   - pra uso interno (admin testando antes de publicar)

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { SiteConfig } from "../../core/types";
import { SiteRenderer } from "./templates/SiteRenderer";

export function SitePreviewPage() {
  const { rid } = useParams<{ rid: string }>();
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);

  // Subscribe em tempo real → mudanças no admin refletem no preview na hora
  useEffect(() => {
    if (!rid) return;
    const unsub = onSnapshot(doc(db, "sitesConfig", rid), (snap) => {
      if (!snap.exists()) {
        setNaoEncontrado(true);
      } else {
        setConfig({ id: snap.id, ...snap.data() } as SiteConfig);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>Carregando preview...</div>;
  }
  if (naoEncontrado || !config) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📝</div>
          <p style={{ fontWeight: 500 }}>Configuração não encontrada</p>
          <p style={{ fontSize: 14, color: "#666", marginTop: 8 }}>
            Salve a configuração ao menos uma vez na aba Geral pra gerar o preview.
          </p>
        </div>
      </div>
    );
  }

  return <SiteRenderer siteConfig={config} />;
}
