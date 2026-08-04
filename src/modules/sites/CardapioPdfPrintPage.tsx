// ════════════════════════════════════════════════════════════════════════════
//  Rota pública de impressão do cardápio → PDF (usada pelo render headless do
//  agente, e testável no navegador). Renderiza o CardapioVisual em modo auto
//  pra UM cardápio (?menu=) e expõe o base64 do PDF em window.__CARDAPIO_PDF__
//  (ou o erro em window.__CARDAPIO_PDF_ERR__). Sem ?headless=1, baixa o PDF pra
//  conferência manual. cardapioEstruturado tem leitura pública.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { CardapioVisual } from "./CardapioVisual";
import type { CardapioEstruturado, CardapioMenu } from "../../core/types";

type W = Window & { __CARDAPIO_PDF__?: string; __CARDAPIO_PDF_ERR__?: string };

export function CardapioPdfPrintPage() {
  const { rid = "" } = useParams();
  const params = new URLSearchParams(window.location.search);
  const menuQ = params.get("menu") || "";
  const nomeRest = params.get("nome") || "";
  const headless = params.get("headless") === "1";

  const [est, setEst] = useState<CardapioEstruturado | null>(null);
  const [status, setStatus] = useState<"carregando" | "gerando" | "pronto" | "erro">("carregando");
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!rid) return;
    void getDoc(doc(db, "cardapioEstruturado", rid)).then((s) => {
      if (!s.exists()) { setErro("cardápio não encontrado"); setStatus("erro"); (window as W).__CARDAPIO_PDF_ERR__ = "cardápio não encontrado"; return; }
      setEst({ id: rid, ...(s.data() as Omit<CardapioEstruturado, "id">) });
      setStatus("gerando");
    }).catch((e) => { const m = e instanceof Error ? e.message : String(e); setErro(m); setStatus("erro"); (window as W).__CARDAPIO_PDF_ERR__ = m; });
  }, [rid]);

  const menu: CardapioMenu | null = useMemo(() => {
    const cards = est?.cardapios || [];
    if (!cards.length) return null;
    if (!menuQ) return cards[0];
    return cards.find(c => c.id === menuQ) || cards.find(c => (c.nome || "").toLowerCase().includes(menuQ.toLowerCase())) || cards[0];
  }, [est, menuQ]);

  function onPdf(b64: string | null, err?: string) {
    if (b64) {
      (window as W).__CARDAPIO_PDF__ = b64;
      setStatus("pronto");
      if (!headless) {
        const a = document.createElement("a");
        a.href = "data:application/pdf;base64," + b64;
        a.download = `${(nomeRest || "cardapio").toLowerCase()}-${(menu?.nome || "cardapio").toLowerCase()}.pdf`;
        a.click();
      }
    } else {
      const m = err || "falha ao gerar";
      setErro(m); setStatus("erro"); (window as W).__CARDAPIO_PDF_ERR__ = m;
    }
  }

  if (status === "carregando" || (!menu && status !== "erro")) {
    return <div style={{ padding: 20, fontFamily: "system-ui", fontSize: 14 }}>Carregando cardápio…</div>;
  }
  if (!menu || status === "erro") {
    return <div style={{ padding: 20, fontFamily: "system-ui", fontSize: 14, color: "#b91c1c" }}>Erro: {erro || "cardápio sem itens"}</div>;
  }
  return (
    <div>
      {!headless && (
        <div style={{ padding: 12, fontFamily: "system-ui", fontSize: 14 }}>
          Gerando PDF de <b>{menu.nome}</b>… {status === "pronto" ? "✓ pronto (baixou)." : "aguarde alguns segundos."}
        </div>
      )}
      <CardapioVisual
        rid={rid}
        menuId={menu.id}
        secoes={menu.secoes || []}
        mostrarGarrafa={menu.mostrarGarrafa}
        nomeRestaurante={nomeRest}
        nomeMenu={menu.nome}
        tituloCapa={menu.tituloCapa}
        lang="pt"
        sharedLayout={est?.layout}
        menuLayoutProprio={menu.layoutProprio}
        menuLayout={menu.layout}
        onClose={() => { /* noop */ }}
        autoPdf={onPdf}
      />
    </div>
  );
}
