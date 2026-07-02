// Relatório mensal de eventos + comissionamento. Gera um PDF, mostra em preview
// (iframe) e permite baixar. Pro mês escolhido: eventos finalizados,
// faturamento, classificação (inbound/outbound), quem fez cada atividade, e a
// comissão apurada por pessoa.
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { LeadEvento } from "../../core/types";
import { calcularComissoes, type ComissaoConfig, type RelatorioComissao } from "./comissaoEventos";

const fmtBR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDia = (ymd: string) => { const [, m, d] = (ymd || "").split("-"); return d ? `${d}/${m}` : ymd; };
const mesLabel = (ref: string) => {
  const [a, m] = ref.split("-");
  const nomes = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return `${nomes[Number(m)] || m}/${a}`;
};

async function construirPdf(rel: RelatorioComissao, restaurantNome: string, mesRef: string) {
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

  return docp;
}

export function RelatorioEventosModal({
  leads, comissao, restaurantNome, mesRef, onClose,
}: {
  leads: LeadEvento[];
  comissao?: ComissaoConfig | null;
  restaurantNome: string;
  mesRef: string;
  onClose: () => void;
}) {
  const rel = useMemo(() => calcularComissoes(leads, comissao), [leads, comissao]);
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [gerando, setGerando] = useState(true);

  useEffect(() => {
    let url = "";
    let cancelado = false;
    setGerando(true);
    (async () => {
      const docp = await construirPdf(rel, restaurantNome, mesRef);
      const blob = docp.output("blob");
      url = URL.createObjectURL(blob);
      if (!cancelado) { setPdfUrl(url); setGerando(false); }
    })().catch(() => { if (!cancelado) setGerando(false); });
    return () => { cancelado = true; if (url) URL.revokeObjectURL(url); };
  }, [rel, restaurantNome, mesRef]);

  return (
    <Modal title={`Relatório — ${mesLabel(mesRef)}`} onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Card label="Eventos" valor={String(rel.detalhes.length)} />
          <Card label="Faturamento" valor={fmtBR(rel.totalFaturamento)} />
          <Card label="Comissão total" valor={fmtBR(rel.totalComissao)} />
        </div>

        {rel.detalhes.length === 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center text-sm text-gray-500">
            Nenhum evento finalizado (com fechamento) neste mês — nada pra reportar.
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden bg-gray-50 dark:bg-gray-900">
            {gerando ? (
              <div className="h-[55vh] flex items-center justify-center text-sm text-gray-500">Gerando PDF…</div>
            ) : (
              <iframe title="Relatório PDF" src={pdfUrl} className="w-full h-[55vh] bg-white" />
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          {rel.detalhes.length > 0 && pdfUrl && (
            <a href={pdfUrl} download={`relatorio-eventos-${mesRef}.pdf`}>
              <Button>⬇ Baixar PDF</Button>
            </a>
          )}
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
