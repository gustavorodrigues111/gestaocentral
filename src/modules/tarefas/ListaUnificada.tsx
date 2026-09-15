// ════════════════════════════════════════════════════════════════════════════
//  ListaUnificada — a visão LISTA do módulo "Tarefas e Prazos". Renderiza
//  tarefas E prazos no MESMO estilo (o dos prazos: linhas limpas agrupadas por
//  janela). Filtros enxutos e iguais pros dois: A fazer · Concluídas ·
//  Atrasados · Hoje · Próx. 7 dias. Cada linha abre o item no seu modal.
// ════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { AlarmClock } from "lucide-react";
import type { Tarefa, TarefaProjeto, Prazo, PrazoTipo, Restaurant } from "../../core/types";
import { PRAZO_TIPO_LABEL } from "../../core/types";
import { ymdExibicao, diaSemanaCurto, hojeYmd, PRAZO_COR_HEX } from "../prazos/logic";

type Bucket = "atrasado" | "hoje" | "semana" | "depois" | "semdata";
const BUCKET_LABEL: Record<Bucket, string> = { atrasado: "Atrasados", hoje: "Hoje", semana: "Próximos 7 dias", depois: "Mais pra frente", semdata: "Sem data" };
const BUCKET_ORDEM: Bucket[] = ["atrasado", "hoje", "semana", "depois", "semdata"];
const TIPO_COR: Record<PrazoTipo, string> = {
  conta: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",       // Financeiro
  tecnico: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",         // Operação
  trabalhista: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",     // Pessoas
  avulso: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",          // Diretoria
};
const brl = (n?: number) => (typeof n === "number" ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "");
const somaDias = (ymd: string, n: number) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

type Norm = {
  key: string; tipo: "tarefa" | "prazo"; titulo: string;
  data: string | null;          // ymd exibido; null = sem data
  concluido: boolean; cancelado: boolean;
  chip: string; chipCls: string;
  empresas: string[]; valor?: number;
  prioCor: string;              // cor da faixa esquerda
  open: () => void;
};

type Filtro = "afazer" | "concluidas" | "atrasado" | "hoje" | "semana";
const PRIO_COR: Record<string, string> = { urgente: "#e11d48", alta: "#f59e0b", baixa: "#94a3b8", normal: "#cbd5e1" };

export function ListaUnificada({ tarefas, prazos, projetos, restaurants, podeVerTipo, onAbrirTarefa, onAbrirPrazo }: {
  tarefas: Tarefa[];
  prazos: Prazo[];
  projetos: TarefaProjeto[];
  restaurants: Restaurant[];
  podeVerTipo: (t: PrazoTipo) => boolean;
  onAbrirTarefa: (id: string) => void;
  onAbrirPrazo: (p: Prazo) => void;
}) {
  const hoje = hojeYmd();
  const [filtro, setFiltro] = useState<Filtro>("afazer");
  const nomeEmpresa = (id: string) => restaurants.find((r) => r.id === id)?.nome || "";

  const itens = useMemo<Norm[]>(() => {
    const out: Norm[] = [];
    for (const t of tarefas) {
      const proj = projetos.find((p) => p.id === t.projetoId);
      out.push({
        key: "t_" + t.id, tipo: "tarefa", titulo: t.titulo,
        data: t.prazo || null,
        concluido: t.status === "concluida", cancelado: t.status === "cancelada",
        chip: proj?.nome || "Tarefa", chipCls: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/25 dark:text-indigo-300",
        empresas: (t.restaurantIds || []).map(nomeEmpresa).filter(Boolean),
        prioCor: PRIO_COR[t.prioridade || "normal"] || PRIO_COR.normal,
        open: () => onAbrirTarefa(t.id),
      });
    }
    for (const p of prazos) {
      if (!podeVerTipo(p.tipo)) continue;
      out.push({
        key: "p_" + p.id, tipo: "prazo", titulo: p.titulo,
        data: p.vencimento ? ymdExibicao(p.vencimento) : null,
        concluido: p.status === "resolvido", cancelado: false,
        chip: PRAZO_TIPO_LABEL[p.tipo], chipCls: TIPO_COR[p.tipo],
        empresas: (p.restaurantIds || []).map(nomeEmpresa).filter(Boolean),
        valor: p.tipo === "conta" ? p.dados?.valor : undefined,
        prioCor: PRAZO_COR_HEX[p.tipo],
        open: () => onAbrirPrazo(p),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarefas, prazos, projetos, restaurants]);

  const bucketDe = (data: string | null): Bucket => {
    if (!data) return "semdata";
    if (data < hoje) return "atrasado";
    if (data === hoje) return "hoje";
    if (data <= somaDias(hoje, 7)) return "semana";
    return "depois";
  };

  const atrasadosCount = useMemo(() => itens.filter((i) => !i.concluido && !i.cancelado && bucketDe(i.data) === "atrasado").length, [itens]);

  // Aplica o filtro selecionado.
  const visiveis = useMemo(() => {
    if (filtro === "concluidas") return itens.filter((i) => i.concluido);
    const abertos = itens.filter((i) => !i.concluido && !i.cancelado);
    if (filtro === "afazer") return abertos;
    if (filtro === "atrasado") return abertos.filter((i) => bucketDe(i.data) === "atrasado");
    if (filtro === "hoje") return abertos.filter((i) => bucketDe(i.data) === "hoje");
    // próximos 7 dias (inclui hoje)
    return abertos.filter((i) => i.data && i.data >= hoje && i.data <= somaDias(hoje, 7));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, filtro, hoje]);

  // Agrupa por janela quando "A fazer"; senão lista plana por data.
  const grupos = useMemo(() => {
    const m: Record<Bucket, Norm[]> = { atrasado: [], hoje: [], semana: [], depois: [], semdata: [] };
    if (filtro === "afazer") {
      for (const i of visiveis) m[bucketDe(i.data)].push(i);
    } else {
      // uma "cesta" só (usa 'depois' como balde neutro), sem cabeçalho de grupo
      m.depois = [...visiveis];
    }
    const ordena = (a: Norm, b: Norm) => (a.data || "9999").localeCompare(b.data || "9999") || a.titulo.localeCompare(b.titulo);
    for (const b of BUCKET_ORDEM) m[b].sort(filtro === "concluidas" ? (a, x) => (x.data || "").localeCompare(a.data || "") : ordena);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiveis, filtro]);

  const chip = (id: Filtro, label: string, extra?: string) => (
    <button type="button" onClick={() => setFiltro(id)} className={`px-2.5 py-1 text-xs font-medium rounded-full border ${filtro === id ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
      {label}{extra}
    </button>
  );

  const linha = (i: Norm) => {
    const desloc = i.tipo === "prazo" && i.data && ymdExibicao(i.data) !== i.data; // já é exibido; manter simples
    return (
      <button key={i.key} type="button" onClick={i.open}
        className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 ${i.concluido ? "opacity-60" : ""}`}
        style={{ borderLeft: `4px solid ${i.prioCor}` }}>
        {i.tipo === "prazo"
          ? <AlarmClock size={15} className="shrink-0" style={{ color: i.prioCor }} />
          : <span className="w-[15px] h-[15px] rounded-full shrink-0" style={{ background: i.prioCor }} />}
        <div className="min-w-0 flex-1">
          <div className={`text-sm text-gray-800 dark:text-gray-100 truncate ${i.concluido ? "line-through" : ""}`}>{i.titulo}</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1.5 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded-full font-semibold ${i.chipCls}`}>{i.chip}</span>
            {i.empresas.slice(0, 3).join(" · ")}
          </div>
        </div>
        {i.valor != null && <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300 shrink-0">{brl(i.valor)}</span>}
        {i.data && <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400 shrink-0 text-right">{i.data.slice(8, 10)}/{i.data.slice(5, 7)} <span className="text-gray-400">{diaSemanaCurto(i.data)}</span>{desloc && <span className="text-amber-500"> ↩</span>}</span>}
      </button>
    );
  };

  const total = visiveis.length;
  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {chip("afazer", "A fazer")}
        {chip("concluidas", "Concluídas")}
        <span className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />
        {chip("atrasado", "Atrasados", atrasadosCount > 0 ? ` (${atrasadosCount})` : "")}
        {chip("hoje", "Hoje")}
        {chip("semana", "Próx. 7 dias")}
      </div>
      {total === 0 ? (
        <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Nada por aqui com esse filtro.</div>
      ) : filtro === "afazer" ? (
        <div className="space-y-4">
          {BUCKET_ORDEM.filter((b) => grupos[b].length > 0).map((b) => (
            <div key={b}>
              <div className={`text-[11px] font-bold uppercase tracking-wide mb-1.5 ${b === "atrasado" ? "text-rose-600 dark:text-rose-400" : "text-gray-400 dark:text-gray-500"}`}>{BUCKET_LABEL[b]} <span className="font-normal">({grupos[b].length})</span></div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">{grupos[b].map(linha)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">{grupos.depois.map(linha)}</div>
      )}
    </div>
  );
}
