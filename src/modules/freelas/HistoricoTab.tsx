import { useMemo, useState } from "react";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import type {
  FreelaMensalistaLinha, FreelaPagamento, FreelaPagamentoResumoPessoa,
  FreelaShift, FreelaTurnoSnapshot, Restaurant,
} from "../../core/types";
import { fmtBR, fmtHoras } from "./helpers";
import { LotePDFPreviewModal } from "./LotePDFPreviewModal";

type Props = {
  shifts: FreelaShift[];
  pagamentos: FreelaPagamento[];
  restaurant: Restaurant;
};

type SubTab = "lotes" | "noshows";

export function HistoricoTab({ shifts, pagamentos, restaurant }: Props) {
  const [sub, setSub] = useState<SubTab>("lotes");
  const [filtroAno, setFiltroAno] = useState<string>(String(new Date().getFullYear()));

  const lotesPagos = useMemo(
    () => pagamentos
      .filter((p) => p.status === "pago")
      .sort((a, b) => (b.pagoEm || "").localeCompare(a.pagoEm || ""))
      .filter((p) => !filtroAno || (p.pagoEm || "").startsWith(filtroAno)),
    [pagamentos, filtroAno],
  );

  const noShows = useMemo(
    () => shifts
      .filter((s) => s.status === "nao_compareceu")
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((s) => !filtroAno || s.date.startsWith(filtroAno)),
    [shifts, filtroAno],
  );

  const anosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    pagamentos.forEach((p) => p.pagoEm && set.add(p.pagoEm.slice(0, 4)));
    shifts.forEach((s) => set.add(s.date.slice(0, 4)));
    return Array.from(set).sort().reverse();
  }, [pagamentos, shifts]);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex border-b border-gray-200 dark:border-gray-800">
          <SubTabBtn active={sub === "lotes"} onClick={() => setSub("lotes")}>
            💰 Lotes pagos ({lotesPagos.length})
          </SubTabBtn>
          <SubTabBtn active={sub === "noshows"} onClick={() => setSub("noshows")}>
            🚫 Não compareceram ({noShows.length})
          </SubTabBtn>
        </div>
        <select
          value={filtroAno}
          onChange={(e) => setFiltroAno(e.target.value)}
          className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">Todos anos</option>
          {anosDisponiveis.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {sub === "lotes" && (
        lotesPagos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
            Nenhum lote pago ainda.
          </div>
        ) : (
          <div className="space-y-3">
            {lotesPagos.map((p) => (
              <LoteCard key={p.id} lote={p} shifts={shifts} restaurant={restaurant} />
            ))}
          </div>
        )
      )}

      {sub === "noshows" && (
        noShows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
            Nenhum no-show registrado.
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-left">
                <tr className="text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                  <th className="px-3 py-2">Pessoa</th>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Área</th>
                  <th className="px-3 py-2">Obs.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {noShows.map((s) => (
                  <tr key={s.id} className="text-gray-700 dark:text-gray-200">
                    <td className="px-3 py-2 font-medium">{s.nomeSnapshot}</td>
                    <td className="px-3 py-2">{dBR(s.date)}</td>
                    <td className="px-3 py-2">{s.area || "—"}</td>
                    <td className="px-3 py-2 italic text-gray-500">{s.observacao || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function SubTabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
          : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
      }`}
    >
      {children}
    </button>
  );
}

function LoteCard({
  lote, shifts, restaurant,
}: { lote: FreelaPagamento; shifts: FreelaShift[]; restaurant: Restaurant }) {
  const [aberto, setAberto] = useState(false);
  const [previewAberto, setPreviewAberto] = useState(false);
  const [recibo, setRecibo] = useState<ReciboData | null>(null);
  const shiftsDoLote = useMemo(
    () => shifts.filter((s) => lote.shiftIds.includes(s.id)),
    [shifts, lote.shiftIds],
  );
  const dataLote = lote.pagoEm || lote.criadoEm;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-gray-800 dark:text-gray-100 text-sm">
            {lote.numero}
            <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">
              Pago
            </span>
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            Lote de {fmtDate(dataLote)} · pago por {lote.pagoPorNome || "—"}
            {lote.formaPagamento && ` · ${lote.formaPagamento}`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-bold text-gray-800 dark:text-gray-100 text-sm">{fmtBR(lote.totalGeral)}</div>
          <div className="text-[11px] text-gray-500">{lote.qtdPessoas} pessoa(s) · {lote.qtdShifts} turno(s)</div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAberto((v) => !v)}>
            {aberto ? "Recolher" : "Detalhes"}
          </Button>
          <Button size="sm" onClick={() => setPreviewAberto(true)}>
            📄 PDF
          </Button>
        </div>
      </div>
      {aberto && (
        <div className="p-3 space-y-1">
          {lote.pessoasResumo.map((p, i) => (
            <PessoaLoteRow
              key={`p${i}`}
              pessoa={p}
              shiftsDoLote={shiftsDoLote}
              onRecibo={(d) => setRecibo(d)}
            />
          ))}
          {(lote.mensalistas || []).map((m, i) => (
            <MensalistaLoteRow key={`m${i}`} linha={m} onRecibo={(d) => setRecibo(d)} />
          ))}
        </div>
      )}
      {previewAberto && (
        <LotePDFPreviewModal
          lote={lote}
          shifts={shiftsDoLote}
          restaurant={restaurant}
          onClose={() => setPreviewAberto(false)}
        />
      )}
      {recibo && <ReciboModal data={recibo} onClose={() => setRecibo(null)} />}
    </div>
  );
}

// Diárias congeladas da pessoa: usa o snapshot do lote (novos) e, em fallback,
// deriva dos turnos ao vivo (lotes antigos, sem snapshot).
function turnosDaPessoa(p: FreelaPagamentoResumoPessoa, shiftsDoLote: FreelaShift[]): FreelaTurnoSnapshot[] {
  if (p.turnos && p.turnos.length) return p.turnos;
  const bate = (s: FreelaShift) =>
    p.pessoaId ? s.pessoaId === p.pessoaId
      : p.empregadoId ? s.empregadoId === p.empregadoId
      : s.nomeSnapshot === p.nome;
  return shiftsDoLote.filter(bate).map((s) => ({
    date: s.date, area: s.area ?? null, entrada: s.entrada ?? null, saida: s.saida ?? null,
    horas: s.horas ?? null, valorTipo: s.valorTipo ?? null, valorUnit: s.valorUnit ?? null,
    totalCalc: s.totalCalc ?? null, cancelado: s.status === "cancelado",
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function PessoaLoteRow({
  pessoa: p, shiftsDoLote, onRecibo,
}: {
  pessoa: FreelaPagamentoResumoPessoa;
  shiftsDoLote: FreelaShift[];
  onRecibo: (d: ReciboData) => void;
}) {
  const [open, setOpen] = useState(false);
  const turnos = useMemo(() => turnosDaPessoa(p, shiftsDoLote), [p, shiftsDoLote]);
  const periodo = periodoDeTurnos(turnos);
  const gorjeta = p.totalGorjeta || 0;
  const totalPessoa = p.totalValor + gorjeta;

  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
          <span className="text-gray-400 text-xs w-3">{open ? "▾" : "▸"}</span>
          <span className="font-medium text-sm text-gray-800 dark:text-gray-100 truncate">{p.nome}</span>
          <span className="text-[11px] text-gray-500 shrink-0">· {p.qtdShifts} diária(s) · {fmtHoras(p.totalHoras)}</span>
        </button>
        <span className="hidden sm:block text-[11px] text-gray-500 truncate max-w-[120px]">{p.pix || ""}</span>
        <span className="text-right shrink-0">
          <span className="block text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">{fmtBR(totalPessoa)}</span>
          {gorjeta > 0 && (
            <span className="block text-[10px] text-indigo-600 dark:text-indigo-400 tabular-nums">
              diária {fmtBR(p.totalValor)} + 🎁 {fmtBR(gorjeta)}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onRecibo({ tipo: "diarista", nome: p.nome, periodo, turnos, total: totalPessoa, gorjeta: gorjeta || undefined })}
          className="text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 shrink-0"
        >
          🧾 Recibo
        </button>
      </div>
      {open && (
        <div className="px-2 pb-2 overflow-x-auto">
          <table className="w-full text-[11px] min-w-[420px]">
            <thead>
              <tr className="text-left text-gray-400 uppercase tracking-wider">
                <th className="py-1">Data</th>
                <th className="py-1">Horário</th>
                <th className="py-1 text-right">Horas</th>
                <th className="py-1 text-right">Tarifa</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {turnos.map((t, i) => (
                <tr key={i} className={`text-gray-700 dark:text-gray-200 ${t.cancelado ? "opacity-50 line-through" : ""}`}>
                  <td className="py-1">{dBR(t.date)}</td>
                  <td className="py-1">{t.entrada && t.saida ? `${t.entrada}–${t.saida}` : "—"}</td>
                  <td className="py-1 text-right">{fmtHoras(t.horas || 0)}</td>
                  <td className="py-1 text-right">{tarifaTxt(t)}</td>
                  <td className="py-1 text-right font-semibold">{fmtBR(t.totalCalc || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MensalistaLoteRow({
  linha: m, onRecibo,
}: { linha: FreelaMensalistaLinha; onRecibo: (d: ReciboData) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
          <span className="text-gray-400 text-xs w-3">{open ? "▾" : "▸"}</span>
          <span className="font-medium text-sm text-gray-800 dark:text-gray-100 truncate">{m.nome}</span>
          <span className="text-[10px] uppercase font-bold text-indigo-500">mensalista</span>
        </button>
        <span className="hidden sm:block text-[11px] text-gray-500 truncate max-w-[120px]">{m.pix || ""}</span>
        <span className="text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">{fmtBR(m.total)}</span>
        <button
          type="button"
          onClick={() => onRecibo({ tipo: "mensalista", nome: m.nome, periodo: competenciaRange(m.competencia), mensalista: m, total: m.total })}
          className="text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 shrink-0"
        >
          🧾 Recibo
        </button>
      </div>
      {open && (
        <div className="px-2 pb-2 text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5">
          <div>Período: {competenciaRange(m.competencia)} · {m.diasTrabalhados}/{m.diasNoMes} dias{(m.faltasInjust || 0) > 0 ? ` (${m.diasCobertos ?? m.diasTrabalhados} − ${m.faltasInjust} falta inj.)` : ""}</div>
          <div>Remuneração proporcional: {fmtBR(m.remuneracaoProporcional)}</div>
          <div>Gorjeta ({m.gorjetaModo === "bruto" ? "bruto" : "líquido"}): {fmtBR(m.gorjetaAplicada)}</div>
          {m.desconto > 0 && <div>Desconto{m.descontoDesc ? ` (${m.descontoDesc})` : ""}: − {fmtBR(m.desconto)}</div>}
          {m.acrescimo > 0 && <div>Acréscimo{m.acrescimoDesc ? ` (${m.acrescimoDesc})` : ""}: + {fmtBR(m.acrescimo)}</div>}
          <div className="font-semibold text-gray-800 dark:text-gray-100">Total: {fmtBR(m.total)}</div>
        </div>
      )}
    </div>
  );
}

// ─── Recibo (na tela + imprimir; sem nome do restaurante) ───
type ReciboData = {
  tipo: "diarista" | "mensalista";
  nome: string;
  periodo: string;
  total: number;
  gorjeta?: number;
  turnos?: FreelaTurnoSnapshot[];
  mensalista?: FreelaMensalistaLinha;
};

function ReciboModal({ data, onClose }: { data: ReciboData; onClose: () => void }) {
  const html = buildReciboHTML(data);
  function imprimir() {
    const w = window.open("", "_blank", "width=480,height=680");
    if (!w) { alert("Permita pop-ups pra imprimir o recibo."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Recibo — ${escaparHtml(data.nome)}</title>
      <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1710;margin:24px}</style>
      </head><body>${html}<div style="color:#94a3b8;font-size:10px;margin-top:18px">Recibo gerado em ${dBR(hojeISO())} — sem valor fiscal.</div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }
  return (
    <Modal title="Recibo" onClose={onClose} maxWidth="max-w-md">
      <div
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white text-gray-900 p-4 max-h-[60vh] overflow-y-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
        <Button onClick={imprimir}>🖨️ Imprimir</Button>
      </div>
    </Modal>
  );
}

// Estilos inline (não dependem de <style> — renderiza igual no modal e na
// janela de impressão).
const RB = {
  h1: "font-size:16px;font-weight:700;margin:0 0 2px",
  sub: "color:#64748b;font-size:12px;margin:0 0 12px",
  table: "width:100%;border-collapse:collapse;font-size:13px",
  th: "text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#64748b",
  thR: "text-align:right;padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#64748b",
  td: "text-align:left;padding:6px 8px;border-bottom:1px solid #f1f5f9",
  tdR: "text-align:right;padding:6px 8px;border-bottom:1px solid #f1f5f9",
  totTd: "text-align:left;padding:8px;border-top:2px solid #1c1710;font-weight:700;font-size:14px",
  totTdR: "text-align:right;padding:8px;border-top:2px solid #1c1710;font-weight:700;font-size:14px",
};

function buildReciboHTML(d: ReciboData): string {
  const cab = `<div style="${RB.h1}">Recibo — ${escaparHtml(d.nome)}</div><div style="${RB.sub}">Período: ${escaparHtml(d.periodo)}</div>`;

  if (d.tipo === "mensalista" && d.mensalista) {
    const m = d.mensalista;
    const linha = (desc: string, val: string) =>
      `<tr><td style="${RB.td}">${desc}</td><td style="${RB.tdR}">${val}</td></tr>`;
    const rows = [
      linha("Dias trabalhados", `${m.diasTrabalhados}/${m.diasNoMes}`),
      linha("Remuneração proporcional", fmtBR(m.remuneracaoProporcional)),
      linha(`Gorjeta (${m.gorjetaModo === "bruto" ? "bruto" : "líquido"})`, fmtBR(m.gorjetaAplicada)),
      m.desconto > 0 ? linha(`Desconto${m.descontoDesc ? ` (${escaparHtml(m.descontoDesc)})` : ""}`, `− ${fmtBR(m.desconto)}`) : "",
      m.acrescimo > 0 ? linha(`Acréscimo${m.acrescimoDesc ? ` (${escaparHtml(m.acrescimoDesc)})` : ""}`, `+ ${fmtBR(m.acrescimo)}`) : "",
    ].join("");
    return `${cab}<table style="${RB.table}">
      <thead><tr><th style="${RB.th}">Descrição</th><th style="${RB.thR}">Valor</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td style="${RB.totTd}">Total recebido</td><td style="${RB.totTdR}">${fmtBR(d.total)}</td></tr></tfoot>
    </table>`;
  }

  const turnos = d.turnos || [];
  const rows = turnos.map((t) => `<tr>
    <td style="${RB.td}">${dBR(t.date)}</td>
    <td style="${RB.td}">${t.entrada && t.saida ? `${t.entrada}–${t.saida}` : "—"}</td>
    <td style="${RB.tdR}">${fmtHoras(t.horas || 0)}</td>
    <td style="${RB.tdR}">${escaparHtml(tarifaTxt(t))}</td>
    <td style="${RB.tdR}">${fmtBR(t.totalCalc || 0)}</td>
  </tr>`).join("");
  const gj = d.gorjeta || 0;
  const linhaGorjeta = gj > 0
    ? `<tr><td style="${RB.tdR}" colspan="4">Diárias</td><td style="${RB.tdR}">${fmtBR(d.total - gj)}</td></tr>
       <tr><td style="${RB.tdR}" colspan="4">🎁 Gorjeta</td><td style="${RB.tdR}">${fmtBR(gj)}</td></tr>`
    : "";
  return `${cab}<table style="${RB.table}">
      <thead><tr><th style="${RB.th}">Data</th><th style="${RB.th}">Horário</th><th style="${RB.thR}">Horas</th><th style="${RB.thR}">Tarifa</th><th style="${RB.thR}">Total</th></tr></thead>
      <tbody>${rows}${linhaGorjeta}</tbody>
      <tfoot><tr><td style="${RB.totTd}" colspan="4">Total recebido</td><td style="${RB.totTdR}">${fmtBR(d.total)}</td></tr></tfoot>
    </table>`;
}

function tarifaTxt(t: FreelaTurnoSnapshot): string {
  if (t.valorTipo === "diaria") return `${fmtBR(t.valorUnit || 0)} (diária)`;
  if (t.valorTipo === "hora") return `${fmtBR(t.valorUnit || 0)}/h`;
  return "—";
}

function periodoDeTurnos(turnos: FreelaTurnoSnapshot[]): string {
  if (turnos.length === 0) return "—";
  const datas = turnos.map((t) => t.date).sort();
  const ini = dBR(datas[0]), fim = dBR(datas[datas.length - 1]);
  return ini === fim ? ini : `${ini} – ${fim}`;
}

function competenciaRange(comp: string): string {
  const m = comp.match(/^(\d{4})-(\d{2})/);
  if (!m) return comp;
  const ultimo = new Date(Number(m[1]), Number(m[2]), 0).getDate();
  return `01/${m[2]}/${m[1]} – ${String(ultimo).padStart(2, "0")}/${m[2]}/${m[1]}`;
}

// "YYYY-MM-DD" → "DD/MM/YYYY" sem Date (evita fuso).
function dBR(iso: string): string {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || "—");
}

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function escaparHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
