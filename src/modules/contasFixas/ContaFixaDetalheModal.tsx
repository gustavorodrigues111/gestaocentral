// Modal de detalhes de uma conta fixa numa competência — mostra os dados de
// pagamento e um botão "Marcar pago" (ou "Desmarcar"). Reusado no módulo Contas
// Fixas e no card derivado do Gestor de Tarefas.
import { useState } from "react";
import { doc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { fmtBR } from "../../core/utils/date";
import type { ContaFixa } from "../../core/types";

const brl = (n?: number) => (typeof n === "number" ? `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");

function mesExtenso(comp: string): string {
  const [a, m] = comp.split("-");
  const nomes = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return `${nomes[Number(m)] || m}/${a}`;
}

export function ContaFixaDetalheModal({ conta, competencia, pessoaId, onClose }: {
  conta: ContaFixa; competencia: string; pessoaId: string; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [paga, setPaga] = useState(!!conta.pagamentos?.[competencia]);
  const pagamento = conta.pagamentos?.[competencia];

  async function toggle() {
    setBusy(true);
    try {
      const ref = doc(db, "contasFixas", conta.id);
      if (paga) await updateDoc(ref, { [`pagamentos.${competencia}`]: deleteField(), atualizadoEm: new Date().toISOString() });
      else await updateDoc(ref, { [`pagamentos.${competencia}`]: { pagoEm: new Date().toISOString(), pagoPor: pessoaId || null }, atualizadoEm: new Date().toISOString() });
      setPaga(!paga);
    } catch (e) {
      alert("Erro: " + (e instanceof Error ? e.message : "?"));
    } finally { setBusy(false); }
  }

  const linhas: [string, string | undefined][] = [
    ["Fornecedor", conta.fornecedor],
    ["Valor estimado", conta.valorEstimado ? brl(conta.valorEstimado) : undefined],
    ["Vencimento", conta.diaDoMes ? `dia ${conta.diaDoMes} · ${mesExtenso(competencia)}` : mesExtenso(competencia)],
    ["PIX", conta.pix],
    ["Banco", conta.banco],
    ["Titular", conta.titular],
    ["Responsável", conta.responsavelPadraoNome],
  ];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-lg leading-none" title="Fechar">✕</button>
        <div className="flex items-center gap-1.5 mb-1"><span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">💰 Conta fixa</span></div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 pr-8">{conta.nome}</h2>
        <p className="text-xs text-gray-500 mb-4">{mesExtenso(competencia)}{paga ? " · ✓ paga" : ""}</p>

        <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 text-sm mb-3">
          {linhas.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="px-3 py-2 flex justify-between gap-3">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 shrink-0">{k}</span>
              <span className="text-right text-gray-800 dark:text-gray-200 break-all">{v}</span>
            </div>
          ))}
        </div>
        {conta.observacoes && <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 whitespace-pre-wrap">{conta.observacoes}</p>}
        {paga && pagamento?.pagoEm && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-3">Pago em {fmtBR(pagamento.pagoEm.slice(0, 10))}.</p>}

        <div className="flex justify-end gap-2">
          {paga
            ? <Button variant="secondary" disabled={busy} onClick={() => void toggle()}>{busy ? "…" : "Desmarcar pago"}</Button>
            : <Button disabled={busy} onClick={() => void toggle()}>{busy ? "…" : "✓ Marcar pago"}</Button>}
        </div>
      </div>
    </div>
  );
}
