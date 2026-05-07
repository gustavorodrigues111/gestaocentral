import { useMemo } from "react";
import * as XLSX from "xlsx";
import { Button } from "../../core/ui/Button";
import type { Cargo, DivisaoItem, Empregado, EscalaMes, Gorjeta, SplitVersion } from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "./calc";
import { getActiveSplitVersion } from "./splitRules";
import { nomeMes } from "../../core/utils/date";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  ano: number;
  mes: number;
  gorjetas: Gorjeta[];
  empregados: Empregado[];
  cargos: Cargo[];
  escala: EscalaMes | null;
  splitVersions: SplitVersion[];
  restaurantNome: string;
};

type LinhaEmpregado = {
  empregadoId: string;
  nome: string;
  cargoNome: string;
  area: string;
  bruto: number;
  retencao: number;
  liquido: number;
  diasComRecebimento: number;
};

export function DivisaoMesTab({
  ano, mes, gorjetas, empregados, cargos, escala, splitVersions, restaurantNome,
}: Props) {

  // Agrega por empregado: pra cada gorjeta do mês, calcula a divisão.
  // bruto do empregado = liquido / (1 - taxRate/100); retenção = bruto - liquido.
  const linhas = useMemo<LinhaEmpregado[]>(() => {
    const acc: Record<string, LinhaEmpregado> = {};

    for (const g of gorjetas) {
      const splitVersion = getActiveSplitVersion(splitVersions, g.date);
      // Usa snapshot se gorjeta paga; senão recalcula em tempo real
      let itens: DivisaoItem[];
      if (g.paidAt && g.divisaoSnapshot) {
        itens = g.divisaoSnapshot;
      } else {
        const liquido = calcularValorLiquido(g.valorBruto, g.taxRate);
        const r = calcularDivisaoDia(g.date, liquido, empregados, cargos, escala, splitVersion);
        itens = r.itens;
      }

      const taxRate = g.taxRate || 0;
      const fator = 1 - taxRate / 100;

      for (const it of itens) {
        if (!acc[it.empregadoId]) {
          acc[it.empregadoId] = {
            empregadoId: it.empregadoId,
            nome: it.empregadoNome,
            cargoNome: it.cargoNome,
            area: it.area,
            bruto: 0,
            retencao: 0,
            liquido: 0,
            diasComRecebimento: 0,
          };
        }
        const linha = acc[it.empregadoId];
        const liquidoEmp = it.valor;
        const brutoEmp = fator > 0 ? liquidoEmp / fator : liquidoEmp;
        const retencaoEmp = brutoEmp - liquidoEmp;
        linha.liquido += liquidoEmp;
        linha.bruto += brutoEmp;
        linha.retencao += retencaoEmp;
        linha.diasComRecebimento += 1;
      }
    }

    // Arredonda pra centavos
    return Object.values(acc).map(l => ({
      ...l,
      bruto: Math.round(l.bruto * 100) / 100,
      retencao: Math.round(l.retencao * 100) / 100,
      liquido: Math.round(l.liquido * 100) / 100,
    })).sort((a, b) =>
      (a.area || "").localeCompare(b.area || "")
        || a.nome.localeCompare(b.nome)
    );
  }, [gorjetas, empregados, cargos, escala, splitVersions]);

  // Totais do mês
  const totais = useMemo(() => {
    const bruto = gorjetas.reduce((s, g) => s + (g.valorBruto || 0), 0);
    const liquido = gorjetas.reduce((s, g) => s + (g.valorLiquido || 0), 0);
    const retencao = bruto - liquido;
    const distribuido = linhas.reduce((s, l) => s + l.liquido, 0);
    return { bruto, liquido, retencao, distribuido };
  }, [gorjetas, linhas]);

  function exportar() {
    if (linhas.length === 0) return;
    const wb = XLSX.utils.book_new();

    // Aba 1: Resumo do mês
    const resumoData = [
      ["Restaurante", restaurantNome],
      ["Mês", `${nomeMes(mes)} ${ano}`],
      [],
      ["Bruto total", totais.bruto],
      ["Retenção total", totais.retencao],
      ["Líquido total", totais.liquido],
      ["Distribuído", totais.distribuido],
      ["Dias lançados", gorjetas.length],
      [],
    ];
    const resumoWS = XLSX.utils.aoa_to_sheet(resumoData);
    XLSX.utils.book_append_sheet(wb, resumoWS, "Resumo");

    // Aba 2: Divisão por empregado
    const divisaoHeader = ["Empregado", "Cargo", "Área", "Dias", "Bruto", "Retenção", "Líquido"];
    const divisaoRows = linhas.map(l => [
      l.nome, l.cargoNome, l.area, l.diasComRecebimento,
      l.bruto, l.retencao, l.liquido,
    ]);
    // Linha de totais
    const totalRow = [
      "TOTAL", "", "", linhas.reduce((s, l) => s + l.diasComRecebimento, 0),
      linhas.reduce((s, l) => s + l.bruto, 0),
      linhas.reduce((s, l) => s + l.retencao, 0),
      linhas.reduce((s, l) => s + l.liquido, 0),
    ];
    const divisaoWS = XLSX.utils.aoa_to_sheet([divisaoHeader, ...divisaoRows, [], totalRow]);
    XLSX.utils.book_append_sheet(wb, divisaoWS, "Divisão");

    // Aba 3: Lançamentos diários
    const lancamentosHeader = ["Data", "Bruto", "Retenção (%)", "Líquido", "Pago em", "Observação"];
    const lancamentosRows = [...gorjetas]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(g => [
        g.date,
        g.valorBruto,
        g.taxRate,
        g.valorLiquido,
        g.paidAt ? new Date(g.paidAt).toLocaleString("pt-BR") : "",
        g.observacao || "",
      ]);
    const lancamentosWS = XLSX.utils.aoa_to_sheet([lancamentosHeader, ...lancamentosRows]);
    XLSX.utils.book_append_sheet(wb, lancamentosWS, "Lançamentos");

    const fileName = `Gorjetas_${restaurantNome.replace(/\s+/g, "_")}_${ano}-${String(mes).padStart(2,"0")}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  if (gorjetas.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3">💸</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem gorjetas neste mês</p>
        <p className="text-sm text-gray-500 mt-2">Volta na aba Lançamentos pra cadastrar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cards de totais */}
      <div className="grid grid-cols-3 gap-3">
        <Card label="Bruto do mês" value={fmtBR(totais.bruto)} />
        <Card label="Retenção total" value={fmtBR(totais.retencao)} variant="warn" />
        <Card label="Líquido distribuído" value={fmtBR(totais.distribuido)} variant="ok" />
      </div>

      <div className="flex justify-between items-center flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {linhas.length} empregado(s) com recebimento · {gorjetas.length} dia(s) lançados
        </p>
        <Button variant="secondary" size="sm" onClick={exportar}>
          📊 Exportar planilha (XLSX)
        </Button>
      </div>

      {/* Tabela de divisão */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="grid grid-cols-[1fr_60px_120px_110px_120px] gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
          <div>Empregado</div>
          <div className="text-right">Dias</div>
          <div className="text-right">Bruto</div>
          <div className="text-right">Retenção</div>
          <div className="text-right">Líquido</div>
        </div>
        {linhas.map(l => (
          <div key={l.empregadoId} className="grid grid-cols-[1fr_60px_120px_110px_120px] gap-2 px-3 py-2 items-center text-sm border-t border-gray-100 dark:border-gray-800">
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{l.nome}</div>
              <div className="text-[10px] text-gray-500">{l.cargoNome} · {l.area}</div>
            </div>
            <div className="text-right tabular-nums text-gray-600 dark:text-gray-400">{l.diasComRecebimento}</div>
            <div className="text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtBR(l.bruto)}</div>
            <div className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtBR(l.retencao)}</div>
            <div className="text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-300">{fmtBR(l.liquido)}</div>
          </div>
        ))}
        {/* Linha de total */}
        <div className="grid grid-cols-[1fr_60px_120px_110px_120px] gap-2 px-3 py-3 items-center text-sm border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-bold">
          <div>TOTAL</div>
          <div className="text-right tabular-nums">{linhas.reduce((s, l) => s + l.diasComRecebimento, 0)}</div>
          <div className="text-right tabular-nums">{fmtBR(linhas.reduce((s, l) => s + l.bruto, 0))}</div>
          <div className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtBR(linhas.reduce((s, l) => s + l.retencao, 0))}</div>
          <div className="text-right tabular-nums text-emerald-700 dark:text-emerald-300">{fmtBR(linhas.reduce((s, l) => s + l.liquido, 0))}</div>
        </div>
      </div>

      {/* Discrepância (caso o líquido distribuído não bata com o líquido do mês) */}
      {Math.abs(totais.liquido - totais.distribuido) > 0.05 && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
          ⚠ Pequena discrepância de <strong>{fmtBR(Math.abs(totais.liquido - totais.distribuido))}</strong> entre
          o líquido do mês e a soma distribuída. Pode ser:
          <ul className="list-disc ml-5 mt-1">
            <li>Arredondamento centavos por dia</li>
            <li>Dia(s) sem ninguém pra dividir (resto vira 0)</li>
            <li>Cargo com semGorjeta=true presente na escala</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, variant }: { label: string; value: string; variant?: "ok" | "warn" }) {
  const cls =
    variant === "ok" ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
    : variant === "warn" ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 text-amber-700 dark:text-amber-300"
    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}
