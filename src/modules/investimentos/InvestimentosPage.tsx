import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { Plus, TrendingUp, Trash2, Pencil, FolderOpen, Sparkles, X, Check, FileText, ExternalLink, Settings, Lock, ChevronDown } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { auth } from "../../core/firebase/config";
import { uploadFileToFolder } from "../../core/google/driveClient";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { centralConfigured, centralEnsureFolder, centralUpload, parseDriveFolderId } from "../../core/google/driveCentral";
import { fmtBR } from "../../core/utils/date";
import { INVEST_FORMA_LABEL, investFormaLabel } from "../../core/types";
import type { InvestProjeto, InvestCategoria, InvestLancamento, InvestParcela, InvestForma, InvestPagador, InvestConfig } from "../../core/types";
import { ouvirProjetos, salvarProjeto, excluirProjeto, ouvirCategorias, salvarCategoria, excluirCategoria, ouvirFormas, salvarForma, excluirForma, ouvirPagadores, salvarPagador, ouvirLancamentos, salvarLancamento, excluirLancamento, ouvirConfig, salvarConfig } from "./repository";
import { PageContainer } from "../../core/ui/PageContainer";

const uid = () => { try { return crypto.randomUUID(); } catch { return "id" + Date.now() + Math.random().toString(36).slice(2); } };
const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseR = (s: string) => { const n = parseFloat((s || "").replace(/[R$\s.]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
// Formata centavos em pt-BR (ex.: 8000000 → "80.000,00"). Pro campo de valor mascarado.
const fmtCents = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Detecção de duplicidade: mesmo valor + estabelecimento parecido + data em até 3 dias.
const normTxt = (s: string) => (s || "").toLowerCase().trim().replace(/\s+/g, " ");
const diasEntre = (a: string, b: string) => Math.abs((Date.parse(a + "T00:00:00") - Date.parse(b + "T00:00:00")) / 86400000);
type DupBase = { id: string; data: string; estabelecimento: string; valor: number };
function ehDuplicado(a: DupBase, b: DupBase): boolean {
  if (a.id === b.id) return false;
  if (Math.abs((a.valor || 0) - (b.valor || 0)) > 0.005) return false;
  if (!a.data || !b.data || diasEntre(a.data, b.data) > 3) return false;
  const na = normTxt(a.estabelecimento), nb = normTxt(b.estabelecimento);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
const FORMAS_FIXAS: { value: string; label: string }[] = Object.entries(INVEST_FORMA_LABEL).map(([value, label]) => ({ value, label }));

// Classe única pros campos — todos com a MESMA altura (h-10).
const INP = "w-full h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/40";
const LBL = "text-[11px] font-bold text-gray-500 uppercase tracking-wide";

// Paleta categórica (distinta, legível nos dois temas) pro donut/legenda.
const CAT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#a855f7", "#64748b"];

// Donut simples em SVG (sem lib). data = fatias já com cor.
function MiniDonut({ data, size = 112, stroke = 15 }: { data: { label: string; value: number; color: string }[]; size?: number; stroke?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-gray-100 dark:stroke-gray-800" />
        {total > 0 && data.map((d, i) => {
          const dash = (d.value / total) * c;
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={stroke} strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-acc} strokeLinecap="butt" />;
          acc += dash;
          return el;
        })}
      </g>
    </svg>
  );
}

// Número-resumo do dashboard.
function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "rose" | "amber" }) {
  const valCls = tone === "rose" ? "text-rose-600 dark:text-rose-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-gray-100";
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-[17px] font-bold tabular-nums leading-tight ${valCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Combo elegante (busca + criar novo), renderizado em portal pra não ser
//    cortado pelo overflow do modal ─────────────────────────────────────────
function Combo(props: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string; onAdd?: (nome: string) => Promise<void> | void; addLabel?: string;
}) {
  const { value, onChange, options, placeholder, onAdd, addLabel } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => { const b = btnRef.current?.getBoundingClientRect(); if (b) setRect({ top: b.bottom + 4, left: b.left, width: b.width }); };
    place();
    const onDoc = (e: MouseEvent) => { if (btnRef.current?.contains(e.target as Node) || panelRef.current?.contains(e.target as Node)) return; setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  const sel = options.find((o) => o.value === value);
  const ql = q.trim().toLowerCase();
  const filt = ql ? options.filter((o) => o.label.toLowerCase().includes(ql)) : options;
  const canAdd = !!onAdd && !!q.trim() && !options.some((o) => o.label.toLowerCase() === ql);

  return <>
    <button ref={btnRef} type="button" onClick={() => setOpen((o) => !o)}
      className="w-full h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm flex items-center justify-between gap-2 hover:border-gray-300 dark:hover:border-gray-600">
      <span className={"truncate " + (sel && sel.value ? "text-gray-800 dark:text-gray-100" : "text-gray-400")}>{sel ? sel.label : (placeholder || "Selecionar")}</span>
      <ChevronDown size={15} className={"text-gray-400 shrink-0 transition-transform " + (open ? "rotate-180" : "")} />
    </button>
    {open && rect && createPortal(
      <div ref={panelRef} style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, zIndex: 200 }}
        className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden">
        <div className="p-2 border-b border-gray-100 dark:border-gray-800">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ou criar…"
            className="w-full h-9 px-2.5 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:outline-none" />
        </div>
        <div className="max-h-56 overflow-auto py-1">
          {filt.map((o) => (
            <button key={o.value || "__none"} type="button" onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}
              className={"w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between gap-2 " + (o.value === value ? "font-semibold text-indigo-600 dark:text-indigo-300" : "")}>
              <span className="truncate">{o.label}</span>{o.value === value && <Check size={14} className="shrink-0" />}
            </button>
          ))}
          {filt.length === 0 && !canAdd && <div className="px-3 py-3 text-sm text-gray-400">Nada encontrado</div>}
        </div>
        {canAdd && (
          <button type="button" onClick={async () => { const n = q.trim(); await onAdd!(n); onChange(n); setOpen(false); setQ(""); }}
            className="w-full text-left px-3 py-2.5 text-sm border-t border-gray-100 dark:border-gray-800 text-indigo-600 dark:text-indigo-300 font-semibold inline-flex items-center gap-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/30">
            <Plus size={14} /> {addLabel || "Criar"} “{q.trim()}”
          </button>
        )}
      </div>, document.body)}
  </>;
}

export function InvestimentosPage() {
  const { pessoa: me } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { can } = useCanAcao(rid || "");
  const master = !!me?.isMaster;
  const podeLancar = master || can("investimentos", "lancar");
  const podeGerirProjetos = master || can("investimentos", "gerirProjetos");
  const podeGerirCategorias = master || can("investimentos", "gerirCategorias");

  const [projetos, setProjetos] = useState<InvestProjeto[]>([]);
  const [categorias, setCategorias] = useState<InvestCategoria[]>([]);
  const [formas, setFormas] = useState<InvestForma[]>([]);
  const [pagadores, setPagadores] = useState<InvestPagador[]>([]);
  const [lancamentos, setLancamentos] = useState<InvestLancamento[]>([]);
  const [cfg, setCfg] = useState<InvestConfig | null>(null);
  const [central, setCentral] = useState<boolean | null>(null);
  const [projId, setProjId] = useState("");
  const proj = projetos.find((p) => p.id === projId) || projetos[0] || null;

  const [projModal, setProjModal] = useState<{ mode: "new" | "edit"; proj?: InvestProjeto } | null>(null);
  const [projMenu, setProjMenu] = useState(false);
  const projMenuRef = useRef<HTMLDivElement>(null);
  const [lancModal, setLancModal] = useState<InvestLancamento | "new" | null>(null);
  const [toast, setToast] = useState("");
  function say(m: string) { setToast(m); setTimeout(() => setToast(""), 2600); }

  useEffect(() => { if (!rid) return; return ouvirProjetos(rid, setProjetos); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirCategorias(rid, setCategorias); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirFormas(rid, setFormas); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirPagadores(rid, setPagadores); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirConfig(rid, setCfg); }, [rid]);
  useEffect(() => { centralConfigured().then(setCentral).catch(() => setCentral(false)); }, []);

  async function salvarRoot(id: string, nome?: string) { if (!rid) return; await salvarConfig({ id: rid, restaurantId: rid, driveRootId: id, driveRootNome: nome }); }
  useEffect(() => { if (!rid || !proj) { setLancamentos([]); return; } return ouvirLancamentos(rid, proj.id, setLancamentos); }, [rid, proj?.id]);
  useEffect(() => { if (proj && projId !== proj.id) setProjId(proj.id); }, [proj, projId]);
  useEffect(() => {
    if (!projMenu) return;
    function onDown(e: MouseEvent) { if (projMenuRef.current && !projMenuRef.current.contains(e.target as Node)) setProjMenu(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [projMenu]);

  const total = useMemo(() => lancamentos.reduce((s, l) => s + (l.valor || 0), 0), [lancamentos]);

  // Parcelas: expandir transação + marcar pago (pra Pix/boleto futuros).
  const hoje = new Date().toISOString().slice(0, 10);
  const emBreveLimite = useMemo(() => { const t = new Date(hoje + "T00:00:00"); t.setDate(t.getDate() + 7); return t.toISOString().slice(0, 10); }, [hoje]);
  const [expandParc, setExpandParc] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => setExpandParc((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function togglePagoParcela(l: InvestLancamento, idx: number) {
    if (!podeLancar || !l.parcelas) return;
    const parcelas = l.parcelas.map((p, i) => i === idx ? { ...p, pago: !p.pago, pagoEm: !p.pago ? new Date().toISOString() : undefined } : p);
    await salvarLancamento({ ...l, parcelas, atualizadoEm: new Date().toISOString() });
  }
  // Parcelas pendentes (não pagas) de todos os lançamentos do projeto, por data.
  const parcelasPendentes = useMemo(() => {
    const arr: { date: string; valor: number }[] = [];
    for (const l of lancamentos) if (l.parcelado && l.parcelas) for (const p of l.parcelas) if (!p.pago && p.valor > 0) arr.push({ date: p.data, valor: p.valor });
    return arr.sort((a, b) => a.date.localeCompare(b.date));
  }, [lancamentos]);
  const aPagar = useMemo(() => parcelasPendentes.reduce((s, p) => s + p.valor, 0), [parcelasPendentes]);
  const temAtrasada = useMemo(() => parcelasPendentes.some((p) => p.date < hoje), [parcelasPendentes, hoje]);
  const proxima = parcelasPendentes[0] || null;

  // Dashboard: gasto por categoria (donut) e por forma de pagamento.
  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lancamentos) { const k = l.categoriaNome || "Sem categoria"; m.set(k, (m.get(k) || 0) + (l.valor || 0)); }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
      .map((d, i) => ({ ...d, color: CAT_COLORS[i % CAT_COLORS.length] }));
  }, [lancamentos]);
  const porForma = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lancamentos) { const k = investFormaLabel(l.formaPagamento) || "—"; m.set(k, (m.get(k) || 0) + (l.valor || 0)); }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [lancamentos]);
  // Cor por categoria (bate com o donut) + lista agrupada por categoria.
  const catColor = useMemo(() => { const m: Record<string, string> = {}; porCategoria.forEach((d) => { m[d.label] = d.color; }); return m; }, [porCategoria]);
  const lancPorCategoria = useMemo(() => {
    const m = new Map<string, InvestLancamento[]>();
    for (const l of lancamentos) { const k = l.categoriaNome || "Sem categoria"; const a = m.get(k) || []; a.push(l); m.set(k, a); }
    return [...m.entries()].map(([cat, items]) => ({
      cat, total: items.reduce((s, l) => s + (l.valor || 0), 0),
      items: items.slice().sort((a, b) => b.data.localeCompare(a.data)),
    })).sort((a, b) => b.total - a.total);
  }, [lancamentos]);
  // IDs com possível duplicidade (pra marcar na lista).
  const idsDuplicados = useMemo(() => {
    const s = new Set<string>();
    for (let i = 0; i < lancamentos.length; i++) for (let j = i + 1; j < lancamentos.length; j++) {
      if (ehDuplicado(lancamentos[i], lancamentos[j])) { s.add(lancamentos[i].id); s.add(lancamentos[j].id); }
    }
    return s;
  }, [lancamentos]);

  async function confirmarCategoria(c: InvestCategoria) { await salvarCategoria({ ...c, confirmada: true, criadaPorIa: false }); }

  if (!rid) return <PageContainer><div className="text-gray-500">Selecione um restaurante.</div></PageContainer>;

  return (
    <PageContainer>
      {/* Cabeçalho: seletor de projeto + ações */}
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={18} className="text-emerald-500 shrink-0" />
        {projetos.length > 0 ? (
          <div className="relative min-w-0" ref={projMenuRef}>
            <button onClick={() => setProjMenu((v) => !v)} className="inline-flex items-center gap-1.5 max-w-full text-[17px] font-bold text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
              <span className="truncate">{proj?.nome || "Selecionar projeto"}</span>
              <ChevronDown size={16} className={"text-gray-400 shrink-0 transition-transform " + (projMenu ? "rotate-180" : "")} />
            </button>
            {projMenu && (
              <div className="absolute z-30 mt-1.5 left-0 min-w-[240px] max-w-[320px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1">
                <div className="max-h-[50vh] overflow-auto">
                  {projetos.map((p) => (
                    <button key={p.id} onClick={() => { setProjId(p.id); setProjMenu(false); }} className={"w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 " + (p.id === proj?.id ? "font-semibold text-indigo-600 dark:text-indigo-400" : "text-gray-700 dark:text-gray-200")}>
                      <Check size={14} className={"shrink-0 " + (p.id === proj?.id ? "" : "opacity-0")} />
                      <span className="truncate">{p.nome}</span>
                    </button>
                  ))}
                </div>
                {podeGerirProjetos && (
                  <>
                    <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                    <button onClick={() => { setProjMenu(false); setProjModal({ mode: "new" }); }} className="w-full text-left px-3 py-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800"><Plus size={15} /> Novo projeto</button>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          podeGerirProjetos
            ? <button onClick={() => setProjModal({ mode: "new" })} className="text-[15px] font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Plus size={16} /> Criar primeiro projeto</button>
            : <span className="text-gray-500 text-sm">Nenhum projeto ainda</span>
        )}
        <div className="flex-1" />
        {proj && (podeGerirProjetos || podeGerirCategorias) && <button onClick={() => setProjModal({ mode: "edit", proj })} className="w-8 h-8 grid place-items-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0 transition-colors" title="Configurações do projeto (pasta, categorias, formas)"><Settings size={16} /></button>}
      </div>

      {!proj ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <TrendingUp size={40} className="mx-auto text-gray-300 mb-3" />
          <div className="font-semibold text-gray-700 dark:text-gray-300">Crie um projeto de investimento</div>
          <div className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">Cada projeto é uma planilha própria (ex.: "Reforma do salão", "Cozinha nova"). Você indica uma pasta do Drive pros comprovantes.</div>
          {podeGerirProjetos && <button onClick={() => setProjModal({ mode: "new" })} className="mt-4 h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold inline-flex items-center gap-1"><Plus size={15} /> Criar primeiro projeto</button>}
        </div>
      ) : (
        <>
          {/* Dashboard: números + donut por categoria + formas */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-4 mb-3">
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 flex-1 content-start">
                <Stat label="Total gasto" value={fmtR(total)} />
                <Stat label="Lançamentos" value={lancamentos.length} />
                <Stat label="A pagar" value={aPagar > 0 ? fmtR(aPagar) : "—"} sub={aPagar > 0 ? `${parcelasPendentes.length} parcela(s)${proxima ? ` · próx. ${fmtBR(proxima.date)}` : ""}` : "nada em aberto"} tone={aPagar > 0 ? (temAtrasada ? "rose" : "amber") : undefined} />
                <Stat label="Parcelas em aberto" value={parcelasPendentes.length} sub={temAtrasada ? "⚠ há atrasada" : undefined} tone={temAtrasada ? "rose" : undefined} />
              </div>
              {porCategoria.length > 0 && total > 0 && (
                <div className="flex items-center gap-4 sm:border-l sm:border-gray-100 sm:dark:border-gray-800 sm:pl-6">
                  <div className="relative">
                    <MiniDonut data={porCategoria} />
                    <div className="absolute inset-0 grid place-items-center text-center">
                      <div><div className="text-[9px] uppercase tracking-wider text-gray-400 font-bold">Categorias</div><div className="text-sm font-bold text-gray-700 dark:text-gray-200">{porCategoria.length}</div></div>
                    </div>
                  </div>
                  <div className="space-y-1 min-w-0">
                    {porCategoria.slice(0, 5).map((d) => (
                      <div key={d.label} className="flex items-center gap-1.5 text-[12px]">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                        <span className="text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{d.label}</span>
                        <span className="text-gray-400 tabular-nums ml-auto pl-2">{Math.round((d.value / total) * 100)}%</span>
                      </div>
                    ))}
                    {porCategoria.length > 5 && <div className="text-[11px] text-gray-400">+{porCategoria.length - 5} outras</div>}
                  </div>
                </div>
              )}
            </div>
            {porForma.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mr-1">Formas</span>
                {porForma.map((f) => (
                  <span key={f.label} className="text-[11.5px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{f.label} <b className="text-gray-800 dark:text-gray-100 tabular-nums">{fmtR(f.value)}</b></span>
                ))}
              </div>
            )}
          </div>

          {/* Linha tracejada "novo lançamento" */}
          {podeLancar && (
            <button onClick={() => setLancModal("new")} className="w-full mb-3 rounded-2xl border-2 border-dashed border-indigo-200 dark:border-indigo-900/60 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/20 py-3 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"><Plus size={16} /> Novo lançamento</button>
          )}

          {/* Lista de lançamentos agrupada por categoria (linha clica → expande) */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
            {lancamentos.length === 0 ? (
              <div className="px-4 py-12 text-center text-gray-400 text-sm">Nenhum lançamento ainda. Use <b className="text-gray-500 dark:text-gray-400">+ Novo lançamento</b> — dá pra arrastar/colar o comprovante que a IA preenche.</div>
            ) : lancPorCategoria.map((g) => (
              <div key={g.cat} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-800/40">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: catColor[g.cat] || "#94a3b8" }} />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">{g.cat}</span>
                  <span className="text-[11px] text-gray-400">· {g.items.length}</span>
                  <span className="ml-auto text-[12px] font-bold tabular-nums text-gray-600 dark:text-gray-300">{fmtR(g.total)}</span>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {g.items.map((l) => {
              const parc = l.parcelado && l.parcelas?.length ? l.parcelas : null;
              const pagas = parc ? parc.filter((p) => p.pago).length : 0;
              const atrasada = parc ? parc.some((p) => !p.pago && p.data < hoje) : false;
              const aberto = expandParc.has(l.id);
              return (
                <div key={l.id}>
                  <button onClick={() => toggleExpand(l.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <ChevronDown size={15} className={"shrink-0 transition-transform " + (aberto ? "rotate-180 text-gray-500" : "text-gray-300 dark:text-gray-600")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{l.estabelecimento || "—"}</span>
                        {idsDuplicados.has(l.id) && <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" title="Possível duplicidade — mesmo valor, estabelecimento e data próximos">⚠ dup?</span>}
                      </div>
                      <div className="text-[12px] text-gray-400 tabular-nums mt-0.5">{fmtBR(l.data)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-sm tabular-nums text-gray-900 dark:text-gray-100">{fmtR(l.valor)}</div>
                      {parc ? (
                        <span className={`inline-block mt-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${pagas === parc.length ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" : atrasada ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>{parc.length}x · {pagas}/{parc.length}</span>
                      ) : <span className="block text-[11px] text-gray-400 mt-0.5">à vista</span>}
                    </div>
                  </button>
                  {aberto && (
                    <div className="px-4 pb-4 pt-1 bg-gray-50/60 dark:bg-gray-900/40 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                        <div><div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Forma</div><div className="text-[13px] text-gray-700 dark:text-gray-200">{investFormaLabel(l.formaPagamento)}</div></div>
                        <div><div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Quem pagou</div><div className="text-[13px] text-gray-700 dark:text-gray-200">{l.pagoPor || "—"}</div></div>
                        <div><div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Categoria</div><div className="text-[13px] text-gray-700 dark:text-gray-200">{l.categoriaNome || "—"}</div></div>
                        <div><div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Comprovante</div><div className="text-[13px]">{l.comprovanteUrl ? <a href={l.comprovanteUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 font-medium"><FileText size={13} /> ver <ExternalLink size={11} /></a> : <span className="text-gray-400">—</span>}</div></div>
                      </div>
                      {l.observacao && <div><div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Observação</div><div className="text-[13px] text-gray-700 dark:text-gray-200">{l.observacao}</div></div>}
                      {parc && (
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Parcelas</div>
                          <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden bg-white dark:bg-gray-900">
                            {parc.map((p, i) => {
                              const vencida = !p.pago && p.data < hoje;
                              const aVencer = !p.pago && !vencida && p.data <= emBreveLimite;
                              return (
                                <div key={i} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                                  <span className="w-7 text-gray-400 shrink-0">{p.n}ª</span>
                                  <span className="tabular-nums text-gray-600 dark:text-gray-300 w-20 shrink-0">{fmtBR(p.data)}</span>
                                  <span className="tabular-nums font-semibold text-gray-900 dark:text-gray-100 w-24 shrink-0">{fmtR(p.valor)}</span>
                                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${p.pago ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" : vencida ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200" : aVencer ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>{p.pago ? "Pago" : vencida ? "Atrasada" : aVencer ? "Vence em breve" : "Pendente"}</span>
                                  <div className="flex-1" />
                                  {podeLancar && <button onClick={() => void togglePagoParcela(l, i)} className={`text-[11.5px] font-semibold px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 ${p.pago ? "border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700" : "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"}`}>{p.pago ? "Desmarcar" : <><Check size={12} /> Marcar pago</>}</button>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div className="flex justify-end pt-1">
                        {podeLancar && <button onClick={() => setLancModal(l)} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-indigo-600 hover:border-indigo-300 dark:hover:border-indigo-700 inline-flex items-center gap-1.5 transition-colors"><Pencil size={13} /> Editar</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
                })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {projModal && <ProjetoModal mode={projModal.mode} proj={projModal.proj} rid={rid} me={me} central={central} driveRootId={cfg?.driveRootId} driveRootNome={cfg?.driveRootNome} onSaveRoot={salvarRoot} onClose={() => setProjModal(null)} onSay={say} onSaved={(id) => setProjId(id)}
        categorias={categorias} formas={formas} podeGerirProjetos={podeGerirProjetos} podeGerirCategorias={podeGerirCategorias} onConfirmarCat={confirmarCategoria} />}
      {lancModal && proj && <LancamentoModal registro={lancModal === "new" ? null : lancModal} proj={proj} rid={rid!} me={me} categorias={categorias} formas={formas} pagadores={pagadores} lancamentos={lancamentos} onClose={() => setLancModal(null)} onSay={say} />}

      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-xl z-[210]">{toast}</div>}
    </PageContainer>
  );
}

// ── Modal: criar/editar projeto (+ pasta Drive) ──────────────────────────────
function ProjetoModal(props: {
  mode: "new" | "edit"; proj?: InvestProjeto; rid: string; me: ReturnType<typeof useAuth>["pessoa"];
  central: boolean | null; driveRootId?: string; driveRootNome?: string; onSaveRoot: (id: string, nome?: string) => Promise<void>;
  onClose: () => void; onSay: (m: string) => void; onSaved: (id: string) => void;
  categorias: InvestCategoria[]; formas: InvestForma[]; podeGerirProjetos: boolean; podeGerirCategorias: boolean; onConfirmarCat: (c: InvestCategoria) => void;
}) {
  const { mode, proj, rid, me, central, driveRootId, onSaveRoot, onClose, onSay, onSaved, categorias, formas, podeGerirProjetos, podeGerirCategorias, onConfirmarCat } = props;
  const [nome, setNome] = useState(proj?.nome || "");
  const [descricao, setDescricao] = useState(proj?.descricao || "");
  const [pastaId, setPastaId] = useState(proj?.pastaDriveId || "");     // fluxo navegador (legado)
  const [pastaNome, setPastaNome] = useState(proj?.pastaDriveNome || "");
  const [rootInput, setRootInput] = useState("");                       // fluxo central: root a configurar
  const [editRoot, setEditRoot] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const precisaRoot = central === true && (!driveRootId || editRoot);
  // Categorias & formas (gerenciadas aqui dentro da engrenagem).
  const [novaCat, setNovaCat] = useState("");
  const [novaForma, setNovaForma] = useState("");
  const catConfirmadas = categorias.filter((c) => c.confirmada !== false);
  const catPend = categorias.filter((c) => c.criadaPorIa && c.confirmada === false);
  async function addCat() {
    const n = novaCat.trim(); if (!n) return;
    if (categorias.some((c) => c.nome.toLowerCase() === n.toLowerCase())) { setNovaCat(""); return; }
    await salvarCategoria({ id: uid(), restaurantId: rid, nome: n, confirmada: true, criadoEm: new Date().toISOString() }); setNovaCat("");
  }
  async function addForma() {
    const n = novaForma.trim(); if (!n) return;
    if (FORMAS_FIXAS.some((x) => x.value === n || x.label.toLowerCase() === n.toLowerCase()) || formas.some((f) => f.nome.toLowerCase() === n.toLowerCase())) { setNovaForma(""); return; }
    await salvarForma({ id: uid(), restaurantId: rid, nome: n, criadoEm: new Date().toISOString() }); setNovaForma("");
  }

  async function escolherPasta() {
    setErro("");
    try {
      const f = await pickDriveFolder("Pasta dos comprovantes deste projeto");
      if (f) { setPastaId(f.id); setPastaNome(f.name); }
    } catch (e) { setErro("Não consegui abrir o Drive: " + (e instanceof Error ? e.message : "erro")); }
  }

  async function salvar() {
    if (!nome.trim()) return;
    setSalvando(true); setErro("");
    try {
      let dId = proj?.pastaDriveId, dNome = proj?.pastaDriveNome, dCentral = proj?.pastaDriveCentral;

      if (central === true) {
        // Descobre/garante a pasta-raiz da conta central.
        let rootId = driveRootId;
        if (!rootId || editRoot) {
          const parsed = parseDriveFolderId(rootInput);
          if (!parsed) { setErro("Cole o link ou o ID da pasta-raiz no Drive central."); setSalvando(false); return; }
          await onSaveRoot(parsed); rootId = parsed;
        }
        // Cria/reaproveita a subpasta deste projeto dentro do root.
        const subId = await centralEnsureFolder(rootId, nome.trim());
        dId = subId; dNome = nome.trim(); dCentral = true;
      } else {
        // Fluxo navegador (central não configurada).
        dId = pastaId || undefined; dNome = pastaNome || undefined; dCentral = false;
      }

      const now = new Date().toISOString();
      const p: InvestProjeto = {
        id: proj?.id || uid(), restaurantId: rid, nome: nome.trim(), descricao: descricao.trim() || undefined,
        pastaDriveId: dId, pastaDriveNome: dNome, pastaDriveCentral: dCentral,
        ativo: true, ordem: proj?.ordem ?? Date.now(), criadoEm: proj?.criadoEm || now, criadoPor: proj?.criadoPor || (me?.id || ""),
      };
      await salvarProjeto(p);
      onSay(mode === "new" ? "✓ Projeto criado" : "✓ Projeto salvo"); onSaved(p.id); onClose();
    } catch (e) { setErro("Falha ao salvar: " + (e instanceof Error ? e.message : "erro")); setSalvando(false); }
  }
  async function excluir() { if (!proj) return; if (!confirm(`Excluir o projeto "${proj.nome}"? Os lançamentos ficam órfãos (não some do Drive).`)) return; await excluirProjeto(proj.id); onSay("Projeto excluído"); onClose(); }

  return <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
    <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[480px] max-h-[90vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-3"><div className="font-extrabold text-[15px]">{mode === "new" ? "Novo projeto" : "Configurações do projeto"}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>

      {podeGerirProjetos && <>
        <label className={LBL}>Nome</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Reforma do salão" autoFocus className={INP + " mt-1 mb-3"} />
        <label className={LBL}>Descrição <span className="text-gray-400 normal-case">(opcional)</span></label>
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={INP + " mt-1 mb-3"} />

        {/* Onde ficam os comprovantes */}
        {central === true ? (
          <>
            <label className={LBL}>Pasta-raiz no Drive (conta central)</label>
            {!precisaRoot ? (
              <div className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
                <Check size={14} /> Configurada — cada projeto vira uma subpasta aqui. <button type="button" onClick={() => { setEditRoot(true); setRootInput(""); }} className="text-indigo-600 dark:text-indigo-400 underline">trocar</button>
              </div>
            ) : (
              <>
                <input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="Cole o link ou o ID da pasta-raiz" className={INP + " mt-1"} />
                <div className="text-[11px] text-gray-400 mt-1">É uma pasta do Drive da <b>conta central</b> (a mesma do Recebimento). Configura uma vez; os projetos criam subpastas dentro. <b>Sem popup de autorização.</b></div>
                {driveRootId && <button type="button" onClick={() => setEditRoot(false)} className="text-[11px] text-gray-500 underline mt-1">cancelar troca</button>}
              </>
            )}
            <div className="text-[11px] text-gray-400 mt-1">Comprovantes nomeados <b>Estabelecimento_Data</b>.</div>
          </>
        ) : central === false ? (
          <>
            <label className={LBL}>Pasta do Drive (comprovantes)</label>
            <div className="flex items-center gap-2 mt-1">
              <button type="button" onClick={() => void escolherPasta()} className="h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1.5"><FolderOpen size={15} className="text-amber-500" /> {pastaNome ? "Trocar pasta" : "Escolher pasta"}</button>
              {pastaNome && <span className="text-[12px] text-gray-600 dark:text-gray-300 truncate">{pastaNome}</span>}
            </div>
            <div className="text-[11px] text-gray-400 mt-1">Comprovantes nomeados <b>Estabelecimento_Data</b>.</div>
          </>
        ) : (
          <div className="text-[12px] text-gray-400 mt-1">Verificando Drive…</div>
        )}
      </>}

      {/* Categorias & Formas de pagamento (gerenciadas aqui) */}
      {mode === "edit" && podeGerirCategorias && <>
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <label className={LBL}>Categorias ({catConfirmadas.length})</label>
          {catPend.length > 0 && (
            <div className="mt-1 mb-2 space-y-1">
              {catPend.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-[13px] bg-amber-50 dark:bg-amber-950/20 rounded-lg px-2.5 py-1.5">
                  <Sparkles size={12} className="text-amber-500 shrink-0" />
                  <span className="flex-1 font-medium">{c.nome}</span>
                  <button onClick={() => onConfirmarCat(c)} className="text-[11px] font-bold px-2 py-1 rounded bg-emerald-600 text-white inline-flex items-center gap-1"><Check size={12} /> Confirmar</button>
                  <button onClick={() => void excluirCategoria(c.id)} className="text-rose-400 hover:text-rose-600" title="Descartar"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mt-1.5 mb-2">
            {catConfirmadas.length === 0 ? <span className="text-xs text-gray-400">Nenhuma ainda.</span> : catConfirmadas.map((c) => (
              <span key={c.id} className="text-[12px] px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 inline-flex items-center gap-1">{c.nome}<button onClick={() => void excluirCategoria(c.id)} className="text-gray-400 hover:text-rose-500"><X size={12} /></button></span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={novaCat} onChange={(e) => setNovaCat(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addCat(); }} placeholder="Nova categoria" className="flex-1 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
            <button onClick={() => void addCat()} disabled={!novaCat.trim()} className="px-3 h-9 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Adicionar</button>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
          <label className={LBL}>Formas de pagamento</label>
          <div className="text-[11px] text-gray-400 mt-0.5">As fixas (Pix, Dinheiro, Cartão…) já vêm prontas. Adicione formas próprias abaixo.</div>
          <div className="flex flex-wrap gap-1.5 mt-2 mb-2">
            {formas.length === 0 ? <span className="text-xs text-gray-400">Nenhuma forma própria ainda.</span> : formas.map((f) => (
              <span key={f.id} className="text-[12px] px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 inline-flex items-center gap-1">{f.nome}<button onClick={() => void excluirForma(f.id)} className="text-gray-400 hover:text-rose-500"><X size={12} /></button></span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={novaForma} onChange={(e) => setNovaForma(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addForma(); }} placeholder="Nova forma de pagamento" className="flex-1 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
            <button onClick={() => void addForma()} disabled={!novaForma.trim()} className="px-3 h-9 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Adicionar</button>
          </div>
        </div>
      </>}

      {erro && <div className="text-[12px] text-rose-600 mt-2">{erro}</div>}
      <div className="flex gap-2 mt-4">
        {mode === "edit" && podeGerirProjetos && <button onClick={() => void excluir()} className="px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-sm font-semibold inline-flex items-center gap-1"><Trash2 size={14} /> Excluir</button>}
        <div className="flex-1" />
        {podeGerirProjetos ? <>
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
          <button onClick={() => void salvar()} disabled={!nome.trim() || salvando || central === null} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">{salvando ? "Salvando…" : "Salvar"}</button>
        </> : (
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold">Fechar</button>
        )}
      </div>
    </div>
  </div>;
}

// ── Modal: novo/editar lançamento (comprovante + IA + parcelas) ──────────────
function LancamentoModal(props: { registro: InvestLancamento | null; proj: InvestProjeto; rid: string; me: ReturnType<typeof useAuth>["pessoa"]; categorias: InvestCategoria[]; formas: InvestForma[]; pagadores: InvestPagador[]; lancamentos: InvestLancamento[]; onClose: () => void; onSay: (m: string) => void }) {
  const { registro, proj, rid, me, categorias, formas, pagadores, lancamentos, onClose, onSay } = props;
  const [data, setData] = useState(registro?.data || new Date().toISOString().slice(0, 10));
  const [estabelecimento, setEstab] = useState(registro?.estabelecimento || "");
  const [categoriaNome, setCategoriaNome] = useState(registro?.categoriaNome || "");
  const [valor, setValor] = useState(registro && registro.valor ? fmtCents(Math.round(registro.valor * 100)) : "");
  const [forma, setForma] = useState<string>(registro?.formaPagamento || "pix");
  const [pagoPor, setPagoPor] = useState<string>(registro?.pagoPor || "");
  const [parcelado, setParcelado] = useState(registro?.parcelado || false);
  const [parcelas, setParcelas] = useState<InvestParcela[]>(registro?.parcelas || []);
  const [observacao, setObs] = useState(registro?.observacao || "");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [iaBusy, setIaBusy] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [catSugerida, setCatSugerida] = useState("");   // sugestão da IA fora da lista
  const [dupWarn, setDupWarn] = useState<InvestLancamento[] | null>(null);   // possíveis duplicados
  const fileRef = useRef<HTMLInputElement>(null);
  // Campo de valor mascarado (R$ xx.xxx,xx) — digita centavos da direita pra esquerda.
  const valorNum = () => { const d = valor.replace(/\D/g, ""); return d ? parseInt(d, 10) / 100 : 0; };
  function onValorChange(raw: string) { const d = raw.replace(/\D/g, ""); setValor(d ? fmtCents(parseInt(d, 10)) : ""); }

  const jaTemComprovante = !!registro?.comprovanteUrl;

  const catOptions = useMemo(() => [
    { value: "", label: "— sem categoria —" },
    ...categorias.map((c) => ({ value: c.nome, label: c.confirmada === false ? `${c.nome} · a confirmar` : c.nome })),
  ], [categorias]);
  const formaOptions = useMemo(() => {
    const extra = formas.filter((fc) => !FORMAS_FIXAS.some((x) => x.value === fc.nome || x.label.toLowerCase() === fc.nome.toLowerCase())).map((fc) => ({ value: fc.nome, label: fc.nome }));
    return [...FORMAS_FIXAS, ...extra];
  }, [formas]);
  const pagadorOptions = useMemo(() => [
    { value: "", label: "— quem pagou —" },
    ...pagadores.map((p) => ({ value: p.nome, label: p.nome })),
  ], [pagadores]);

  async function addCategoria(nome: string) {
    if (categorias.some((c) => c.nome.toLowerCase() === nome.toLowerCase())) return;
    await salvarCategoria({ id: uid(), restaurantId: rid, nome, confirmada: true, criadoEm: new Date().toISOString() });
  }
  async function addForma(nome: string) {
    if (FORMAS_FIXAS.some((x) => x.value === nome || x.label.toLowerCase() === nome.toLowerCase())) return;
    if (formas.some((f) => f.nome.toLowerCase() === nome.toLowerCase())) return;
    await salvarForma({ id: uid(), restaurantId: rid, nome, criadoEm: new Date().toISOString() });
  }
  async function addPagador(nome: string) {
    if (pagadores.some((p) => p.nome.toLowerCase() === nome.toLowerCase())) return;
    await salvarPagador({ id: uid(), restaurantId: rid, nome, criadoEm: new Date().toISOString() });
  }

  function aceitar(f: File | null | undefined) {
    if (!f) return;
    const ok = f.type.startsWith("image/") || f.type === "application/pdf";
    if (!ok) { setErro("Só aceito imagem ou PDF como comprovante."); return; }
    const named = f.name ? f : new File([f], `comprovante-${Date.now()}.${(f.type.split("/")[1] || "png")}`, { type: f.type });
    setFile(named); void preencherComIA(named);
  }

  // Colar (⌘V / Ctrl+V) uma imagem ou PDF em qualquer lugar do modal.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items; if (!items) return;
      for (const it of items) {
        if (it.kind === "file") { const f = it.getAsFile(); if (f) { aceitar(f); e.preventDefault(); break; } }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorias]);

  async function preencherComIA(f: File) {
    setIaBusy(true); setErro("");
    try {
      const b64 = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1] || ""); r.onerror = reject; r.readAsDataURL(f); });
      const idToken = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/investimentos-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, mimeType: f.type, dataBase64: b64, categorias: categorias.map((c) => c.nome) }) });
      const j = await r.json();
      if (!r.ok) { setErro(j?.error || "A IA não conseguiu ler o comprovante."); return; }
      const ex = j.extraido || {};
      if (ex.data) setData(String(ex.data).slice(0, 10));
      if (ex.estabelecimento) setEstab(String(ex.estabelecimento));
      if (typeof ex.valor === "number" && ex.valor > 0) setValor(fmtCents(Math.round(ex.valor * 100)));
      if (ex.formaPagamento) setForma(String(ex.formaPagamento));
      if (ex.categoriaExistente && categorias.some((c) => c.nome.toLowerCase() === String(ex.categoriaExistente).toLowerCase())) { setCategoriaNome(String(ex.categoriaExistente)); setCatSugerida(""); }
      else if (ex.categoriaSugerida) { setCatSugerida(String(ex.categoriaSugerida)); }
      if (ex.parcelado && Array.isArray(ex.parcelas) && ex.parcelas.length) {
        setParcelado(true);
        setParcelas(ex.parcelas.map((p: { data?: string; valor?: number }, i: number) => ({ n: i + 1, data: (p.data || "").slice(0, 10), valor: Number(p.valor) || 0 })));
      }
      onSay("✓ IA preencheu — confira e ajuste");
    } catch (e) { setErro("Falha na IA: " + (e instanceof Error ? e.message : "erro")); }
    finally { setIaBusy(false); }
  }

  function gerarParcelas(n: number) {
    const v = valorNum(); if (!v || n < 1) return;
    const base = v / n;
    const arr: InvestParcela[] = [];
    for (let i = 0; i < n; i++) { const d = new Date(data + "T12:00:00"); d.setMonth(d.getMonth() + i); arr.push({ n: i + 1, data: d.toISOString().slice(0, 10), valor: Math.round(base * 100) / 100 }); }
    setParcelas(arr);
  }

  async function adicionarCatSugerida() {
    const n = catSugerida.trim(); if (!n) return;
    await salvarCategoria({ id: uid(), restaurantId: rid, nome: n, criadaPorIa: true, confirmada: false, criadoEm: new Date().toISOString() });
    setCategoriaNome(n); setCatSugerida("");
    onSay("Categoria adicionada (pendente de confirmação nas Categorias)");
  }

  async function salvar(bypassDup = false) {
    if (!estabelecimento.trim()) { setErro("Informe o estabelecimento."); return; }
    const v = valorNum(); if (!v) { setErro("Informe o valor."); return; }
    if (!bypassDup) {
      const dups = lancamentos.filter((x) => ehDuplicado({ id: registro?.id || "__novo__", data, estabelecimento: estabelecimento.trim(), valor: v }, x));
      if (dups.length) { setDupWarn(dups); return; }
    }
    setDupWarn(null);
    setSalvando(true); setErro("");
    try {
      let comprovanteDriveId = registro?.comprovanteDriveId, comprovanteUrl = registro?.comprovanteUrl, comprovanteNome = registro?.comprovanteNome;
      if (file) {
        if (!proj.pastaDriveId) { setErro("Configure a pasta do Drive no projeto (⚙️) antes de anexar."); setSalvando(false); return; }
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
        const nomeArq = `${safe(estabelecimento)}_${data}.${ext}`;
        const renamed = new File([file], nomeArq, { type: file.type });
        // Conta central (sem popup) quando a pasta do projeto é central; senão, navegador.
        const up = proj.pastaDriveCentral
          ? await centralUpload(proj.pastaDriveId, renamed)
          : await uploadFileToFolder(proj.pastaDriveId, renamed);
        comprovanteDriveId = up.id; comprovanteUrl = up.webViewLink || comprovanteUrl; comprovanteNome = nomeArq;
      }
      const now = new Date().toISOString();
      const catId = categorias.find((c) => c.nome === categoriaNome)?.id;
      const l: InvestLancamento = {
        id: registro?.id || uid(), restaurantId: rid, projetoId: proj.id,
        data, estabelecimento: estabelecimento.trim(), categoriaId: catId, categoriaNome: categoriaNome || undefined,
        valor: v, formaPagamento: forma, pagoPor: pagoPor.trim() || undefined, parcelado, parcelas: parcelado ? parcelas.filter((p) => p.valor > 0) : undefined,
        comprovanteDriveId, comprovanteUrl, comprovanteNome, observacao: observacao.trim() || undefined,
        criadoEm: registro?.criadoEm || now, criadoPor: registro?.criadoPor || (me?.id || ""), criadoPorNome: registro?.criadoPorNome || me?.nome,
      };
      await salvarLancamento(l);
      onSay(registro ? "✓ Lançamento salvo" : "✓ Lançamento criado");
      onClose();
    } catch (e) { setErro("Falha ao salvar: " + (e instanceof Error ? e.message : "erro")); setSalvando(false); }
  }

  return <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
    <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[560px] max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2"><div className="font-extrabold text-[15px]">{registro ? "Editar lançamento" : "Novo lançamento"}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
      <div className="p-4 overflow-auto space-y-3">
        {/* Comprovante — arrasta, cola ou clica */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); aceitar(e.dataTransfer.files?.[0]); }}
          className={"rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-colors " + (dragOver ? "border-indigo-400 bg-indigo-100/60 dark:bg-indigo-950/40" : "border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20")}
        >
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => aceitar(e.target.files?.[0])} />
          <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-800 dark:text-indigo-200"><Sparkles size={14} /> Comprovante — a IA preenche a linha</div>
          <div className="text-[12px] text-gray-500 mt-1">Arraste aqui, cole (⌘V) ou <span className="text-indigo-600 dark:text-indigo-300 font-semibold underline">clique pra escolher</span></div>
          {file && <div className="text-[12px] text-gray-700 dark:text-gray-200 mt-2 inline-flex items-center gap-1"><FileText size={13} /> {file.name}</div>}
          {jaTemComprovante && !file && <div className="text-[11px] text-gray-500 mt-2 inline-flex items-center gap-1"><FileText size={12} /> Já tem: {registro?.comprovanteNome} — suba outro pra trocar</div>}
          {iaBusy && <div className="text-[12px] text-indigo-600 mt-2 inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" /> Lendo o comprovante…</div>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={LBL}>Data</label><input type="date" value={data} onChange={(e) => setData(e.target.value)} className={INP + " mt-1"} /></div>
          <div><label className={LBL}>Valor</label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">R$</span>
              <input value={valor} onChange={(e) => onValorChange(e.target.value)} inputMode="numeric" placeholder="0,00" className={INP + " pl-9 text-right"} />
            </div>
          </div>
        </div>
        <div><label className={LBL}>Estabelecimento</label><input value={estabelecimento} onChange={(e) => setEstab(e.target.value)} className={INP + " mt-1"} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LBL}>Categoria</label>
            <div className="mt-1"><Combo value={categoriaNome} onChange={setCategoriaNome} options={catOptions} placeholder="— sem categoria —" onAdd={addCategoria} addLabel="Criar categoria" /></div>
            {catSugerida && !categorias.some((c) => c.nome.toLowerCase() === catSugerida.toLowerCase()) && <button type="button" onClick={() => void adicionarCatSugerida()} className="text-[11px] mt-1 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1"><Sparkles size={11} /> IA sugeriu “{catSugerida}” — adicionar</button>}
          </div>
          <div>
            <label className={LBL}>Forma de pagamento</label>
            <div className="mt-1"><Combo value={forma} onChange={setForma} options={formaOptions} placeholder="Selecionar" onAdd={addForma} addLabel="Criar forma" /></div>
          </div>
        </div>
        <div>
          <label className={LBL}>Quem pagou</label>
          <div className="mt-1"><Combo value={pagoPor} onChange={setPagoPor} options={pagadorOptions} placeholder="— quem pagou —" onAdd={addPagador} addLabel="Criar pagador" /></div>
        </div>
        {/* Parcelamento */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <label className="inline-flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={parcelado} onChange={(e) => { setParcelado(e.target.checked); if (e.target.checked && parcelas.length === 0) gerarParcelas(2); }} /> Parcelado</label>
          {parcelado && <div className="mt-2 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500 flex-wrap">Gerar rápido:{[2, 3, 4, 6, 10, 12].map((n) => <button key={n} type="button" onClick={() => gerarParcelas(n)} className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">{n}x</button>)}</div>
            {parcelas.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 w-6">{p.n}ª</span>
                <input type="date" value={p.data} onChange={(e) => setParcelas((arr) => arr.map((x, j) => j === i ? { ...x, data: e.target.value } : x))} className="h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[12px]" />
                <input value={String(p.valor).replace(".", ",")} onChange={(e) => setParcelas((arr) => arr.map((x, j) => j === i ? { ...x, valor: parseR(e.target.value) } : x))} placeholder="valor" className="w-24 h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[12px] text-right" />
                <button type="button" onClick={() => setParcelas((arr) => arr.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600"><X size={14} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setParcelas((arr) => [...arr, { n: arr.length + 1, data, valor: 0 }])} className="text-[12px] font-semibold text-indigo-600">+ parcela</button>
          </div>}
        </div>
        <div><label className={LBL}>Observação <span className="text-gray-400 normal-case">(opcional)</span></label><input value={observacao} onChange={(e) => setObs(e.target.value)} className={INP + " mt-1"} /></div>
        {dupWarn && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-[12.5px]">
            <div className="font-bold text-amber-800 dark:text-amber-200 mb-1">⚠ Possível duplicidade</div>
            <div className="text-amber-700 dark:text-amber-300/90">Já existe lançamento parecido (mesmo valor, estabelecimento e data próximos):</div>
            <ul className="mt-1.5 space-y-1">
              {dupWarn.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                  <span className="tabular-nums text-gray-500 dark:text-gray-400">{fmtBR(d.data)}</span>
                  <span className="truncate">{d.estabelecimento}</span>
                  <span className="ml-auto font-semibold tabular-nums">{fmtR(d.valor)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setDupWarn(null)} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700">Revisar</button>
              <button onClick={() => void salvar(true)} disabled={salvando} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-amber-600 text-white disabled:opacity-50">Salvar mesmo assim</button>
            </div>
          </div>
        )}
        {erro && <div className="text-[12px] text-rose-600">{erro}</div>}
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2">
        {registro && <button onClick={async () => { if (confirm("Excluir este lançamento? O comprovante no Drive não é apagado.")) { await excluirLancamento(registro.id); onSay("Lançamento excluído"); onClose(); } }} className="px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-sm font-semibold inline-flex items-center gap-1"><Trash2 size={14} /> Excluir</button>}
        <div className="flex-1" />
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
        <button onClick={() => void salvar()} disabled={salvando || iaBusy} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1">{salvando ? "Salvando…" : <><Lock size={13} /> Salvar</>}</button>
      </div>
    </div>
  </div>;
}
