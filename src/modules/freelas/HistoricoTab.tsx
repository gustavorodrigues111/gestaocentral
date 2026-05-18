import { useMemo, useState } from "react";
import { Button } from "../../core/ui/Button";
import type {
  FreelaPagamento, FreelaShift, Restaurant,
} from "../../core/types";
import { fmtBR, fmtHoras } from "./helpers";
import { gerarLotePDF } from "./gerarLotePDF";

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
                    <td className="px-3 py-2">{s.date}</td>
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
  const [gerando, setGerando] = useState(false);
  const shiftsDoLote = useMemo(
    () => shifts.filter((s) => lote.shiftIds.includes(s.id)),
    [shifts, lote.shiftIds],
  );

  async function exportarPDF() {
    setGerando(true);
    try {
      const doc = await gerarLotePDF({ lote, shifts: shiftsDoLote, restaurant });
      doc.save(`${lote.numero}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Erro ao gerar PDF.");
    } finally {
      setGerando(false);
    }
  }

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
            Pago em {fmtDate(lote.pagoEm)} por {lote.pagoPorNome || "—"}
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
          <Button size="sm" onClick={exportarPDF} disabled={gerando}>
            {gerando ? "Gerando…" : "📄 PDF"}
          </Button>
        </div>
      </div>
      {aberto && (
        <div className="p-3 text-xs">
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500 uppercase tracking-wider">
                <th className="py-1">Nome</th>
                <th className="py-1">PIX</th>
                <th className="py-1 text-center">Turnos</th>
                <th className="py-1 text-right">Horas</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {lote.pessoasResumo.map((p, i) => (
                <tr key={i} className="text-gray-700 dark:text-gray-200">
                  <td className="py-1.5 font-medium">{p.nome}</td>
                  <td className="py-1.5 text-gray-500">{p.pix || "—"}</td>
                  <td className="py-1.5 text-center">{p.qtdShifts}</td>
                  <td className="py-1.5 text-right">{fmtHoras(p.totalHoras)}</td>
                  <td className="py-1.5 text-right font-semibold">{fmtBR(p.totalValor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
