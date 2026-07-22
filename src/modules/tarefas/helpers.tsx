import { useState } from "react";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { mudarStatus, atualizarTarefa, CamposObrigatoriosFaltantesError } from "./repository";
import { type Tarefa, type TarefaStatus } from "../../core/types";

export async function mudarStatusComErro(id: string, status: TarefaStatus, autor: { id: string; nome: string }) {
  try {
    await mudarStatus(id, status, autor);
  } catch (e) {
    if (e instanceof CamposObrigatoriosFaltantesError) {
      alert(`Não dá pra concluir — campos obrigatórios faltando:\n\n• ${e.faltantes.join("\n• ")}`);
      return;
    }
    throw e;
  }
}
export type Tab = "minhas" | "tudo" | "projeto" | "admin" | "lixeira" | "todas" | "ideias";
export type ViewMode = "calendario" | "lista" | "kanban";

// Avatar de iniciais do responsável (2 letras) numa bolinha de cor estável por
// pessoa — pra bater o olho em quem é o dono do card.
// Órfãs do sistema de prazo ANTIGO: tarefas persistidas com origem conta_fixa/
// manutencao/admissao (esta última = exames/uniformes gerados na admissão). O
// filtro que as escondia (ORIGEM_DERIVADA) saiu junto com o maquinário de
// derivados na Fase 3. Agora essas datas vivem no módulo Prazos.
const ORFAS_PRAZO = new Set(["conta_fixa", "manutencao", "admissao"]);
export const semOrfasPrazo = (ts: Tarefa[]): Tarefa[] => ts.filter((t) => !ORFAS_PRAZO.has(t.origem));

// A área legada "Prazos" foi aposentada — datas que vencem vivem no módulo
// Prazos dedicado. Removida de toda a UI do gestor (chips, breadcrumb, admin,
// sidebar). Filtramos na fonte pra garantir consistência em todos consumidores.
export const ehAreaPrazos = (p: { id?: string; nome?: string }): boolean =>
  p.id === "proj-prazos" || /praz/i.test(p.nome || "");

// Conversão YYYY-MM-DD ↔ dd/mm/aaaa pro DatePickerBR no modal de tarefa.
export const ymdParaBr = (ymd: string): string => { if (!ymd) return ""; const [a, m, d] = ymd.split("-"); return d ? `${d}/${m}/${a}` : ""; };
export const brParaYmd = (br: string): string => { const [d, m, a] = br.split("/"); return (d && m && a) ? `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : ""; };

const AVATAR_CORES = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#dc2626", "#0d9488", "#2563eb", "#9333ea"];
function iniciaisNome(nome?: string): string {
  const parts = (nome || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function corAvatar(key: string): string {
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_CORES[h % AVATAR_CORES.length];
}
export function AvatarIniciais({ nome, id, size = 22, className = "" }: { nome?: string; id?: string; size?: number; className?: string }) {
  if (!nome && !id) return null;
  return (
    <span title={nome || "Responsável"} className={`inline-flex items-center justify-center rounded-full text-white font-bold shrink-0 ${className}`}
      style={{ width: size, height: size, background: corAvatar(id || nome || ""), fontSize: Math.round(size * 0.42), lineHeight: 1 }}>
      {iniciaisNome(nome)}
    </span>
  );
}

// Badge da(s) empresa(s) de um card (usa restaurantIds). Lê o contexto — sem
// prop threading. Mostra o nome; se for mais de uma, "Nome +N".
export function EmpresaBadge({ ids, className = "" }: { ids?: string[]; className?: string }) {
  const { restaurants } = useRestaurant();
  if (!ids || !ids.length) return null;
  const nomes = ids.map(id => restaurants.find(r => r.id === id)?.nome || "?");
  const label = nomes.length === 1 ? nomes[0] : `${nomes[0]} +${nomes.length - 1}`;
  return (
    <span title={nomes.join(", ")} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 text-[10px] font-medium whitespace-nowrap max-w-[120px] ${className}`}>
      <span className="truncate">🏢 {label}</span>
    </span>
  );
}

export function ViewSwitcher({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: { id: ViewMode; icon: string; label: string }[] = [
    { id: "calendario", icon: "📅", label: "Calendário" },
    { id: "lista", icon: "📋", label: "Lista" },
    { id: "kanban", icon: "📊", label: "Kanban" },
  ];
  return (
    <div className="inline-flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 mb-4">
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            value === o.id
              ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
          }`}
        >
          <span className="mr-1.5">{o.icon}</span>{o.label}
        </button>
      ))}
    </div>
  );
}

// ─── VIEW: Minhas Tarefas ─────────────────────────────────────────────────

export function FiltroChip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        ativo
          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300"
          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
      }`}
    >{children}</button>
  );
}

// ─── COMPONENTE: Card de Tarefa ───────────────────────────────────────────

// Multi-picker simples: chips + select com opções restantes. Reusado em
// co-responsáveis e observadores.
export function PessoasMultiPicker({ value, onChange, pessoas, excluir, placeholder }: {
  value: string[];
  onChange: (ids: string[]) => void;
  pessoas: Array<{ id: string; nome: string }>;
  excluir?: string[];
  placeholder?: string;
}) {
  const excluirSet = new Set([...(excluir || []), ...value]);
  const disponiveis = pessoas.filter(p => !excluirSet.has(p.id));
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {value.map(id => {
          const p = pessoas.find(x => x.id === id);
          return (
            <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[11px]">
              {p?.nome || id}
              <button onClick={() => onChange(value.filter(v => v !== id))} className="hover:text-rose-600">×</button>
            </span>
          );
        })}
      </div>
      {disponiveis.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }}
          /* h-[38px] alinha com inputs/selects do mesmo form (NovaTarefaModal,
             Automações). Box-sizing border-box vem do Tailwind reset. */
          className="w-full h-[38px] px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
        >
          <option value="">{placeholder || "+ adicionar"}</option>
          {disponiveis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      )}
    </div>
  );
}

export function inicioSemanaSeg(yyyymmdd: string): string {
  const d = new Date(yyyymmdd + "T12:00:00");
  const dow = d.getDay(); // 0=Dom..6=Sab
  const offset = dow === 0 ? -6 : 1 - dow; // shift pra segunda
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// Badge objetivo por TIPO de tarefa (origem) — label curto + cor + ícone.
// Manual/sem origem cai no projeto (nome + cor + emoji).
const TAREFA_CAT_META: Record<string, { label: string; cor: string; icon: string }> = {
  conta_fixa:       { label: "Conta",       cor: "#10b981", icon: "💵" },
  manutencao:       { label: "Técnico",     cor: "#f59e0b", icon: "🛠️" },
  admissao:         { label: "Trabalhista", cor: "#8b5cf6", icon: "🧑‍⚖️" },
  demissao:         { label: "Demissão",    cor: "#ef4444", icon: "👋" },
  ferias:           { label: "Férias",      cor: "#0ea5e9", icon: "🏖️" },
  reuniao:          { label: "Reunião",     cor: "#6366f1", icon: "🗣️" },
  evento:           { label: "Evento",      cor: "#ec4899", icon: "🎉" },
  recorrencia:      { label: "Rotina",      cor: "#14b8a6", icon: "🔁" },
  lote_financeiro:  { label: "Financeiro",  cor: "#22c55e", icon: "📦" },
  portal_empregado: { label: "Portal",      cor: "#64748b", icon: "📲" },
};
export function catDaTarefa(origem: string, proj?: { nome?: string; cor?: string; emoji?: string }): { label: string; cor: string; icon: string } {
  return TAREFA_CAT_META[origem] || { label: proj?.nome || "Tarefa", cor: proj?.cor || "#6b7280", icon: proj?.emoji || "📁" };
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>
      {children}
    </label>
  );
}

// ─── MODAL: Detalhe da Tarefa ─────────────────────────────────────────────

// Helper de linha label/valor. Asana usa label fixo à esquerda, valor à direita
// com hover-edit. Aqui mantemos selects/inputs inline pra simplificar — mas
// removendo a moldura visual quando não está em hover.
export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-40 shrink-0 text-xs text-gray-500 dark:text-gray-400 pt-1.5">{label}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── Custom fields tipados (preenchidos por tarefa) ──────────────────────

export function UsuariosAutorizadosPicker({ ids, pessoas, excluir, onChange }: {
  ids: string[];
  pessoas: Array<{ id: string; nome: string }>;
  excluir?: string[];          // pessoas que já têm acesso por outras vias
  onChange: (ids: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const excluirSet = new Set([...(excluir || []), ...ids]);
  const disponiveis = pessoas.filter(p => !excluirSet.has(p.id));

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {ids.map(id => {
        const nome = pessoas.find(p => p.id === id)?.nome || "—";
        return (
          <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs">
            🔒 {nome}
            <button onClick={() => onChange(ids.filter(x => x !== id))} className="text-amber-400 hover:text-red-500 ml-1">×</button>
          </span>
        );
      })}
      {!aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="text-xs px-2 py-0.5 rounded-full border border-dashed border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
        >
          + autorizar pessoa
        </button>
      ) : (
        <select
          autoFocus
          onChange={(e) => { if (e.target.value) onChange([...ids, e.target.value]); setAberto(false); }}
          onBlur={() => setAberto(false)}
          className="text-xs px-2 py-0.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
          defaultValue=""
        >
          <option value="" disabled>— escolha —</option>
          {disponiveis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      )}
    </div>
  );
}

// ─── Picker de co-responsáveis ─────────────────────────────────────────────

export function CoRespPicker({ tarefa, pessoas, autor }: {
  tarefa: Tarefa;
  pessoas: Array<{ id: string; nome: string }>;
  autor: { id: string; nome: string };
}) {
  const [aberto, setAberto] = useState(false);
  const atuais = tarefa.coResponsaveis || [];
  const atuaisNomes = tarefa.coResponsaveisNomes || [];

  async function remover(id: string) {
    const novoIds = atuais.filter(x => x !== id);
    const novoNomes = atuaisNomes.filter((_, i) => atuais[i] !== id);
    const removidoNome = pessoas.find(p => p.id === id)?.nome
      || atuaisNomes[atuais.indexOf(id)] || "—";
    await atualizarTarefa(tarefa.id, {
      coResponsaveis: novoIds,
      coResponsaveisNomes: novoNomes,
    }, autor, {
      acao: "co_resp_removido",
      detalhe: removidoNome,
    });
  }
  async function adicionar(id: string) {
    if (atuais.includes(id) || id === tarefa.responsavelId) return;
    const pessoa = pessoas.find(p => p.id === id);
    if (!pessoa) return;
    await atualizarTarefa(tarefa.id, {
      coResponsaveis: [...atuais, id],
      coResponsaveisNomes: [...atuaisNomes, pessoa.nome],
    }, autor, {
      acao: "co_resp_adicionado",
      detalhe: pessoa.nome,
    });
    setAberto(false);
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {atuais.map((id, i) => {
        const nome = pessoas.find(p => p.id === id)?.nome || atuaisNomes[i] || "—";
        return (
          <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs">
            {nome}
            <button onClick={() => remover(id)} className="text-indigo-400 hover:text-red-500 ml-1">×</button>
          </span>
        );
      })}
      {!aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="text-xs px-2 py-0.5 rounded-full border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          + co-responsável
        </button>
      ) : (
        <select
          autoFocus
          onChange={(e) => adicionar(e.target.value)}
          onBlur={() => setAberto(false)}
          className="text-xs px-2 py-0.5 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
          defaultValue=""
        >
          <option value="" disabled>— escolha —</option>
          {pessoas
            .filter(p => !atuais.includes(p.id) && p.id !== tarefa.responsavelId)
            .map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      )}
    </div>
  );
}

// ─── Seção de subtarefas com CRUD completo ────────────────────────────────

