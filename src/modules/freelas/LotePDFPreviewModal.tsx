import { useEffect, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { gerarLotePDF } from "./gerarLotePDF";
import type { FreelaPagamento, FreelaShift, Restaurant } from "../../core/types";

type Props = {
  lote: FreelaPagamento;
  shifts: FreelaShift[];
  restaurant: Restaurant;
  onClose: () => void;
};

export function LotePDFPreviewModal({ lote, shifts, restaurant, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let urlAtual: string | null = null;
    (async () => {
      try {
        const doc = await gerarLotePDF({ lote, shifts, restaurant });
        const blob = doc.output("blob");
        const u = URL.createObjectURL(blob);
        if (cancelado) {
          URL.revokeObjectURL(u);
          return;
        }
        urlAtual = u;
        setUrl(u);
      } catch (e) {
        console.error("[LotePDFPreviewModal]", e);
        if (!cancelado) setErro(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelado = true;
      if (urlAtual) URL.revokeObjectURL(urlAtual);
    };
  }, [lote, shifts, restaurant]);

  function baixar() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lote.numero}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <Modal title={`Pré-visualização — ${lote.numero}`} onClose={onClose} maxWidth="max-w-4xl">
      {erro ? (
        <div className="text-sm text-red-600">Erro ao gerar PDF: {erro}</div>
      ) : !url ? (
        <div className="text-sm text-gray-500 py-10 text-center">Gerando pré-visualização…</div>
      ) : (
        <>
          <iframe
            src={url}
            className="w-full h-[70vh] rounded border border-gray-200 dark:border-gray-800 bg-white"
            title="Pré-visualização do lote"
          />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            <Button onClick={baixar}>📥 Baixar PDF</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
