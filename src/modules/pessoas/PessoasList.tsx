import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { statusAcesso, passaFiltroAcesso, type FiltroAcesso } from "./accessStatus";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { PessoaModal } from "./PessoaModal";
import { VincularPessoaModal } from "./VincularPessoaModal";
import { VincularAdmissaoModal } from "./VincularAdmissaoModal";
import { horarioBadgeProps, statusHorarioEmpregado } from "./horarioStatus";
import type { Area, Cargo, Empregado, Pessoa } from "../../core/types";
import { AREAS, TIPO_VINCULO_LABEL } from "../../core/types";
import { fmtBR } from "../../core/utils/date";

type FiltroStatus = "ativas" | "inativas" | "todas";
type FiltroEquipe = "todos" | "equipe" | "naoEquipe";
type FiltroArea = "todas" | Area;

type Props = { restaurantId: string };

export function PessoasList({ restaurantId }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const restaurant = restaurants.find((r) => r.id === restaurantId) || null;
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("ativas");
  const [filtroEquipe, setFiltroEquipe] = useState<FiltroEquipe>("todos");
  const [filtroArea, setFiltroArea] = useState<FiltroArea>("todas");
  const [filtroAcesso, setFiltroAcesso] = useState<FiltroAcesso>("todos");
  // Perfis carregados pra calcular badges de acesso (resolução de perfil
  // custom funciona com a lista mergeada built-in + Firestore).
  const { perfis } = useAccessProfiles();
  const [editing, setEditing] = useState<Pessoa | "new" | null>(null);
  // Fluxo de vínculo: "chooser" abre o seletor; "admissao" puxa de uma admissão
  // pronta; "existente" vincula pessoa já cadastrada em outro restaurante.
  const [vincularModo, setVincularModo] = useState<"chooser" | "admissao" | "existente" | null>(null);
  // Gates granulares de ações (sistema novo de perfis)
  const { can } = useCanAcao(restaurantId);
  const podeCriar = !!me?.isMaster || can("pessoas", "criar");
  const podeVincular = !!me?.isMaster || can("pessoas", "atribuirRest");
  // podeConfig mantido como proxy genérico — usado em outros pontos do file
  // que ainda dependem da semântica "pode mexer em pessoas". Será substituído
  // por gates específicos quando refinarmos detalhes em rodadas futuras.
  const podeConfig = !!me?.isMaster || podeCriar || podeVincular
    || can("pessoas", "editarDados") || can("pessoas", "demitir") || can("pessoas", "excluir");

  // Pessoas com acesso a esse restaurante
  useEffect(() => {
    if (!restaurantId) return;
    setLoading(true);
    const q = query(collection(db, "pessoas"), where("restaurantIds", "array-contains", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa));
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  // Empregados do restaurante (pra saber quem é equipe + qual cargo)
  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [restaurantId]);

  // Cargos (pra mostrar nome)
  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [restaurantId]);

  // Mapeamento pessoaId → empregado deste restaurante
  const empPorPessoa = useMemo(() => {
    const m: Record<string, Empregado> = {};
    for (const e of empregados) {
      if (e.pessoaId) m[e.pessoaId] = e;
    }
    return m;
  }, [empregados]);
  const cargoMap = useMemo(() => Object.fromEntries(cargos.map(c => [c.id, c])), [cargos]);

  // Aplica filtros + busca
  const filtered = useMemo(() => {
    return pessoas.filter(p => {
      const isAtiva = p.ativa !== false;
      if (filtroStatus === "ativas"  && !isAtiva) return false;
      if (filtroStatus === "inativas" && isAtiva) return false;

      const ehEquipe = !!empPorPessoa[p.id];
      if (filtroEquipe === "equipe"    && !ehEquipe) return false;
      if (filtroEquipe === "naoEquipe" && ehEquipe) return false;

      // Filtro de área: só faz sentido quando filtrando por equipe + tem cargo
      if (filtroEquipe === "equipe" && filtroArea !== "todas") {
        const emp = empPorPessoa[p.id];
        const cargo = emp ? cargoMap[emp.cargoId] : null;
        if (!cargo || cargo.area !== filtroArea) return false;
      }

      // Filtro de acesso (Pronto/Com pendência/Nunca logou)
      if (filtroAcesso !== "todos") {
        const badges = statusAcesso(p, restaurantId, empPorPessoa[p.id], perfis);
        if (!passaFiltroAcesso(badges, filtroAcesso)) return false;
      }

      if (!search.trim()) return true;
      const s = search.toLowerCase();
      // CPF: compara só os dígitos (aceita digitar com ou sem pontos/traço).
      // Só busca por CPF quando o termo tem ao menos 1 dígito, senão "includes"
      // de string vazia casaria com todo mundo e quebraria a busca por nome.
      const sDigits = s.replace(/\D/g, "");
      return (p.nome || "").toLowerCase().includes(s)
          || (p.email || "").toLowerCase().includes(s)
          || (sDigits.length > 0 && (p.cpf || "").replace(/\D/g, "").includes(sDigits));
    }).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  }, [pessoas, empPorPessoa, cargoMap, filtroStatus, filtroEquipe, filtroArea, filtroAcesso, perfis, restaurantId, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} pessoa(s)</p>
        {(podeCriar || podeVincular) && (
          <div className="flex gap-2">
            {podeVincular && (
              <Button variant="secondary" onClick={() => setVincularModo("chooser")} title="Vincular de uma admissão ou de pessoa já cadastrada em outro restaurante">
                🔗 Vincular
              </Button>
            )}
            {podeCriar && (
              <Button onClick={() => setEditing("new")}>+ Nova pessoa</Button>
            )}
          </div>
        )}
      </div>

      <Input
        placeholder="🔍 Buscar por nome, email ou CPF..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3"
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mr-1">Status:</span>
        {(["ativas", "inativas", "todas"] as FiltroStatus[]).map(f => (
          <FilterChip key={f} active={filtroStatus === f} onClick={() => setFiltroStatus(f)}>
            {f === "ativas" ? "✓ Ativas" : f === "inativas" ? "○ Inativas" : "Todas"}
          </FilterChip>
        ))}
        <span className="ml-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 mr-1">Tipo:</span>
        {(["todos", "equipe", "naoEquipe"] as FiltroEquipe[]).map(f => (
          <FilterChip key={f} active={filtroEquipe === f} onClick={() => {
            setFiltroEquipe(f);
            // Sair de "equipe" → reseta filtro de área (deixa de fazer sentido)
            if (f !== "equipe") setFiltroArea("todas");
          }}>
            {f === "todos" ? "Todos" : f === "equipe" ? "👥 Equipe" : "🧑 Só usuários"}
          </FilterChip>
        ))}

        <span className="ml-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 mr-1">Acesso:</span>
        {(["todos", "comPendencia", "pronto", "nuncaLogou"] as FiltroAcesso[]).map(f => (
          <FilterChip key={f} active={filtroAcesso === f} onClick={() => setFiltroAcesso(f)}>
            {f === "todos" ? "Todos"
              : f === "comPendencia" ? "🟡 Com pendência"
              : f === "pronto" ? "🟢 Pronto"
              : "🆕 Nunca logou"}
          </FilterChip>
        ))}

        {/* Filtro de área — só aparece quando filtrando por Equipe */}
        {filtroEquipe === "equipe" && (
          <>
            <span className="ml-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 mr-1">Área:</span>
            <FilterChip active={filtroArea === "todas"} onClick={() => setFiltroArea("todas")}>
              Todas
            </FilterChip>
            {AREAS.map(a => (
              <FilterChip key={a} active={filtroArea === a} onClick={() => setFiltroArea(a)}>
                {a === "Bar" ? "🍸 Bar" : a === "Cozinha" ? "👨‍🍳 Cozinha" : a === "Salão" ? "🍽️ Salão" : "🧹 Limpeza"}
              </FilterChip>
            ))}
          </>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">👥</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search ? "Nenhuma pessoa encontrada" : "Nenhuma pessoa cadastrada"}
          </p>
          {!search && podeConfig && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Cadastre clicando em "+ Nova pessoa"
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {filtered.map((p, i) => {
            const emp = empPorPessoa[p.id];
            const cargo = emp ? cargoMap[emp.cargoId] : null;
            const acessoBadges = statusAcesso(p, restaurantId, emp, perfis);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => podeConfig && setEditing(p)}
                disabled={!podeConfig}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""
                } ${p.ativa === false ? "opacity-60" : ""} ${
                  podeConfig ? "hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer" : "cursor-default"
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-semibold flex-shrink-0">
                  {(p.nome || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 flex-wrap">
                    <span>{p.nome}</span>
                    {p.ativa === false && (
                      <span className="text-xs text-gray-400">
                        (inativa{emp?.demitidoEm ? ` · demitido em ${fmtBR(emp.demitidoEm)}` : ""})
                      </span>
                    )}
                    {acessoBadges.map(b => (
                      <span
                        key={b.status}
                        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${b.classes}`}
                        title={b.tooltip}
                      >
                        {b.label}
                      </span>
                    ))}
                    {emp && cargo && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold">
                        👥 {cargo.nome}
                      </span>
                    )}
                    {emp && cargo && (() => {
                      const badge = horarioBadgeProps(statusHorarioEmpregado(emp, restaurant));
                      if (!badge) return null;
                      return (
                        <span
                          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${badge.classes}`}
                          title={badge.tooltip}
                        >
                          {badge.texto}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {p.email || <span className="italic">sem email</span>}
                    {emp && cargo && <> · {TIPO_VINCULO_LABEL[cargo.tipoVinculo]}</>}
                  </div>
                </div>
                {podeConfig && <span className="text-gray-400 text-sm">›</span>}
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <PessoaModal
          pessoa={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
        />
      )}

      {vincularModo === "chooser" && (
        <Modal title="🔗 Vincular pessoa" onClose={() => setVincularModo(null)} maxWidth="max-w-md">
          <div className="p-4 space-y-3">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              De onde você quer trazer a pessoa pra este restaurante?
            </p>
            <button
              type="button"
              onClick={() => setVincularModo("admissao")}
              className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-800 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                📥 De uma admissão
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Cria a Pessoa + o Empregado a partir de uma admissão pronta (cargo,
                horários e dados já preenchidos).
              </div>
            </button>
            <button
              type="button"
              onClick={() => setVincularModo("existente")}
              className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-800 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                🔗 Pessoa existente (outro restaurante)
              </div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Vincula uma pessoa já cadastrada em outro restaurante a este.
              </div>
            </button>
          </div>
        </Modal>
      )}

      {vincularModo === "admissao" && (
        <VincularAdmissaoModal
          restaurantId={restaurantId}
          onClose={() => setVincularModo(null)}
        />
      )}

      {vincularModo === "existente" && (
        <VincularPessoaModal
          restaurantId={restaurantId}
          onClose={() => setVincularModo(null)}
        />
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
