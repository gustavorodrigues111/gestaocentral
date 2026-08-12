// ════════════════════════════════════════════════════════════════════════════
//  Chat — Central de Avisos (Fase C2.2)
//
//  Futura TELA DE ABERTURA do planejamento.app. Reúne tudo que precisa da
//  atenção do usuário, de várias fontes derivadas das coleções dos módulos,
//  filtradas pela permissão `receberAvisos` de cada módulo (transversal a
//  todos os restaurantes do usuário).
//
//  O cálculo das fontes vive em useAvisos (provider no shell) pra Sidebar e
//  esta página compartilharem o MESMO resultado — badge bate com o feed.
//  Aqui é só a renderização + o modal de leitura do Fale com DP.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { tratarFaleDp } from "../faleDp/repository";
import { concluirRotina } from "../rotinas/repository";
import { useAvisosCentral, type Aviso } from "./useAvisos";
import { WhatsappTemplatesTab } from "../whatsapp/WhatsappTemplatesTab";
import { CentralConfig } from "./CentralConfig";
import type { FaleDpMensagem, Pessoa } from "../../core/types";
import { FALE_DP_CATEGORIA_LABEL, FALE_DP_CATEGORIA_ICONE } from "../../core/types";

type AbaCentral = "semana" | "avisos" | "whatsapp" | "historico" | "config";

// ── Helpers de semana (datas locais, sem UTC drift) ──
const fmtYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ymdHoje = () => fmtYmd(new Date());
const addYmd = (ymd: string, n: number) => { const d = new Date(ymd + "T00:00:00"); d.setDate(d.getDate() + n); return fmtYmd(d); };
const segundaDaSemana = (ymd: string) => { const d = new Date(ymd + "T00:00:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return fmtYmd(d); };
const WD = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
// Cor por categoria (rótulo do módulo de origem do aviso).
const CAT_COR: Record<string, string> = {
  "Prazos": "#0369a1", "Rotinas": "#7c3aed", "Vendas": "#0f766e", "Faturas": "#7c3aed",
  "Monitor de falhas": "#dc2626", "Enviados a você": "#b45309", "Fechamento Financeiro": "#0f766e",
  "Reuniões": "#be185d", "Tarefas": "#4f46e5", "Checklists": "#15803d", "Wiki de Processos": "#0891b2",
  "Fale com DP": "#b45309",
};
const catCor = (c: string) => CAT_COR[c] || "#64748b";

export function ChatPage() {
  const { pessoa } = useAuth();
  const { restaurants, activeRestaurant, setActiveId } = useRestaurant();
  const navigate = useNavigate();
  const { inbox, historico, todos, marcarLido, marcarNaoLido, marcarTodosLidos } = useAvisosCentral();

  const isMaster = !!pessoa?.isMaster;
  const { can } = useCanAcao(activeRestaurant?.id || "");
  // "WhatsApp do sistema" = número da API oficial (disparos/templates).
  const podeSistema = isMaster || can("whatsapp", "configurar");
  const podeConfig = isMaster || can("whatsapp", "configurar");

  const multiRest = restaurants.length > 1;
  const [aba, setAba] = useState<AbaCentral>("semana");
  const lidosIds = useMemo(() => new Set(historico.map(a => a.id)), [historico]);
  const [filtroRestAvisos, setFiltroRestAvisos] = useState<string>("all");
  const [msgAberta, setMsgAberta] = useState<{ msg: FaleDpMensagem; nome: string } | null>(null);

  // Avisos filtrados por restaurante (chips na aba Avisos do sistema).
  const inboxVis = useMemo(() => filtroRestAvisos === "all" ? inbox : inbox.filter(a => a.restauranteId === filtroRestAvisos), [inbox, filtroRestAvisos]);


  // Pessoas do restaurante ativo (pra config de destinatários dos avisos).
  const [pessoasRest, setPessoasRest] = useState<Pessoa[]>([]);
  useEffect(() => {
    const rid = activeRestaurant?.id;
    if (!rid || !podeConfig) { setPessoasRest([]); return; }
    const u = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)), snap =>
      setPessoasRest(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa).filter(p => p.ativa !== false)));
    return () => u();
  }, [activeRestaurant?.id, podeConfig]);

  // Histórico agrupado por categoria (módulo).
  const gruposHistorico = useMemo(() => {
    const m = new Map<string, { icone: string; itens: Aviso[] }>();
    for (const a of historico) {
      const g = m.get(a.categoria) || { icone: a.categoriaIcone, itens: [] };
      g.itens.push(a);
      m.set(a.categoria, g);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [historico]);

  function abrirAviso(a: Aviso) {
    if (a.faleDp) { setMsgAberta({ msg: a.faleDp, nome: a.restauranteNome }); return; }
    if (a.href) {
      if (/^https?:\/\//i.test(a.href)) { window.open(a.href, "_blank", "noopener"); return; }
      if (a.restauranteId !== activeRestaurant?.id) setActiveId(a.restauranteId);
      navigate(a.href);
    }
  }

  async function concluirRotinaAviso(a: Aviso) {
    if (!a.rotina || !pessoa) return;
    await concluirRotina(a.rotina.rotina, a.rotina.ocorrenciaData, pessoa.id, pessoa.nome);
  }

  return (
    <div className={`p-4 sm:p-6 mx-auto ${aba === "semana" ? "max-w-6xl" : "max-w-3xl"}`}>
      <header className="mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          🎛️ Minha Central
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Tudo que é seu, no dia certo{multiRest ? " — em todos os seus restaurantes" : ""}.
          {inbox.length > 0 && (
            <span className="ml-1">{inbox.length} {inbox.length === 1 ? "pendência" : "pendências"} na caixa.</span>
          )}
        </p>
      </header>

      {/* Abas */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200 dark:border-gray-800 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {([
          { k: "semana" as const, label: "🗓️ Minha Semana", n: 0, alerta: false },
          { k: "avisos" as const, label: "📥 Avisos do sistema", n: inbox.length, alerta: true },
          ...(podeSistema ? [{ k: "whatsapp" as const, label: "📣 WhatsApp do sistema", n: 0, alerta: false }] : []),
          { k: "historico" as const, label: "🗂️ Histórico", n: historico.length, alerta: false },
          ...(podeConfig ? [{ k: "config" as const, label: "⚙️ Configurações", n: 0, alerta: false }] : []),
        ]).map((t) => (
          <button
            key={t.k}
            onClick={() => setAba(t.k)}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0 ${
              aba === t.k
                ? "border-indigo-600 text-indigo-700 dark:text-indigo-300"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
            {t.n > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                t.alerta ? "bg-red-500 text-white" : (aba === t.k ? "bg-indigo-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300")
              }`}>{t.n}</span>
            )}
          </button>
        ))}
      </div>

      {aba === "semana" && (
        <SemanaView
          todos={todos} lidosIds={lidosIds} multiRest={multiRest}
          onAbrir={abrirAviso} marcarLido={marcarLido} concluirRotina={concluirRotinaAviso}
        />
      )}

      {aba === "avisos" && (
        inbox.length === 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center">
            <div className="text-4xl mb-3">✨</div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Tudo em dia</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Nenhum aviso pendente pra você por aqui.</p>
          </div>
        ) : (
          <>
            {multiRest && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                <ChipRest ativo={filtroRestAvisos === "all"} onClick={() => setFiltroRestAvisos("all")}>Todos</ChipRest>
                {restaurants.map(r => (
                  <ChipRest key={r.id} ativo={filtroRestAvisos === r.id} onClick={() => setFiltroRestAvisos(r.id)}>{r.nome}</ChipRest>
                ))}
              </div>
            )}
            <div className="flex justify-end mb-2">
              <button
                onClick={marcarTodosLidos}
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                ✓ Marcar todos como lidos
              </button>
            </div>
            {inboxVis.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Nenhum aviso nesse restaurante.</div>
            ) : (
              <div className="space-y-2.5">
                {inboxVis.map((a) => (
                  <AvisoCard
                    key={a.id} aviso={a} multiRest={multiRest}
                    onAbrir={() => abrirAviso(a)}
                    acao={a.rotina
                      ? { label: "Marcar como feita", icone: "✓", onClick: () => concluirRotinaAviso(a) }
                      : { label: "Marcar como lido", icone: "✓", onClick: () => marcarLido(a) }}
                  />
                ))}
              </div>
            )}
          </>
        )
      )}

      {aba === "whatsapp" && podeSistema && (
        <div>
          <div className="mb-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 p-3">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">📣 WhatsApp do sistema (API oficial)</div>
            <p className="text-xs text-gray-500 mt-0.5">Número da API da Meta usado pelos <b>disparos automáticos</b> do sistema (lembretes, fechamento, cobranças). O atendimento pelos números conectados fica no módulo <b>WhatsApp</b>.</p>
          </div>
          <WhatsappTemplatesTab podeConfig={podeConfig} />
        </div>
      )}

      {aba === "config" && podeConfig && (
        <CentralConfig
          rid={activeRestaurant?.id || ""}
          restauranteNome={activeRestaurant?.nome || "—"}
          pessoas={pessoasRest}
          modulosAtivos={activeRestaurant?.modulosAtivos || []}
          meId={pessoa?.id || ""}
          podeConfig={podeConfig}
        />
      )}

      {aba === "historico" && (
        historico.length === 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center">
            <div className="text-4xl mb-3">🗂️</div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Histórico vazio</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Avisos que você marcar como lidos aparecem aqui, por módulo.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {gruposHistorico.map(([categoria, g]) => (
              <div key={categoria}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-base leading-none">{g.icone}</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{categoria}</span>
                  <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">({g.itens.length})</span>
                </div>
                <div className="space-y-2.5">
                  {g.itens.map((a) => (
                    <AvisoCard
                      key={a.id} aviso={a} multiRest={multiRest} lido
                      onAbrir={() => abrirAviso(a)}
                      acao={{ label: "Voltar pra caixa de entrada", icone: "↩︎", onClick: () => marcarNaoLido(a) }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {msgAberta && (
        <FaleDpModal
          msg={msgAberta.msg}
          restauranteNome={msgAberta.nome}
          pessoaId={pessoa?.id || ""}
          pessoaNome={pessoa?.nome || ""}
          onClose={() => setMsgAberta(null)}
        />
      )}
    </div>
  );
}

// ─── Minha Semana — calendário que agrega tudo do usuário por dia ───────────
function SemanaView({ todos, lidosIds, multiRest, onAbrir, marcarLido, concluirRotina }: {
  todos: Aviso[];
  lidosIds: Set<string>;
  multiRest: boolean;
  onAbrir: (a: Aviso) => void;
  marcarLido: (a: Aviso) => void;
  concluirRotina: (a: Aviso) => void;
}) {
  const navigate = useNavigate();
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const { can } = useCanAcao(activeRestaurant?.id || "");
  const [ref, setRef] = useState(ymdHoje());
  const hoje = ymdHoje();
  const seg = useMemo(() => segundaDaSemana(ref), [ref]);
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => addYmd(seg, i)), [seg]);
  const fim = dias[6];

  // Bucketiza os avisos por dia; fora da semana e vencidos/sem-data caem no topo.
  const { porDia, atrasados } = useMemo(() => {
    const pd: Record<string, Aviso[]> = {}; dias.forEach(d => (pd[d] = []));
    const atr: Aviso[] = [];
    for (const a of todos) {
      const em = (a.em || "").slice(0, 10);
      const semData = !a.em || a.em >= "9999";
      if (semData) { if (!lidosIds.has(a.id)) atr.push(a); continue; }
      if (em >= seg && em <= fim) pd[em].push(a);
      else if (em < hoje && !lidosIds.has(a.id)) atr.push(a);
    }
    Object.values(pd).forEach(arr => arr.sort((x, y) => (x.em || "").localeCompare(y.em || "")));
    atr.sort((x, y) => (x.em || "").localeCompare(y.em || ""));
    return { porDia: pd, atrasados: atr };
  }, [todos, dias, seg, fim, hoje, lidosIds]);

  const rangeLabel = `${Number(seg.slice(8))} – ${Number(fim.slice(8))} de ${MES_CURTO[Number(fim.slice(5, 7)) - 1]}`;
  const onCheck = (a: Aviso) => (a.rotina ? concluirRotina(a) : marcarLido(a));

  // Botões de ação — só dos módulos que a pessoa pode acessar.
  const podeVer = (mod: string, ...acts: string[]) => acts.some(x => can(mod, x));
  // Modo de tarefa por usuário: simplificado abre a lente da operação; avançado o Gestor.
  const tarefaMod = pessoa?.modoTarefa === "simplificado" ? "planoDeAcao" : "tarefas";
  const acoes = [
    { mod: tarefaMod, label: "+ Tarefa", cor: "#4f46e5", ok: podeVer("tarefas", "verProprias", "criar", "editarTodas") || podeVer("planoDeAcao", "ver", "operar", "concluir") },
    { mod: "prazos", label: "+ Prazo", cor: "#0369a1", ok: podeVer("prazos", "ver", "criar", "operar") },
    { mod: "fechamentoFin", label: "Fechamento", cor: "#0f766e", ok: podeVer("fechamentoFin", "ver", "operar") },
    { mod: "checklists", label: "Checklists", cor: "#15803d", ok: podeVer("checklists", "ver", "operar") },
  ].filter(a => a.ok);

  return (
    <div>
      {/* Barra: navegação de semana + ações */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <button className="px-3 py-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100" onClick={() => setRef(addYmd(seg, -7))} title="Semana anterior">‹</button>
            <span className="px-2 text-sm font-semibold text-gray-800 dark:text-gray-100 min-w-[130px] text-center">{rangeLabel}</span>
            <button className="px-3 py-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100" onClick={() => setRef(addYmd(seg, 7))} title="Próxima semana">›</button>
          </div>
          <button className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-200" onClick={() => setRef(ymdHoje())}>Hoje</button>
        </div>
        {acoes.length > 0 && activeRestaurant && (
          <div className="flex flex-wrap gap-1.5">
            {acoes.map(a => (
              <button key={a.mod} onClick={() => navigate(`/r/${activeRestaurant.id}/${a.mod}`)}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:border-indigo-400">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.cor }} />{a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Atrasados & sem data */}
      {atrasados.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-300 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 p-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-500 mb-1.5 px-1">⚠️ Atrasados & sem data ({atrasados.length})</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {atrasados.slice(0, 12).map(a => (
              <MiniCard key={a.id} a={a} lido={lidosIds.has(a.id)} multiRest={multiRest} onAbrir={() => onAbrir(a)} onCheck={() => onCheck(a)} />
            ))}
          </div>
        </div>
      )}

      {/* Grade da semana */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
        {dias.map(d => {
          const ehHoje = d === hoje;
          const itens = porDia[d];
          return (
            <div key={d} className={`rounded-xl border min-h-[120px] md:min-h-[300px] flex flex-col overflow-hidden ${ehHoje ? "border-amber-400 dark:border-amber-600 bg-amber-50/40 dark:bg-amber-950/10" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
              <div className="px-2.5 py-2 border-b border-gray-100 dark:border-gray-800/70 flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wide font-bold text-gray-400">{WD[dias.indexOf(d)]}</span>
                <span className={`text-sm font-extrabold ${ehHoje ? "text-amber-600 dark:text-amber-500" : "text-gray-800 dark:text-gray-100"}`}>
                  {Number(d.slice(8))}{ehHoje && <span className="ml-1 text-[8px] align-middle font-black text-white bg-amber-500 rounded-full px-1.5 py-0.5">HOJE</span>}
                </span>
              </div>
              <div className="p-1.5 flex flex-col gap-1.5 flex-1">
                {itens.length === 0
                  ? <span className="text-[11px] text-gray-300 dark:text-gray-700 m-auto">—</span>
                  : itens.map(a => <MiniCard key={a.id} a={a} lido={lidosIds.has(a.id)} multiRest={multiRest} onAbrir={() => onAbrir(a)} onCheck={() => onCheck(a)} />)}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3 px-1">
        Cada card vem de um módulo (Prazos, Fechamento, Rotinas, Tarefas, Avisos…) filtrado por você. Marcar ✓ dá baixa no módulo de origem.
      </p>
    </div>
  );
}

function MiniCard({ a, lido, multiRest, onAbrir, onCheck }: {
  a: Aviso; lido: boolean; multiRest: boolean; onAbrir: () => void; onCheck: () => void;
}) {
  const cor = catCor(a.categoria);
  const vencido = !lido && a.em && a.em < ymdHoje() && a.em < "9999";
  return (
    <div onClick={onAbrir} style={{ borderLeftColor: vencido ? "#dc2626" : cor }}
      className={`group border border-gray-100 dark:border-gray-800 border-l-[3px] rounded-lg px-2 py-1.5 cursor-pointer bg-gray-50/60 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-800 ${lido ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-1.5">
        <button onClick={(e) => { e.stopPropagation(); onCheck(); }} title={lido ? "Concluído" : "Marcar como feito"}
          style={{ borderColor: cor, background: lido ? cor : "transparent" }}
          className="shrink-0 mt-0.5 w-4 h-4 rounded-[5px] border-[1.5px] flex items-center justify-center text-[10px] text-white leading-none">{lido ? "✓" : ""}</button>
        <div className="min-w-0 flex-1">
          <div className={`text-[12px] font-medium leading-tight ${lido ? "line-through text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>{a.titulo}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: vencido ? "#dc2626" : cor }}>{a.categoria}</span>
            {multiRest && <span className="text-[9px] text-gray-400 truncate max-w-[90px]">{a.restauranteNome}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipRest({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${ativo ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>{children}</button>
  );
}

// ─── Card de aviso (usado na caixa de entrada e no histórico) ───────────────
// Container é <div> (não <button>) pra poder ter um botão de ação dentro sem
// aninhar botões. Clique no corpo abre o destino; o botão de ação (lido / não
// lido) usa stopPropagation.

function AvisoCard({
  aviso: a, multiRest, lido, onAbrir, acao,
}: {
  aviso: Aviso;
  multiRest: boolean;
  lido?: boolean;
  onAbrir: () => void;
  acao: { label: string; icone: string; onClick: () => void };
}) {
  return (
    <div
      onClick={onAbrir}
      className={`w-full text-left flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-800 transition-colors p-4 cursor-pointer ${
        lido
          ? "bg-gray-50/60 dark:bg-gray-900/40 hover:bg-gray-100 dark:hover:bg-gray-800/60"
          : "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60"
      }`}
    >
      <span className={`text-xl leading-none mt-0.5 ${lido ? "opacity-60" : ""}`}>{a.icone}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${lido ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>{a.titulo}</span>
          {multiRest && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
              🏠 {a.restauranteNome}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{a.descricao}</div>
        <div className={`text-[11px] font-medium mt-2 ${lido ? "text-gray-400 dark:text-gray-500" : "text-indigo-600 dark:text-indigo-400"}`}>{a.cta} →</div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); acao.onClick(); }}
        title={acao.label}
        aria-label={acao.label}
        className="shrink-0 self-center w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
      >
        {acao.icone}
      </button>
    </div>
  );
}

// ─── Modal de leitura + tratar do Fale com DP ───────────────────────────────

function FaleDpModal({
  msg, restauranteNome, pessoaId, pessoaNome, onClose,
}: {
  msg: FaleDpMensagem;
  restauranteNome: string;
  pessoaId: string;
  pessoaNome: string;
  onClose: () => void;
}) {
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function tratar() {
    setSalvando(true);
    try {
      await tratarFaleDp(msg.id, pessoaId, pessoaNome, nota);
      onClose();
    } catch (e) {
      console.error(e);
      setSalvando(false);
    }
  }

  const dt = msg.criadoEm ? new Date(msg.criadoEm).toLocaleString("pt-BR") : "";

  return (
    <Modal onClose={onClose} title={`${FALE_DP_CATEGORIA_ICONE[msg.categoria]} Fale com DP · ${FALE_DP_CATEGORIA_LABEL[msg.categoria]}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded font-semibold bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
            🏠 {restauranteNome}
          </span>
          {msg.anonimo ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
              🕶️ Anônimo
            </span>
          ) : (
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {msg.autorNome}{msg.cargoNome ? ` · ${msg.cargoNome}` : ""}
            </span>
          )}
          {dt && <span>· {dt}</span>}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 p-3 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
          {msg.texto}
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            Observação ao tratar (opcional)
          </label>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={2}
            placeholder="Ex: conversado com a equipe, encaminhado pro sócio…"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button onClick={tratar} disabled={salvando}>
            {salvando ? "Salvando…" : "Marcar como tratada"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
