// ════════════════════════════════════════════════════════════════════════════
//  Modal — Exportar Escalas em PDF (Sólides × planejamento.app)
//
//  Mesmo modelo do VR/VT: gera o PDF, mostra preview num iframe e só BAIXA no
//  clique do botão. Baixar num gesto de usuário fresco é o que faz o Safari
//  desktop salvar de verdade (o download automático pós-async era ignorado).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import type { jsPDF as JsPDFType } from "jspdf";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { gerarEscalasPDF, type EscalaPDFLinha } from "./gerarEscalasPDF";
import { baixarOuCompartilhar, podeCompartilharArquivo } from "../../core/pdf/baixarOuCompartilhar";

type Props = {
  restaurantNome: string;
  fileBase: string;         // ex: "escalas-lobozo-2026-08-27"
  linhas: EscalaPDFLinha[];
  onClose: () => void;
};

export function ExportarEscalasModal({ restaurantNome, fileBase, linhas, onClose }: Props) {
  const [gerando, setGerando] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [erro, setErro] = useState("");
  const docRef = useRef<JsPDFType | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string>("");
  const nomeArq = `${fileBase}.pdf`;

  useEffect(() => {
    let cancelled = false;
    async function gen() {
      setErro("");
      if (linhas.length === 0) { docRef.current = null; setPreviewUrl(""); return; }
      setGerando(true);
      try {
        const doc = await gerarEscalasPDF({ restaurantNome, linhas });
        if (cancelled) return;
        docRef.current = doc;
        const blob = doc.output("blob");
        blobRef.current = blob;
        const novaUrl = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = novaUrl;
        setPreviewUrl(novaUrl);
      } catch (e) {
        if (!cancelled) setErro(e instanceof Error ? e.message : "Erro ao gerar PDF.");
      } finally {
        if (!cancelled) setGerando(false);
      }
    }
    gen();
    return () => { cancelled = true; };
  }, [restaurantNome, linhas]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  function baixar() {
    if (docRef.current) docRef.current.save(nomeArq);
  }

  async function enviar() {
    if (blobRef.current) await baixarOuCompartilhar(blobRef.current, nomeArq, { titulo: "Escalas cadastradas", texto: restaurantNome });
  }

  const pronto = !gerando && linhas.length > 0 && !!docRef.current;

  return (
    <Modal title="📄 Exportar escalas em PDF" onClose={onClose} maxWidth="max-w-4xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">{linhas.length} colaborador(es)</span>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">
              ↗ abrir em nova aba
            </a>
          )}
        </div>
        <div className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 h-[55vh] flex items-center justify-center overflow-hidden">
          {gerando ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Gerando pré-visualização…</span>
          ) : linhas.length === 0 ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Nenhum colaborador pra exportar.</span>
          ) : previewUrl ? (
            <iframe src={previewUrl} title="Pré-visualização das escalas" className="w-full h-full bg-white" />
          ) : null}
        </div>
        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          {podeCompartilharArquivo(nomeArq) && (
            <Button variant="secondary" onClick={() => void enviar()} disabled={!pronto}>📤 Enviar</Button>
          )}
          <Button onClick={baixar} disabled={!pronto}>⬇️ Baixar PDF</Button>
        </div>
      </div>
    </Modal>
  );
}
