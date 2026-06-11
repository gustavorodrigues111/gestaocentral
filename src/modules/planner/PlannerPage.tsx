// ════════════════════════════════════════════════════════════════════════════
//  Planner — planejamento pessoal do Gustavo (single-user).
//
//  ⚠️ MÓDULO PESSOAL: só monta pro master (gate abaixo). Fora do escopo de
//  restaurante (rota de topo /planner). Backend Google Calendar NÃO conectado
//  ainda — esta é a casca front-end (F1, metade front) com DADOS MOCK.
//
//  Navegação em 2 níveis (briefing §6):
//    Nível 1 — tipo de visão: Calendário · Kanban · Cronograma
//    Nível 2 — período (só em Calendário): Semana · Mês · Trimestre · Ano
//  Padrão de abertura: Calendário → Semana.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../core/auth/AuthContext";

// ─── Domínio (mock — vai virar espelho do Firestore na fase backend) ────────
type Perfil = "projeto" | "rotina" | "pessoal" | "viagem";
type Agenda = { id: string; nome: string; perfil: Perfil; cor: string };

const AGENDAS: Agenda[] = [
  { id: "puba",    nome: "Inauguração Puba SP",  perfil: "projeto", cor: "#ff8a4c" },
  { id: "lobozo",  nome: "Seis Anos de Lobozó",  perfil: "projeto", cor: "#f5b73d" },
  { id: "rotina",  nome: "Rotinas Escritório",   perfil: "rotina",  cor: "#4c7ef3" },
  { id: "viagem",  nome: "Viagens",              perfil: "viagem",  cor: "#27ae8f" },
  { id: "pessoal", nome: "Pessoal",              perfil: "pessoal", cor: "#6a5ae0" },
];
const corAgenda = (id: string): string => AGENDAS.find((a) => a.id === id)?.cor || "#9aa";

type TipoVista = "calendario" | "kanban" | "crono";
type Periodo = "semana" | "mes" | "tri" | "ano";

// ─── Página ─────────────────────────────────────────────────────────────────
export function PlannerPage() {
  const { pessoa } = useAuth();

  // Gate single-user. Por ora via isMaster; o gate estrito por uid + regras
  // Firestore entra junto com o backend Google (fase F1-backend).
  if (!pessoa?.isMaster) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="font-medium text-gray-700 dark:text-gray-200">Planner é pessoal</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Este módulo é privado do dono da conta.
        </p>
      </div>
    );
  }

  const [vista, setVista] = useState<TipoVista>("calendario");
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [reviewOpen, setReviewOpen] = useState(false);

  const alvo: TipoVista | Periodo = vista === "calendario" ? periodo : vista;

  return (
    <div className="max-w-6xl">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">🗓 Planner</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Pessoal · espelhado no Google · <span className="italic">backend ainda não conectado (mock)</span>
          </p>
        </div>
      </div>

      {/* Faixa "Para revisar" (recolhível) */}
      <ReviewBand open={reviewOpen} onToggle={() => setReviewOpen((v) => !v)} />

      {/* Navegação: tipo de visão + período */}
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="inline-flex gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-1 rounded-xl">
          <NavBtn ativo={vista === "calendario"} onClick={() => setVista("calendario")}>🗓 Calendário</NavBtn>
          <NavBtn ativo={vista === "kanban"}     onClick={() => setVista("kanban")}>🗂 Kanban</NavBtn>
          <NavBtn ativo={vista === "crono"}      onClick={() => setVista("crono")}>📈 Cronograma</NavBtn>
        </div>
        {vista === "calendario" && (
          <div className="inline-flex gap-1 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-1 rounded-xl">
            <PerBtn ativo={periodo === "semana"} onClick={() => setPeriodo("semana")}>📆 Semana</PerBtn>
            <PerBtn ativo={periodo === "mes"}    onClick={() => setPeriodo("mes")}>🗓 Mês</PerBtn>
            <PerBtn ativo={periodo === "tri"}    onClick={() => setPeriodo("tri")}>📊 Trimestre</PerBtn>
            <PerBtn ativo={periodo === "ano"}    onClick={() => setPeriodo("ano")}>📅 Ano</PerBtn>
          </div>
        )}
      </div>

      {/* Conteúdo */}
      {alvo === "semana" && <SemanaView />}
      {alvo === "mes"    && <MesView />}
      {alvo === "tri"    && <EmBreve titulo="Trimestre" desc="Grade de semanas × dias, com janelas livres em verde." />}
      {alvo === "ano"    && <EmBreve titulo="Ano (fita)" desc="12 faixas de meses; cada dia uma célula." />}
      {alvo === "kanban" && <EmBreve titulo="Kanban" desc="Colunas = fases dos projetos; arrastar muda a fase." />}
      {alvo === "crono"  && <EmBreve titulo="Cronograma" desc="Barras por duração, swimlanes por agenda." />}
    </div>
  );
}

// ─── Navegação (botões) ─────────────────────────────────────────────────────
function NavBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
        ativo
          ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
          : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
    >
      {children}
    </button>
  );
}
function PerBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
        ativo
          ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Faixa "Para revisar" ───────────────────────────────────────────────────
function ReviewBand({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-1.5 mb-4">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400"
      >
        📥 Para revisar · 2
        {!open && <span className="font-normal text-gray-400">janela 26–30 jun · e-mail de fornecedor</span>}
        <span className={`ml-auto transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
      </button>
      {open && (
        <div className="space-y-1 px-1 pb-1">
          <ReviewItem
            lead="🟢" leadCls="bg-emerald-100 dark:bg-emerald-900/40"
            titulo="Janela de 5 dias livres — 26 a 30 jun"
            sub="sem compromissos firmes · respeitando blocos protegidos"
            acoes={<><MiniBtn tom="go">Virar viagem</MiniBtn><MiniBtn tom="no">Dispensar</MiniBtn></>}
          />
          <ReviewItem
            lead="✉️" leadCls="bg-indigo-100 dark:bg-indigo-900/40"
            titulo="E-mail de fornecedor → criar pin “Jantar c/ fornecedor”?"
            sub="detectado pela automação · Gmail"
            acoes={<><MiniBtn tom="ok">Aprovar</MiniBtn><MiniBtn tom="no">Descartar</MiniBtn></>}
          />
        </div>
      )}
    </div>
  );
}
function ReviewItem({ lead, leadCls, titulo, sub, acoes }: { lead: string; leadCls: string; titulo: string; sub: string; acoes: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg">
      <div className={`w-8 h-8 rounded-lg grid place-items-center text-base flex-none ${leadCls}`}>{lead}</div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-gray-800 dark:text-gray-100">{titulo}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400">{sub}</div>
      </div>
      <div className="flex gap-1.5 flex-none">{acoes}</div>
    </div>
  );
}
function MiniBtn({ tom, children }: { tom: "go" | "ok" | "no"; children: React.ReactNode }) {
  const cls = tom === "go"
    ? "bg-indigo-600 text-white"
    : tom === "ok"
      ? "bg-emerald-600 text-white"
      : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
  return <button type="button" className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold ${cls}`}>{children}</button>;
}

// ─── Placeholder das visões ainda não portadas ──────────────────────────────
function EmBreve({ titulo, desc }: { titulo: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
      <div className="text-3xl mb-2">🚧</div>
      <div className="font-semibold text-gray-700 dark:text-gray-200">{titulo}</div>
      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">{desc}</div>
      <div className="text-[11px] text-gray-400 mt-3">Próxima etapa do scaffold.</div>
    </div>
  );
}

// ─── Visão SEMANA (grade de horas) ──────────────────────────────────────────
type EvSemana = { ini: number; fim: number; titulo: string; agenda: string };
const DIAS_SEMANA: [string, number][] = [["Seg", 8], ["Ter", 9], ["Qua", 10], ["Qui", 11], ["Sex", 12], ["Sáb", 13], ["Dom", 14]];
const HOJE_IDX = 3;
const H0 = 0, H1 = 23, PX = 44; // dia inteiro — voos/compromissos em qualquer hora
const EVENTOS_SEMANA: Record<number, EvSemana[]> = {
  0: [{ ini: 9, fim: 10, titulo: "Alinhamento operação", agenda: "rotina" }, { ini: 15, fim: 16.5, titulo: "Visita obra Puba SP", agenda: "puba" }],
  1: [{ ini: 11, fim: 12, titulo: "Reunião SCI · folha", agenda: "rotina" }],
  2: [{ ini: 18, fim: 23, titulo: "Serviço Sororoca", agenda: "lobozo" }],
  3: [{ ini: 10, fim: 11, titulo: "Café com Marcelo", agenda: "pessoal" }, { ini: 16, fim: 17, titulo: "Call AppTip", agenda: "puba" }],
  4: [{ ini: 9, fim: 10.5, titulo: "Proposta Quibebe — André", agenda: "puba" }],
  5: [], 6: [],
};
const ALLDAY_SEMANA: Record<number, { txt: string; tipo: "lock" | "pin" }[]> = {
  5: [{ txt: "🔒 Barco — Ubatuba", tipo: "lock" }],
};

function fmtHora(h: number): string {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return mm ? `${hh}h${String(mm).padStart(2, "0")}` : `${hh}h`;
}

function SemanaView() {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Abre mostrando ~7h (mas dá pra rolar pra cima até 0h — voo de madrugada etc).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * PX;
  }, []);

  const totH = (H1 - H0 + 1) * PX;
  const horas: number[] = [];
  for (let h = H0; h <= H1; h++) horas.push(h);

  // Cada linha (header, dia-todo, horas) usa a MESMA estrutura
  // [gutter 46px][grade de 7 colunas] e TODAS vivem no mesmo container de
  // rolagem — assim a barra de scroll desloca as 3 igualmente e as colunas
  // ficam alinhadas. Header + dia-todo ficam `sticky` no topo.
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Semana · 8–14 jun</h2>
        <span className="text-[11.5px] text-gray-500 dark:text-gray-400">grade de horas (0h–23h) · linha vermelha = agora</span>
      </div>

      <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
        <div ref={scrollRef} className="max-h-[600px] overflow-y-auto">
          {/* Cabeçalho + dia-todo: grudados no topo, dentro do mesmo scroll */}
          <div className="sticky top-0 z-20 bg-white dark:bg-gray-900">
            {/* Header dos dias */}
            <div className="flex border-b border-gray-200 dark:border-gray-800">
              <div className="w-[46px] flex-none" />
              <div className="grid grid-cols-7 flex-1">
                {DIAS_SEMANA.map(([dn, dd], i) => (
                  <div key={i} className={`py-2 px-1.5 text-center border-l border-gray-200 dark:border-gray-800 ${i === HOJE_IDX ? "bg-indigo-50 dark:bg-indigo-900/30" : ""}`}>
                    <div className="text-[9.5px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">{dn}</div>
                    <div className={`text-[15px] font-semibold ${i === HOJE_IDX ? "text-indigo-700 dark:text-indigo-300" : "text-gray-800 dark:text-gray-100"}`}>{dd}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Dia-todo (locks/pins) */}
            <div className="flex border-b border-gray-200 dark:border-gray-800">
              <div className="w-[46px] flex-none grid place-items-center text-[8px] uppercase tracking-wider text-gray-400 border-r border-gray-200 dark:border-gray-800">dia<br />todo</div>
              <div className="grid grid-cols-7 flex-1">
                {DIAS_SEMANA.map((_, i) => (
                  <div key={i} className="p-1 border-l border-gray-200 dark:border-gray-800 min-h-[28px]">
                    {(ALLDAY_SEMANA[i] || []).map((a, j) => (
                      <div key={j} className={`text-[9.5px] px-1.5 py-0.5 rounded truncate ${a.tipo === "lock" ? "bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800" : "text-indigo-600 border border-dashed border-indigo-400"}`}>
                        {a.txt}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Grade de horas */}
          <div className="flex">
            <div className="w-[46px] flex-none border-r border-gray-200 dark:border-gray-800">
              {horas.map((h, idx) => (
                <div key={h} className={`h-[44px] text-[9.5px] text-gray-400 text-right pr-1.5 pt-0.5 ${idx > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>{h}h</div>
              ))}
            </div>
            <div className="grid grid-cols-7 flex-1">
              {DIAS_SEMANA.map((_, i) => (
                <div
                  key={i}
                  className={`relative border-l border-gray-200 dark:border-gray-800 ${i === HOJE_IDX ? "bg-indigo-50/40 dark:bg-indigo-900/10" : ""}`}
                  style={{
                    height: totH,
                    backgroundImage: "repeating-linear-gradient(to bottom,transparent,transparent 43px,rgba(0,0,0,.06) 43px,rgba(0,0,0,.06) 44px)",
                  }}
                >
                  {(EVENTOS_SEMANA[i] || []).map((e, j) => (
                    <div
                      key={j}
                      className="absolute left-[3px] right-[3px] rounded-md text-white text-[9.5px] leading-tight px-1.5 py-1 overflow-hidden shadow-sm"
                      style={{ background: corAgenda(e.agenda), top: (e.ini - H0) * PX, height: (e.fim - e.ini) * PX - 3 }}
                    >
                      <span className="font-bold text-[9px] opacity-90">{fmtHora(e.ini)}</span> {e.titulo}
                    </div>
                  ))}
                  {i === HOJE_IDX && (
                    <div className="absolute left-0 right-0 h-0.5 bg-rose-500 z-10" style={{ top: (15 - H0) * PX }}>
                      <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-rose-500" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Visão MÊS ──────────────────────────────────────────────────────────────
type EvMes = { txt: string; cor?: string; hora?: string; tipo?: "dim" | "pin" | "lock" };
const EVENTOS_MES: Record<number, EvMes[]> = {
  13: [{ txt: "Barco — Ubatuba", tipo: "lock" }],
  15: [{ txt: "Seis Anos de Lobozó", cor: corAgenda("lobozo"), hora: "19h" }],
  17: [{ txt: "Proposta Quibebe", cor: corAgenda("puba"), hora: "09h" }],
  19: [{ txt: "Reunião SCI · folha", cor: corAgenda("rotina"), hora: "11h" }],
  21: [{ txt: "Aluguel", tipo: "dim" }],
  24: [{ txt: "Eu e a Má", cor: corAgenda("pessoal"), hora: "08h" }],
  25: [{ txt: "Lançamento AppTip", tipo: "pin" }],
};
const JANELA_MES = new Set([26, 27, 28, 29, 30]);
const DOW = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function MesView() {
  // junho/2026 começa numa segunda (1 jun = seg). 30 dias. Grade 5×7=35.
  const celulas: ({ dia: number } | null)[] = [];
  for (let i = 0; i < 35; i++) celulas.push(i < 30 ? { dia: i + 1 } : null);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Junho 2026</h2>
        <span className="text-[11.5px] text-gray-500 dark:text-gray-400">verde = janela livre · 📌 pin · 🔒 protegido</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {DOW.map((d) => (
          <div key={d} className="text-[9.5px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold px-1 pb-0.5">{d}</div>
        ))}
        {celulas.map((c, i) => {
          if (!c) return <div key={i} className="min-h-[92px] rounded-xl border border-dashed border-gray-200 dark:border-gray-800 opacity-40" />;
          const win = JANELA_MES.has(c.dia);
          const hoje = c.dia === 11;
          return (
            <div
              key={i}
              className={`min-h-[92px] rounded-xl border p-1.5 relative ${
                win
                  ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
                  : "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800"
              } ${hoje ? "ring-2 ring-indigo-200 dark:ring-indigo-800 border-indigo-400" : ""}`}
            >
              <div className="text-[12.5px] font-semibold text-gray-500 dark:text-gray-400">{c.dia}</div>
              {win && <span className="absolute right-1.5 top-1.5 text-[8px] uppercase tracking-wide text-emerald-600 font-bold">janela</span>}
              {(EVENTOS_MES[c.dia] || []).map((e, j) => {
                const label = e.hora ? `${e.hora} ${e.txt}` : e.txt;
                if (e.tipo === "dim") return <div key={j} className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 truncate">{label}</div>;
                if (e.tipo === "pin") return <div key={j} className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 border border-dashed border-indigo-400 truncate">📌 {label}</div>;
                if (e.tipo === "lock") return <div key={j} className="mt-1 text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800 truncate">{label}</div>;
                return <div key={j} className="mt-1 text-[10px] px-1.5 py-0.5 rounded text-white truncate" style={{ background: e.cor }}>{label}</div>;
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
