// ════════════════════════════════════════════════════════════════════════════
//  Ferramentas e Credenciais — catálogo de acessos a sistemas externos.
//
//  Princípio: o app NÃO guarda senha. Só metadado + link pro Bitwarden.
//
//  2 modos (toggle no topo):
//   - "Minhas" (default) — usuário vê só tools onde está em usuariosAutorizados
//   - "Gerenciar" — master / quem tem ferramentasCredenciais.gerenciar:
//     CRUD completo + picker de usuários + seed Lobozó
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canAcao } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import {
  FERRAMENTA_CATEGORIA_LABEL,
  FERRAMENTA_METODO_LABEL,
} from "../../core/types";
import type {
  Tool,
  FerramentaCategoria,
  FerramentaMetodoAcesso,
  Pessoa,
} from "../../core/types";
import { subscribeToolsByRestaurant, deleteTool } from "./repository";
import { seedLobozo } from "./seed";
import { FerramentaEditorModal } from "./FerramentaEditorModal";

const CATEGORIAS_ORDEM: FerramentaCategoria[] = [
  "delivery", "fornecedores", "operacao", "financeiro", "rh", "infra", "identidade", "restrito",
];

// Badge color por método de acesso (combina com o mockup)
const METODO_BADGE_CLASS: Record<FerramentaMetodoAcesso, string> = {
  login_proprio:        "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  senha_compartilhada:  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  senha_oculta:         "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  fisico:               "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  restrito:             "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  delegado_sso:         "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  dormente:             "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export function FerramentasCredenciaisPage() {
  const { pessoa: me } = useAuth();
  const { activeId: rid, activeRestaurant } = useRestaurant();
  // Seed Lobozó é específico do Lobozó (a planilha-blueprint do briefing).
  // Pra outros restaurantes, o gestor cria do zero ou usaremos seeds próprios
  // quando existirem.
  const isLobozo = !!activeRestaurant && (
    /lobo[zó]/i.test(activeRestaurant.nome) || activeRestaurant.shortCode === "LOB"
  );
  const [tools, setTools] = useState<Tool[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [catFiltro, setCatFiltro] = useState<FerramentaCategoria | "todas">("todas");
  const [editando, setEditando] = useState<Tool | "nova" | null>(null);
  const [seedando, setSeedando] = useState(false);

  // Modos: "minhas" (usuário) vs "gerenciar" (admin). Usuário sem
  // permissão de gerenciar fica preso em "minhas".
  const podeGerenciar = !!me?.isMaster || !!(me && rid && canAcao(me, rid, "ferramentasCredenciais", "gerenciar"));
  const [modo, setModo] = useState<"minhas" | "gerenciar">("minhas");

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const unsubTools = subscribeToolsByRestaurant(rid, (arr) => {
      setTools(arr);
      setLoading(false);
    });
    const unsubPessoas = onSnapshot(
      query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid)),
      (snap) => {
        const arr: Pessoa[] = [];
        snap.forEach(d => arr.push({ id: d.id, ...(d.data() as Omit<Pessoa, "id">) }));
        arr.sort((a, b) => a.nome.localeCompare(b.nome));
        setPessoas(arr);
      },
    );
    return () => { unsubTools(); unsubPessoas(); };
  }, [rid]);

  // Lista filtrada conforme modo + busca + chip
  const toolsVisiveis = useMemo(() => {
    let arr = tools;
    if (modo === "minhas" && !me?.isMaster) {
      arr = arr.filter(t => me && t.usuariosAutorizados.includes(me.id));
    }
    if (modo === "minhas") {
      // No modo usuário, esconde dormentes
      arr = arr.filter(t => t.status === "ativo");
    }
    if (catFiltro !== "todas") {
      arr = arr.filter(t => t.categoria === catFiltro);
    }
    const t = busca.toLowerCase().trim();
    if (t) {
      arr = arr.filter(x => {
        const hay = `${x.nome} ${x.necessidade} ${x.tags.join(" ")}`.toLowerCase();
        return hay.includes(t);
      });
    }
    return arr;
  }, [tools, modo, me, catFiltro, busca]);

  // Agrupa por categoria pra render
  const porCategoria = useMemo(() => {
    const m: Partial<Record<FerramentaCategoria, Tool[]>> = {};
    for (const t of toolsVisiveis) {
      if (!m[t.categoria]) m[t.categoria] = [];
      m[t.categoria]!.push(t);
    }
    return m;
  }, [toolsVisiveis]);

  async function handleSeed() {
    if (!rid || !me?.id) return;
    if (!confirm("Carregar seed do Lobozó (8 ferramentas)? Idempotente — não duplica.")) return;
    setSeedando(true);
    try {
      const r = await seedLobozo(rid, me.id);
      alert(`✓ ${r.criadas} criadas, ${r.jaExistiam} já existiam.`);
    } catch (e) {
      alert("Erro no seed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSeedando(false);
    }
  }

  async function handleDelete(t: Tool) {
    if (!confirm(`Excluir "${t.nome}"? Permanente.`)) return;
    await deleteTool(t.id);
  }

  if (!rid) {
    return <div className="p-6 text-gray-500">Selecione um restaurante.</div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            🔑 Ferramentas e Credenciais
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Catálogo de acessos a sistemas externos. Senhas ficam no Bitwarden.
          </p>
        </div>
        {podeGerenciar && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setModo("minhas")}
                className={`px-3 py-1.5 ${modo === "minhas" ? "bg-indigo-600 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"}`}
              >Minhas</button>
              <button
                type="button"
                onClick={() => setModo("gerenciar")}
                className={`px-3 py-1.5 ${modo === "gerenciar" ? "bg-indigo-600 text-white" : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"}`}
              >Gerenciar</button>
            </div>
            {modo === "gerenciar" && (
              <>
                {isLobozo && (
                  <Button size="sm" variant="secondary" onClick={handleSeed} disabled={seedando}>
                    {seedando ? "..." : "📦 Seed Lobozó"}
                  </Button>
                )}
                <Button size="sm" onClick={() => setEditando("nova")}>+ Nova</Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Busca + chips */}
      <div className="mb-4 space-y-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="🔍 O que você precisa fazer? (ex: 'bebida' acha BEES, Heineken...)"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
        />
        <div className="flex gap-1.5 flex-wrap">
          <Chip on={catFiltro === "todas"} onClick={() => setCatFiltro("todas")}>Todas</Chip>
          {CATEGORIAS_ORDEM.map(cat => (
            <Chip key={cat} on={catFiltro === cat} onClick={() => setCatFiltro(cat)}>
              {FERRAMENTA_CATEGORIA_LABEL[cat]}
            </Chip>
          ))}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : toolsVisiveis.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-500">
          {modo === "minhas" ? (
            <>
              <div className="text-4xl mb-3">🔑</div>
              <p className="font-medium">Você ainda não tem ferramentas atribuídas.</p>
              <p className="text-xs mt-2">Peça ao seu gestor pra cadastrar seus acessos.</p>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">📦</div>
              <p className="font-medium">Nenhuma ferramenta cadastrada.</p>
              <p className="text-xs mt-2">Clique em "Seed Lobozó" pra começar, ou "+ Nova" pra criar do zero.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {CATEGORIAS_ORDEM.map(cat => {
            const lista = porCategoria[cat];
            if (!lista || lista.length === 0) return null;
            return (
              <div key={cat}>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">
                  {FERRAMENTA_CATEGORIA_LABEL[cat]}
                </div>
                <div className="space-y-2">
                  {lista.map(t => (
                    <ToolCard
                      key={t.id}
                      tool={t}
                      pessoas={pessoas}
                      isAdmin={modo === "gerenciar"}
                      onEdit={() => setEditando(t)}
                      onDelete={() => handleDelete(t)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editando && rid && me && (
        <FerramentaEditorModal
          tool={editando === "nova" ? null : editando}
          rid={rid}
          pessoaId={me.id}
          pessoas={pessoas}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function Chip({
  on, onClick, children,
}: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
        on
          ? "bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100"
          : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
      }`}
    >
      {children}
    </button>
  );
}

function ToolCard({
  tool, pessoas, isAdmin, onEdit, onDelete,
}: {
  tool: Tool;
  pessoas: Pessoa[];
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pessoasMap = useMemo(
    () => Object.fromEntries(pessoas.map(p => [p.id, p.nome])),
    [pessoas],
  );
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-lg shrink-0">
          {tool.icone || "🔧"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-medium text-gray-900 dark:text-gray-100">{tool.nome}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${METODO_BADGE_CLASS[tool.metodoAcesso]}`}>
              {FERRAMENTA_METODO_LABEL[tool.metodoAcesso]}
            </span>
            {tool.status === "dormente" && (
              <span className="text-[10px] px-2 py-0.5 rounded font-semibold uppercase bg-gray-200 dark:bg-gray-700 text-gray-500">Dormente</span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{tool.necessidade}</p>
          <AcaoFerramenta tool={tool} pessoasMap={pessoasMap} />
        </div>
        {isAdmin && (
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >Editar</button>
            <button
              type="button"
              onClick={onDelete}
              className="text-xs px-2 py-1 rounded border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30"
            >Excluir</button>
          </div>
        )}
      </div>
      {isAdmin && tool.usuariosAutorizados.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
          <strong>Acesso:</strong>{" "}
          {tool.usuariosAutorizados.map(uid => pessoasMap[uid] || "?").join(", ")}
        </div>
      )}
    </div>
  );
}

function AcaoFerramenta({
  tool, pessoasMap,
}: { tool: Tool; pessoasMap: Record<string, string> }) {
  switch (tool.metodoAcesso) {
    case "login_proprio":
      return (
        <div className="text-xs text-gray-600 dark:text-gray-400">
          {tool.instrucoesAcesso || "Login próprio — peça acesso ao responsável."}
        </div>
      );
    case "senha_compartilhada":
      return tool.bitwardenItemUrl ? (
        <a
          href={tool.bitwardenItemUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          ↗ Abrir senha no Bitwarden
        </a>
      ) : (
        <div className="text-xs text-gray-500 italic">Link Bitwarden não cadastrado.</div>
      );
    case "senha_oculta":
      return tool.bitwardenItemUrl ? (
        <a
          href={tool.bitwardenItemUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          ↗ Abrir no Bitwarden (autofill)
        </a>
      ) : (
        <div className="text-xs text-gray-500 italic">Link Bitwarden não cadastrado.</div>
      );
    case "fisico":
      return (
        <div className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
          📍 {tool.localFisico || "Local físico não especificado."}
        </div>
      );
    case "restrito":
      return (
        <div className="text-xs text-gray-600 dark:text-gray-400">
          🔒 Acesso restrito — fale com{" "}
          <strong>{tool.responsavel ? (pessoasMap[tool.responsavel] || tool.responsavel) : "o responsável"}</strong>.
        </div>
      );
    case "delegado_sso":
      return (
        <div className="text-xs text-gray-600 dark:text-gray-400">
          Entrar via SSO (login federado).
        </div>
      );
    case "dormente":
      return (
        <div className="text-xs text-gray-500 italic">Conta dormente — sem uso ativo.</div>
      );
  }
}
