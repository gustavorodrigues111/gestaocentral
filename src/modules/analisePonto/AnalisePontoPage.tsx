// ════════════════════════════════════════════════════════════════════════════
//  Análise de Ponto — módulo NOVO (lado a lado com "Registros de Ponto"/Exceções,
//  que será aposentado depois). Motor determinístico sobre a API Sólides:
//  carga prevista × trabalhada + saldo do período (jornada flexível), com as
//  ocorrências divididas em duas categorias de AÇÃO: A Corrigir × A Avaliar.
//
//  Fase 1b: leitura (período + restaurante → relatório). Correções (escrita),
//  Excel e FALTA (precisa do roster de colaboradores) entram nas próximas fases.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { addDoc, collection, onSnapshot, query, where } from "firebase/firestore";
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
} from "../../core/ponto/analise";

import { EscalasComparacaoTab } from "./EscalasComparacaoTab";

const soDigitos = (s?: string | null) => (s || "").replace(/\D/g, "");

const pad = (n: number) => String(n).padStart(2, "0");
const fmtYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Converte qualquer YYYY-MM-DD (inclusive dentro de "X a Y") → DD/MM/YYYY.
const fmtBR = (s: string) => s.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3/$2/$1");

type PresetId = "7d" | "estaSemana" | "semanaPassada" | "esteMes" | "mesPassado";
const PRESETS: { id: PresetId; label: string }[] = [
  { id: "semanaPassada", label: "Semana passada" },
  { id: "estaSemana", label: "Esta semana" },
  { id: "7d", label: "Últimos 7 dias" },
  { id: "esteMes", label: "Este mês" },
  { id: "mesPassado", label: "Mês passado" },
];
// Semanas Dom–Sáb (a Sólides troca escala/semana aos domingos).
function rangePreset(p: PresetId): [string, string] {
  const h = new Date(); h.setHours(0, 0, 0, 0);
  if (p === "7d") { const s = new Date(h); s.setDate(s.getDate() - 6); return [fmtYmd(s), fmtYmd(h)]; }
  if (p === "estaSemana") { const s = new Date(h); s.setDate(s.getDate() - s.getDay()); return [fmtYmd(s), fmtYmd(h)]; }
  if (p === "semanaPassada") {
    const dom = new Date(h); dom.setDate(dom.getDate() - dom.getDay() - 7);
    const sab = new Date(dom); sab.setDate(sab.getDate() + 6);
    return [fmtYmd(dom), fmtYmd(sab)];
  }
  if (p === "esteMes") return [fmtYmd(new Date(h.getFullYear(), h.getMonth(), 1)), fmtYmd(h)];
  // mês passado
  return [fmtYmd(new Date(h.getFullYear(), h.getMonth() - 1, 1)), fmtYmd(new Date(h.getFullYear(), h.getMonth(), 0))];
}

const SEV_COR: Record<Severidade, string> = {
  alta: "bg-red-500",
  media: "bg-amber-500",
  baixa: "bg-gray-400",
};

export function AnalisePontoPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;
  const { can, loading: permLoading } = useCanAcao(rid);
  const podeVer = can("analise-ponto", "ver");
  const podeCorrigir = can("analise-ponto", "corrigir");

  const hoje = new Date();
  const [inicio, setInicio] = useState(fmtYmd(new Date(hoje.getTime() - 7 * 86400000)));
  const [fim, setFim] = useState(fmtYmd(hoje));
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<ResultadoAnalise | null>(null);
  const [roster, setRoster] = useState<PontoColaborador[]>([]);
  const [corrigindo, setCorrigindo] = useState<Ocorrencia | null>(null);
  const [filtroArea, setFiltroArea] = useState<Area | "todas" | "sem">("todas");
  const [tab, setTab] = useState<"inconsist" | "escalas">("inconsist");

  // Empregados + cargos do app → ponte pra área (Sólides employeeId === empregado.solidesId).
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

  // Mapa: employeeId da Sólides → área. Ponte por CPF (roster Sólides → empregado
  // do app → cargo.area), igual ao módulo antigo.
  const areaPorEmpId = useMemo(() => {
    const cargoArea = new Map<string, Area>();
    for (const c of cargos) cargoArea.set(c.id, c.area);
    const areaPorCpf = new Map<string, Area>();
    for (const e of empregados) {
      const cpf = soDigitos(e.cpf);
      const a = cargoArea.get(e.cargoId);
      if (cpf && a) areaPorCpf.set(cpf, a);
    }
    const m = new Map<number, Area>();
    for (const r of roster) {
      if (typeof r.id !== "number") continue;
      const a = areaPorCpf.get(soDigitos(r.cpf));
      if (a) m.set(r.id, a);
    }
    return m;
  }, [empregados, cargos, roster]);

  function aplicarPreset(p: PresetId) {
    const [s, e] = rangePreset(p);
    setInicio(s); setFim(e);
    void analisar(s, e);
  }

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

  return (
    <div className="max-w-5xl space-y-4">
      {/* Abas */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
        {([["inconsist", "⚠️ Inconsistências"], ["escalas", "🗓️ Escalas (Sólides × app)"]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "escalas" && <EscalasComparacaoTab rid={rid} activeRestaurant={activeRestaurant} />}

      {tab === "inconsist" && <>
      {/* Filtros */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
        {/* Atalhos de período */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Período</span>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => aplicarPreset(p.id)} disabled={carregando}
              className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-50">
              {p.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-gray-400 inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {activeRestaurant.nome} · {activeRestaurant.shortCode}
          </span>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800" />

        {/* Datas + área + ação */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Início</label>
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Fim</label>
            <input type="date" value={fim} onChange={(e) => setFim(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none" />
          </div>
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Área</label>
            <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value as Area | "todas" | "sem")}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none">
              <option value="todas">Todas as áreas</option>
              {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              <option value="sem">Sem área (não vinculado)</option>
            </select>
          </div>
          <button type="button" onClick={() => void analisar()} disabled={carregando}
            className="ml-auto px-5 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 inline-flex items-center gap-2">
            {carregando ? "Analisando…" : <>🔍 Analisar período</>}
          </button>
        </div>
      </div>

      {erro && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</div>
      )}

      {resultado && (() => {
        const passaArea = (o: Ocorrencia) => {
          if (filtroArea === "todas") return true;
          const a = areaPorEmpId.get(o.employeeId);
          if (filtroArea === "sem") return !a;
          return a === filtroArea;
        };
        const filtradas = resultado.ocorrencias.filter(passaArea);
        const nCorrigir = filtradas.filter((o) => o.categoria === "CORRIGIR").length;
        const nAvaliar = filtradas.filter((o) => o.categoria === "AVALIAR").length;
        return (
        <>
          {/* Resumo (reflete o filtro de área) */}
          <div className="grid grid-cols-3 gap-3">
            <Cartao titulo="A Corrigir" valor={nCorrigir} cor="text-red-600" />
            <Cartao titulo="A Avaliar" valor={nAvaliar} cor="text-amber-600" />
            <Cartao titulo="Total" valor={filtradas.length} cor="text-gray-700 dark:text-gray-200" />
          </div>

          {(["CORRIGIR", "AVALIAR"] as Categoria[]).map((cat) => {
            const itens = filtradas.filter((o) => o.categoria === cat);
            return (
              <section key={cat} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                <header className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 font-bold text-sm text-gray-900 dark:text-gray-100">
                  {cat === "CORRIGIR" ? "🔧" : "👀"} {CAT_LABEL[cat]} ({itens.length})
                </header>
                {itens.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-gray-400">Nada nesta categoria 🎉</div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {itens.map((o, i) => (
                      <Linha key={i} o={o} area={areaPorEmpId.get(o.employeeId)}
                        podeCorrigir={podeCorrigir} onCorrigir={() => setCorrigindo(o)} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          <p className="text-[11px] text-gray-400">
            Correções de "Ponto em aberto" (lançar ponto em atraso) são feitas pelo
            botão ✏️ Corrigir{podeCorrigir ? "" : " (só com permissão de Corrigir)"}.
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

function Cartao({ titulo, valor, cor }: { titulo: string; valor: number; cor: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold tabular-nums ${cor}`}>{valor}</div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-0.5">{titulo}</div>
    </div>
  );
}

function Linha({ o, area, podeCorrigir, onCorrigir }: { o: Ocorrencia; area?: Area; podeCorrigir: boolean; onCorrigir: () => void }) {
  // Ponto em atraso corrige o caso clássico de PONTO_EM_ABERTO (saída faltante).
  const corrigivel = podeCorrigir && o.tipo === "PONTO_EM_ABERTO" && o.employeeId > 0 && /^\d{4}-\d{2}-\d{2}$/.test(o.data);
  return (
    <div className="px-4 py-2.5 flex items-start gap-2.5">
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEV_COR[o.severidade]}`} title={o.severidade} />
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-semibold text-gray-900 dark:text-gray-100">{o.colaborador}</span>
          {area && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{area}</span>}
          <span className="text-gray-400"> · {fmtBR(o.data)}{o.diaSemana !== "período" ? ` (${o.diaSemana})` : ""}</span>
        </div>
        <div className="text-xs text-indigo-700 dark:text-indigo-300 font-medium">{ROTULOS[o.tipo]}</div>
        <div className="text-xs text-gray-600 dark:text-gray-300">{o.detalhe}</div>
        {o.marcacoes.length > 0 && (
          <div className="text-[11px] text-gray-400 tabular-nums mt-0.5">{o.marcacoes.join("  ·  ")}</div>
        )}
      </div>
      {corrigivel && (
        <button type="button" onClick={onCorrigir}
          className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
          ✏️ Corrigir
        </button>
      )}
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
