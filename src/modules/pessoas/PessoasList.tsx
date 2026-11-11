import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Link, Users, User, TriangleAlert, Wine, ChefHat, UtensilsCrossed, SprayCan, CircleAlert, CircleCheck, Sparkles, Inbox, Filter, Check, X, Download } from "lucide-react";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { statusAcesso, passaFiltroAcesso, type FiltroAcesso } from "./accessStatus";
import {
  resolverVinculo,
  VINCULOS_LOGICOS,
  VINCULO_LOGICO_LABEL,
  VINCULO_LOGICO_ICONE,
  VINCULO_LOGICO_CLASSES,
  type VinculoLogico,
} from "../../core/vinculos/comportamento";

type FiltroVinculo = "todos" | VinculoLogico | "semVinculo";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { exportarPessoasXLSX, exportarPessoasPDF, type PessoaExportRow } from "./exportPessoas";
import { PessoaModal } from "./PessoaModal";
import { VincularPessoaModal } from "./VincularPessoaModal";
import { VincularAdmissaoModal } from "./VincularAdmissaoModal";
import { horarioBadgeProps, statusHorarioEmpregado } from "./horarioStatus";
import type { Area, Cargo, Empregado, Pessoa } from "../../core/types";
import { AREAS, TIPO_VINCULO_LABEL } from "../../core/types";
import { fmtBR } from "../../core/utils/date";

const AREA_DOT: Record<string, string> = { Bar: "bg-violet-500", Cozinha: "bg-orange-500", "Salão": "bg-blue-500", Limpeza: "bg-teal-500" };
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
  const [filtroVinculo, setFiltroVinculo] = useState<FiltroVinculo>("todos");
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
        const badges = statusAcesso(p, restaurantId, empPorPessoa[p.id], perfis, empPorPessoa[p.id] ? cargoMap[empPorPessoa[p.id].cargoId] : null);
        if (!passaFiltroAcesso(badges, filtroAcesso)) return false;
      }

      // Filtro de vínculo lógico
      if (filtroVinculo !== "todos") {
        const emp = empPorPessoa[p.id];
        const cargo = emp ? cargoMap[emp.cargoId] : null;
        const vinc = resolverVinculo(p, restaurantId, emp, cargo);
        if (filtroVinculo === "semVinculo") {
          if (vinc !== null) return false;
        } else if (vinc !== filtroVinculo) {
          return false;
        }
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
  }, [pessoas, empPorPessoa, cargoMap, filtroStatus, filtroEquipe, filtroArea, filtroAcesso, filtroVinculo, perfis, restaurantId, search]);

  // Filtro faceteado (mesma lógica do Cargos): single-select por dimensão, chips
  // removíveis. Remover um chip = volta a dimensão pro default.
  const facet: Record<Dim, string> = { status: filtroStatus, tipo: filtroEquipe, acesso: filtroAcesso, vinculo: filtroVinculo, area: filtroArea };
  const setFacet = (d: Dim, v: string) => {
    if (d === "status") setFiltroStatus(v as FiltroStatus);
    else if (d === "tipo") { setFiltroEquipe(v as FiltroEquipe); if (v !== "equipe") setFiltroArea("todas"); }
    else if (d === "acesso") setFiltroAcesso(v as FiltroAcesso);
    else if (d === "vinculo") setFiltroVinculo(v as FiltroVinculo);
    else setFiltroArea(v as FiltroArea);
  };
  const limparFiltros = () => { setFiltroStatus("ativas"); setFiltroEquipe("todos"); setFiltroAcesso("todos"); setFiltroVinculo("todos"); setFiltroArea("todas"); };
  const chipsAtivos = (Object.keys(PESSOA_DEF) as Dim[]).filter((d) => facet[d] !== PESSOA_DEF[d] && (d !== "area" || filtroEquipe === "equipe"));

  // Ordenação da tabela (mesma lógica do Cargos)
  const [sortK, setSortK] = useState<"nome" | "vinculo" | "cargo">("nome");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const ordenados = useMemo(() => {
    const val = (p: Pessoa): string => {
      if (sortK === "nome") return (p.nome || "").toLowerCase();
      const e = empPorPessoa[p.id];
      const c = e ? cargoMap[e.cargoId] : null;
      if (sortK === "cargo") return (c?.nome || "~~~").toLowerCase();
      return (resolverVinculo(p, restaurantId, e, c) || "~~~") as string;
    };
    return [...filtered].sort((a, b) => (val(a).localeCompare(val(b)) * sortDir) || (a.nome || "").localeCompare(b.nome || ""));
  }, [filtered, sortK, sortDir, empPorPessoa, cargoMap, restaurantId]);
  const sortBy = (k: "nome" | "vinculo" | "cargo") => { if (sortK === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortK(k); setSortDir(1); } };

  // Linhas pra export (respeita filtro + ordenação atuais)
  const buildExportRows = (): PessoaExportRow[] => ordenados.map((p) => {
    const emp = empPorPessoa[p.id];
    const cargo = emp ? cargoMap[emp.cargoId] : null;
    const vinc = resolverVinculo(p, restaurantId, emp, cargo);
    const badges = statusAcesso(p, restaurantId, emp, perfis, cargo);
    return {
      nome: p.nome || "",
      vinculo: vinc ? VINCULO_LOGICO_LABEL[vinc] : "Sem vínculo",
      cargo: cargo?.nome || "—",
      area: cargo?.area || "—",
      email: p.email || "",
      cpf: p.cpf || "",
      acesso: badges.map((b) => b.label).join(" / ") || "—",
      situacao: p.ativa === false ? "Inativa" : "Ativa",
    };
  });
  const restauranteNome = restaurant?.nome || "Restaurante";
  const Th = ({ k, label }: { k: "nome" | "vinculo" | "cargo"; label: string }) => (
    <th onClick={() => sortBy(k)} className={`px-3 py-2.5 text-[11px] uppercase tracking-wider font-bold cursor-pointer select-none border-b border-gray-200 dark:border-gray-800 text-left whitespace-nowrap ${sortK === k ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}>
      {label}<span className="ml-1 text-[10px] text-indigo-500">{sortK === k ? (sortDir === 1 ? "▲" : "▼") : ""}</span>
    </th>
  );

  return (
    <div>
      {/* Toolbar em uma linha só: contagem + Filtro + busca (esq) · Vincular/Nova pessoa (dir) */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">{filtered.length} pessoa(s)</span>
        <PessoasFiltro value={facet} onPick={setFacet} mostrarArea={filtroEquipe === "equipe"} />
        <div className="relative flex-1 min-w-[180px] max-w-[340px]">
          <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, email ou CPF…"
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
        {(podeCriar || podeVincular) && (
          <div className="flex gap-2 ml-auto">
            <ExportMenuPessoas
              onXlsx={() => exportarPessoasXLSX(buildExportRows(), restauranteNome)}
              onPdf={() => exportarPessoasPDF(buildExportRows(), restauranteNome)}
            />
            {podeVincular && (
              <Button variant="secondary" onClick={() => setVincularModo("chooser")} title="Vincular de uma admissão ou de pessoa já cadastrada em outro restaurante">
                <span className="inline-flex items-center gap-1.5"><Link size={14} /> Vincular</span>
              </Button>
            )}
            {podeCriar && <Button onClick={() => setEditing("new")}>+ Nova pessoa</Button>}
          </div>
        )}
      </div>

      {/* Chips dos filtros ativos — só aparecem quando há filtro */}
      {chipsAtivos.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {chipsAtivos.map((d) => (
            <span key={d} className="inline-flex items-center gap-1.5 text-[13px] font-semibold pl-2.5 pr-1.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
              {labelDe(d, facet[d])}
              <button type="button" onClick={() => setFacet(d, PESSOA_DEF[d])} className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-indigo-200/60 dark:hover:bg-indigo-800/60" aria-label="Remover filtro">
                <X size={12} />
              </button>
            </span>
          ))}
          <button type="button" onClick={limparFiltros} className="text-[13px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 underline">limpar tudo</button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="flex justify-center mb-3 text-gray-400"><Users size={40} /></div>
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 820 }}>
              <thead className="bg-gray-50 dark:bg-gray-900/60">
                <tr>
                  <Th k="nome" label="Pessoa" />
                  <Th k="vinculo" label="Vínculo" />
                  <Th k="cargo" label="Cargo" />
                  <th className="px-3 py-2.5 text-[11px] uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400 text-left border-b border-gray-200 dark:border-gray-800 whitespace-nowrap">Área</th>
                  <th className="px-3 py-2.5 text-[11px] uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400 text-left border-b border-gray-200 dark:border-gray-800 whitespace-nowrap">Acesso</th>
                  <th className="border-b border-gray-200 dark:border-gray-800 w-6" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {ordenados.map((p) => {
                  const emp = empPorPessoa[p.id];
                  const cargo = emp ? cargoMap[emp.cargoId] : null;
                  const acessoBadges = statusAcesso(p, restaurantId, emp, perfis, cargo);
                  const vinculo = resolverVinculo(p, restaurantId, emp, cargo);
                  // Sombreamento por ACESSO: âmbar = tem pendência (precisa de ação).
                  const precisaAtencaoAcesso = p.ativa !== false &&
                    !acessoBadges.some(b => b.status === "pronto" || b.status === "master" || b.status === "sem_login");
                  const horario = emp && cargo ? horarioBadgeProps(statusHorarioEmpregado(emp, restaurant)) : null;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => podeConfig && setEditing(p)}
                      className={`border-b border-gray-100 dark:border-gray-800 transition-colors ${p.ativa === false ? "opacity-60" : ""} ${precisaAtencaoAcesso ? "bg-amber-50/70 dark:bg-amber-900/15" : ""} ${podeConfig ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50" : "cursor-default"}`}
                    >
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-semibold text-sm flex-shrink-0">
                            {(p.nome || "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                              {p.nome}
                              {p.ativa === false && <span className="text-[10px] text-gray-400 whitespace-nowrap">(inativa{emp?.demitidoEm ? ` · ${fmtBR(emp.demitidoEm)}` : ""})</span>}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.email || <span className="italic">sem email</span>}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        {vinculo ? (
                          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${VINCULO_LOGICO_CLASSES[vinculo]}`} title={`Vínculo: ${VINCULO_LOGICO_LABEL[vinculo]}`}>
                            {VINCULO_LOGICO_ICONE[vinculo]} {VINCULO_LOGICO_LABEL[vinculo].split(" ")[0]}
                          </span>
                        ) : p.ativa !== false ? (
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title="Sem vínculo definido — abra e defina o vínculo desta pessoa">
                            <span className="inline-flex items-center gap-1"><TriangleAlert size={11} /> sem vínculo</span>
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        {emp && cargo ? (
                          <div className="min-w-0">
                            <div className="text-sm text-gray-800 dark:text-gray-100 truncate inline-flex items-center gap-1.5"><Users size={13} className="text-gray-400 shrink-0" /> {cargo.nome}</div>
                            <div className="text-[11px] text-gray-400">{TIPO_VINCULO_LABEL[cargo.tipoVinculo]}</div>
                          </div>
                        ) : <span className="text-gray-400 text-sm">—</span>}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        {cargo ? (
                          <span className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200 whitespace-nowrap">
                            <span className={`w-2 h-2 rounded ${AREA_DOT[cargo.area] || "bg-gray-400"}`} />{cargo.area}
                          </span>
                        ) : <span className="text-gray-400 text-sm">—</span>}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex flex-wrap items-center gap-1">
                          {acessoBadges.map(b => (
                            <span key={b.status} className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${b.classes}`} title={b.tooltip}>{b.label}</span>
                          ))}
                          {horario && <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${horario.classes}`} title={horario.tooltip}>{horario.texto}</span>}
                          {acessoBadges.length === 0 && !horario && <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-middle text-right text-gray-400">{podeConfig ? "›" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
        <Modal title={<span className="inline-flex items-center gap-2"><Link size={16} /> Vincular pessoa</span>} onClose={() => setVincularModo(null)} maxWidth="max-w-md">
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
                <span className="inline-flex items-center gap-1.5"><Inbox size={14} /> De uma admissão</span>
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
                <span className="inline-flex items-center gap-1.5"><Link size={14} /> Pessoa existente (outro restaurante)</span>
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

// ─── Filtro faceteado de Pessoas (mesma lógica do Cargos) ───────────────────
type Dim = "status" | "tipo" | "acesso" | "vinculo" | "area";
const PESSOA_DEF: Record<Dim, string> = { status: "ativas", tipo: "todos", acesso: "todos", vinculo: "todos", area: "todas" };
const LABEL_SIMPLES: Record<"status" | "tipo" | "acesso", Record<string, string>> = {
  status: { ativas: "Ativas", inativas: "Inativas", todas: "Todas" },
  tipo: { todos: "Todos", equipe: "Equipe", naoEquipe: "Só usuários" },
  acesso: { todos: "Todos", comPendencia: "Com pendência", pronto: "Pronto", nuncaLogou: "Nunca logou" },
};
function labelDe(d: Dim, v: string): string {
  if (d === "vinculo") return v === "todos" ? "Todos" : v === "semVinculo" ? "Sem vínculo" : VINCULO_LOGICO_LABEL[v as VinculoLogico];
  if (d === "area") return v === "todas" ? "Todas" : v;
  return LABEL_SIMPLES[d][v] ?? v;
}
const ic = (Ic: typeof Users, t: string) => <span className="inline-flex items-center gap-1.5"><Ic size={13} /> {t}</span>;
const GRUPOS_BASE: { dim: Dim; g: string; items: { v: string; node: ReactNode }[] }[] = [
  { dim: "status", g: "Status", items: [{ v: "ativas", node: "✓ Ativas" }, { v: "inativas", node: "Inativas" }, { v: "todas", node: "Todas" }] },
  { dim: "tipo", g: "Tipo", items: [{ v: "todos", node: "Todos" }, { v: "equipe", node: ic(Users, "Equipe") }, { v: "naoEquipe", node: ic(User, "Só usuários") }] },
  { dim: "acesso", g: "Acesso", items: [{ v: "todos", node: "Todos" }, { v: "comPendencia", node: ic(CircleAlert, "Com pendência") }, { v: "pronto", node: ic(CircleCheck, "Pronto") }, { v: "nuncaLogou", node: ic(Sparkles, "Nunca logou") }] },
  { dim: "vinculo", g: "Vínculo", items: [
    { v: "todos", node: "Todos" },
    ...VINCULOS_LOGICOS.map((v) => ({ v, node: <span className="inline-flex items-center gap-1.5">{VINCULO_LOGICO_ICONE[v]} {VINCULO_LOGICO_LABEL[v]}</span> })),
    { v: "semVinculo", node: ic(TriangleAlert, "Sem vínculo") },
  ] },
];
const GRUPO_AREA: { dim: Dim; g: string; items: { v: string; node: ReactNode }[] } = {
  dim: "area", g: "Área", items: [
    { v: "todas", node: "Todas" },
    ...AREAS.map((a) => ({ v: a, node: a === "Bar" ? ic(Wine, "Bar") : a === "Cozinha" ? ic(ChefHat, "Cozinha") : a === "Salão" ? ic(UtensilsCrossed, "Salão") : ic(SprayCan, "Limpeza") })),
  ],
};

function ExportMenuPessoas({ onXlsx, onPdf }: { onXlsx: () => void; onPdf: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const pick = (fn: () => void) => { setOpen(false); void fn(); };
  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" onClick={() => setOpen((o) => !o)}>
        <span className="inline-flex items-center gap-1.5"><Download size={14} /> Exportar ▾</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-44 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl p-1.5">
          <button type="button" onClick={() => pick(onXlsx)} className="w-full text-left text-sm px-2.5 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200">Planilha Excel (.xlsx)</button>
          <button type="button" onClick={() => pick(onPdf)} className="w-full text-left text-sm px-2.5 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200">Documento PDF</button>
        </div>
      )}
    </div>
  );
}

function PessoasFiltro({ value, onPick, mostrarArea }: { value: Record<Dim, string>; onPick: (d: Dim, v: string) => void; mostrarArea: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const grupos = mostrarArea ? [...GRUPOS_BASE, GRUPO_AREA] : GRUPOS_BASE;
  const n = (Object.keys(PESSOA_DEF) as Dim[]).filter((d) => value[d] !== PESSOA_DEF[d] && (d !== "area" || mostrarArea)).length;
  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 h-9 rounded-lg border border-dashed hover:bg-gray-50 dark:hover:bg-gray-800 ${n ? "border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}
      >
        <Filter size={14} /> Filtro{n ? ` · ${n}` : ""}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-30 w-60 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl p-1.5 max-h-[70vh] overflow-y-auto">
          {grupos.map((gr) => (
            <div key={gr.dim}>
              <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400 px-2.5 pt-2 pb-1">{gr.g}</div>
              {gr.items.map((it) => {
                const on = value[gr.dim] === it.v;
                return (
                  <button
                    key={it.v}
                    type="button"
                    onClick={() => onPick(gr.dim, it.v)}
                    className={`w-full flex items-center gap-2 text-sm text-left px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 ${on ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-300"}`}
                  >
                    <span className="flex-1">{it.node}</span>
                    {on && <Check size={14} className="text-indigo-500" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
