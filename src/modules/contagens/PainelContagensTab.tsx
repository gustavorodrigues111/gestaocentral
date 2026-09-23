// Painel enxuto da situação de estoque — resumo, não tabelão. Cards + top faltas.
// A ação (gerar pedido) vive no Compras; aqui é a foto pra decisão.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { TriangleAlert, PackageX, ClipboardCheck, Banknote, Truck, ArrowRight } from "lucide-react";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Insumo } from "../../core/types";
import { todayYmd } from "../../core/utils/date";

const fmtR$ = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const und = (i: Insumo) => (i.unidade === "outro" ? (i.unidadeOutroLabel || "un") : (UNIDADES_LABEL[i.unidade] || i.unidade)).slice(0, 3).toLowerCase();

export function PainelContagensTab({ insumos, ultimaContagem, rid }: { insumos: Insumo[]; ultimaContagem: Record<string, Contagem>; rid: string }) {
  const ativos = useMemo(() => insumos.filter(i => i.ativo), [insumos]);
  const hoje = todayYmd();

  const stats = useMemo(() => {
    let contadosHoje = 0, semContagem = 0, reposicao = 0;
    const faltas: { insumo: Insumo; falta: number; qtd: number }[] = [];
    for (const i of ativos) {
      const c = ultimaContagem[i.id];
      if (c?.data === hoje) contadosHoje++;
      if (!c) semContagem++;
      const min = i.minStock || 0;
      const qtd = c?.qty ?? 0;
      if (min > 0 && qtd < min) {
        const necessidade = min - qtd;
        const fator = i.fatorCompra && i.fatorCompra > 0 ? i.fatorCompra : 1;
        let sug = Math.ceil(necessidade / fator) * fator;
        if (i.minPedido && sug < i.minPedido) sug = Math.ceil(i.minPedido / fator) * fator;
        reposicao += sug * (i.precoEstimado || 0);
        faltas.push({ insumo: i, falta: necessidade, qtd });
      }
    }
    faltas.sort((a, b) => b.falta - a.falta);
    return { contadosHoje, semContagem, abaixoMin: faltas.length, reposicao, faltas };
  }, [ativos, ultimaContagem, hoje]);

  const Card = ({ icon, label, valor, cor }: { icon: React.ReactNode; label: string; valor: React.ReactNode; cor: string }) => (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 inline-flex items-center gap-1.5">{icon} {label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${cor}`}>{valor}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card icon={<ClipboardCheck size={12} />} label="Contados hoje" valor={stats.contadosHoje} cor="text-gray-900 dark:text-gray-100" />
        <Card icon={<TriangleAlert size={12} />} label="Abaixo do mínimo" valor={stats.abaixoMin} cor={stats.abaixoMin > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"} />
        <Card icon={<PackageX size={12} />} label="Sem contagem" valor={stats.semContagem} cor={stats.semContagem > 0 ? "text-gray-700 dark:text-gray-300" : "text-emerald-700 dark:text-emerald-400"} />
        <Card icon={<Banknote size={12} />} label="Reposição estimada" valor={<span className="text-xl">{fmtR$(stats.reposicao)}</span>} cor="text-indigo-700 dark:text-indigo-300" />
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><TriangleAlert size={15} className="text-amber-500" /> Maiores faltas</h3>
          <Link to={`/r/${rid}/compras`} className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"><Truck size={13} /> Gerar pedido no Compras <ArrowRight size={12} /></Link>
        </div>
        {stats.faltas.length === 0 ? (
          <div className="text-sm text-emerald-700 dark:text-emerald-400 py-6 text-center">✓ Nenhum insumo abaixo do mínimo.</div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {stats.faltas.slice(0, 12).map(({ insumo: i, falta, qtd }) => (
              <div key={i.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{i.nome}</span>
                  <span className="ml-1.5 text-[11px] text-gray-400">{i.categoria || "—"}</span>
                </div>
                <div className="shrink-0 text-xs tabular-nums text-gray-500">
                  tem <strong className="text-gray-700 dark:text-gray-200">{qtd}</strong> · mín <strong>{i.minStock}</strong> · falta <strong className="text-amber-700 dark:text-amber-400">{falta} {und(i)}</strong>
                </div>
              </div>
            ))}
            {stats.faltas.length > 12 && <div className="text-[11px] text-gray-400 pt-1.5">+ {stats.faltas.length - 12} outros abaixo do mínimo</div>}
          </div>
        )}
      </div>
    </div>
  );
}
