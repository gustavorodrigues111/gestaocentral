// ════════════════════════════════════════════════════════════════════════════
//  Fechamento Financeiro Mensal
//
//  Matriz item × empresa. Cada linha é uma tarefa/relatório do fechamento
//  (com prazo e responsável); cada empresa ativa vira uma coluna de check.
//   • Config  → empresas no fechamento + itens (seções, prazo, responsável, link)
//   • Matriz  → marca o check por empresa; item "geral" tem um check único
//  O template de itens é fixo (fechamentoConfig/config). O estado dos checks é
//  por competência (fechamentoMes/{YYYY-MM}) e nasce zerado a cada mês.
//
//  Links: cada item pode apontar pra um MÓDULO interno (abre /r/<empresa>/<mod>)
//  ou, por célula, um arquivo EXTERNO (URL no Drive). Giro do fechamento = manual.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import type { Pessoa, ModuleId } from "../../core/types";

// ───────────────────────── Tipos locais do módulo ──────────────────────────
type LinkTipo = "nenhum" | "externo" | "modulo";
type FechamentoItem = {
  id: string;
  secao: string;
  titulo: string;
  responsavelId?: string | null;
  responsavelNome?: string | null;
  prazo?: string | null;              // texto relativo à competência ("dia 1", "D+3", "31/03")
  aplica?: string[];                  // restaurantIds a que se aplica; vazio = todas as ativas
  geral?: boolean;                    // check único (não quebra por empresa)
  linkTipo?: LinkTipo;
  modulo?: ModuleId | null;           // se linkTipo="modulo"
  ordem?: number;
};
type FechamentoConfig = { empresasAtivas: string[]; itens: FechamentoItem[] };
type Celula = { status?: "recebido"; obs?: string; url?: string };  // ausência de status = pendente
type FechamentoMes = { competencia: string; celulas: Record<string, Celula>; atualizadoEm?: string; atualizadoPor?: string | null };

// Módulos internos que fazem sentido linkar a partir de um item do fechamento.
const MODULOS_LINKAVEIS: { id: ModuleId; label: string }[] = [
  { id: "gorjetas", label: "Gorjetas" },
  { id: "vendas", label: "Vendas" },
  { id: "freelas", label: "Freelas" },
  { id: "recebimento", label: "Recebimento" },
  { id: "fechamentoCaixa", label: "Fechamento de Caixa" },
  { id: "faturas", label: "Faturas" },
];
const moduloLabel = (m?: ModuleId | null) => MODULOS_LINKAVEIS.find(x => x.id === m)?.label || (m ?? "");

// Modelo sugerido (do checklist de fechamento aprovado). Nasce sem responsável
// vinculado (nome livre) e aplicando a todas as empresas ativas — edite depois.
const SEED: Omit<FechamentoItem, "id" | "ordem">[] = [
  { secao: "Bancos", titulo: "Extrato Itaú", responsavelNome: "Daniel", prazo: "dia 1" },
  { secao: "Bancos", titulo: "Extrato C6", responsavelNome: "Gustavo", prazo: "dia 1", linkTipo: "externo" },
  { secao: "Inventários", titulo: "Inventário de bebidas (fim de mês)", responsavelNome: "Gustavo", prazo: "dia 1", linkTipo: "externo" },
  { secao: "DDA · até 90 dias", titulo: "Relatório de DDA mensal", responsavelNome: "Janaynna", prazo: "31", linkTipo: "externo" },
  { secao: "Gorjetas", titulo: "Gorjeta final mês a mês", responsavelNome: "Gustavo", prazo: "dia 1", linkTipo: "modulo", modulo: "gorjetas" },
  { secao: "Sócios & espécie", titulo: "Controle de mesas de sócios", responsavelNome: "Janaynna", prazo: "D+3", linkTipo: "modulo", modulo: "vendas" },
  { secao: "Sócios & espécie", titulo: "Relatório de dinheiro em espécie", responsavelNome: "Janaynna", prazo: "D+3", linkTipo: "externo" },
  { secao: "Produção & freelas", titulo: "Vendas de produção Quibebe → Lobozó", responsavelNome: "Janaynna", prazo: "D+3", linkTipo: "modulo", modulo: "vendas" },
  { secao: "Produção & freelas", titulo: "Extras de freelas", responsavelNome: "Gustavo", prazo: "D+3", linkTipo: "modulo", modulo: "freelas" },
  { secao: "Análise do assessor", titulo: "Analisar indicadores fora da média", responsavelNome: "Daniel", prazo: "D+5", geral: true },
  { secao: "Análise do assessor", titulo: "Identificar o que impacta esses indicadores", responsavelNome: "Daniel", prazo: "D+5", geral: true },
  { secao: "Análise do assessor", titulo: "Enviar lista de dúvidas para o Gustavo", responsavelNome: "Daniel", prazo: "D+6", geral: true },
];

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const uid = () => Math.random().toString(36).slice(2, 10);
const compAtual = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const compLabel = (c: string) => { const [y, m] = c.split("-"); return `${MESES[Number(m) - 1] || "?"}/${y}`; };
const compShift = (c: string, delta: number) => { const [y, m] = c.split("-").map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const cor = (i: number) => ["#b91c1c", "#0e7490", "#a16207", "#7c3aed", "#15803d", "#be185d", "#0f766e", "#c2410c"][i % 8];

export function FechamentoFinPage() {
  const { pessoa } = useAuth();
  const { restaurants, activeId } = useRestaurant();
  const { can } = useCanAcao(activeId || "");
  const podeOperar = can("fechamentoFin", "operar");
  const podeConfig = can("fechamentoFin", "configurar");
  const nav = useNavigate();

  const [config, setConfig] = useState<FechamentoConfig | null>(null);
  const [configCarregado, setConfigCarregado] = useState(false);
  const [mes, setMes] = useState<FechamentoMes | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [comp, setComp] = useState(compAtual());
  const [aba, setAba] = useState<"matriz" | "config">("matriz");
  const [editando, setEditando] = useState<FechamentoItem | "novo" | null>(null);

  // ── Assinaturas Firestore ──
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "fechamentoConfig", "config"), (snap) => {
      setConfig(snap.exists() ? (snap.data() as FechamentoConfig) : null);
      setConfigCarregado(true);
    });
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "fechamentoMes", comp), (snap) => {
      setMes(snap.exists() ? (snap.data() as FechamentoMes) : { competencia: comp, celulas: {} });
    });
    return unsub;
  }, [comp]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "pessoas"), (snap) => {
      setPessoas(snap.docs.map(d => ({ id: d.id, ...(d.data() as object) }) as Pessoa));
    });
    return unsub;
  }, []);

  const pessoaNome = useMemo(() => Object.fromEntries(pessoas.map(p => [p.id, p.nome])), [pessoas]);

  // Empresas ativas (na ordem dos restaurantes carregados), só as que ainda existem.
  const empresas = useMemo(() => {
    const ativos = new Set(config?.empresasAtivas || []);
    return restaurants.filter(r => ativos.has(r.id));
  }, [restaurants, config]);

  // Itens agrupados por seção, preservando a ordem de cadastro.
  const secoes = useMemo(() => {
    const itens = [...(config?.itens || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    const out: { nome: string; itens: FechamentoItem[] }[] = [];
    for (const it of itens) {
      let g = out.find(s => s.nome === it.secao);
      if (!g) { g = { nome: it.secao, itens: [] }; out.push(g); }
      g.itens.push(it);
    }
    return out;
  }, [config]);

  // ── Persistência ──
  async function salvarConfig(next: FechamentoConfig) {
    await setDoc(doc(db, "fechamentoConfig", "config"), sanitizeForFirestore(next));
  }
  async function salvarMes(celulas: Record<string, Celula>) {
    await setDoc(doc(db, "fechamentoMes", comp), sanitizeForFirestore({
      competencia: comp, celulas, atualizadoEm: new Date().toISOString(), atualizadoPor: pessoa?.id || null,
    }));
  }

  const chave = (itemId: string, empId: string) => `${itemId}__${empId}`;
  const cel = (itemId: string, empId: string): Celula => mes?.celulas?.[chave(itemId, empId)] || {};

  function toggleCheck(itemId: string, empId: string) {
    if (!podeOperar || !mes) return;
    const k = chave(itemId, empId);
    const atual = mes.celulas[k] || {};
    const proximo: Celula = { ...atual, status: atual.status === "recebido" ? undefined : "recebido" };
    if (!proximo.status) delete proximo.status;
    void salvarMes({ ...mes.celulas, [k]: proximo });
  }
  function setObs(itemId: string, empId: string, obs: string) {
    if (!mes) return;
    const k = chave(itemId, empId);
    const proximo: Celula = { ...(mes.celulas[k] || {}), obs: obs.trim() || undefined };
    if (!proximo.obs) delete proximo.obs;
    void salvarMes({ ...mes.celulas, [k]: proximo });
  }
  function setUrl(itemId: string, empId: string, url: string) {
    if (!mes) return;
    const k = chave(itemId, empId);
    const proximo: Celula = { ...(mes.celulas[k] || {}), url: url.trim() || undefined };
    if (!proximo.url) delete proximo.url;
    void salvarMes({ ...mes.celulas, [k]: proximo });
  }

  function aplicaNa(it: FechamentoItem, empId: string) {
    return !it.aplica || it.aplica.length === 0 || it.aplica.includes(empId);
  }

  // Progresso por empresa (itens que se aplicam, ignorando geral).
  const progresso = useMemo(() => {
    const out: Record<string, { feito: number; total: number }> = {};
    for (const e of empresas) {
      let feito = 0, total = 0;
      for (const s of secoes) for (const it of s.itens) {
        if (it.geral || !aplicaNa(it, e.id)) continue;
        total++; if (cel(it.id, e.id).status === "recebido") feito++;
      }
      out[e.id] = { feito, total };
    }
    return out;
  }, [empresas, secoes, mes]);

  // ── Estados de carga / vazio ──
  if (!configCarregado) {
    return <div className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">Carregando…</div>;
  }

  const semConfig = !config || (config.itens || []).length === 0;

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">🧮 Fechamento Financeiro</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Matriz item × empresa — nasce zerado a cada mês.</p>
        </div>
        {/* Seletor de competência */}
        <div className="flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button className="px-3 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100" onClick={() => setComp(compShift(comp, -1))} title="Mês anterior">‹</button>
          <span className="px-2 py-2 text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums min-w-[120px] text-center">{compLabel(comp)}</span>
          <button className="px-3 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100" onClick={() => setComp(compShift(comp, 1))} title="Próximo mês">›</button>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        {([["matriz", "Fechamento"], ["config", "Configurações"]] as const).map(([id, label]) => (
          (id === "config" && !podeConfig) ? null : (
            <button key={id} onClick={() => setAba(id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${aba === id ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
              {label}
            </button>
          )
        ))}
      </div>

      {/* ─────────────────────────────── MATRIZ ─────────────────────────────── */}
      {aba === "matriz" && (
        semConfig ? (
          <EmptyState podeConfig={podeConfig}
            onSeed={() => salvarConfig({ empresasAtivas: restaurants.map(r => r.id), itens: SEED.map((s, i) => ({ ...s, id: uid(), ordem: i })) })}
            onZero={() => { salvarConfig({ empresasAtivas: restaurants.map(r => r.id), itens: [] }); setAba("config"); }} />
        ) : empresas.length === 0 ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-300">
            Nenhuma empresa no fechamento. {podeConfig ? "Ative empresas em Configurações." : "Peça a um gestor pra ativar as empresas."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/60">
                  <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900/60 text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-200 min-w-[240px]">Tarefa</th>
                  <th className="text-left px-2 py-2 font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Prazo</th>
                  <th className="text-left px-2 py-2 font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Responsável</th>
                  {empresas.map((e, i) => (
                    <th key={e.id} className="px-2 py-2 text-center font-semibold whitespace-nowrap" style={{ color: cor(i) }} title={e.nome}>
                      {e.nome}
                      <div className="text-[10px] font-normal text-gray-400 tabular-nums">
                        {progresso[e.id]?.feito ?? 0}/{progresso[e.id]?.total ?? 0}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {secoes.map(s => (
                  <SecaoRows key={s.nome} secao={s} empresas={empresas} cel={cel} aplicaNa={aplicaNa}
                    podeOperar={podeOperar} toggleCheck={toggleCheck} setObs={setObs} setUrl={setUrl}
                    pessoaNome={pessoaNome} nav={nav} />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ────────────────────────────── CONFIG ─────────────────────────────── */}
      {aba === "config" && podeConfig && (
        <div className="space-y-6">
          {/* Empresas */}
          <section className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">Empresas no fechamento</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Cada empresa ativa vira uma coluna de check na matriz.</p>
            <div className="flex flex-wrap gap-2">
              {restaurants.map(r => {
                const on = (config?.empresasAtivas || []).includes(r.id);
                return (
                  <button key={r.id}
                    onClick={() => {
                      const base = config || { empresasAtivas: [], itens: [] };
                      const set = new Set(base.empresasAtivas);
                      if (on) set.delete(r.id); else set.add(r.id);
                      void salvarConfig({ ...base, empresasAtivas: restaurants.filter(x => set.has(x.id)).map(x => x.id) });
                    }}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-700"}`}>
                    {on ? "✓ " : ""}{r.nome}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Itens */}
          <section className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Itens do fechamento</h3>
              <Button size="sm" onClick={() => setEditando("novo")}>+ Adicionar item</Button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Repetem todo mês. Ao virar a competência, o checklist nasce zerado a partir daqui. Item <b>geral</b> tem um check único (sem quebra por empresa).
            </p>
            {(config?.itens || []).length === 0 ? (
              <p className="text-sm text-gray-400 italic">Nenhum item ainda. {config ? "" : <button className="text-indigo-600 underline" onClick={() => salvarConfig({ empresasAtivas: restaurants.map(r => r.id), itens: SEED.map((s, i) => ({ ...s, id: uid(), ordem: i })) })}>Usar modelo sugerido</button>}</p>
            ) : (
              <div className="space-y-4">
                {secoes.map(s => (
                  <div key={s.nome}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">{s.nome}</div>
                    <div className="space-y-1">
                      {s.itens.map(it => (
                        <div key={it.id} className="group flex items-center gap-2 rounded-md border border-gray-200 dark:border-gray-800 px-3 py-2 hover:border-indigo-300">
                          <button className="flex-1 text-left" onClick={() => setEditando(it)}>
                            <span className="text-sm text-gray-900 dark:text-gray-100">{it.titulo}</span>
                            {it.geral && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">geral</span>}
                            {it.linkTipo === "modulo" && <span className="ml-2 text-[10px] text-indigo-600 dark:text-indigo-400">↗ {moduloLabel(it.modulo)}</span>}
                            {it.linkTipo === "externo" && <span className="ml-2 text-[10px] text-gray-500">🔗 arquivo</span>}
                          </button>
                          <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">{it.prazo || "—"}</span>
                          <span className="text-xs text-gray-500 whitespace-nowrap">{it.responsavelId ? (pessoaNome[it.responsavelId] || "?") : (it.responsavelNome || "—")}</span>
                          <button className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 px-1" title="Excluir item"
                            onClick={() => { if (!config) return; void salvarConfig({ ...config, itens: config.itens.filter(x => x.id !== it.id) }); }}>✕</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {editando && config && (
        <ItemModal item={editando === "novo" ? null : editando} pessoas={pessoas} secoesExistentes={secoes.map(s => s.nome)}
          onClose={() => setEditando(null)}
          onSave={(it) => {
            const base = config;
            const existe = base.itens.some(x => x.id === it.id);
            const itens = existe ? base.itens.map(x => x.id === it.id ? it : x) : [...base.itens, { ...it, ordem: base.itens.length }];
            void salvarConfig({ ...base, itens });
            setEditando(null);
          }} />
      )}
    </div>
  );
}

// ───────────────────────── Linhas de uma seção ─────────────────────────────
function SecaoRows({ secao, empresas, cel, aplicaNa, podeOperar, toggleCheck, setObs, setUrl, pessoaNome, nav }: {
  secao: { nome: string; itens: FechamentoItem[] };
  empresas: { id: string; nome: string }[];
  cel: (itemId: string, empId: string) => Celula;
  aplicaNa: (it: FechamentoItem, empId: string) => boolean;
  podeOperar: boolean;
  toggleCheck: (itemId: string, empId: string) => void;
  setObs: (itemId: string, empId: string, v: string) => void;
  setUrl: (itemId: string, empId: string, v: string) => void;
  pessoaNome: Record<string, string>;
  nav: (to: string) => void;
}) {
  const nCols = 3 + empresas.length;
  return (
    <>
      <tr>
        <td colSpan={nCols} className="sticky left-0 bg-gray-100/70 dark:bg-gray-800/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {secao.nome}
        </td>
      </tr>
      {secao.itens.map(it => (
        <tr key={it.id} className="border-t border-gray-100 dark:border-gray-800/70 hover:bg-gray-50/60 dark:hover:bg-gray-900/40">
          <td className="sticky left-0 z-[1] bg-white dark:bg-gray-950 px-3 py-2 text-gray-900 dark:text-gray-100 align-top">
            <div className="flex items-start gap-1.5">
              <span>{it.titulo}</span>
              {it.geral && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 shrink-0">geral</span>}
            </div>
          </td>
          <td className="px-2 py-2 text-gray-500 tabular-nums whitespace-nowrap align-top">{it.prazo || "—"}</td>
          <td className="px-2 py-2 text-gray-500 whitespace-nowrap align-top">{it.responsavelId ? (pessoaNome[it.responsavelId] || "?") : (it.responsavelNome || "—")}</td>
          {it.geral ? (
            <td colSpan={empresas.length} className="px-2 py-2 text-center align-top">
              <Check on={cel(it.id, "geral").status === "recebido"} podeOperar={podeOperar} onClick={() => toggleCheck(it.id, "geral")} />
            </td>
          ) : (
            empresas.map(e => {
              const aplica = aplicaNa(it, e.id);
              const c = cel(it.id, e.id);
              return (
                <td key={e.id} className="px-2 py-2 text-center align-top">
                  {!aplica ? (
                    <span className="text-gray-300 dark:text-gray-700" title="Não se aplica">–</span>
                  ) : (
                    <div className="flex flex-col items-center gap-0.5">
                      <Check on={c.status === "recebido"} podeOperar={podeOperar} onClick={() => toggleCheck(it.id, e.id)} />
                      {it.linkTipo === "modulo" && it.modulo && (
                        <button className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline" title={`Abrir ${moduloLabel(it.modulo)} de ${e.nome}`}
                          onClick={() => nav(`/r/${e.id}/${it.modulo}`)}>↗</button>
                      )}
                      {it.linkTipo === "externo" && (
                        c.url
                          ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-500 hover:underline" title={c.url}>🔗</a>
                          : podeOperar && <button className="text-[10px] text-gray-300 hover:text-gray-500" title="Anexar link do arquivo"
                              onClick={() => { const v = prompt(`Link do arquivo (${it.titulo} · ${e.nome}):`, ""); if (v != null) setUrl(it.id, e.id, v); }}>+link</button>
                      )}
                      {podeOperar && (
                        <button className="text-[10px] text-gray-300 hover:text-gray-500" title={c.obs ? `Obs: ${c.obs}` : "Observação"}
                          onClick={() => { const v = prompt(`Observação (${it.titulo} · ${e.nome}):`, c.obs || ""); if (v != null) setObs(it.id, e.id, v); }}>
                          {c.obs ? "💬" : "·"}
                        </button>
                      )}
                    </div>
                  )}
                </td>
              );
            })
          )}
        </tr>
      ))}
    </>
  );
}

function Check({ on, podeOperar, onClick }: { on: boolean; podeOperar: boolean; onClick: () => void }) {
  return (
    <button disabled={!podeOperar} onClick={onClick}
      className={`w-7 h-7 rounded-md border flex items-center justify-center text-sm font-bold transition-colors ${
        on ? "bg-green-600 border-green-600 text-white"
           : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-300 dark:text-gray-600"
      } ${podeOperar ? "hover:border-green-500 cursor-pointer" : "cursor-default"}`}
      title={on ? "Recebido — clique pra desmarcar" : "Pendente — clique pra marcar recebido"}>
      {on ? "✓" : ""}
    </button>
  );
}

// ───────────────────────── Empty state (matriz) ────────────────────────────
function EmptyState({ podeConfig, onSeed, onZero }: { podeConfig: boolean; onSeed: () => void; onZero: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
      <div className="text-4xl mb-2">🧮</div>
      <h3 className="font-semibold text-gray-900 dark:text-gray-100">Ainda não há itens de fechamento</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">Comece pelo modelo sugerido (você edita tudo depois) ou monte do zero.</p>
      {podeConfig ? (
        <div className="flex items-center justify-center gap-2">
          <Button onClick={onSeed}>Usar modelo sugerido</Button>
          <Button variant="secondary" onClick={onZero}>Começar do zero</Button>
        </div>
      ) : (
        <p className="text-sm text-gray-400">Peça a um gestor pra configurar os itens.</p>
      )}
    </div>
  );
}

// ───────────────────────── Modal de item (add/editar) ──────────────────────
function ItemModal({ item, pessoas, secoesExistentes, onClose, onSave }: {
  item: FechamentoItem | null;
  pessoas: Pessoa[];
  secoesExistentes: string[];
  onClose: () => void;
  onSave: (it: FechamentoItem) => void;
}) {
  const [secao, setSecao] = useState(item?.secao || "");
  const [titulo, setTitulo] = useState(item?.titulo || "");
  const [prazo, setPrazo] = useState(item?.prazo || "");
  const [geral, setGeral] = useState(!!item?.geral);
  const [linkTipo, setLinkTipo] = useState<LinkTipo>(item?.linkTipo || "nenhum");
  const [modulo, setModulo] = useState<ModuleId | "">(item?.modulo || "");
  const [respId, setRespId] = useState<string | null>(item?.responsavelId || null);
  const [respNome, setRespNome] = useState(item?.responsavelNome || "");
  const [busca, setBusca] = useState(item?.responsavelId ? (pessoas.find(p => p.id === item.responsavelId)?.nome || "") : (item?.responsavelNome || ""));
  const [aberto, setAberto] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const sugestoes = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return pessoas.slice(0, 8);
    return pessoas.filter(p => p.nome.toLowerCase().includes(q)).slice(0, 8);
  }, [busca, pessoas]);

  function salvar() {
    if (!secao.trim() || !titulo.trim()) return;
    onSave({
      id: item?.id || uid(),
      secao: secao.trim(),
      titulo: titulo.trim(),
      prazo: prazo.trim() || null,
      geral,
      responsavelId: respId,
      responsavelNome: respId ? null : (respNome.trim() || null),
      linkTipo,
      modulo: linkTipo === "modulo" ? (modulo || null) : null,
      aplica: item?.aplica,
      ordem: item?.ordem,
    });
  }

  const inputCls = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100";

  return (
    <Modal title={item ? "Editar item" : "Novo item"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Seção *</label>
          <input list="secoes-fech" className={inputCls} value={secao} onChange={e => setSecao(e.target.value)} placeholder="Ex.: Bancos, Inventários…" />
          <datalist id="secoes-fech">{secoesExistentes.map(s => <option key={s} value={s} />)}</datalist>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Tarefa *</label>
          <input className={inputCls} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex.: Extrato Itaú" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Prazo</label>
            <input className={inputCls} value={prazo} onChange={e => setPrazo(e.target.value)} placeholder="dia 1 · D+3 · 31" />
          </div>
          <div ref={boxRef} className="relative">
            <label className="block text-xs font-medium text-gray-500 mb-1">Responsável</label>
            <input className={inputCls} value={busca} onFocus={() => setAberto(true)}
              onChange={e => { setBusca(e.target.value); setRespId(null); setRespNome(e.target.value); setAberto(true); }}
              placeholder="Buscar pessoa…" />
            {aberto && sugestoes.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg max-h-52 overflow-y-auto">
                {sugestoes.map(p => (
                  <button key={p.id} className="block w-full text-left px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                    onClick={() => { setRespId(p.id); setRespNome(""); setBusca(p.nome); setAberto(false); }}>
                    {p.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={geral} onChange={e => setGeral(e.target.checked)} />
          Item geral (check único, sem quebra por empresa)
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Link</label>
            <select className={inputCls} value={linkTipo} onChange={e => setLinkTipo(e.target.value as LinkTipo)}>
              <option value="nenhum">Nenhum</option>
              <option value="externo">Arquivo externo (por empresa)</option>
              <option value="modulo">Módulo interno</option>
            </select>
          </div>
          {linkTipo === "modulo" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Módulo</label>
              <select className={inputCls} value={modulo} onChange={e => setModulo(e.target.value as ModuleId)}>
                <option value="">Escolha…</option>
                {MODULOS_LINKAVEIS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={!secao.trim() || !titulo.trim()}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}
