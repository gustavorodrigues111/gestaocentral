import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { canConfigurar } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { PessoaModal } from "./PessoaModal";
import { VincularPessoaModal } from "./VincularPessoaModal";
import type { Area, Cargo, Empregado, Pessoa } from "../../core/types";
import { AREAS, TIPO_VINCULO_LABEL } from "../../core/types";

type FiltroStatus = "ativas" | "inativas" | "todas";
type FiltroEquipe = "todos" | "equipe" | "naoEquipe";
type FiltroArea = "todas" | Area;

type Props = { restaurantId: string };

export function PessoasList({ restaurantId }: Props) {
  const { pessoa: me } = useAuth();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("ativas");
  const [filtroEquipe, setFiltroEquipe] = useState<FiltroEquipe>("todos");
  const [filtroArea, setFiltroArea] = useState<FiltroArea>("todas");
  const [editing, setEditing] = useState<Pessoa | "new" | null>(null);
  const [vinculando, setVinculando] = useState(false);
  const podeConfig = canConfigurar(me, restaurantId, "pessoas");

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

      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (p.nome || "").toLowerCase().includes(s)
          || (p.email || "").toLowerCase().includes(s);
    }).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  }, [pessoas, empPorPessoa, cargoMap, filtroStatus, filtroEquipe, filtroArea, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} pessoa(s)</p>
        {podeConfig && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setVinculando(true)} title="Vincular pessoa já cadastrada em outro restaurante">
              🔗 Vincular existente
            </Button>
            <Button onClick={() => setEditing("new")}>+ Nova pessoa</Button>
          </div>
        )}
      </div>

      <Input
        placeholder="🔍 Buscar por nome ou email..."
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
                    {p.ativa === false && <span className="text-xs text-gray-400">(inativa)</span>}
                    {p.isMaster && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-bold">Master</span>}
                    {emp && cargo && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold">
                        👥 {cargo.nome}
                      </span>
                    )}
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

      {vinculando && (
        <VincularPessoaModal
          restaurantId={restaurantId}
          onClose={() => setVinculando(false)}
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
