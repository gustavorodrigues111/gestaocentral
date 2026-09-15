// Visualização rápida da última nota (recebimento) onde um produto apareceu —
// aberta ao clicar numa grafia original no InsumoModal. Mostra emissor, data,
// valor, o que veio junto (itens) e link pro anexo no Drive.
import { FileText, ExternalLink, Package } from "lucide-react";
import { Modal } from "../../core/ui/Modal";
import { normalizar } from "./sugestoesRecebimento";
import type { RecebimentoNota } from "../../core/types";

export function NotaViewModal({ nota, grafia, onClose }: { nota: RecebimentoNota; grafia?: string; onClose: () => void }) {
  const data = nota.recebidoEm ? new Date(nota.recebidoEm).toLocaleDateString("pt-BR") : "—";
  const anexos = [
    ...(nota.notaPaginas || []),
    ...(!nota.notaPaginas?.length && nota.notaDriveUrl ? [{ nome: nota.notaNome || "Nota", driveUrl: nota.notaDriveUrl, driveFileId: nota.notaDriveFileId || "" }] : []),
  ].filter(p => p.driveUrl);
  const alvo = grafia ? normalizar(grafia) : "";
  const brl = (n?: number) => n != null ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";

  return (
    <Modal title={`Nota — ${nota.emissor || "Fornecedor"}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <div><span className="text-xs text-gray-400">Data</span><div className="text-gray-900 dark:text-gray-100">{data}</div></div>
          {nota.numeroNota && <div><span className="text-xs text-gray-400">Nº nota</span><div className="text-gray-900 dark:text-gray-100">{nota.numeroNota}</div></div>}
          {nota.valorTotal != null && <div><span className="text-xs text-gray-400">Total</span><div className="text-gray-900 dark:text-gray-100 tabular-nums">{brl(nota.valorTotal)}</div></div>}
          <div><span className="text-xs text-gray-400">Recebido por</span><div className="text-gray-900 dark:text-gray-100">{nota.recebidoPor?.nome || "—"}</div></div>
        </div>

        {anexos.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {anexos.map((p, i) => (
              <a key={i} href={p.driveUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
                <FileText size={13} /> {anexos.length > 1 ? `Anexo ${i + 1}` : "Abrir anexo da nota"} <ExternalLink size={11} />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-gray-400">Sem anexo no Drive pra esta nota.</p>
        )}

        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1 inline-flex items-center gap-1"><Package size={12} /> Itens da nota ({nota.itens?.length || 0})</div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 max-h-64 overflow-y-auto">
            {(nota.itens || []).map((it, i) => {
              const match = alvo && normalizar(it.descricao || "") === alvo;
              return (
                <div key={i} className={`flex items-center justify-between gap-3 px-2.5 py-1.5 text-[13px] ${match ? "bg-amber-50 dark:bg-amber-900/20" : ""}`}>
                  <span className={`min-w-0 truncate ${match ? "font-semibold text-amber-800 dark:text-amber-300" : "text-gray-800 dark:text-gray-200"}`}>{it.descricao || "—"}</span>
                  <span className="text-gray-500 dark:text-gray-400 tabular-nums shrink-0">{it.quantidade != null ? `${it.quantidade} ${it.unidade || ""}` : ""}{it.valorUnitario != null ? ` · ${brl(it.valorUnitario)}` : ""}</span>
                </div>
              );
            })}
            {(nota.itens?.length || 0) === 0 && <div className="px-2.5 py-2 text-xs text-gray-400">Nota sem itens detalhados.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
