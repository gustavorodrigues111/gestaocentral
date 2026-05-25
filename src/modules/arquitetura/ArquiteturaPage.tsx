import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { AREA_INFO, MODULES, getModule } from "../../config/modules";
import { ROADMAP } from "../../config/roadmap";
import type { AuditLog, ModuleArea, ModuleDef, ModuleId, Restaurant } from "../../core/types";

type Tab = "modulos" | "dados" | "roadmap" | "permissoes" | "historico";

export function ArquiteturaPage() {
  const [tab, setTab] = useState<Tab>("modulos");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "modulos",     label: "Mapa de módulos",  icon: "🗺️" },
    { id: "dados",       label: "Modelo de dados",  icon: "🗄️" },
    { id: "roadmap",     label: "Roadmap",          icon: "🛣️" },
    { id: "permissoes",  label: "Permissões",       icon: "🔐" },
    { id: "historico",   label: "Histórico global", icon: "📋" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🏗️ Arquitetura</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Mapa do sistema. Atualiza automaticamente conforme o código evolui — use pra planejar antes de construir.
        </p>
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-6 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "modulos"    && <MapaModulos />}
      {tab === "dados"      && <ModeloDados />}
      {tab === "roadmap"    && <RoadmapView />}
      {tab === "permissoes" && <PermissoesView />}
      {tab === "historico"  && <HistoricoGlobal />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 1: MAPA DE MÓDULOS
// ════════════════════════════════════════════════════════════════

function MapaModulos() {
  const areas: ModuleArea[] = ["escritorio", "time", "operacao"];

  // Index reverso: pra cada módulo, descobre quem depende dele
  const dependentes = useMemo(() => {
    const m: Record<string, ModuleId[]> = {};
    for (const mod of MODULES) {
      for (const dep of mod.dependsOn || []) {
        if (!m[dep]) m[dep] = [];
        m[dep].push(mod.id);
      }
    }
    return m;
  }, []);

  // Estatísticas
  const stats = useMemo(() => {
    const ativo = MODULES.filter(m => m.status === "ativo").length;
    const breve = MODULES.filter(m => m.status === "em-breve").length;
    const plan  = MODULES.filter(m => m.status === "planejado").length;
    return { ativo, breve, plan, total: MODULES.length };
  }, []);

  return (
    <div>
      <div className="grid grid-cols-4 gap-3 mb-5">
        <Stat label="Total" value={stats.total} />
        <Stat label="Ativos" value={stats.ativo} variant="ok" />
        <Stat label="Em breve" value={stats.breve} variant="warn" />
        <Stat label="Planejados" value={stats.plan} variant="muted" />
      </div>

      <Legenda />

      <div className="space-y-6 mt-5">
        {areas.map(area => (
          <AreaSection key={area} area={area} dependentes={dependentes} />
        ))}
      </div>
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mb-2">
      <span className="font-semibold uppercase tracking-wider">Status:</span>
      <StatusBadge status="ativo" />
      <StatusBadge status="em-breve" />
      <StatusBadge status="planejado" />
    </div>
  );
}

function StatusBadge({ status }: { status: ModuleDef["status"] }) {
  const cls = status === "ativo"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : status === "em-breve"
    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  const label = status === "ativo" ? "✓ Ativo" : status === "em-breve" ? "⏳ Em breve" : "○ Planejado";
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{label}</span>;
}

function AreaSection({ area, dependentes }: { area: ModuleArea; dependentes: Record<string, ModuleId[]> }) {
  const info = AREA_INFO[area];
  const mods = MODULES.filter(m => m.area === area);
  // Ordena: ativo > em-breve > planejado, depois alfabético
  const order: Record<ModuleDef["status"], number> = { ativo: 0, "em-breve": 1, planejado: 2 };
  const sorted = [...mods].sort((a, b) =>
    order[a.status] - order[b.status] || a.label.localeCompare(b.label)
  );
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: info.color }}>
          {info.label}
        </span>
        <span className="text-xs text-gray-400">— {info.desc}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map(m => (
          <ModuleCard key={m.id} mod={m} dependentes={dependentes[m.id] || []} accent={info.color} />
        ))}
      </div>
    </div>
  );
}

function ModuleCard({ mod, dependentes, accent }: {
  mod: ModuleDef;
  dependentes: ModuleId[];
  accent: string;
}) {
  const cls = mod.status === "ativo"
    ? "border-l-4"
    : mod.status === "em-breve"
    ? "border-l-4 border-dashed"
    : "border-l-4 opacity-70";
  const borderColor = mod.status === "ativo" ? accent
                    : mod.status === "em-breve" ? "#f59e0b"
                    : "#9ca3af";

  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 ${cls}`}
      style={{ borderLeftColor: borderColor }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">{mod.icon}</span>
          <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{mod.label}</span>
        </div>
        <StatusBadge status={mod.status} />
      </div>
      {mod.desc && <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{mod.desc}</p>}
      {(mod.dependsOn?.length || 0) > 0 && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
          <span className="font-semibold">↓ depende de:</span>{" "}
          {mod.dependsOn!.map(id => <ChipModule key={id} id={id} />)}
        </div>
      )}
      {dependentes.length > 0 && (
        <div className="text-[11px] text-gray-500 dark:text-gray-400">
          <span className="font-semibold">↑ usado por:</span>{" "}
          {dependentes.map(id => <ChipModule key={id} id={id} />)}
        </div>
      )}
    </div>
  );
}

function ChipModule({ id }: { id: ModuleId }) {
  const m = getModule(id);
  if (!m) return <span className="text-rose-500">{id}?</span>;
  return (
    <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-[10px] mr-1">
      {m.icon} {m.label}
    </span>
  );
}

function Stat({ label, value, variant }: { label: string; value: number; variant?: "ok" | "warn" | "muted" }) {
  const cls =
    variant === "ok"    ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
  : variant === "warn"  ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 text-amber-700 dark:text-amber-300"
  : variant === "muted" ? "border-gray-200 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700 text-gray-600 dark:text-gray-400"
  :                       "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-70 mb-1">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 2: MODELO DE DADOS
// ════════════════════════════════════════════════════════════════

type Entity = {
  name: string;
  icon: string;
  desc: string;
  fields: string[];
  relations: { label: string; to: string }[];
  collection: string;
  status: "ativo" | "planejado";
};

const ENTITIES: Entity[] = [
  {
    name: "Restaurant", icon: "🏠",
    desc: "Restaurante (4 do grupo)",
    collection: "restaurants",
    status: "ativo",
    fields: ["id", "nome", "shortCode", "cnpj?", "modulosAtivos[]", "portalEmpregado{...}", "taxRate?"],
    relations: [
      { label: "tem N", to: "Empregado" },
      { label: "tem N", to: "Cargo" },
      { label: "tem N", to: "EscalaMes" },
      { label: "tem N", to: "Gorjeta" },
      { label: "tem N", to: "VTFolha" },
      { label: "tem N", to: "AccessProfile" },
    ],
  },
  {
    name: "Pessoa", icon: "👤",
    desc: "Usuário do sistema (qualquer um: dono, contador, gestor, empregado…)",
    collection: "pessoas",
    status: "ativo",
    fields: ["id (=uid)", "email", "nome", "cpf?", "isMaster", "restaurantIds[]", "permissions{rid: {moduloId: {ver, configurar}}}", "specialPermissions{rid: {pessoasExcluir?}}", "ativa", "inativadaEm?"],
    relations: [
      { label: "acesso a N", to: "Restaurant" },
      { label: "vínculo opcional 1:N", to: "Empregado" },
    ],
  },
  {
    name: "Cargo", icon: "🏷️",
    desc: "Cargo do restaurante. Carrega tipoVinculo, regra de gorjeta, área.",
    collection: "cargos",
    status: "ativo",
    fields: ["id", "restaurantId", "nome", "area", "tipoVinculo (registrado/provisorio/estagiario/terceirizado)", "pontos", "semGorjeta", "recebeProducao", "ativo"],
    relations: [{ label: "tem N", to: "Empregado" }],
  },
  {
    name: "Empregado", icon: "👥",
    desc: "Membro da equipe (com ou sem registro). Trilha completa em periodos[].",
    collection: "empregados",
    status: "ativo",
    fields: ["id", "restaurantId", "pessoaId? (só registrados)", "nome", "cpf?", "cargoId", "periodos[{admissao, demissao?}]", "estaAtivo", "vtAtivo?", "vtPassagensPorDia?", "vtValorPassagem?"],
    relations: [
      { label: "tem 1", to: "Cargo" },
      { label: "tem 1 (opcional)", to: "Pessoa" },
      { label: "está em N", to: "EscalaMes" },
    ],
  },
  {
    name: "EscalaMes", icon: "📅",
    desc: "Escala de 1 mês com 2 versões: prevista (planejamento) e real (depois)",
    collection: "escalas",
    status: "ativo",
    fields: ["id (=rid_yyyy-mm)", "restaurantId", "ano", "mes", "prevista{empId: {date: status}}", "real{empId: {date: status}}", "vtPagoEm?", "fechadoEm?"],
    relations: [{ label: "alimenta", to: "Gorjeta" }, { label: "alimenta", to: "VTFolha" }],
  },
  {
    name: "Gorjeta", icon: "💸",
    desc: "Lançamento diário de gorjeta",
    collection: "gorjetas",
    status: "ativo",
    fields: ["id (=rid_yyyy-mm-dd)", "restaurantId", "date", "valorBruto", "taxRate", "valorLiquido", "paidAt?"],
    relations: [{ label: "depende de", to: "EscalaMes" }, { label: "depende de", to: "Cargo" }],
  },
  {
    name: "VTFolha", icon: "🚌",
    desc: "Folha mensal de Vale Transporte",
    collection: "vtFolhas",
    status: "ativo",
    fields: ["id (=rid_yyyy-mm)", "restaurantId", "ano", "mes", "itens{empId: {dias, total, paidAt?}}"],
    relations: [{ label: "depende de", to: "EscalaMes" }, { label: "depende de", to: "Empregado" }],
  },
  {
    name: "AccessProfile", icon: "🛡️",
    desc: "Perfil de Acesso. Master define o que cada perfil pode fazer (ações granulares). Pessoas recebem 1 perfil por restaurante.",
    collection: "accessProfiles",
    status: "ativo",
    fields: ["id", "nome", "descricao?", "builtin", "restaurantId? (null=global)", "permissions{moduloId: {acaoId: boolean}}", "criadoEm", "criadoPor"],
    relations: [{ label: "aplicado a N", to: "Pessoa" }],
  },
  {
    name: "Historico", icon: "📜",
    desc: "Versões de campos críticos com data de vigência (cargo, vt, pontos, taxRate)",
    collection: "historicos",
    status: "planejado",
    fields: ["id (=entityType_entityId_campo)", "entityType", "entityId", "campo", "versoes[{valor, inicio, fim?, motivo?}]"],
    relations: [],
  },
  {
    name: "AuditLog", icon: "📝",
    desc: "Registro de TODA mudança crítica (criar, alterar, demitir, excluir, etc.)",
    collection: "auditLog",
    status: "planejado",
    fields: ["id", "entityType", "entityId", "acao", "diff{campo: {antes, depois}}", "vigenteApartir?", "motivo?", "registradoEm", "registradoPor"],
    relations: [],
  },
  {
    name: "MudancaAgendada", icon: "⏰",
    desc: "Mudança com data futura. Aplicada automaticamente quando o dia chega.",
    collection: "mudancasAgendadas",
    status: "planejado",
    fields: ["id", "entityType", "entityId", "campo", "valorNovo", "aplicarEm (YYYY-MM-DD)", "aplicadoEm?"],
    relations: [],
  },
];

function ModeloDados() {
  const ativos = ENTITIES.filter(e => e.status === "ativo");
  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Cada coleção é uma "entidade" no Firestore. Setas mostram dependências.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ativos.map(e => <EntityCard key={e.name} entity={e} />)}
      </div>
    </div>
  );
}

function EntityCard({ entity }: { entity: Entity }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{entity.icon}</span>
          <span className="font-bold text-gray-900 dark:text-gray-100">{entity.name}</span>
        </div>
        <code className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">/{entity.collection}</code>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{entity.desc}</p>
      <div className="mb-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Campos</div>
        <div className="flex flex-wrap gap-1">
          {entity.fields.map(f => (
            <code key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
              {f}
            </code>
          ))}
        </div>
      </div>
      {entity.relations.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Relações</div>
          <ul className="space-y-0.5">
            {entity.relations.map((r, i) => (
              <li key={i} className="text-xs text-gray-600 dark:text-gray-400">
                <span className="text-gray-400">↳</span> <span className="text-gray-500">{r.label}</span>{" "}
                <span className="font-semibold text-gray-700 dark:text-gray-200">{r.to}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 3: ROADMAP
// ════════════════════════════════════════════════════════════════

function RoadmapView() {
  const completed = ROADMAP.filter(s => s.status === "completed").length;
  const active    = ROADMAP.filter(s => s.status === "active").length;
  const planned   = ROADMAP.filter(s => s.status === "planned").length;

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Stat label="Concluídas" value={completed} variant="ok" />
        <Stat label="Em andamento" value={active} variant="warn" />
        <Stat label="Planejadas" value={planned} variant="muted" />
      </div>

      <div className="space-y-3">
        {ROADMAP.map(s => <SprintCard key={s.id} sprint={s} />)}
      </div>
    </div>
  );
}

function SprintCard({ sprint }: { sprint: typeof ROADMAP[number] }) {
  const cls = sprint.status === "completed"
    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10"
    : sprint.status === "active"
    ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 ring-2 ring-amber-200 dark:ring-amber-800"
    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900";
  const icon = sprint.status === "completed" ? "✅" : sprint.status === "active" ? "🚧" : "○";

  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h3 className="font-bold text-gray-900 dark:text-gray-100">{sprint.title}</h3>
        </div>
        {sprint.modules && sprint.modules.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sprint.modules.map(id => <ChipModule key={id} id={id} />)}
          </div>
        )}
      </div>
      <ul className="space-y-1 ml-7">
        {sprint.items.map((item, i) => (
          <li key={i} className="text-sm text-gray-700 dark:text-gray-300 list-disc">{item}</li>
        ))}
      </ul>
      {sprint.notes && (
        <p className="text-xs text-gray-500 italic mt-3 ml-7">📝 {sprint.notes}</p>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 4: PERMISSÕES
// ════════════════════════════════════════════════════════════════

const ROLES = [
  { id: "owner",    label: "Owner / Master",  desc: "isMaster=true → acesso total a todos restaurantes" },
  { id: "ext",      label: "Externo (contador, consultor)", desc: "Pessoa sem vínculo de equipe. Permissões por módulo (geralmente só 'ver')" },
  { id: "emp_pure", label: "Empregado puro",   desc: "Pessoa + Empregado. Vê só Portal do Empregado (Minha Escala, Minhas Gorjetas, Comunicados). Sem permissões admin." },
  { id: "emp_admin",label: "Empregado + Admin (ex: DP)", desc: "Pessoa + Empregado + permissões admin. Vê portal + módulos administrativos juntos." },
  { id: "freela",   label: "Freela / Provisório", desc: "Empregado SEM Pessoa. Aparece em escala/gorjeta. Sem login, sem portal." },
];

function PermissoesView() {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">📐 Modelo</h3>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-sm space-y-2">
          <p className="text-gray-700 dark:text-gray-300">
            Cada pessoa tem permissões <strong>por restaurante</strong> e <strong>por módulo</strong>:
          </p>
          <pre className="bg-gray-50 dark:bg-gray-800/50 rounded p-3 text-xs overflow-x-auto">
{`pessoa.permissions = {
  [restaurantId]: {
    [moduleId]: { ver: boolean, configurar: boolean }
  }
}
pessoa.specialPermissions = {
  [restaurantId]: { pessoasExcluir?: boolean }
}`}
          </pre>
          <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-disc ml-4">
            <li><code>ver</code>: pode visualizar e usar o módulo</li>
            <li><code>configurar</code>: pode editar configurações (implica <code>ver</code>)</li>
            <li><code>isMaster: true</code> bypassa todas as checagens</li>
            <li>Especiais (transversais ao restaurante): <code>pessoasExcluir</code></li>
            <li><strong>Sem perfis fixos.</strong> Apenas permissões granulares + templates cadastráveis (ex: "Líder Sororoca")</li>
          </ul>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">👥 Perfis típicos</h3>
        <div className="space-y-2">
          {ROLES.map(r => (
            <div key={r.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">{r.label}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{r.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">🛡️ Onde checar no código</h3>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 text-xs space-y-2">
          <div>
            <code className="text-gray-700 dark:text-gray-200">canUse(pessoa, rid, moduleId)</code>
            <span className="text-gray-500"> — bool. Renderiza módulo ou bloqueia.</span>
          </div>
          <div>
            <code className="text-gray-700 dark:text-gray-200">canConfig(pessoa, rid, moduleId)</code>
            <span className="text-gray-500"> — bool. Mostra/esconde botões de edição.</span>
          </div>
          <div className="text-gray-500 mt-2">📁 src/core/auth/permissions.ts</div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 5: HISTÓRICO GLOBAL (auditLog de todos os restaurantes)
// ════════════════════════════════════════════════════════════════

const ACAO_INFO: Record<AuditLog["acao"], { label: string; icon: string; cls: string }> = {
  criado:    { label: "Criado",     icon: "✨", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  alterado:  { label: "Alterado",   icon: "✏️", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  agendado:  { label: "Agendado",   icon: "⏰", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  inativado: { label: "Inativado",  icon: "🚫", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  reativado: { label: "Reativado",  icon: "✓", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  demitido:  { label: "Demitido",   icon: "📤", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  readmitido:{ label: "Readmitido", icon: "📥", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  excluido:  { label: "Excluído",   icon: "🗑", cls: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

function HistoricoGlobal() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroPeriodo, setFiltroPeriodo] = useState<"7d" | "30d" | "90d" | "todos">("7d");
  const [filtroEntidade, setFiltroEntidade] = useState<string>("todos");
  const [filtroRestaurante, setFiltroRestaurante] = useState<string>("todos");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [snapLogs, snapRest] = await Promise.all([
          getDocs(query(collection(db, "auditLog"))),
          getDocs(query(collection(db, "restaurants"))),
        ]);
        if (!alive) return;
        const list = snapLogs.docs.map(d => ({ id: d.id, ...d.data() }) as AuditLog);
        list.sort((a, b) => (b.registradoEm || "").localeCompare(a.registradoEm || ""));
        setLogs(list);
        setRestaurants(snapRest.docs.map(d => ({ id: d.id, ...d.data() }) as Restaurant));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const restMap = useMemo(
    () => Object.fromEntries(restaurants.map(r => [r.id, r.nome])),
    [restaurants],
  );

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (filtroEntidade !== "todos" && l.entityType !== filtroEntidade) return false;
      if (filtroRestaurante !== "todos" && l.restaurantId !== filtroRestaurante) return false;
      if (filtroPeriodo !== "todos") {
        const dias = filtroPeriodo === "7d" ? 7 : filtroPeriodo === "30d" ? 30 : 90;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - dias);
        if (l.registradoEm < cutoff.toISOString()) return false;
      }
      return true;
    });
  }, [logs, filtroEntidade, filtroRestaurante, filtroPeriodo]);

  const stats = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach(l => { m[l.acao] = (m[l.acao] || 0) + 1; });
    return m;
  }, [filtered]);

  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        Timeline de todas as mudanças críticas no sistema (todos os restaurantes).
        Útil pra debug, compliance e acompanhamento.
      </p>

      {/* Stats por ação */}
      {Object.keys(stats).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {(Object.keys(stats) as AuditLog["acao"][]).map(a => (
            <div key={a} className={`px-2 py-1 rounded text-xs ${ACAO_INFO[a].cls}`}>
              {ACAO_INFO[a].icon} {ACAO_INFO[a].label}: <strong>{stats[a]}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mr-1">Período:</span>
        {(["7d", "30d", "90d", "todos"] as const).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setFiltroPeriodo(p)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filtroPeriodo === p
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
            }`}
          >
            {p === "7d" ? "7 dias" : p === "30d" ? "30 dias" : p === "90d" ? "90 dias" : "Todos"}
          </button>
        ))}
        <select
          value={filtroEntidade}
          onChange={(e) => setFiltroEntidade(e.target.value)}
          className="ml-2 text-xs px-3 py-1 rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        >
          <option value="todos">Todas entidades</option>
          <option value="empregado">Empregado</option>
          <option value="cargo">Cargo</option>
          <option value="pessoa">Pessoa</option>
          <option value="restaurant">Restaurante</option>
          <option value="permissionTemplate">Template</option>
        </select>
        <select
          value={filtroRestaurante}
          onChange={(e) => setFiltroRestaurante(e.target.value)}
          className="text-xs px-3 py-1 rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        >
          <option value="todos">Todos restaurantes</option>
          {restaurants.map(r => (
            <option key={r.id} value={r.id}>{r.nome}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhuma alteração no período</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {filtered.slice(0, 200).map((log, i) => {
            const acao = ACAO_INFO[log.acao] || ACAO_INFO.alterado;
            const data = log.registradoEm
              ? new Date(log.registradoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
              : "—";
            const restNome = log.restaurantId ? restMap[log.restaurantId] || "?" : "global";
            return (
              <div key={log.id || i} className={`px-4 py-3 ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}>
                <div className="flex items-start gap-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${acao.cls} flex-shrink-0`}>
                    {acao.icon} {acao.label}
                  </span>
                  <div className="flex-1 min-w-0 text-xs">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">{log.entityType}</span>
                      <span className="font-mono text-[10px] ml-1 opacity-60">{log.entityId.slice(0, 10)}</span>
                      <span className="ml-2 text-[10px] text-gray-400">@ {restNome}</span>
                    </div>
                    {log.motivo && (
                      <div className="text-gray-600 dark:text-gray-400 mt-0.5 italic">"{log.motivo}"</div>
                    )}
                    {log.diff && Object.keys(log.diff).length > 0 && (
                      <div className="text-gray-500 mt-1 font-mono text-[10px]">
                        {Object.keys(log.diff).slice(0, 3).join(", ")}
                        {Object.keys(log.diff).length > 3 && ` +${Object.keys(log.diff).length - 3}`}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-[10px] text-gray-400 flex-shrink-0">
                    {data}
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length > 200 && (
            <div className="px-4 py-2 text-xs text-gray-500 text-center border-t border-gray-100 dark:border-gray-800">
              Mostrando 200 de {filtered.length}. Use filtros pra refinar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
