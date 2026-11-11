import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { Inbox, Tag, History, Mail, IdCard, Crown, TriangleAlert, Ban, X, Check, Filter, Pencil, Users, Download } from "lucide-react";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar } from "../../core/auth/permissions";
import { exportarCargosXLSX, exportarCargosPDF } from "./exportCargos";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { VigenciaModal, type ChangedField } from "../../core/ui/VigenciaModal";
import { applyVersionedChange, logAudit } from "../../core/audit/versionedChange";
import {
  AREAS, TIPOS_VINCULO, TIPO_VINCULO_LABEL, TIPOS_VINCULO_COM_PESSOA,
} from "../../core/types";
import type { Area, Cargo, Empregado, TipoVinculo } from "../../core/types";
import { defaultBatePontoPorVinculo } from "../../core/types";
import { ImportCargosModal } from "./ImportCargosModal";
import { HistoricoCargoModal } from "./HistoricoCargoModal";

type Props = { restaurantId: string };

// ─── Helpers / identidade visual ────────────────────────────────────────────

// Cargo de confiança = NÃO bate ponto (CLT Art. 62 II). Cascata: override do
// cargo > default por vínculo.
const ehConfianca = (c: Cargo) => !(c.batePonto ?? defaultBatePontoPorVinculo(c.tipoVinculo));
const brl = (v?: number | null) =>
  v == null ? "—" : "R$ " + Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const iniciais = (n: string) =>
  n.split(" ").filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || n.slice(0, 2).toUpperCase();

// Cor por área: ponto, linha (sombra + faixa à esquerda, com dark mode) e texto.
// Classes literais (não concatenadas) pra o Tailwind não purgar.
const AREA_UI: Record<Area, { dot: string; row: string; text: string }> = {
  Bar:      { dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-300", row: "border-l-violet-400 bg-violet-50/50 dark:bg-violet-950/20 hover:bg-violet-100/70 dark:hover:bg-violet-900/25" },
  Cozinha:  { dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-300", row: "border-l-orange-400 bg-orange-50/50 dark:bg-orange-950/20 hover:bg-orange-100/70 dark:hover:bg-orange-900/25" },
  "Salão":  { dot: "bg-blue-500",   text: "text-blue-700 dark:text-blue-300",     row: "border-l-blue-400 bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100/70 dark:hover:bg-blue-900/25" },
  Limpeza:  { dot: "bg-teal-500",   text: "text-teal-700 dark:text-teal-300",     row: "border-l-teal-400 bg-teal-50/50 dark:bg-teal-950/20 hover:bg-teal-100/70 dark:hover:bg-teal-900/25" },
};

// ─── Filtro faceteado ───────────────────────────────────────────────────────
type Facet = "area" | "producao" | "gorjeta" | "confianca" | "ocupacao" | "vinculo" | "situacao";
type FilterItem = { f: Facet; v: string; l: string };
const keyOf = (i: FilterItem) => `${i.f}:${i.v}`;

const MENU_GROUPS: { g: string; items: FilterItem[] }[] = [
  { g: "Área", items: AREAS.map((a) => ({ f: "area", v: a, l: a })) },
  { g: "Gorjeta", items: [
    { f: "producao", v: "1", l: "Recebe produção" },
    { f: "gorjeta", v: "com", l: "Recebe gorjeta" },
    { f: "gorjeta", v: "sem", l: "Sem gorjeta" },
  ] },
  { g: "Registro de ponto", items: [{ f: "confianca", v: "1", l: "Cargo de confiança" }] },
  { g: "Ocupação", items: [
    { f: "ocupacao", v: "com", l: "Com empregados" },
    { f: "ocupacao", v: "vago", l: "Sem ocupante" },
  ] },
  { g: "Vínculo", items: TIPOS_VINCULO.map((t) => ({ f: "vinculo", v: t, l: TIPO_VINCULO_LABEL[t].split(" ")[0] })) },
  { g: "Situação", items: [
    { f: "situacao", v: "ativo", l: "Ativos" },
    { f: "situacao", v: "inativo", l: "Inativos" },
  ] },
];
const dotClass = (i: FilterItem) =>
  i.f === "area" ? AREA_UI[i.v as Area].dot : i.f === "producao" ? "bg-amber-500" : i.f === "confianca" ? "bg-indigo-500" : "";

function testaItem(c: Cargo, nAtivos: number, f: Facet, v: string): boolean {
  switch (f) {
    case "area": return c.area === v;
    case "producao": return !!c.recebeProducao;
    case "confianca": return ehConfianca(c);
    case "gorjeta": return v === "sem" ? !!c.semGorjeta : !c.semGorjeta;
    case "ocupacao": return v === "com" ? nAtivos > 0 : nAtivos === 0;
    case "vinculo": return c.tipoVinculo === v;
    case "situacao": return v === "ativo" ? c.ativo : !c.ativo;
  }
}

// ─── Tab ────────────────────────────────────────────────────────────────────
export function CargosTab({ restaurantId }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const restauranteNome = restaurants.find((r) => r.id === restaurantId)?.nome || "Restaurante";
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cargo | "new" | null>(null);
  const [detail, setDetail] = useState<Cargo | null>(null);
  const [showHistory, setShowHistory] = useState<Cargo | null>(null);
  const [importing, setImporting] = useState(false);
  const [active, setActive] = useState<FilterItem[]>([]);
  const [busca, setBusca] = useState("");
  const [sortK, setSortK] = useState<string>("area");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const podeConfig = canConfigurar(me, restaurantId, "pessoas");

  useEffect(() => {
    if (!restaurantId) return;
    setLoading(true);
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo));
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [restaurantId]);

  // cargoId → nomes dos empregados ativos
  const ativosPorCargo = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const e of empregados) {
      if (!e.estaAtivo) continue;
      (m[e.cargoId] = m[e.cargoId] || []).push(e.nome);
    }
    Object.values(m).forEach((arr) => arr.sort((a, b) => a.localeCompare(b)));
    return m;
  }, [empregados]);
  const nAtivosDe = (c: Cargo) => ativosPorCargo[c.id]?.length || 0;

  // Filtro: mesmo facet = OU, facets diferentes = E. Sem filtro de situação →
  // mostra só ativos por padrão.
  const filtrados = useMemo(() => {
    const porFacet = active.reduce<Record<string, string[]>>((acc, i) => {
      (acc[i.f] = acc[i.f] || []).push(i.v);
      return acc;
    }, {});
    const termo = busca.trim().toLowerCase();
    return cargos.filter((c) => {
      const n = nAtivosDe(c);
      for (const [f, vals] of Object.entries(porFacet)) {
        if (!vals.some((v) => testaItem(c, n, f as Facet, v))) return false;
      }
      if (!porFacet.situacao && !c.ativo) return false; // default: só ativos
      if (termo && !c.nome.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [cargos, active, busca, ativosPorCargo]);

  const ordenados = useMemo(() => {
    const val = (c: Cargo): string | number => {
      switch (sortK) {
        case "nome": return c.nome.toLowerCase();
        case "area": return `${c.area}`;
        case "pontos": return c.semGorjeta ? -1 : (c.pontos ?? 0);
        case "recebeProducao": return c.recebeProducao ? 1 : 0;
        case "confianca": return ehConfianca(c) ? 1 : 0;
        case "salarioBase": return c.salarioBase ?? -1;
        case "nAtivos": return nAtivosDe(c);
        default: return 0;
      }
    };
    return [...filtrados].sort((a, b) => {
      const x = val(a), y = val(b);
      const base = typeof x === "string" ? x.localeCompare(y as string)
        : (x as number) - (y as number);
      // desempate estável por área+ordem+nome
      return base * sortDir || a.area.localeCompare(b.area) || (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome);
    });
  }, [filtrados, sortK, sortDir, ativosPorCargo]);

  const toggleFiltro = (it: FilterItem) =>
    setActive((prev) => prev.some((a) => keyOf(a) === keyOf(it)) ? prev.filter((a) => keyOf(a) !== keyOf(it)) : [...prev, it]);
  const sortBy = (k: string) => { if (sortK === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortK(k); setSortDir(1); } };

  const Th = ({ k, label, num }: { k: string; label: string; num?: boolean }) => (
    <th
      onClick={() => sortBy(k)}
      className={`px-3 py-2.5 text-[11px] uppercase tracking-wider font-bold cursor-pointer select-none border-b border-gray-200 dark:border-gray-800 whitespace-nowrap ${num ? "text-right" : "text-left"} ${sortK === k ? "text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400"}`}
    >
      {label}<span className="ml-1 text-[10px] text-indigo-500">{sortK === k ? (sortDir === 1 ? "▲" : "▼") : ""}</span>
    </th>
  );

  return (
    <div>
      {/* Toolbar em uma linha só: contagem + Filtro + busca (esq) · exportar/importar/novo (dir) */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {ordenados.length}{ordenados.length !== cargos.length ? ` de ${cargos.length}` : ""} cargo(s)
        </span>
        <FilterDropdown active={active} onToggle={toggleFiltro} />
        <div className="relative flex-1 min-w-[150px] max-w-[260px]">
          <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cargo…"
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
        <div className="flex gap-2 ml-auto">
          <ExportMenu
            onXlsx={() => exportarCargosXLSX(ordenados, ativosPorCargo, restauranteNome)}
            onPdf={() => exportarCargosPDF(ordenados, ativosPorCargo, restauranteNome)}
          />
          {podeConfig && (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)} title="Importar cargos via CSV (migração do AppTip)">
                <span className="inline-flex items-center gap-1.5"><Inbox size={14} /> Importar CSV</span>
              </Button>
              <Button onClick={() => setEditing("new")}>+ Novo cargo</Button>
            </>
          )}
        </div>
      </div>

      {/* Chips dos filtros ativos — só aparecem quando há filtro */}
      {active.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {active.map((a) => {
            const dc = dotClass(a);
            return (
              <span key={keyOf(a)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold pl-2.5 pr-1.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                {dc && <span className={`w-2 h-2 rounded ${dc}`} />}
                {a.l}
                <button type="button" onClick={() => toggleFiltro(a)} className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-indigo-200/60 dark:hover:bg-indigo-800/60" aria-label={`Remover ${a.l}`}>
                  <X size={12} />
                </button>
              </span>
            );
          })}
          <button type="button" onClick={() => setActive([])} className="text-[13px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 underline">limpar tudo</button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : cargos.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="flex justify-center mb-3 text-gray-400"><Tag size={40} /></div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum cargo cadastrado</p>
          {podeConfig && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Cadastre os cargos do restaurante (Garçom 1, Cozinheiro Líder, Freela Garçom, etc).
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: 720 }}>
              <thead className="bg-gray-50 dark:bg-gray-900/60">
                <tr>
                  <Th k="nome" label="Cargo" />
                  <Th k="area" label="Área" />
                  <Th k="pontos" label="Pontos" num />
                  <Th k="recebeProducao" label="Produção" />
                  <Th k="confianca" label="Confiança" />
                  <Th k="salarioBase" label="Salário" num />
                  <Th k="nAtivos" label="Empregados" num />
                </tr>
              </thead>
              <tbody>
                {ordenados.map((c) => {
                  const nomes = ativosPorCargo[c.id] || [];
                  const n = nomes.length;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => setDetail(c)}
                      className={`cursor-pointer border-l-[3px] transition-colors ${AREA_UI[c.area].row} ${!c.ativo ? "opacity-55" : ""}`}
                    >
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{c.nome}</span>
                          <TipoVinculoBadge tipo={c.tipoVinculo} />
                          {!c.ativo && <span className="text-[10px] text-gray-400">(inativo)</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
                        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${AREA_UI[c.area].text}`}>
                          <span className={`w-2 h-2 rounded ${AREA_UI[c.area].dot}`} />{c.area}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 text-right tabular-nums">
                        {c.semGorjeta ? <span className="text-gray-400">—</span> : <span className="font-semibold text-gray-800 dark:text-gray-100">{c.pontos}</span>}
                      </td>
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 text-sm">
                        {c.recebeProducao ? <span className="text-amber-600 dark:text-amber-400 font-medium">● Sim</span> : <span className="text-gray-400">Não</span>}
                      </td>
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 text-sm">
                        {ehConfianca(c) ? <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium"><Crown size={13} /> Sim</span> : <span className="text-gray-400">Não</span>}
                      </td>
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 text-right tabular-nums text-gray-700 dark:text-gray-200">
                        {c.salarioBase != null ? brl(c.salarioBase) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 text-right">
                        {n === 0 ? <span className="text-gray-400">—</span> : (
                          <span className="relative inline-flex group">
                            <span className="inline-flex items-center justify-center min-w-[26px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[13px] font-semibold tabular-nums">{n}</span>
                            <span className="pointer-events-none absolute bottom-full right-0 mb-2 hidden group-hover:block z-20 w-max max-w-[260px] rounded-lg bg-gray-900 text-white text-xs px-3 py-2 shadow-lg text-left whitespace-normal leading-relaxed">
                              <span className="block text-[10px] uppercase tracking-wide opacity-60 mb-1">No cargo</span>
                              {nomes.join(" · ")}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {ordenados.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">Nenhum cargo com esses filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail && (
        <CargoDetailModal
          cargo={detail}
          empregados={ativosPorCargo[detail.id] || []}
          podeConfig={podeConfig}
          onEdit={() => { setEditing(detail); setDetail(null); }}
          onHistory={() => { setShowHistory(detail); setDetail(null); }}
          onClose={() => setDetail(null)}
        />
      )}

      {editing && (
        <CargoModal
          cargo={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          empregadosAtivos={editing === "new" ? 0 : (ativosPorCargo[editing.id]?.length || 0)}
          onClose={() => setEditing(null)}
        />
      )}

      {importing && (
        <ImportCargosModal
          cargosExistentes={cargos}
          restaurantId={restaurantId}
          onClose={() => setImporting(false)}
        />
      )}

      {showHistory && (
        <HistoricoCargoModal
          cargo={showHistory}
          restaurantId={restaurantId}
          onClose={() => setShowHistory(null)}
        />
      )}
    </div>
  );
}

// ─── Menu de exportação ─────────────────────────────────────────────────────
function ExportMenu({ onXlsx, onPdf }: { onXlsx: () => void; onPdf: () => void }) {
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

// ─── Botão/menu de filtro faceteado ─────────────────────────────────────────
function FilterDropdown({ active, onToggle }: { active: FilterItem[]; onToggle: (i: FilterItem) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 h-9 rounded-lg border border-dashed hover:bg-gray-50 dark:hover:bg-gray-800 ${active.length ? "border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}
      >
        <Filter size={14} /> Filtro{active.length ? ` · ${active.length}` : ""}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-30 w-60 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl p-1.5 max-h-[70vh] overflow-y-auto">
          {MENU_GROUPS.map((g) => (
            <div key={g.g}>
              <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400 px-2.5 pt-2 pb-1">{g.g}</div>
              {g.items.map((it) => {
                const on = active.some((a) => keyOf(a) === keyOf(it));
                const dc = dotClass(it);
                return (
                  <button
                    key={keyOf(it)}
                    type="button"
                    onClick={() => onToggle(it)}
                    className={`w-full flex items-center gap-2 text-sm text-left px-2.5 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 ${on ? "font-semibold text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-300"}`}
                  >
                    {dc && <span className={`w-2 h-2 rounded ${dc}`} />}
                    <span className="flex-1">{it.l}</span>
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

// ─── Modal de DETALHE (read-only; Editar/Histórico só aqui dentro) ───────────
function CargoDetailModal({ cargo, empregados, podeConfig, onEdit, onHistory, onClose }: {
  cargo: Cargo;
  empregados: string[];
  podeConfig: boolean;
  onEdit: () => void;
  onHistory: () => void;
  onClose: () => void;
}) {
  const attr = (k: string, v: ReactNode) => (
    <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-0.5">{k}</div>
      <div className="text-[15px] font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">{v}</div>
    </div>
  );
  return (
    <Modal
      title={<span className="inline-flex items-center gap-2 flex-wrap">{cargo.nome}<TipoVinculoBadge tipo={cargo.tipoVinculo} /><span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${AREA_UI[cargo.area].text}`}><span className={`w-2 h-2 rounded ${AREA_UI[cargo.area].dot}`} />{cargo.area}</span></span>}
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2.5">
          {attr("Pontos de gorjeta", cargo.semGorjeta ? <span className="text-gray-400">Sem gorjeta</span> : `${cargo.pontos} pts`)}
          {attr("Salário base", cargo.salarioBase != null ? brl(cargo.salarioBase) : <span className="text-gray-400">Não cadastrado</span>)}
          {attr("Recebe produção", cargo.recebeProducao ? <span className="text-amber-600 dark:text-amber-400">● Sim, todo dia</span> : <span className="text-gray-400">Não</span>)}
          {attr("Cargo de confiança", ehConfianca(cargo) ? <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400"><Crown size={14} /> Sim (não bate ponto)</span> : <span className="text-gray-400">Não</span>)}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1.5">Descrição do cargo</div>
          <div className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2.5">
            {cargo.descricao ? cargo.descricao : <span className="text-gray-400">Sem descrição cadastrada.</span>}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-1.5 inline-flex items-center gap-1.5"><Users size={13} /> Empregados ativos ({empregados.length})</div>
          {empregados.length === 0 ? (
            <div className="text-sm text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2.5">Nenhum empregado ativo neste cargo.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {empregados.map((n) => (
                <div key={n} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
                  <span className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 text-[11px] font-bold flex items-center justify-center shrink-0">{iniciais(n)}</span>
                  {n}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onHistory}>
            <span className="inline-flex items-center gap-1.5"><History size={14} /> Histórico</span>
          </Button>
          {podeConfig && (
            <Button onClick={onEdit}>
              <span className="inline-flex items-center gap-1.5"><Pencil size={14} /> Editar cargo</span>
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function TipoVinculoBadge({ tipo }: { tipo: TipoVinculo }) {
  const cls = tipo === "registrado"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : tipo === "estagiario"
    ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
    : tipo === "provisorio"
    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {TIPO_VINCULO_LABEL[tipo].split(" ")[0]}
    </span>
  );
}

// ─── MODAL DE EDIÇÃO ────────────────────────────────────────────────────────

function CargoModal({
  cargo, restaurantId, empregadosAtivos, onClose,
}: {
  cargo: Cargo | null;
  restaurantId: string;
  empregadosAtivos: number;
  onClose: () => void;
}) {
  const { pessoa: me } = useAuth();
  const [nome, setNome] = useState(cargo?.nome || "");
  const [area, setArea] = useState<Area>(cargo?.area || "Salão");
  const [tipoVinculo, setTipoVinculo] = useState<TipoVinculo>(cargo?.tipoVinculo || "registrado");
  const [pontos, setPontos] = useState<number>(cargo?.pontos ?? 1);
  const [semGorjeta, setSemGorjeta] = useState(cargo?.semGorjeta ?? false);
  const [recebeProducao, setRecebeProducao] = useState(cargo?.recebeProducao ?? false);
  const [salarioBase, setSalarioBase] = useState(cargo?.salarioBase != null ? String(cargo.salarioBase) : "");
  const [descricao, setDescricao] = useState(cargo?.descricao || "");
  // batePonto opcional — default = true pra registrado/estagiario, false pra
  // freela/terceirizado. Quando o user marca/desmarca, vira valor explícito.
  // null = "herda do TipoVinculo" (não persiste).
  const [batePonto, setBatePonto] = useState<boolean | null>(cargo?.batePonto ?? null);
  const [ativo, setAtivo] = useState(cargo?.ativo ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // Pending vigência changes (quando há mudança crítica em cargo existente)
  const [pendingVigencia, setPendingVigencia] = useState<{
    changes: ChangedField[];
    nonVersionedUpdates: Record<string, unknown>;
  } | null>(null);

  const tipoOriginal = cargo?.tipoVinculo;
  const ativoOriginal = cargo?.ativo;

  // Validações
  const tentaInativarComEmpregados = !!cargo && ativoOriginal && !ativo && empregadosAtivos > 0;
  const trocouTipoVinculo = !!cargo && tipoOriginal && tipoOriginal !== tipoVinculo && empregadosAtivos > 0;
  const tipoExigePessoa = TIPOS_VINCULO_COM_PESSOA.includes(tipoVinculo);

  // Detecta diff entre cargo original e form atual.
  // Retorna { criticas, naoCriticas } separadas. Críticas vão pelo VigenciaModal.
  function diffAtual() {
    const criticas: ChangedField[] = [];
    const naoCriticas: Record<string, unknown> = {};

    if (!cargo) return { criticas, naoCriticas };

    // Não-versionados (sempre aplicam imediato)
    if (cargo.nome !== nome.trim()) naoCriticas.nome = nome.trim();
    if (cargo.area !== area) naoCriticas.area = area;
    if (cargo.ativo !== ativo) naoCriticas.ativo = ativo;
    // Remuneração/descrição — não afetam gorjeta, aplicam imediato.
    const novoSalario = salarioBase.trim() ? (parseFloat(salarioBase.replace(",", ".")) || null) : null;
    if ((cargo.salarioBase ?? null) !== novoSalario) naoCriticas.salarioBase = novoSalario;
    if ((cargo.descricao ?? "") !== descricao.trim()) naoCriticas.descricao = descricao.trim();
    // batePonto: muda imediatamente — afeta só filtragem do relatório de ponto
    const batePontoAtualCargo = cargo.batePonto ?? null;
    if (batePontoAtualCargo !== batePonto) {
      naoCriticas.batePonto = batePonto === null ? null : batePonto;
    }

    // Versionados (críticos — afetam gorjeta/escala/empregados)
    const novoPontos = semGorjeta ? 0 : pontos;
    if ((cargo.pontos ?? 0) !== novoPontos) {
      criticas.push({
        campo: "pontos",
        label: "Pontos",
        valorAntes: String(cargo.pontos ?? 0),
        valorDepois: String(novoPontos),
        rawValorAntes: cargo.pontos ?? 0,
        rawValorDepois: novoPontos,
      });
    }
    if ((cargo.semGorjeta ?? false) !== semGorjeta) {
      criticas.push({
        campo: "semGorjeta",
        label: "Sem gorjeta",
        valorAntes: cargo.semGorjeta ? "Sim" : "Não",
        valorDepois: semGorjeta ? "Sim" : "Não",
        rawValorAntes: cargo.semGorjeta ?? false,
        rawValorDepois: semGorjeta,
      });
    }
    const novoRecebeProd = semGorjeta ? false : recebeProducao;
    if ((cargo.recebeProducao ?? false) !== novoRecebeProd) {
      criticas.push({
        campo: "recebeProducao",
        label: "Recebe produção",
        valorAntes: cargo.recebeProducao ? "Sim" : "Não",
        valorDepois: novoRecebeProd ? "Sim" : "Não",
        rawValorAntes: cargo.recebeProducao ?? false,
        rawValorDepois: novoRecebeProd,
      });
    }
    if ((cargo.tipoVinculo ?? "registrado") !== tipoVinculo) {
      criticas.push({
        campo: "tipoVinculo",
        label: "Tipo de vínculo",
        valorAntes: TIPO_VINCULO_LABEL[cargo.tipoVinculo ?? "registrado"],
        valorDepois: TIPO_VINCULO_LABEL[tipoVinculo],
        rawValorAntes: cargo.tipoVinculo ?? "registrado",
        rawValorDepois: tipoVinculo,
      });
    }

    return { criticas, naoCriticas };
  }

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (tentaInativarComEmpregados) {
      setErr(`Não dá pra inativar — ${empregadosAtivos} empregado(s) com esse cargo. Migre eles primeiro.`);
      return;
    }
    if (!me) { setErr("Sessão inválida"); return; }
    setErr("");

    // Caso 1: cargo NOVO — addDoc imediato + audit log "criado"
    if (!cargo) {
      setSaving(true);
      try {
        const data = {
          restaurantId,
          nome: nome.trim(),
          area,
          tipoVinculo,
          pontos: semGorjeta ? 0 : pontos,
          semGorjeta,
          recebeProducao: semGorjeta ? false : recebeProducao,
          ...(batePonto !== null ? { batePonto } : {}),
          ...(salarioBase.trim() ? { salarioBase: parseFloat(salarioBase.replace(",", ".")) || null } : {}),
          ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
          ativo,
        };
        const ref = await addDoc(collection(db, "cargos"), {
          ...data,
          ordem: 999,
          createdAt: new Date().toISOString(),
        });
        await logAudit({
          entityType: "cargo",
          entityId: ref.id,
          restaurantId,
          acao: "criado",
          registradoPor: me.id,
        });
        onClose();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Caso 2: editando — separa diff entre crítico (com vigência) e não-crítico (imediato)
    const { criticas, naoCriticas } = diffAtual();

    if (criticas.length === 0) {
      // Sem mudanças críticas: aplica direto
      if (Object.keys(naoCriticas).length === 0) {
        onClose();
        return;
      }
      setSaving(true);
      try {
        await updateDoc(doc(db, "cargos", cargo.id), naoCriticas);
        await logAudit({
          entityType: "cargo",
          entityId: cargo.id,
          restaurantId,
          acao: "alterado",
          diff: Object.fromEntries(Object.entries(naoCriticas).map(([k, v]) =>
            [k, { antes: (cargo as unknown as Record<string, unknown>)[k], depois: v }]
          )),
          registradoPor: me.id,
        });
        onClose();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Erro");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Caso 3: tem mudanças críticas — abre VigenciaModal
    setPendingVigencia({ changes: criticas, nonVersionedUpdates: naoCriticas });
  }

  async function aplicarComVigencia(vigencia: string, motivo: string) {
    if (!cargo || !me || !pendingVigencia) return;
    // 1. Aplica não-críticos imediato
    if (Object.keys(pendingVigencia.nonVersionedUpdates).length > 0) {
      await updateDoc(doc(db, "cargos", cargo.id), pendingVigencia.nonVersionedUpdates);
    }
    // 2. Cada mudança crítica vai pelo applyVersionedChange (com a mesma vigência+motivo)
    for (const c of pendingVigencia.changes) {
      await applyVersionedChange({
        entityType: "cargo",
        entityId: cargo.id,
        restaurantId,
        campo: c.campo,
        valorAntes: c.rawValorAntes,
        valorDepois: c.rawValorDepois,
        vigenteApartir: vigencia,
        motivo,
        registradoPor: me.id,
      });
    }
  }

  async function excluir() {
    if (!cargo) return;
    if (empregadosAtivos > 0) {
      alert(`Não dá pra excluir — ${empregadosAtivos} empregado(s) com esse cargo.`);
      return;
    }
    if (!confirm(`Excluir o cargo "${cargo.nome}" PERMANENTEMENTE?\n(use Inativar pra preservar histórico)`)) return;
    await deleteDoc(doc(db, "cargos", cargo.id));
    onClose();
  }

  return (
    <Modal title={cargo ? `Editar — ${cargo.nome}` : "+ Novo cargo"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <Input
          label="Nome do cargo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Garçom 1, Cozinheiro Líder, Freela Garçom"
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Área</label>
            <select
              value={area}
              onChange={(e) => setArea(e.target.value as Area)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 mt-1"
            >
              {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Tipo de vínculo</label>
            <select
              value={tipoVinculo}
              onChange={(e) => setTipoVinculo(e.target.value as TipoVinculo)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 mt-1"
            >
              {TIPOS_VINCULO.map(t => (
                <option key={t} value={t}>{TIPO_VINCULO_LABEL[t]}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              {tipoExigePessoa
                ? <span className="inline-flex items-center gap-1"><Mail size={12} /> Exige Pessoa vinculada (login no sistema)</span>
                : <span className="inline-flex items-center gap-1"><IdCard size={12} /> Sem login — só consta na escala/gorjeta</span>}
            </p>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 block mb-2">
            Gorjeta
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={semGorjeta}
                onChange={(e) => setSemGorjeta(e.target.checked)}
              />
              <span>Não recebe gorjeta</span>
              <span className="text-xs text-gray-400">(cobre sócios, gerência etc)</span>
            </label>
            {!semGorjeta && (
              <>
                <Input
                  label="Pontos para divisão"
                  type="number"
                  min="0" step="0.5"
                  value={String(pontos)}
                  onChange={(e) => setPontos(parseFloat(e.target.value) || 0)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={recebeProducao}
                    onChange={(e) => setRecebeProducao(e.target.checked)}
                  />
                  <span>Recebe produção</span>
                  <span className="text-xs text-gray-400">(gorjeta TODO dia, mesmo sem trabalhar — cozinha)</span>
                </label>
              </>
            )}
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 block mb-2">
            Remuneração & descrição
          </label>
          <div className="space-y-2">
            <Input
              label="Salário base (R$/mês)"
              type="number"
              min="0" step="0.01"
              value={salarioBase}
              onChange={(e) => setSalarioBase(e.target.value)}
              placeholder="ex: 1800"
            />
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Descrição do cargo (job description)</label>
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={4}
                placeholder="Responsabilidades, o que a pessoa faz no dia a dia, requisitos…"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 mt-1"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 block mb-2">
            Registro de ponto
          </label>
          {(() => {
            // Cargo de confiança = NÃO bate ponto (CLT Art. 62 II).
            // Checkbox marcado = é cargo de confiança = batePonto false.
            const defaultBate = defaultBatePontoPorVinculo(tipoVinculo);
            const efetivoBate = batePonto ?? defaultBate;
            const efetivoConfianca = !efetivoBate;
            return (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={efetivoConfianca}
                    onChange={(e) => setBatePonto(!e.target.checked)}
                  />
                  <span className="inline-flex items-center gap-1"><Crown size={14} /> Cargo de confiança <span className="text-xs text-gray-500">(não bate ponto)</span></span>
                  <span className="text-xs text-gray-400">
                    {batePonto === null
                      ? `(default por vínculo "${tipoVinculo}": ${defaultBate ? "bate" : "não bate"})`
                      : "(override do cargo)"}
                  </span>
                </label>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 ml-6">
                  CLT Art. 62 II: gerentes, diretores e cargos de confiança não submetidos a controle de jornada.
                  Quem não bate ponto não gera inconformidades no módulo de Registros de Ponto.
                </p>
              </>
            );
          })()}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            <span className="font-medium">Ativo</span>
          </label>
        </div>

        {trocouTipoVinculo && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
            <span className="inline-flex items-center gap-1"><TriangleAlert size={13} /> <strong>Atenção:</strong></span> {empregadosAtivos} empregado(s) tem esse cargo.
            Mudar o tipo de vínculo pode exigir migrações (ex: criar/desvincular Pessoa).
            Verifique cada empregado depois.
          </div>
        )}

        {tentaInativarComEmpregados && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 p-3 text-xs text-rose-800 dark:text-rose-300">
            <span className="inline-flex items-center gap-1"><Ban size={13} /> <strong>Bloqueado:</strong></span> {empregadosAtivos} empregado(s) ativo(s) com esse cargo.
            Migre eles pra outro cargo antes de inativar.
          </div>
        )}

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
          <div>
            {cargo && (
              <Button variant="danger" size="sm" onClick={excluir} disabled={empregadosAtivos > 0}>
                Excluir permanente
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving || tentaInativarComEmpregados}>
              {saving ? "..." : "Salvar"}
            </Button>
          </div>
        </div>
      </div>

      {pendingVigencia && (
        <VigenciaModal
          titulo={`Confirmar mudança no cargo "${cargo?.nome ?? ""}"`}
          changes={pendingVigencia.changes}
          impacto={
            empregadosAtivos > 0
              ? `${empregadosAtivos} empregado(s) tem esse cargo. A mudança afeta cálculo de gorjeta a partir da data de vigência.`
              : undefined
          }
          onConfirm={async (vigencia, motivo) => {
            await aplicarComVigencia(vigencia, motivo);
            setPendingVigencia(null);
            onClose();
          }}
          onClose={() => setPendingVigencia(null)}
        />
      )}
    </Modal>
  );
}
