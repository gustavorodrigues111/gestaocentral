// Painel enxuto da situação de estoque — 4 cards clicáveis; cada um abre um modal
// com os itens por trás do número. É SÓ VISUALIZAÇÃO: gerar pedido acontece no
// módulo Compras (que tem a etapa de edição). "Abaixo do mínimo" e "Reposição"
// agrupam por fornecedor, pra bater o olho no que falta de cada um.
import { useMemo, useState } from "react";
import { TriangleAlert, PackageX, ClipboardCheck, Banknote, Store } from "lucide-react";
import { Modal } from "../../core/ui/Modal";
import { UNIDADES_LABEL } from "../../core/types";
import type { Contagem, Insumo, Fornecedor } from "../../core/types";
import { todayYmd } from "../../core/utils/date";

const fmtR$ = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const und = (i: Insumo) => (i.unidade === "outro" ? (i.unidadeOutroLabel || "un") : (UNIDADES_LABEL[i.unidade] || i.unidade)).slice(0, 3).toLowerCase();

type Metrica = "hoje" | "abaixo" | "sem" | "reposicao";
const SEM_FORN = "__sem__";

type Falta = { insumo: Insumo; falta: number; qtd: number; sug: number; subtotal: number };

export function PainelContagensTab({ insumos, ultimaContagem, fornecedores }: { insumos: Insumo[]; ultimaContagem: Record<string, Contagem>; rid: string; fornecedores: Fornecedor[] }) {
  const ativos = useMemo(() => insumos.filter(i => i.ativo), [insumos]);
  const hoje = todayYmd();
  const [aberto, setAberto] = useState<Metrica | null>(null);

  const fornNome = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of fornecedores) m[f.id] = f.nome;
    return m;
  }, [fornecedores]);

  const stats = useMemo(() => {
    const contadosHoje: { insumo: Insumo; c: Contagem }[] = [];
    const semContagem: Insumo[] = [];
    const faltas: Falta[] = [];
    let reposicao = 0;
    for (const i of ativos) {
      const c = ultimaContagem[i.id];
      if (c?.data === hoje) contadosHoje.push({ insumo: i, c });
      if (!c) semContagem.push(i);
      const min = i.minStock || 0;
      const qtd = c?.qty ?? 0;
      if (min > 0 && qtd < min) {
        const necessidade = min - qtd;
        const fator = i.fatorCompra && i.fatorCompra > 0 ? i.fatorCompra : 1;
        let sug = Math.ceil(necessidade / fator) * fator;
        if (i.minPedido && sug < i.minPedido) sug = Math.ceil(i.minPedido / fator) * fator;
        const subtotal = sug * (i.precoEstimado || 0);
        reposicao += subtotal;
        faltas.push({ insumo: i, falta: necessidade, qtd, sug, subtotal });
      }
    }
    faltas.sort((a, b) => b.falta - a.falta);
    contadosHoje.sort((a, b) => a.insumo.nome.localeCompare(b.insumo.nome, "pt-BR"));
    semContagem.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return { contadosHoje, semContagem, faltas, reposicao };
  }, [ativos, ultimaContagem, hoje]);

  // Agrupa as faltas por fornecedor preferencial (ou "Sem fornecedor").
  const gruposFalta = useMemo(() => {
    const by: Record<string, Falta[]> = {};
    for (const f of stats.faltas) {
      const fid = f.insumo.fornecedorPreferredId && fornNome[f.insumo.fornecedorPreferredId] ? f.insumo.fornecedorPreferredId : SEM_FORN;
      (by[fid] ||= []).push(f);
    }
    return Object.entries(by)
      .map(([fid, itens]) => ({
        fid,
        nome: fid === SEM_FORN ? "Sem fornecedor" : fornNome[fid],
        itens,
        subtotal: itens.reduce((s, x) => s + x.subtotal, 0),
      }))
      .sort((a, b) => (a.fid === SEM_FORN ? 1 : b.fid === SEM_FORN ? -1 : a.nome.localeCompare(b.nome, "pt-BR")));
  }, [stats.faltas, fornNome]);

  const Card = ({ metrica, icon, label, valor, cor, n }: { metrica: Metrica; icon: React.ReactNode; label: string; valor: React.ReactNode; cor: string; n: number }) => (
    <button type="button" onClick={() => n > 0 && setAberto(metrica)} disabled={n === 0}
      className={`text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 transition-colors ${n > 0 ? "hover:border-indigo-300 dark:hover:border-indigo-700 cursor-pointer" : "cursor-default opacity-90"}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 inline-flex items-center gap-1.5">{icon} {label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${cor}`}>{valor}</div>
      {n > 0 && <div className="text-[10px] text-indigo-500 mt-0.5">ver itens →</div>}
    </button>
  );

  const mostraReposicao = aberto === "reposicao";

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card metrica="hoje" n={stats.contadosHoje.length} icon={<ClipboardCheck size={12} />} label="Contados hoje" valor={stats.contadosHoje.length} cor="text-gray-900 dark:text-gray-100" />
        <Card metrica="abaixo" n={stats.faltas.length} icon={<TriangleAlert size={12} />} label="Abaixo do mínimo" valor={stats.faltas.length} cor={stats.faltas.length > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"} />
        <Card metrica="sem" n={stats.semContagem.length} icon={<PackageX size={12} />} label="Sem contagem" valor={stats.semContagem.length} cor={stats.semContagem.length > 0 ? "text-gray-700 dark:text-gray-300" : "text-emerald-700 dark:text-emerald-400"} />
        <Card metrica="reposicao" n={stats.faltas.length} icon={<Banknote size={12} />} label="Reposição estimada" valor={<span className="text-xl">{fmtR$(stats.reposicao)}</span>} cor="text-indigo-700 dark:text-indigo-300" />
      </div>

      {aberto && (
        <Modal onClose={() => setAberto(null)} maxWidth="max-w-lg"
          title={<span className="inline-flex items-center gap-2">
            {aberto === "hoje" && <><ClipboardCheck size={18} /> Contados hoje ({stats.contadosHoje.length})</>}
            {aberto === "abaixo" && <><TriangleAlert size={18} className="text-amber-500" /> Abaixo do mínimo ({stats.faltas.length})</>}
            {aberto === "sem" && <><PackageX size={18} /> Sem contagem ({stats.semContagem.length})</>}
            {aberto === "reposicao" && <><Banknote size={18} /> Reposição estimada</>}
          </span>}>
          <div className="space-y-3">
            {/* Contados hoje — lista simples */}
            {aberto === "hoje" && (
              <div className="max-h-[60vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {stats.contadosHoje.map(({ insumo: i, c }) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="min-w-0"><span className="text-gray-900 dark:text-gray-100">{i.nome}</span>{c.registradoNome && <span className="ml-1.5 text-[11px] text-gray-400">· {c.registradoNome}</span>}</span>
                    <span className="shrink-0 tabular-nums font-semibold text-gray-800 dark:text-gray-100">{c.qty} {und(i)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Sem contagem — lista simples */}
            {aberto === "sem" && (
              <div className="max-h-[60vh] overflow-auto rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                {stats.semContagem.map(i => (
                  <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="text-gray-900 dark:text-gray-100">{i.nome}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">{i.categoria || "—"}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Abaixo do mínimo / Reposição — AGRUPADO POR FORNECEDOR (só visualização) */}
            {(aberto === "abaixo" || mostraReposicao) && (
              <>
                <div className="max-h-[60vh] overflow-auto space-y-2.5">
                  {gruposFalta.map(g => (
                    <div key={g.fid} className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/60">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 min-w-0">
                          <Store size={13} className={g.fid === SEM_FORN ? "text-gray-400" : "text-indigo-500"} />
                          <span className="truncate">{g.nome}</span>
                          <span className="text-[10px] font-normal text-gray-400">({g.itens.length})</span>
                        </span>
                        {mostraReposicao && g.subtotal > 0 && <span className="shrink-0 text-xs font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{fmtR$(g.subtotal)}</span>}
                      </div>
                      <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {g.itens.map(({ insumo: i, falta, qtd, sug, subtotal }) => (
                          <div key={i.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                            {mostraReposicao ? (
                              <>
                                <span className="min-w-0 text-gray-900 dark:text-gray-100 truncate">{i.nome} <span className="text-[11px] text-gray-400">{sug} {und(i)}{i.precoEstimado != null ? ` × ${fmtR$(i.precoEstimado)}` : ""}</span></span>
                                <span className="shrink-0 tabular-nums font-semibold text-gray-800 dark:text-gray-100">{subtotal > 0 ? fmtR$(subtotal) : "—"}</span>
                              </>
                            ) : (
                              <>
                                <span className="min-w-0 text-gray-900 dark:text-gray-100 truncate">{i.nome}</span>
                                <span className="shrink-0 text-xs tabular-nums text-gray-500">tem <strong className="text-gray-700 dark:text-gray-200">{qtd}</strong> · mín <strong>{i.minStock}</strong> · falta <strong className="text-amber-700 dark:text-amber-400">{falta} {und(i)}</strong></span>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {mostraReposicao && (
                  <div className="flex items-center justify-between px-1 pt-1 text-sm font-bold border-t border-gray-200 dark:border-gray-800">
                    <span className="text-gray-600 dark:text-gray-300">Total estimado</span>
                    <span className="text-indigo-700 dark:text-indigo-300 tabular-nums">{fmtR$(stats.reposicao)}</span>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 px-1">Isto é uma visão do estoque. Para gerar um pedido editável, use <strong>Compras → Novo pedido</strong>.</p>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
