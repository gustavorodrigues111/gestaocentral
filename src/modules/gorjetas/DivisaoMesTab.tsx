import { Fragment, useMemo, useState } from "react";
import { Button } from "../../core/ui/Button";
import type { Cargo, DivisaoItem, Empregado, EscalaMes, Gorjeta, SplitVersion, Unidade } from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "./calc";
import { getActiveSplitVersion } from "./splitRules";
import { nomeMes } from "../../core/utils/date";
import { ExportarGorjetasPDFModal } from "./ExportarGorjetasPDFModal";
import { recalcularSnapshotGorjeta } from "./publicar";
import { useAuth } from "../../core/auth/AuthContext";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// `demitidoEm` é o PRIMEIRO dia FORA. Pra exibir, mostra o último dia
// trabalhado (= demitidoEm − 1) que casa com o que o gestor lançou como
// "data efetiva" da demissão.
function fmtDataSaida(demitidoEm: string): string {
  const [y, m, d] = demitidoEm.split("-").map(Number);
  if (!y || !m || !d) return demitidoEm;
  const dt = new Date(y, m - 1, d - 1);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

type Props = {
  ano: number;
  mes: number;
  gorjetas: Gorjeta[];
  empregados: Empregado[];
  cargos: Cargo[];
  escala: EscalaMes | null;
  splitVersions: SplitVersion[];
  restaurantNome: string;
  unidades: Unidade[];
  usaMultiUnidades: boolean;
  filtroUnidadeId: string;   // controlado pela GorjetasPage (pills do header)
};

type DiaEmpregado = {
  date: string;
  bruto: number;
  retencao: number;
  liquido: number;
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
  dias: DiaEmpregado[];   // detalhamento por dia pro drill-down
  demitidoEm?: string | null;   // YYYY-MM-DD (primeiro dia FORA) — badge no PDF/UI
};

export function DivisaoMesTab({
  ano, mes, gorjetas, empregados, cargos, escala, splitVersions, restaurantNome,
  unidades, usaMultiUnidades, filtroUnidadeId,
}: Props) {
  // Drill-down: empregadoId atualmente expandido (mostra dia-a-dia)
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null);

  // Lookup: empregadoId → nome da unidade padrão (pro badge)
  const unidadeNomePorEmp = useMemo(() => {
    if (!usaMultiUnidades) return {} as Record<string, string>;
    const byId = Object.fromEntries(unidades.map(u => [u.id, u.nome]));
    const out: Record<string, string> = {};
    for (const e of empregados) {
      if (e.unidadePadraoId && byId[e.unidadePadraoId]) {
        out[e.id] = byId[e.unidadePadraoId];
      }
    }
    return out;
  }, [usaMultiUnidades, unidades, empregados]);

  // Tipo da unidade filtrada (se houver). Determina como o filtro se aplica:
  //   - "atendimento" → filtra GORJETAS pelo unidadeId (só os dias daquela unidade)
  //   - "producao"    → filtra EMPREGADOS pela unidadePadraoId (mas calcula com
  //                     todas as gorjetas, pois empregado de produção divide
  //                     com todas as unidades de atendimento)
  const tipoUnidadeFiltro = useMemo(() => {
    if (!filtroUnidadeId) return null;
    return unidades.find(u => u.id === filtroUnidadeId)?.tipo || null;
  }, [filtroUnidadeId, unidades]);

  const gorjetasFiltradas = useMemo(() => {
    if (!filtroUnidadeId || tipoUnidadeFiltro !== "atendimento") return gorjetas;
    return gorjetas.filter(g => g.unidadeId === filtroUnidadeId);
  }, [gorjetas, filtroUnidadeId, tipoUnidadeFiltro]);

  // Agrega por empregado: pra cada gorjeta do mês, calcula a divisão.
  // bruto do empregado = liquido / (1 - taxRate/100); retenção = bruto - liquido.
  const linhas = useMemo<LinhaEmpregado[]>(() => {
    const acc: Record<string, LinhaEmpregado> = {};

    for (const g of gorjetasFiltradas) {
      const splitVersion = getActiveSplitVersion(splitVersions, g.date);
      // taxRate: se a gorjeta foi publicada (snapshot congelado), usa o
      // snapshot dela. Senão, usa a splitVersion ativa na data — o `g.taxRate`
      // armazenado pode ser zero/vazio em gorjetas importadas.
      const taxRate = (g.publicada && g.divisaoSnapshot)
        ? (g.taxRate || 0)
        : (splitVersion?.taxRate ?? 0);
      const fator = 1 - taxRate / 100;

      // Usa snapshot se gorjeta publicada (congelada); senão recalcula live.
      // ATENÇÃO: `liquido` precisa estar arredondado em centavos antes de
      // entrar no calcularDivisaoDia. Sem arredondar, sobram frações de
      // centavo na conta que nem são distribuíveis nem somam ao bruto.
      let itens: DivisaoItem[];
      if (g.publicada && g.divisaoSnapshot) {
        itens = g.divisaoSnapshot;
      } else {
        const liquido = calcularValorLiquido(g.valorBruto, taxRate);
        const r = calcularDivisaoDia(g.date, liquido, empregados, cargos, escala, splitVersion, g.unidadeId || null, unidades);
        itens = r.itens;
        // Marca o fator como inverso do arredondamento real — pra na
        // agregação por empregado, brutoEmp / liquidoEmp baterem certinho
        // sem reabrir buraco. (calcularValorLiquido já arredondou.)
      }

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
            dias: [],
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
        linha.dias.push({
          date: g.date,
          bruto: Math.round(brutoEmp * 100) / 100,
          retencao: Math.round(retencaoEmp * 100) / 100,
          liquido: Math.round(liquidoEmp * 100) / 100,
        });
      }
    }

    // Arredonda totais pra centavos e ordena dias asc.
    // Captura demitidoEm do empregado pra render do badge.
    const empById = Object.fromEntries(empregados.map(e => [e.id, e]));
    let resultado = Object.values(acc).map(l => ({
      ...l,
      bruto: Math.round(l.bruto * 100) / 100,
      retencao: Math.round(l.retencao * 100) / 100,
      liquido: Math.round(l.liquido * 100) / 100,
      dias: [...l.dias].sort((a, b) => a.date.localeCompare(b.date)),
      demitidoEm: empById[l.empregadoId]?.demitidoEm || null,
    }));
    // Filtro por unidade de PRODUÇÃO: aplica DEPOIS do cálculo.
    // Mostra TODOS os empregados ativos com unidadePadraoId = produção,
    // mesmo os que NÃO entraram na divisão (porque cargo não tem
    // recebeProducao=true). Os que não receberam aparecem com R$ 0,00 —
    // ajuda o user a entender o motivo (cargo provavelmente sem
    // recebeProducao marcado).
    if (filtroUnidadeId && tipoUnidadeFiltro === "producao") {
      const cargoPorId = Object.fromEntries(cargos.map(c => [c.id, c]));
      const empsDestaUnidade = empregados.filter(e =>
        e.unidadePadraoId === filtroUnidadeId
        && e.estaAtivo
      );
      const idsCalculados = new Set(resultado.map(l => l.empregadoId));
      // Adiciona empregados desta unidade que ainda não estão em `resultado`
      // como linhas zeradas
      for (const e of empsDestaUnidade) {
        if (idsCalculados.has(e.id)) continue;
        const cargo = cargoPorId[e.cargoId];
        resultado.push({
          empregadoId: e.id,
          nome: e.nome,
          cargoNome: cargo?.nome || "—",
          area: cargo?.area || "",
          bruto: 0,
          retencao: 0,
          liquido: 0,
          diasComRecebimento: 0,
          dias: [],
          demitidoEm: e.demitidoEm || null,
        });
      }
      // Filtra: mantém só empregados da unidade selecionada
      const idsDaUnidade = new Set(empsDestaUnidade.map(e => e.id));
      resultado = resultado.filter(l => idsDaUnidade.has(l.empregadoId));
    }
    return resultado.sort((a, b) =>
      (a.area || "").localeCompare(b.area || "")
        || a.nome.localeCompare(b.nome)
    );
  }, [gorjetasFiltradas, empregados, cargos, escala, splitVersions, unidades, filtroUnidadeId, tipoUnidadeFiltro]);

  // Detalha a discrepância entre líquido do mês e soma distribuída.
  // Duas causas reais (NÃO existe efeito de semGorjeta=true diluindo, esse
  // cargo é só pulado em calc.ts:123):
  //   1. Arredondamento por dia: calc.ts:173 usa Math.floor pro valorPonto em
  //      centavos. Cada dia perde pontos × 0.0099 no pior caso. Acumula.
  //   2. Dia sem ninguém elegível: se itens.length === 0 em calc.ts:160, o
  //      líquido INTEIRO do dia vira resto (não distribuído). Tipicamente o
  //      maior contribuinte quando a diferença passa de R$ 20.
  const discrepanciaDetalhe = useMemo(() => {
    const diasSemDistribuicao: { date: string; valor: number }[] = [];
    let arredondamentoCentavos = 0;
    for (const g of gorjetasFiltradas) {
      const splitVersion = getActiveSplitVersion(splitVersions, g.date);
      const taxRate = (g.publicada && g.divisaoSnapshot)
        ? (g.taxRate || 0)
        : (splitVersion?.taxRate ?? 0);
      let valorLiquido: number;
      let totalDistribuido: number;
      let itensCount: number;
      if (g.publicada && g.divisaoSnapshot) {
        valorLiquido = g.valorLiquido || 0;
        totalDistribuido = g.divisaoSnapshot.reduce((s, it) => s + it.valor, 0);
        itensCount = g.divisaoSnapshot.length;
      } else {
        // Arredonda em centavos antes de calcular pra ficar consistente
        // com o que `linhas` usa (e evitar fração de centavo perdida).
        valorLiquido = calcularValorLiquido(g.valorBruto, taxRate);
        const r = calcularDivisaoDia(g.date, valorLiquido, empregados, cargos, escala, splitVersion, g.unidadeId || null, unidades);
        totalDistribuido = r.totalDistribuido;
        itensCount = r.itens.length;
      }
      const resto = valorLiquido - totalDistribuido;
      if (itensCount === 0 && valorLiquido > 0.005) {
        diasSemDistribuicao.push({ date: g.date, valor: Math.round(valorLiquido * 100) / 100 });
      } else if (resto > 0.005) {
        arredondamentoCentavos += resto;
      }
    }
    diasSemDistribuicao.sort((a, b) => a.date.localeCompare(b.date));
    const totalSemDistribuicao = diasSemDistribuicao.reduce((s, d) => s + d.valor, 0);
    return {
      diasSemDistribuicao,
      totalSemDistribuicao: Math.round(totalSemDistribuicao * 100) / 100,
      arredondamentoCentavos: Math.round(arredondamentoCentavos * 100) / 100,
    };
  }, [gorjetasFiltradas, empregados, cargos, escala, splitVersions, unidades]);

  // Totais do mês (respeitam filtro).
  // Líquido: pra gorjetas pagas usa o snapshot armazenado; pra pendentes
  // calcula a partir do bruto + splitVersion.taxRate ativa da data.
  const totais = useMemo(() => {
    // Quando o filtro é PRODUÇÃO, "bruto do mês" não tem como ser por unidade
    // (produção não arrecada). Mostra os totais derivados das LINHAS filtradas
    // pra ficar coerente (soma do bruto/líquido dos empregados de produção).
    if (tipoUnidadeFiltro === "producao") {
      const bruto = linhas.reduce((s, l) => s + l.bruto, 0);
      const liquido = linhas.reduce((s, l) => s + l.liquido, 0);
      const retencao = linhas.reduce((s, l) => s + l.retencao, 0);
      return { bruto, liquido, retencao, distribuido: liquido };
    }
    const bruto = gorjetasFiltradas.reduce((s, g) => s + (g.valorBruto || 0), 0);
    const liquido = gorjetasFiltradas.reduce((s, g) => {
      if (g.publicada && g.divisaoSnapshot) return s + (g.valorLiquido || 0);
      const sv = getActiveSplitVersion(splitVersions, g.date);
      const tax = sv?.taxRate ?? 0;
      // Arredonda em centavos por dia antes de somar — pra bater com a
      // soma distribuída (que é sempre arredondada).
      return s + calcularValorLiquido(g.valorBruto || 0, tax);
    }, 0);
    const retencao = bruto - liquido;
    const distribuido = linhas.reduce((s, l) => s + l.liquido, 0);
    return { bruto, liquido, retencao, distribuido };
  }, [gorjetasFiltradas, linhas, splitVersions, tipoUnidadeFiltro]);

  const [exportando, setExportando] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const { pessoa: me } = useAuth();

  // Recalcula o divisaoSnapshot das gorjetas publicadas do mês com o
  // algoritmo atual (corrige a discrepância histórica de centavos perdidos
  // por floor diário). Não muda metadados de publicação — só atualiza
  // o snapshot pra refletir o algoritmo mais recente.
  async function recalcularSnapshotsDoMes() {
    const publicadas = gorjetas.filter(g => g.publicada && g.divisaoSnapshot);
    if (publicadas.length === 0) {
      alert("Sem gorjetas publicadas neste mês pra recalcular.");
      return;
    }
    const diff = totais.liquido - totais.distribuido;
    const ok = window.confirm(
      `Recalcular a divisão de ${publicadas.length} gorjeta(s) publicada(s) do mês?\n\n` +
      `Vai aplicar o algoritmo de distribuição de centavos (zerar a diferença de ${fmtBR(Math.abs(diff))}).\n\n` +
      `Cada empregado pode receber +R$ 0,01 a +R$ 0,15 a mais no total do mês. ` +
      `Os snapshots publicados são sobrescritos, mas data e autor da publicação ficam.\n\n` +
      `Recomendado APENAS pra mês ainda não pago.`,
    );
    if (!ok) return;
    setRecalculando(true);
    let ok_count = 0;
    let erros = 0;
    try {
      for (const g of publicadas) {
        try {
          await recalcularSnapshotGorjeta({
            gorjeta: g, empregados, cargos, escala, splitVersions, unidades,
            publicadoPorId: me?.id || "",
            publicadoPorNome: me?.nome || "",
          });
          ok_count++;
        } catch (e) {
          erros++;
          console.warn("Falha no recálculo de", g.id, e);
        }
      }
      alert(
        `✓ Recalculado: ${ok_count} gorjeta(s)` +
        (erros > 0 ? `\n⚠ Falharam: ${erros}` : ""),
      );
    } finally {
      setRecalculando(false);
    }
  }

  async function exportar() {
    if (linhas.length === 0) return;
    setExportando(true);
    try {
      // Lazy load — xlsx é ~250KB
      const XLSX = await import("xlsx");
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
    const lancamentosHeader = ["Data", "Bruto", "Retenção (%)", "Líquido", "Publicada em", "Observação"];
    const lancamentosRows = [...gorjetas]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(g => {
        // Pra gorjetas publicadas (snapshot), usa o taxRate do snapshot.
        // Pra não-publicadas, pega da splitVersion ativa.
        const tax = (g.publicada && g.divisaoSnapshot)
          ? (g.taxRate || 0)
          : (getActiveSplitVersion(splitVersions, g.date)?.taxRate ?? 0);
        const liquido = (g.publicada && g.divisaoSnapshot)
          ? (g.valorLiquido || 0)
          : (g.valorBruto || 0) * (1 - tax / 100);
        return [
          g.date,
          g.valorBruto,
          tax,
          liquido,
          g.publicadaEm ? new Date(g.publicadaEm).toLocaleString("pt-BR") : "",
          g.observacao || "",
        ];
      });
    const lancamentosWS = XLSX.utils.aoa_to_sheet([lancamentosHeader, ...lancamentosRows]);
    XLSX.utils.book_append_sheet(wb, lancamentosWS, "Lançamentos");

      const fileName = `Gorjetas_${restaurantNome.replace(/\s+/g, "_")}_${ano}-${String(mes).padStart(2,"0")}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error(e);
      alert("Erro ao exportar XLSX: " + (e instanceof Error ? e.message : "desconhecido"));
    } finally {
      setExportando(false);
    }
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
      {/* Filtro de unidade vive no header da GorjetasPage (pills compartilhados
          entre tabs Lançamentos e Divisão do mês). */}

      {/* Cards de totais.
          Desktop: 3 colunas. Mobile: Bruto sozinho na 1ª linha (cabe valor grande);
          Retenção + Líquido dividem a 2ª linha. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
        <Card label="Bruto do mês" value={fmtBR(totais.bruto)} />
        <div className="grid grid-cols-2 gap-2 md:contents">
          <Card label="Retenção total" value={fmtBR(totais.retencao)} variant="warn" />
          <Card label="Líquido distribuído" value={fmtBR(totais.distribuido)} variant="ok" />
        </div>
      </div>

      <div className="flex justify-between items-center flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {linhas.length} empregado(s) {tipoUnidadeFiltro === "producao" ? "nesta unidade" : "com recebimento"} · {gorjetasFiltradas.length} lançamento(s)
        </p>
        {/* Botões de export — só desktop */}
        <div className="hidden md:flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPdfModalOpen(true)} disabled={linhas.length === 0}>
            📄 Gerar PDF
          </Button>
          <Button variant="secondary" size="sm" onClick={exportar} disabled={exportando}>
            {exportando ? "Gerando..." : "📊 Exportar planilha (XLSX)"}
          </Button>
        </div>
      </div>

      {/* Aviso quando filtro=produção e ninguém recebeu — explica que o cargo
          precisa estar marcado como "Recebe produção" pra entrar na divisão */}
      {tipoUnidadeFiltro === "producao" && linhas.length > 0 && linhas.every(l => l.liquido === 0) && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <span className="text-base">💡</span>
          <div>
            Nenhum empregado desta unidade recebeu gorjeta neste mês. Pra que
            empregados de uma unidade de PRODUÇÃO dividam gorjeta das unidades
            de atendimento, marque o cargo deles como <strong>"Recebe produção"</strong> em
            Pessoas → Cargos.
          </div>
        </div>
      )}

      {/* Tabela de divisão (cabeçalho com 1 col extra pro chevron expand/collapse) */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="text-[11px] text-gray-500 dark:text-gray-400 px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/30">
          💡 Click em qualquer empregado pra ver o dia-a-dia do recebimento.
        </div>
        {/* Desktop: tabela com 6 colunas */}
        <div className="hidden md:grid grid-cols-[24px_1fr_60px_120px_110px_120px] gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
          <div></div>
          <div>Empregado</div>
          <div className="text-right">Dias</div>
          <div className="text-right">Bruto</div>
          <div className="text-right">Retenção</div>
          <div className="text-right">Líquido</div>
        </div>
        {linhas.map((l, i) => {
          const areaPrev = i > 0 ? linhas[i - 1].area : null;
          const isPrimeiroDaArea = l.area !== areaPrev;
          const isExpanded = expandedEmpId === l.empregadoId;
          return (
            <Fragment key={l.empregadoId}>
              {isPrimeiroDaArea && (
                <div className="px-3 py-1 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                    {l.area || "Sem área"}
                  </span>
                </div>
              )}
              {/* Desktop: row da tabela */}
              <button
                type="button"
                onClick={() => setExpandedEmpId(isExpanded ? null : l.empregadoId)}
                className={`hidden md:grid w-full grid-cols-[24px_1fr_60px_120px_110px_120px] gap-2 px-3 py-2 items-center text-sm border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 text-left transition-colors ${
                  isExpanded ? "bg-indigo-50/40 dark:bg-indigo-900/20" : ""
                }`}
                title={isExpanded ? "Esconder dia-a-dia" : "Ver dia-a-dia"}
              >
                <span className="text-gray-400 text-xs">{isExpanded ? "▼" : "▶"}</span>
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                    <span className="truncate">{l.nome}</span>
                    {l.demitidoEm && (
                      <span className="text-[9px] bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide shrink-0">
                        Demitido em {fmtDataSaida(l.demitidoEm)}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500 flex items-center gap-1.5">
                    <span>{l.cargoNome}</span>
                    {unidadeNomePorEmp[l.empregadoId] && (
                      <span className="text-[9px] bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">
                        {unidadeNomePorEmp[l.empregadoId]}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right tabular-nums text-gray-600 dark:text-gray-400">{l.diasComRecebimento}</div>
                <div className="text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtBR(l.bruto)}</div>
                <div className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtBR(l.retencao)}</div>
                <div className="text-right tabular-nums font-bold text-emerald-700 dark:text-emerald-300">{fmtBR(l.liquido)}</div>
              </button>

              {/* Mobile: card vertical */}
              <button
                type="button"
                onClick={() => setExpandedEmpId(isExpanded ? null : l.empregadoId)}
                className={`md:hidden w-full px-3 py-2.5 border-t border-gray-100 dark:border-gray-800 text-left transition-colors ${
                  isExpanded ? "bg-indigo-50/40 dark:bg-indigo-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-gray-400 text-xs shrink-0">{isExpanded ? "▼" : "▶"}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate flex items-center gap-1.5 flex-wrap">
                        <span className="truncate">{l.nome}</span>
                        {l.demitidoEm && (
                          <span className="text-[9px] bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">
                            Demitido em {fmtDataSaida(l.demitidoEm)}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate flex items-center gap-1.5">
                        <span>{l.cargoNome}</span>
                        {unidadeNomePorEmp[l.empregadoId] && (
                          <span className="text-[9px] bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200 px-1.5 py-0.5 rounded uppercase font-bold tracking-wide">
                            {unidadeNomePorEmp[l.empregadoId]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{fmtBR(l.liquido)}</div>
                    <div className="text-[10px] text-gray-500 tabular-nums">{l.diasComRecebimento} dias · {fmtBR(l.bruto)} bruto</div>
                  </div>
                </div>
              </button>

              {/* Drill-down: dia-a-dia desse empregado */}
              {isExpanded && l.dias.length > 0 && (
                <div className="bg-indigo-50/30 dark:bg-indigo-900/10 border-t border-indigo-100 dark:border-indigo-900/40 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 mb-1.5">
                    📅 Detalhamento de {l.nome.split(" ")[0]} — {l.dias.length} dia(s)
                  </div>
                  {/* Desktop: tabela 5 colunas */}
                  <div className="hidden md:block rounded border border-indigo-100 dark:border-indigo-900/40 bg-white dark:bg-gray-900 overflow-hidden">
                    <div className="grid grid-cols-[100px_1fr_120px_110px_120px] gap-2 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 bg-gray-50 dark:bg-gray-800/50">
                      <div>Data</div>
                      <div></div>
                      <div className="text-right">Bruto do dia</div>
                      <div className="text-right">Retenção</div>
                      <div className="text-right">Líquido</div>
                    </div>
                    {l.dias.map((d) => {
                      const [y, m, dd] = d.date.split("-");
                      const dataBr = `${dd}/${m}/${y}`;
                      const dayDate = new Date(d.date + "T12:00:00");
                      const dow = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][dayDate.getDay()];
                      return (
                        <div key={d.date} className="grid grid-cols-[100px_1fr_120px_110px_120px] gap-2 px-3 py-1.5 items-center text-xs border-t border-gray-100 dark:border-gray-800">
                          <div className="tabular-nums text-gray-700 dark:text-gray-300">
                            {dataBr} <span className="text-[10px] text-gray-400">{dow}</span>
                          </div>
                          <div></div>
                          <div className="text-right tabular-nums text-gray-700 dark:text-gray-300">{fmtBR(d.bruto)}</div>
                          <div className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtBR(d.retencao)}</div>
                          <div className="text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">{fmtBR(d.liquido)}</div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Mobile: lista compacta */}
                  <div className="md:hidden rounded border border-indigo-100 dark:border-indigo-900/40 bg-white dark:bg-gray-900 overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
                    {l.dias.map((d) => {
                      const [, m, dd] = d.date.split("-");
                      const dayDate = new Date(d.date + "T12:00:00");
                      const dow = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][dayDate.getDay()];
                      return (
                        <div key={d.date} className="flex items-center justify-between px-3 py-1.5 text-xs">
                          <div className="text-gray-700 dark:text-gray-300 tabular-nums">
                            {dd}/{m} <span className="text-[10px] text-gray-400">{dow}</span>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{fmtBR(d.liquido)}</div>
                            <div className="text-[10px] text-gray-500 tabular-nums">bruto {fmtBR(d.bruto)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
        {/* Linha de total — desktop */}
        <div className="hidden md:grid grid-cols-[24px_1fr_60px_120px_110px_120px] gap-2 px-3 py-3 items-center text-sm border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-bold">
          <div></div>
          <div>TOTAL</div>
          <div className="text-right tabular-nums">{linhas.reduce((s, l) => s + l.diasComRecebimento, 0)}</div>
          <div className="text-right tabular-nums">{fmtBR(linhas.reduce((s, l) => s + l.bruto, 0))}</div>
          <div className="text-right tabular-nums text-amber-700 dark:text-amber-400">{fmtBR(linhas.reduce((s, l) => s + l.retencao, 0))}</div>
          <div className="text-right tabular-nums text-emerald-700 dark:text-emerald-300">{fmtBR(linhas.reduce((s, l) => s + l.liquido, 0))}</div>
        </div>
        {/* Linha de total — mobile */}
        <div className="md:hidden flex items-center justify-between px-3 py-3 border-t-2 border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 font-bold text-sm">
          <span>TOTAL ({linhas.reduce((s, l) => s + l.diasComRecebimento, 0)} dias)</span>
          <div className="text-right">
            <div className="tabular-nums text-emerald-700 dark:text-emerald-300">{fmtBR(linhas.reduce((s, l) => s + l.liquido, 0))}</div>
            <div className="text-[10px] font-normal tabular-nums text-gray-500">bruto {fmtBR(linhas.reduce((s, l) => s + l.bruto, 0))}</div>
          </div>
        </div>
      </div>

      {/* Discrepância (caso o líquido distribuído não bata com o líquido do mês).
          Detalha as 2 causas reais com valores específicos pra investigação. */}
      {Math.abs(totais.liquido - totais.distribuido) > 0.05 && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="font-bold text-amber-900 dark:text-amber-100 mb-2 flex items-center justify-between gap-3 flex-wrap">
            <span>⚠ Diferença de <span className="tabular-nums">{fmtBR(Math.abs(totais.liquido - totais.distribuido))}</span> entre o líquido do mês e a soma distribuída</span>
            {discrepanciaDetalhe.arredondamentoCentavos > 0.005 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={recalcularSnapshotsDoMes}
                disabled={recalculando}
                className="shrink-0"
              >
                {recalculando ? "Recalculando..." : "🔄 Recalcular divisão"}
              </Button>
            )}
          </div>

          {discrepanciaDetalhe.arredondamentoCentavos > 0.005 && (
            <div className="mb-2">
              <div>
                <strong>1. Arredondamento por dia:</strong> <span className="tabular-nums">{fmtBR(discrepanciaDetalhe.arredondamentoCentavos)}</span>
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-300/80 mt-0.5">
                O valor por ponto é arredondado pra baixo em centavos a cada dia. Em meses com muitos lançamentos acumula uns poucos reais — comportamento esperado.
              </div>
            </div>
          )}

          {discrepanciaDetalhe.diasSemDistribuicao.length > 0 && (
            <div className="mb-1">
              <div>
                <strong>
                  {discrepanciaDetalhe.arredondamentoCentavos > 0.005 ? "2. " : ""}
                  Dias com gorjeta sem ninguém pra dividir:
                </strong>{" "}
                <span className="tabular-nums">{fmtBR(discrepanciaDetalhe.totalSemDistribuicao)}</span> em {discrepanciaDetalhe.diasSemDistribuicao.length} dia(s)
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-300/80 mt-0.5 mb-1">
                Geralmente significa que ninguém estava escalado, ou todos os escalados tinham cargo sem direito à gorjeta. Vale checar a escala desses dias:
              </div>
              <ul className="ml-4 space-y-0.5">
                {discrepanciaDetalhe.diasSemDistribuicao.slice(0, 10).map(d => {
                  const [y, m, dd] = d.date.split("-");
                  return (
                    <li key={d.date} className="tabular-nums">
                      • {dd}/{m}/{y} — <strong>{fmtBR(d.valor)}</strong>
                    </li>
                  );
                })}
                {discrepanciaDetalhe.diasSemDistribuicao.length > 10 && (
                  <li className="text-[11px] italic text-amber-700 dark:text-amber-300/80">
                    + {discrepanciaDetalhe.diasSemDistribuicao.length - 10} dia(s) a mais
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {pdfModalOpen && (
        <ExportarGorjetasPDFModal
          ano={ano}
          mes={mes}
          restaurantNome={restaurantNome}
          linhas={linhas.map(l => ({
            empregadoId: l.empregadoId,
            nome: l.nome,
            cargoNome: l.cargoNome,
            area: l.area,
            bruto: l.bruto,
            retencao: l.retencao,
            liquido: l.liquido,
            diasComRecebimento: l.diasComRecebimento,
            demitidoEm: l.demitidoEm,
          }))}
          empregados={empregados}
          unidades={unidades}
          usaMultiUnidades={usaMultiUnidades}
          totaisGlobais={{
            bruto: totais.bruto,
            retencao: totais.retencao,
            liquido: totais.liquido,
            distribuido: totais.distribuido,
          }}
          diasLancados={gorjetasFiltradas.length}
          unidadeInicial={filtroUnidadeId}
          onClose={() => setPdfModalOpen(false)}
        />
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
