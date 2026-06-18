// ════════════════════════════════════════════════════════════════════════════
//  Análise de Ponto — módulo NOVO (lado a lado com "Registros de Ponto"/Exceções,
//  que será aposentado depois). Motor determinístico sobre a API Sólides:
//  carga prevista × trabalhada + saldo do período (jornada flexível), com as
//  ocorrências divididas em duas categorias de AÇÃO: A Corrigir × A Avaliar.
//
//  Fluxo central: o EMPREGADO corrige no app dele → a gente APROVA. Correção
//  manual (editar/excluir batida) é exceção, em aba à parte com permissão própria.
//
//  Aba Inconsistências: agrupado por empregado, seleciono apontamentos → mando
//  UMA mensagem de WhatsApp com prazo (config, default 6h) → relógio no nome.
//  "Ciente / sem ação" tira da lista (registra quem avaliou). Estado persiste
//  em pontoSolicitacoes / pontoAvaliacoes (a análise em si é recalculada do zero).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { AREAS, type Area, type Cargo, type Empregado } from "../../core/types";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { fetchPunches } from "../../core/excecoes/solidesClient";
import {
  fetchScheduleCatalog, fetchRoster, fetchJustificativas, corrigirPontoAtraso,
  type Justificativa,
} from "../../core/ponto/solidesPontoClient";
import {
  analisarPonto, CAT_LABEL, ROTULOS, type Categoria, type Ocorrencia,
  type PontoColaborador, type PontoMarcacao, type ResultadoAnalise, type Severidade,
  type TipoOcorrencia,
} from "../../core/ponto/analise";

import { EscalasComparacaoTab } from "./EscalasComparacaoTab";

const soDigitos = (s?: string | null) => (s || "").replace(/\D/g, "");

const pad = (n: number) => String(n).padStart(2, "0");
const fmtYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Converte qualquer YYYY-MM-DD (inclusive dentro de "X a Y") → DD/MM/YYYY.
const fmtBR = (s: string) => s.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2/$1");

// Identidade estável de uma ocorrência (pra casar com solicitações / avaliações).
const ocKey = (o: Ocorrencia) => `${o.employeeId}|${o.data}|${o.tipo}`;

const SEV_COR: Record<Severidade, string> = {
  alta: "bg-red-500",
  media: "bg-amber-500",
  baixa: "bg-gray-400",
};

// ─── Persistência (Firestore) ───────────────────────────────────────────────
type SolItem = { key: string; tipo: TipoOcorrencia; data: string; rotulo: string };
type Solicitacao = {
  id: string;
  restaurantId: string;
  employeeId: number;
  colaborador: string;
  itens: SolItem[];
  enviadoEm: string;   // ISO
  prazoHoras: number;
  prazoEm: string;     // ISO
  por: { id: string; nome: string };
  status: string;      // "enviado"
};
type Avaliacao = {
  id: string;
  restaurantId: string;
  key: string;
  employeeId: number;
  colaborador: string;
  tipo: TipoOcorrencia;
  data: string;
  obs?: string;
  por: { id: string; nome: string };
  em: string;
};

// ─── Helpers de mensagem / relógio ──────────────────────────────────────────
function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function montarMensagem(colaborador: string, itens: Ocorrencia[], prazoEm: string): string {
  const primeiro = (colaborador || "").trim().split(/\s+/)[0] || colaborador;
  const linhas = itens.map((o) => `• ${fmtBR(o.data)} — ${ROTULOS[o.tipo]}`).join("\n");
  return (
    `Olá ${primeiro}, tudo bem?\n\n` +
    `Identificamos pendências no seu registro de ponto que precisam de ajuste no aplicativo da Sólides:\n\n` +
    `${linhas}\n\n` +
    `Por favor, faça os ajustes até ${fmtDataHora(prazoEm)}. Depois disso eles passam pela nossa revisão e aprovação. ` +
    `Qualquer dúvida, é só falar com a gente. Obrigado! 🙏`
  );
}
function waLink(tel: string, msg: string): string {
  const d = soDigitos(tel);
  const num = d.startsWith("55") ? d : `55${d}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}
function relogio(prazoEm: string, now: number): { txt: string; vencido: boolean } {
  const diff = new Date(prazoEm).getTime() - now;
  const vencido = diff < 0;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const dur = h > 0 ? `${h}h${pad(m)}` : `${m}min`;
  return { txt: vencido ? `venceu há ${dur}` : `faltam ${dur}`, vencido };
}

function agrupar(itens: Ocorrencia[]): Array<{ employeeId: number; colaborador: string; itens: Ocorrencia[] }> {
  const m = new Map<number, { employeeId: number; colaborador: string; itens: Ocorrencia[] }>();
  for (const o of itens) {
    let g = m.get(o.employeeId);
    if (!g) { g = { employeeId: o.employeeId, colaborador: o.colaborador, itens: [] }; m.set(o.employeeId, g); }
    g.itens.push(o);
  }
  return [...m.values()].sort((a, b) => a.colaborador.localeCompare(b.colaborador));
}

export function AnalisePontoPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;
  const { can, loading: permLoading } = useCanAcao(rid);
  const podeVer = can("analise-ponto", "ver");
  const podeSolicitar = can("analise-ponto", "solicitar");
  const podeCorrigir = can("analise-ponto", "corrigir");

  const hoje = new Date();
  // Default: 1º dia do mês corrente → ontem.
  const [inicio, setInicio] = useState(fmtYmd(new Date(hoje.getFullYear(), hoje.getMonth(), 1)));
  const [fim, setFim] = useState(fmtYmd(new Date(hoje.getTime() - 86400000)));
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<ResultadoAnalise | null>(null);
  const [roster, setRoster] = useState<PontoColaborador[]>([]);
  const [corrigindo, setCorrigindo] = useState<Ocorrencia | null>(null);
  // Prazo de correção (horas) — configurável, padrão 6h. Persiste no navegador.
  const [prazoHoras, setPrazoHoras] = useState<number>(() => {
    const v = Number(localStorage.getItem("analisePonto.prazoHoras"));
    return Number.isFinite(v) && v > 0 ? v : 6;
  });
  useEffect(() => { localStorage.setItem("analisePonto.prazoHoras", String(prazoHoras)); }, [prazoHoras]);
  // Seleção de apontamentos (por ocKey) pra montar a mensagem única.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (k: string) => setSel((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  // Filtro por área: conjunto vazio = TODAS. "sem" = não vinculado no app.
  const [filtroAreas, setFiltroAreas] = useState<Set<Area | "sem">>(new Set());
  const toggleArea = (a: Area | "sem") => setFiltroAreas((cur) => {
    const next = new Set(cur);
    if (next.has(a)) next.delete(a); else next.add(a);
    return next;
  });
  const [mostrarAvaliados, setMostrarAvaliados] = useState(false);
  const [editObs, setEditObs] = useState<{ id: string; text: string } | null>(null);
  const [tab, setTab] = useState<"inconsist" | "manual" | "escalas">("inconsist");

  // Relógio: re-render a cada minuto pra atualizar os countdowns.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Empregados + cargos do app → ponte pra área + telefone (Sólides id ↔ CPF).
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)),
      (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)));
    const u2 = onSnapshot(collection(db, "cargos"),
      (s) => setCargos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo)));
    return () => { u1(); u2(); };
  }, [rid]);

  // Solicitações enviadas + avaliações (ciente) — estado persistido.
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<Avaliacao[]>([]);
  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "pontoSolicitacoes"), where("restaurantId", "==", rid)),
      (s) => setSolicitacoes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Solicitacao)));
    const u2 = onSnapshot(query(collection(db, "pontoAvaliacoes"), where("restaurantId", "==", rid)),
      (s) => setAvaliacoes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Avaliacao)));
    return () => { u1(); u2(); };
  }, [rid]);

  // Mapa: employeeId da Sólides → { área, telefone }. Ponte por CPF
  // (roster Sólides → empregado do app → cargo.area / empregado.telefone).
  const dadosPorEmpId = useMemo(() => {
    const cargoArea = new Map<string, Area>();
    for (const c of cargos) cargoArea.set(c.id, c.area);
    const empPorCpf = new Map<string, Empregado>();
    for (const e of empregados) {
      const cpf = soDigitos(e.cpf);
      if (cpf) empPorCpf.set(cpf, e);
    }
    const m = new Map<number, { area?: Area; tel: string }>();
    for (const r of roster) {
      if (typeof r.id !== "number") continue;
      const e = empPorCpf.get(soDigitos(r.cpf));
      if (!e) continue;
      m.set(r.id, { area: cargoArea.get(e.cargoId), tel: soDigitos(e.telefone) });
    }
    return m;
  }, [empregados, cargos, roster]);
  const areaPorEmpId = (id: number): Area | undefined => dadosPorEmpId.get(id)?.area;
  const telPorEmpId = (id: number): string => dadosPorEmpId.get(id)?.tel || "";

  // Solicitação ativa por ocKey (mais recente) e por empregado (prazo mais urgente).
  const solPorKey = useMemo(() => {
    const m = new Map<string, Solicitacao>();
    for (const s of solicitacoes) {
      for (const it of s.itens || []) {
        const prev = m.get(it.key);
        if (!prev || new Date(s.enviadoEm) > new Date(prev.enviadoEm)) m.set(it.key, s);
      }
    }
    return m;
  }, [solicitacoes]);

  const cienteKeys = useMemo(() => new Set(avaliacoes.map((a) => a.key)), [avaliacoes]);

  async function analisar(ini: string = inicio, fimArg: string = fim) {
    if (!activeRestaurant) return;
    const shortCode = activeRestaurant.shortCode || "";
    if (!shortCode) { setErro("Restaurante sem shortCode configurado."); return; }
    setErro("");
    setCarregando(true);
    setResultado(null);
    try {
      // Roster pode vir vazio em algumas contas → FALTA simplesmente não aponta;
      // não derruba o resto. Por isso o catch dele é tolerante.
      const [{ punches }, schedules, employees] = await Promise.all([
        fetchPunches(ini, fimArg, shortCode),
        fetchScheduleCatalog(shortCode),
        fetchRoster(shortCode).catch(() => []),
      ]);
      setRoster(employees);
      const res = analisarPonto(
        punches as unknown as PontoMarcacao[], employees, schedules, ini, fimArg,
      );
      setResultado(res);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao analisar.");
    } finally {
      setCarregando(false);
    }
  }

  // Auto-analisa ao abrir (e ao trocar de restaurante) — atualiza com os dados
  // atuais, sem tela vazia. Roda 1× por restaurante quando permissão e dados
  // estão prontos. Mudança manual de data NÃO dispara (aí é o botão Analisar).
  const autoRef = useRef<string>("");
  useEffect(() => {
    if (permLoading || !podeVer || !activeRestaurant) return;
    if (autoRef.current === rid) return;
    autoRef.current = rid;
    void analisar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid, permLoading, podeVer, activeRestaurant]);

  // ─── Ações ────────────────────────────────────────────────────────────────
  function enviarCorrecao(colaborador: string, employeeId: number, itens: Ocorrencia[]) {
    const tel = telPorEmpId(employeeId);
    if (!tel || itens.length === 0) return;
    const prazoEm = new Date(Date.now() + prazoHoras * 3_600_000).toISOString();
    const msg = montarMensagem(colaborador, itens, prazoEm);
    // Abre o WhatsApp NA HORA do clique (evita bloqueio de popup).
    window.open(waLink(tel, msg), "_blank");
    const solItens: SolItem[] = itens.map((o) => ({ key: ocKey(o), tipo: o.tipo, data: o.data, rotulo: ROTULOS[o.tipo] }));
    void addDoc(collection(db, "pontoSolicitacoes"), {
      restaurantId: rid, employeeId, colaborador,
      itens: solItens,
      enviadoEm: new Date().toISOString(),
      prazoHoras, prazoEm,
      por: { id: me?.id || "", nome: me?.nome || "?" },
      status: "enviado",
    }).catch((e) => setErro(e instanceof Error ? e.message : "Falha ao registrar a solicitação."));
    // Limpa a seleção dos itens enviados.
    setSel((cur) => {
      const next = new Set(cur);
      itens.forEach((o) => next.delete(ocKey(o)));
      return next;
    });
  }

  // Ciência em lote (sem caixa) — mesma lógica do envio: seleciona e dá ciência
  // de uma vez. Observação é opcional, adicionada depois na seção "Avaliados".
  function darCiencia(itens: Ocorrencia[]) {
    if (itens.length === 0) return;
    const por = { id: me?.id || "", nome: me?.nome || "?" };
    const em = new Date().toISOString();
    for (const o of itens) {
      void addDoc(collection(db, "pontoAvaliacoes"), {
        restaurantId: rid, key: ocKey(o),
        employeeId: o.employeeId, colaborador: o.colaborador,
        tipo: o.tipo, data: o.data, detalhe: o.detalhe, obs: "",
        por, em,
      }).catch((e) => setErro(e instanceof Error ? e.message : "Falha ao registrar ciência."));
    }
    setSel((cur) => {
      const next = new Set(cur);
      itens.forEach((o) => next.delete(ocKey(o)));
      return next;
    });
  }

  async function salvarObs() {
    if (!editObs) return;
    const { id, text } = editObs;
    setEditObs(null);
    try { await updateDoc(doc(db, "pontoAvaliacoes", id), { obs: text.trim() }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar observação."); }
  }

  async function reabrirAvaliacao(a: Avaliacao) {
    try { await deleteDoc(doc(db, "pontoAvaliacoes", a.id)); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falha ao reabrir."); }
  }

  if (!activeRestaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (permLoading) return <div className="text-gray-400 py-12 text-center text-sm">Carregando permissões…</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const tabsDisp = ([
    ["inconsist", "⚠️ Inconsistências"],
    podeCorrigir ? ["manual", "🛠️ Corrigir manual"] : null,
    ["escalas", "🗓️ Escalas (Sólides × app)"],
  ].filter(Boolean)) as Array<[typeof tab, string]>;

  return (
    <div className="max-w-5xl space-y-4">
      {/* Abas */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
        {tabsDisp.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "escalas" && <EscalasComparacaoTab rid={rid} activeRestaurant={activeRestaurant} />}

      {(tab === "inconsist" || tab === "manual") && <>
      {/* Filtros */}
      <div className="bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/20 dark:to-gray-900 border border-indigo-100 dark:border-indigo-900/40 rounded-xl px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Início</label>
            <input type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)}
              className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Fim</label>
            <input type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)}
              className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
          {tab === "inconsist" && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Prazo p/ correção</label>
              <div className="h-9 inline-flex items-center gap-1.5">
                <input type="number" min={1} max={168} value={prazoHoras}
                  onChange={(e) => setPrazoHoras(Math.max(1, Number(e.target.value) || 6))}
                  className="h-9 w-16 px-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400" />
                <span className="text-xs text-gray-500">horas</span>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">Área</label>
            <div className="flex items-center gap-1.5 flex-wrap h-9">
              <Chip ativo={filtroAreas.size === 0} onClick={() => setFiltroAreas(new Set())}>Todas</Chip>
              {AREAS.map((a) => (
                <Chip key={a} ativo={filtroAreas.has(a)} onClick={() => toggleArea(a)}>{a}</Chip>
              ))}
              <Chip ativo={filtroAreas.has("sem")} onClick={() => toggleArea("sem")}>Sem área</Chip>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[11px] text-gray-400 inline-flex items-center gap-1 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {activeRestaurant.nome} · {activeRestaurant.shortCode}
            </span>
            <button type="button" onClick={() => void analisar()} disabled={carregando}
              className="h-9 px-5 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-200 dark:shadow-none disabled:opacity-50 inline-flex items-center justify-center gap-2 whitespace-nowrap">
              {carregando ? "Analisando…" : <>🔍 Analisar período</>}
            </button>
          </div>
        </div>
      </div>

      {erro && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>
      )}

      {resultado && (() => {
        const passaArea = (o: Ocorrencia) => {
          if (filtroAreas.size === 0) return true; // TODAS
          const a = areaPorEmpId(o.employeeId);
          if (!a) return filtroAreas.has("sem");
          return filtroAreas.has(a);
        };
        const filtradas = resultado.ocorrencias.filter(passaArea);

        // ─── Aba Corrigir manual: só os corrigíveis, com o modal de ponto em atraso.
        if (tab === "manual") {
          const corrigiveis = filtradas.filter(
            (o) => o.tipo === "PONTO_EM_ABERTO" && o.employeeId > 0 && /^\d{4}-\d{2}-\d{2}$/.test(o.data),
          );
          return (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <header className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800">
                <div className="font-bold text-sm text-gray-900 dark:text-gray-100">🛠️ Correção manual ({corrigiveis.length})</div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Use só em exceção — o ideal é o empregado corrigir no app dele. Lança ponto em atraso direto na Sólides (a Sólides decide se é entrada ou saída).
                </p>
              </header>
              {corrigiveis.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400">Nenhum ponto em aberto pra corrigir 🎉</div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {corrigiveis.map((o, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-start gap-2.5">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEV_COR[o.severidade]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{o.colaborador}</span>
                          <span className="text-gray-400"> · {fmtBR(o.data)}{o.diaSemana !== "período" ? ` (${o.diaSemana})` : ""}</span>
                        </div>
                        <div className="text-xs text-indigo-700 dark:text-indigo-300 font-medium">{ROTULOS[o.tipo]}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-300">{o.detalhe}</div>
                      </div>
                      <button type="button" onClick={() => setCorrigindo(o)}
                        className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
                        ✏️ Corrigir
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        }

        // ─── Aba Inconsistências: pendentes (tira os marcados "ciente") agrupados por empregado.
        const pendentes = filtradas.filter((o) => !cienteKeys.has(ocKey(o)));
        const avaliadosVisiveis = avaliacoes.filter((a) =>
          filtroAreas.size === 0 ? true : (() => {
            const ar = areaPorEmpId(a.employeeId);
            return ar ? filtroAreas.has(ar) : filtroAreas.has("sem");
          })(),
        );
        const nCorrigir = pendentes.filter((o) => o.categoria === "CORRIGIR").length;
        const nAvaliar = pendentes.filter((o) => o.categoria === "AVALIAR").length;

        return (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Cartao titulo="A Corrigir" valor={nCorrigir} cor="text-red-600" />
            <Cartao titulo="A Avaliar" valor={nAvaliar} cor="text-amber-600" />
            <Cartao titulo="Total pendente" valor={pendentes.length} cor="text-gray-700 dark:text-gray-200" />
          </div>

          {(["CORRIGIR", "AVALIAR"] as Categoria[]).map((cat) => {
            const grupos = agrupar(pendentes.filter((o) => o.categoria === cat));
            const totalCat = grupos.reduce((s, g) => s + g.itens.length, 0);
            return (
              <section key={cat} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                <header className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 font-bold text-sm text-gray-900 dark:text-gray-100">
                  {cat === "CORRIGIR" ? "🔧" : "👀"} {CAT_LABEL[cat]} ({totalCat})
                </header>
                {grupos.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-gray-400">Nada nesta categoria 🎉</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {grupos.map((g) => (
                      <GrupoEmp key={g.employeeId} grupo={g}
                        area={areaPorEmpId(g.employeeId)} tel={telPorEmpId(g.employeeId)}
                        sel={sel} toggleSel={toggleSel} solPorKey={solPorKey} now={now}
                        podeSolicitar={podeSolicitar}
                        onEnviar={(itens) => enviarCorrecao(g.colaborador, g.employeeId, itens)}
                        onCiencia={darCiencia} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {/* Avaliados (ciente / sem ação) */}
          {avaliadosVisiveis.length > 0 && (
            <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <button type="button" onClick={() => setMostrarAvaliados((v) => !v)}
                className="w-full px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 font-bold text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between">
                <span>✅ Avaliados — ciente / sem ação ({avaliadosVisiveis.length})</span>
                <span className="text-gray-400">{mostrarAvaliados ? "▲" : "▼"}</span>
              </button>
              {mostrarAvaliados && (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {avaliadosVisiveis.map((a) => (
                    <div key={a.id} className="px-4 py-2 flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">✓ ciente</span>
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{a.colaborador}</span>
                        <span className="text-gray-400"> · {fmtBR(a.data)} · {ROTULOS[a.tipo]}</span>
                        {editObs?.id === a.id ? (
                          <div className="flex items-center gap-1.5 mt-1">
                            <input autoFocus type="text" value={editObs.text}
                              onChange={(e) => setEditObs({ id: a.id, text: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") void salvarObs(); if (e.key === "Escape") setEditObs(null); }}
                              placeholder="Observação (opcional)…"
                              className="flex-1 px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-400" />
                            <button type="button" onClick={() => void salvarObs()}
                              className="text-[11px] font-semibold px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white">Salvar</button>
                            <button type="button" onClick={() => setEditObs(null)}
                              className="text-[11px] px-2 py-1 rounded-md text-gray-500 hover:text-gray-800">Cancelar</button>
                          </div>
                        ) : (
                          a.obs && <div className="text-xs text-gray-500 italic">"{a.obs}"</div>
                        )}
                        <div className="text-[11px] text-gray-400">por {a.por?.nome} · {fmtDataHora(a.em)}</div>
                      </div>
                      {podeSolicitar && editObs?.id !== a.id && (
                        <div className="shrink-0 flex items-center gap-1.5">
                          <button type="button" onClick={() => setEditObs({ id: a.id, text: a.obs || "" })}
                            className="text-[11px] font-medium px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-400">
                            {a.obs ? "✏️ observação" : "+ observação"}
                          </button>
                          <button type="button" onClick={() => void reabrirAvaliacao(a)}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                            ↩︎ Reabrir
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <p className="text-[11px] text-gray-400">
            O empregado corrige no app dele; depois você aprova (aba Aprovações — em breve).
            Correção manual só em exceção, na aba 🛠️{podeCorrigir ? "" : " (sem permissão)"}.
            FALTA depende do roster da Sólides (se a conta não retornar colaboradores, não aparece).
          </p>
        </>
        );
      })()}

      {!resultado && !carregando && !erro && (
        <div className="text-center text-sm text-gray-400 py-12">
          Escolha o período e clique em <strong>Analisar</strong>.
        </div>
      )}

      {corrigindo && activeRestaurant && (
        <CorrecaoModal
          ocorrencia={corrigindo}
          shortCode={activeRestaurant.shortCode || ""}
          restaurantId={rid}
          por={{ id: me?.id || "", nome: me?.nome || "?" }}
          onClose={() => setCorrigindo(null)}
          onDone={() => { setCorrigindo(null); void analisar(); }}
        />
      )}
      </>}
    </div>
  );
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
        ativo
          ? "bg-indigo-600 text-white border-indigo-600"
          : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400"
      }`}>
      {children}
    </button>
  );
}

function Cartao({ titulo, valor, cor }: { titulo: string; valor: number; cor: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold tabular-nums ${cor}`}>{valor}</div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-0.5">{titulo}</div>
    </div>
  );
}

// ─── Grupo de um empregado: cabeçalho (nome + relógio + enviar) + itens ───────
function GrupoEmp({
  grupo, area, tel, sel, toggleSel, solPorKey, now, podeSolicitar, onEnviar, onCiencia,
}: {
  grupo: { employeeId: number; colaborador: string; itens: Ocorrencia[] };
  area?: Area;
  tel: string;
  sel: Set<string>;
  toggleSel: (k: string) => void;
  solPorKey: Map<string, Solicitacao>;
  now: number;
  podeSolicitar: boolean;
  onEnviar: (itens: Ocorrencia[]) => void;
  onCiencia: (itens: Ocorrencia[]) => void;
}) {
  const selecionados = grupo.itens.filter((o) => sel.has(ocKey(o)));
  // Relógio do empregado = solicitação ativa mais urgente entre os itens visíveis.
  const ativas = grupo.itens.map((o) => solPorKey.get(ocKey(o))).filter(Boolean) as Solicitacao[];
  const maisUrgente = ativas.length
    ? ativas.reduce((a, b) => (new Date(a.prazoEm) < new Date(b.prazoEm) ? a : b))
    : null;
  const rel = maisUrgente ? relogio(maisUrgente.prazoEm, now) : null;
  const semNumero = !tel;
  const todosSel = grupo.itens.every((o) => sel.has(ocKey(o)));
  const toggleTodos = () => grupo.itens.forEach((o) => {
    const k = ocKey(o);
    if (todosSel ? sel.has(k) : !sel.has(k)) toggleSel(k);
  });

  return (
    <div className="px-3 py-2.5">
      {/* Cabeçalho do empregado */}
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        {podeSolicitar && (
          <input type="checkbox" checked={todosSel} onChange={toggleTodos}
            className="w-4 h-4 accent-indigo-600 cursor-pointer" title="Selecionar todos" />
        )}
        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{grupo.colaborador}</span>
        {area && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{area}</span>}
        <span className="text-[11px] text-gray-400">({grupo.itens.length})</span>
        {rel && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
            rel.vencido ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
            ⏱ {rel.txt}
          </span>
        )}
        {podeSolicitar && (
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" disabled={selecionados.length === 0}
              onClick={() => onCiencia(selecionados)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1">
              ✓ Dar ciência{selecionados.length > 0 ? ` (${selecionados.length})` : ""}
            </button>
            {semNumero ? (
              <span className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed" title="Empregado sem telefone cadastrado no app">
                sem número cadastrado
              </span>
            ) : (
              <button type="button" disabled={selecionados.length === 0}
                onClick={() => onEnviar(selecionados)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1">
                💬 Enviar p/ correção{selecionados.length > 0 ? ` (${selecionados.length})` : ""}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Itens do empregado */}
      <div className="space-y-1 pl-0.5">
        {grupo.itens.map((o, i) => {
          const k = ocKey(o);
          const enviado = solPorKey.has(k);
          return (
            <div key={i} className="flex items-start gap-2.5">
              {podeSolicitar && (
                <input type="checkbox" checked={sel.has(k)} onChange={() => toggleSel(k)}
                  className="mt-1 w-4 h-4 accent-indigo-600 cursor-pointer shrink-0" />
              )}
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEV_COR[o.severidade]}`} title={o.severidade} />
              <div className="min-w-0 flex-1">
                <div className="text-xs">
                  <span className="text-gray-500">{fmtBR(o.data)}{o.diaSemana !== "período" ? ` (${o.diaSemana})` : ""}</span>
                  <span className="ml-1.5 text-indigo-700 dark:text-indigo-300 font-medium">{ROTULOS[o.tipo]}</span>
                  {enviado && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">enviado</span>}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300">{o.detalhe}</div>
                {o.marcacoes.length > 0 && (
                  <div className="text-[11px] text-gray-400 tabular-nums">{o.marcacoes.join("  ·  ")}</div>
                )}
              </div>
              {podeSolicitar && (
                <button type="button" onClick={() => onCiencia([o])}
                  className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:border-gray-400"
                  title="Ciente / sem ação">
                  ✓ ciente
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Modal de correção: lança ponto em atraso na Sólides ─────────────────────
function CorrecaoModal({
  ocorrencia, shortCode, restaurantId, por, onClose, onDone,
}: {
  ocorrencia: Ocorrencia;
  shortCode: string;
  restaurantId: string;
  por: { id: string; nome: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [justs, setJusts] = useState<Justificativa[]>([]);
  const [justId, setJustId] = useState<number | null>(null);
  const [data, setData] = useState(ocorrencia.data);
  const [hora, setHora] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetchJustificativas(shortCode)
      .then((js) => { if (vivo) { setJusts(js); if (js[0]) setJustId(js[0].id); } })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : "Falha ao carregar justificativas."); });
    return () => { vivo = false; };
  }, [shortCode]);

  async function confirmar() {
    if (!justId) { setErro("Escolha uma justificativa."); return; }
    if (!/^\d{2}:\d{2}$/.test(hora)) { setErro("Informe a hora real (HH:MM)."); return; }
    const dataHoraIso = `${data}T${hora}:00.000-0300`; // America/Sao_Paulo (UTC-3 fixo)
    if (!window.confirm(`Lançar ponto em atraso para ${ocorrencia.colaborador} em ${fmtBR(data)} ${hora}?\n\nIsso grava na Sólides (dado trabalhista). A Sólides decide se é entrada ou saída e pareia.`)) return;
    setErro("");
    setSalvando(true);
    try {
      await corrigirPontoAtraso(shortCode, { employeeId: ocorrencia.employeeId, dataHoraIso, justificativaId: justId });
      // Auditoria (quem/quando/o quê) — dado trabalhista.
      try {
        await addDoc(collection(db, "pontoAuditoria"), {
          restaurantId, tipo: "ponto_atraso",
          por: { id: por.id, nome: por.nome },
          employeeId: ocorrencia.employeeId, colaborador: ocorrencia.colaborador,
          data, hora, justificativaId: justId,
          em: new Date().toISOString(),
        });
      } catch { /* auditoria não bloqueia a correção */ }
      alert("Ponto lançado na Sólides ✓ (entra como pendente de aprovação). Reanalisando o período…");
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao lançar o ponto.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-base text-gray-900 dark:text-gray-100">✏️ Corrigir ponto — {ocorrencia.colaborador}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {ROTULOS[ocorrencia.tipo]} em {fmtBR(ocorrencia.data)}. Informe a hora real da batida faltante.
          Para saída de madrugada (vira-dia), use a data do dia seguinte.
        </p>
        {erro && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{erro}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Data</label>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Hora (HH:MM)</label>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Justificativa</label>
          <select value={justId ?? ""} onChange={(e) => setJustId(Number(e.target.value))}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100">
            {justs.length === 0 && <option value="">— carregando —</option>}
            {justs.map((j) => <option key={j.id} value={j.id}>{j.description}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={salvando}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
            Cancelar
          </button>
          <button type="button" onClick={() => void confirmar()} disabled={salvando}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
            {salvando ? "Lançando…" : "Confirmar correção"}
          </button>
        </div>
      </div>
    </div>
  );
}
