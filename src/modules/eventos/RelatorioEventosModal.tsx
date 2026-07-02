// Relatório mensal de eventos + comissionamento. Mostra, pro mês escolhido:
// eventos finalizados, faturamento, classificação (inbound/outbound), quem fez
// cada atividade, e a comissão apurada por pessoa. Exporta PDF.
import { useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { LeadEvento } from "../../core/types";
import { calcularComissoes, type ComissaoConfig } from "./comissaoEventos";

const fmtBR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDia = (ymd: string) => { const [, m, d] = (ymd || "").split("-"); return d ? `${d}/${m}` : ymd; };
const mesLabel = (ref: string) => {
  const [a, m] = ref.split("-");
  const nomes = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return `${nomes[Number(m)] || m}/${a}`;
};

export function RelatorioEventosModal({
  leads, comissao, restaurantNome, mesRef, onClose,
}: {
  leads: LeadEvento[];        // já filtrados do mês
  comissao?: ComissaoConfig | null;
  restaurantNome: string;
  mesRef: string;             // "YYYY-MM"
  onClose: () => void;
}) {
  const rel = useMemo(() => calcularComissoes(leads, comissao), [leads, comissao]);
  const [gerando, setGerando] = useState(false);

  async function baixarPDF() {
    setGerando(true);
    try {
      const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const autoTable = autoTableMod.default;
      const docp = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const MX = 14;
      docp.setFont("helvetica", "bold"); docp.setFontSize(16); docp.setTextColor(31, 41, 55);
      docp.text("Relatório de Eventos", MX, 18);
      docp.setFont("helvetica", "normal"); docp.setFontSize(10); docp.setTextColor(107, 114, 128);
      docp.text(`${restaurantNome} — ${mesLabel(mesRef)}`, MX, 24);

      autoTable(docp, {
        startY: 30,
        head: [["Evento", "Data", "Tipo", "Faturamento"]],
        body: rel.detalhes.map(d => [d.clienteNome, fmtDia(d.dataEvento), d.classificacao === "outbound" ? "Outbound" : "Inbound", fmtBR(d.faturamento)]),
        foot: [["Total", "", "", fmtBR(rel.totalFaturamento)]],
        theme: "grid", styles: { fontSize: 9 }, headStyles: { fillColor: [79, 70, 229] },
        footStyles: { fillColor: [243, 244, 246], textColor: [31, 41, 55], fontStyle: "bold" },
        margin: { left: MX, right: MX },
      });

      const y = (docp as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
      docp.setFont("helvetica", "bold"); docp.setFontSize(12); docp.setTextColor(31, 41, 55);
      docp.text("Comissão por pessoa", MX, y);
      autoTable(docp, {
        startY: y + 3,
        head: [["Pessoa", "Eventos", "Comissão"]],
        body: rel.porPessoa.map(p => [p.pessoaNome, String(p.eventos), fmtBR(p.comissao)]),
        foot: [["Total", "", fmtBR(rel.totalComissao)]],
        theme: "grid", styles: { fontSize: 9 }, headStyles: { fillColor: [16, 122, 64] },
        footStyles: { fillColor: [243, 244, 246], textColor: [31, 41, 55], fontStyle: "bold" },
        margin: { left: MX, right: MX },
      });

      docp.save(`relatorio-eventos-${mesRef}.pdf`);
    } finally {
      setGerando(false);
    }
  }

  return (
    <Modal title={`Relatório — ${mesLabel(mesRef)}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Card label="Eventos" valor={String(rel.detalhes.length)} />
          <Card label="Faturamento" valor={fmtBR(rel.totalFaturamento)} />
          <Card label="Comissão total" valor={fmtBR(rel.totalComissao)} />
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Eventos do mês</div>
          {rel.detalhes.length === 0 ? (
            <p className="text-sm text-gray-500 italic">Nenhum evento finalizado neste mês.</p>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {rel.detalhes.map(d => (
                <div key={d.leadId} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{d.clienteNome}</span>
                    <span className="tabular-nums text-gray-700 dark:text-gray-300">{fmtBR(d.faturamento)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                    <span>{fmtDia(d.dataEvento)}</span>
                    <span className={`px-1 rounded ${d.classificacao === "outbound" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"}`}>
                      {d.classificacao === "outbound" ? "outbound" : "inbound"}
                    </span>
                    {d.itens.map((it, i) => (
                      <span key={i}>· {it.pessoaNome} ({it.atividade}, {it.percent}% = {fmtBR(it.valor)})</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Comissão por pessoa</div>
          {rel.porPessoa.length === 0 ? (
            <p className="text-sm text-gray-500 italic">Sem comissão apurada.</p>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {rel.porPessoa.map(p => (
                <div key={p.pessoaId} className="px-3 py-2 text-sm flex items-center justify-between">
                  <span className="text-gray-900 dark:text-gray-100">{p.pessoaNome} <span className="text-[11px] text-gray-400">· {p.eventos} evento(s)</span></span>
                  <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{fmtBR(p.comissao)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button onClick={baixarPDF} disabled={gerando}>{gerando ? "Gerando…" : "⬇ Baixar PDF"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Card({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3">
      <div className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{label}</div>
      <div className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-0.5 tabular-nums">{valor}</div>
    </div>
  );
}
