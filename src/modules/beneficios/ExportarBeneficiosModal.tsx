// Modal — Exportar Benefícios em PDF (preview + baixar), igual ao VT/VR.

import { useEffect, useRef, useState } from "react";
import type { jsPDF as JsPDFType } from "jspdf";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { gerarBeneficiosPDF, type BeneficiosPDFLinha } from "./gerarBeneficiosPDF";
import { pad2 } from "../../core/utils/date";

type Props = {
  ano: number;
  mes: number;
  restaurantNome: string;
  statusLabel?: string;
  linhas: BeneficiosPDFLinha[];
  onClose: () => void;
};

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function ExportarBeneficiosModal({ ano, mes, restaurantNome, statusLabel, linhas, onClose }: Props) {
  const [gerando, setGerando] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [erro, setErro] = useState("");
  const docRef = useRef<JsPDFType | null>(null);
  const urlRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    async function gen() {
      setErro("");
      if (linhas.length === 0) { docRef.current = null; setPreviewUrl(""); return; }
      setGerando(true);
      try {
        const doc = await gerarBeneficiosPDF({ ano, mes, restaurantNome, statusLabel, linhas });
        if (cancelled) return;
        docRef.current = doc;
        const blob = doc.output("blob");
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
  }, [ano, mes, restaurantNome, statusLabel, linhas]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  function baixar() {
    if (!docRef.current) return;
    docRef.current.save(`beneficios-${slugify(restaurantNome)}-${ano}-${pad2(mes)}.pdf`);
  }

  return (
    <Modal title="📄 Exportar Benefícios em PDF" onClose={onClose} maxWidth="max-w-4xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {linhas.length} empregado(s){statusLabel ? ` · ${statusLabel}` : ""}
          </span>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">
              ↗ abrir em nova aba
            </a>
          )}
        </div>
        <div className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 h-[55vh] flex items-center justify-center overflow-hidden">
          {gerando ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Gerando pré-visualização…</span>
          ) : linhas.length === 0 ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Nenhum empregado pra exportar.</span>
          ) : previewUrl ? (
            <iframe src={previewUrl} title="Pré-visualização de Benefícios" className="w-full h-full bg-white" />
          ) : null}
        </div>
        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={baixar} disabled={gerando || linhas.length === 0 || !docRef.current}>⬇️ Baixar PDF</Button>
        </div>
      </div>
    </Modal>
  );
}
