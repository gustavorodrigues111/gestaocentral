import { useEffect, useMemo, useRef, useState } from "react";
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
import type { InvestProjeto, InvestCategoria, InvestLancamento, InvestParcela, InvestForma, InvestConfig } from "../../core/types";
import { ouvirProjetos, salvarProjeto, excluirProjeto, ouvirCategorias, salvarCategoria, excluirCategoria, ouvirFormas, salvarForma, ouvirLancamentos, salvarLancamento, excluirLancamento, ouvirConfig, salvarConfig } from "./repository";
import { PageContainer } from "../../core/ui/PageContainer";

const uid = () => { try { return crypto.randomUUID(); } catch { return "id" + Date.now() + Math.random().toString(36).slice(2); } };
const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseR = (s: string) => { const n = parseFloat((s || "").replace(/[R$\s.]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const FORMAS_FIXAS: { value: string; label: string }[] = Object.entries(INVEST_FORMA_LABEL).map(([value, label]) => ({ value, label }));

// Classe única pros campos — todos com a MESMA altura (h-10).
const INP = "w-full h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/40";
const LBL = "text-[11px] font-bold text-gray-500 uppercase tracking-wide";

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
  const [lancamentos, setLancamentos] = useState<InvestLancamento[]>([]);
  const [cfg, setCfg] = useState<InvestConfig | null>(null);
  const [central, setCentral] = useState<boolean | null>(null);
  const [projId, setProjId] = useState("");
  const proj = projetos.find((p) => p.id === projId) || projetos[0] || null;

  const [projModal, setProjModal] = useState<{ mode: "new" | "edit"; proj?: InvestProjeto } | null>(null);
  const [lancModal, setLancModal] = useState<InvestLancamento | "new" | null>(null);
  const [gerirCat, setGerirCat] = useState(false);
  const [toast, setToast] = useState("");
  function say(m: string) { setToast(m); setTimeout(() => setToast(""), 2600); }

  useEffect(() => { if (!rid) return; return ouvirProjetos(rid, setProjetos); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirCategorias(rid, setCategorias); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirFormas(rid, setFormas); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirConfig(rid, setCfg); }, [rid]);
  useEffect(() => { centralConfigured().then(setCentral).catch(() => setCentral(false)); }, []);

  async function salvarRoot(id: string, nome?: string) { if (!rid) return; await salvarConfig({ id: rid, restaurantId: rid, driveRootId: id, driveRootNome: nome }); }
  useEffect(() => { if (!rid || !proj) { setLancamentos([]); return; } return ouvirLancamentos(rid, proj.id, setLancamentos); }, [rid, proj?.id]);
  useEffect(() => { if (proj && projId !== proj.id) setProjId(proj.id); }, [proj, projId]);

  const total = useMemo(() => lancamentos.reduce((s, l) => s + (l.valor || 0), 0), [lancamentos]);
  const catPendentes = useMemo(() => categorias.filter((c) => c.criadaPorIa && c.confirmada === false), [categorias]);

  async function confirmarCategoria(c: InvestCategoria) { await salvarCategoria({ ...c, confirmada: true, criadaPorIa: false }); }

  if (!rid) return <PageContainer><div className="text-gray-500">Selecione um restaurante.</div></PageContainer>;

  return (
    <PageContainer>
      {/* Cabeçalho: seletor de projeto + ações */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <TrendingUp size={20} className="text-emerald-500 shrink-0" />
        {projetos.length > 0 ? (
          <select value={proj?.id || ""} onChange={(e) => setProjId(e.target.value)} className="h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-semibold flex-1 min-w-0 sm:flex-none sm:min-w-[220px]">
            {projetos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        ) : <span className="text-gray-500 text-sm flex-1">Nenhum projeto ainda</span>}
        {podeGerirProjetos && <button onClick={() => setProjModal({ mode: "new" })} className="h-10 px-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold inline-flex items-center gap-1 shrink-0"><Plus size={15} /> Novo projeto</button>}
        {proj && podeGerirProjetos && <button onClick={() => setProjModal({ mode: "edit", proj })} className="h-10 w-10 grid place-items-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 shrink-0" title="Editar projeto / pasta do Drive"><Settings size={16} /></button>}
        {proj && <div className="w-full sm:w-auto sm:ml-auto text-sm text-gray-500">Total: <b className="text-gray-800 dark:text-gray-100">{fmtR(total)}</b> · {lancamentos.length} lançamento(s)</div>}
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
          {/* Barra do projeto: pasta Drive + categorias + nova linha */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {proj.pastaDriveId
              ? <span className="text-[12px] text-gray-500 inline-flex items-center gap-1 min-w-0"><FolderOpen size={13} className="text-amber-500 shrink-0" /> Comprovantes: <b className="text-gray-700 dark:text-gray-300 truncate">{proj.pastaDriveNome || "pasta do Drive"}</b></span>
              : <span className="text-[12px] text-amber-600 inline-flex items-center gap-1"><FolderOpen size={13} className="shrink-0" /> Sem pasta do Drive — configure no ⚙️ pra anexar comprovantes.</span>}
            <div className="hidden sm:block flex-1" />
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {podeGerirCategorias && <button onClick={() => setGerirCat(true)} className="text-[12.5px] font-semibold px-3 h-9 rounded-lg border border-gray-200 dark:border-gray-700 flex-1 sm:flex-none">Categorias{catPendentes.length ? ` · ${catPendentes.length}` : ""}</button>}
              {podeLancar && <button onClick={() => setLancModal("new")} className="text-[12.5px] font-semibold px-3 h-9 rounded-lg bg-indigo-600 text-white inline-flex items-center justify-center gap-1 flex-1 sm:flex-none"><Plus size={14} /> Novo lançamento</button>}
            </div>
          </div>

          {/* Tabela */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl overflow-x-auto shadow-sm">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500 text-[11px] uppercase tracking-wider border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Data</th><th className="text-left px-4 py-3 font-semibold">Estabelecimento</th>
                  <th className="text-left px-4 py-3 font-semibold">Categoria</th><th className="text-right px-4 py-3 font-semibold">Valor</th>
                  <th className="text-left px-4 py-3 font-semibold">Pagamento</th><th className="text-left px-4 py-3 font-semibold">Parcelas</th>
                  <th className="text-center px-4 py-3 font-semibold">Comprovante</th><th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/70">
                {lancamentos.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Nenhum lançamento. Clique em "Novo lançamento" (dá pra arrastar/colar o comprovante e a IA preenche).</td></tr>
                ) : lancamentos.map((l) => (
                  <tr key={l.id} className="group hover:bg-indigo-50/40 dark:hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap text-gray-500 dark:text-gray-400">{fmtBR(l.data)}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100">{l.estabelecimento || "—"}</td>
                    <td className="px-4 py-3">{l.categoriaNome ? <span className="inline-block px-2 py-0.5 rounded-full text-[12px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{l.categoriaNome}</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900 dark:text-gray-100">{fmtR(l.valor)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{investFormaLabel(l.formaPagamento)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{l.parcelado && l.parcelas?.length ? `${l.parcelas.length}x` : "à vista"}</td>
                    <td className="px-4 py-3 text-center">{l.comprovanteUrl ? <a href={l.comprovanteUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 text-[12px] font-medium"><FileText size={13} /> ver <ExternalLink size={11} /></a> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {podeLancar && <button onClick={() => setLancModal(l)} className="w-8 h-8 inline-grid place-items-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-indigo-600 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors" title="Editar"><Pencil size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {lancamentos.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 font-extrabold">
                    <td className="px-4 py-3.5" colSpan={3}>Total do projeto</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-[15px]">{fmtR(total)}</td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {projModal && <ProjetoModal mode={projModal.mode} proj={projModal.proj} rid={rid} me={me} central={central} driveRootId={cfg?.driveRootId} driveRootNome={cfg?.driveRootNome} onSaveRoot={salvarRoot} onClose={() => setProjModal(null)} onSay={say} onSaved={(id) => setProjId(id)} />}
      {gerirCat && <CategoriasModal categorias={categorias} rid={rid!} onConfirmar={confirmarCategoria} onClose={() => setGerirCat(false)} />}
      {lancModal && proj && <LancamentoModal registro={lancModal === "new" ? null : lancModal} proj={proj} rid={rid!} me={me} categorias={categorias} formas={formas} onClose={() => setLancModal(null)} onSay={say} />}

      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-xl z-[210]">{toast}</div>}
    </PageContainer>
  );
}

// ── Modal: criar/editar projeto (+ pasta Drive) ──────────────────────────────
function ProjetoModal(props: {
  mode: "new" | "edit"; proj?: InvestProjeto; rid: string; me: ReturnType<typeof useAuth>["pessoa"];
  central: boolean | null; driveRootId?: string; driveRootNome?: string; onSaveRoot: (id: string, nome?: string) => Promise<void>;
  onClose: () => void; onSay: (m: string) => void; onSaved: (id: string) => void;
}) {
  const { mode, proj, rid, me, central, driveRootId, onSaveRoot, onClose, onSay, onSaved } = props;
  const [nome, setNome] = useState(proj?.nome || "");
  const [descricao, setDescricao] = useState(proj?.descricao || "");
  const [pastaId, setPastaId] = useState(proj?.pastaDriveId || "");     // fluxo navegador (legado)
  const [pastaNome, setPastaNome] = useState(proj?.pastaDriveNome || "");
  const [rootInput, setRootInput] = useState("");                       // fluxo central: root a configurar
  const [editRoot, setEditRoot] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const precisaRoot = central === true && (!driveRootId || editRoot);

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
      <div className="flex items-center gap-2 mb-3"><div className="font-extrabold text-[15px]">{mode === "new" ? "Novo projeto" : "Editar projeto"}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
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

      {erro && <div className="text-[12px] text-rose-600 mt-2">{erro}</div>}
      <div className="flex gap-2 mt-4">
        {mode === "edit" && <button onClick={() => void excluir()} className="px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-sm font-semibold inline-flex items-center gap-1"><Trash2 size={14} /> Excluir</button>}
        <div className="flex-1" />
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
        <button onClick={() => void salvar()} disabled={!nome.trim() || salvando || central === null} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">{salvando ? "Salvando…" : "Salvar"}</button>
      </div>
    </div>
  </div>;
}

// ── Modal: gerir categorias (fixa + confirmar sugestões da IA) ────────────────
function CategoriasModal(props: { categorias: InvestCategoria[]; rid: string; onConfirmar: (c: InvestCategoria) => void; onClose: () => void }) {
  const { categorias, rid, onConfirmar, onClose } = props;
  const [nova, setNova] = useState("");
  const confirmadas = categorias.filter((c) => c.confirmada !== false);
  const pendentes = categorias.filter((c) => c.criadaPorIa && c.confirmada === false);
  async function adicionar() {
    const n = nova.trim(); if (!n) return;
    if (categorias.some((c) => c.nome.toLowerCase() === n.toLowerCase())) { setNova(""); return; }
    await salvarCategoria({ id: uid(), restaurantId: rid, nome: n, confirmada: true, criadoEm: new Date().toISOString() });
    setNova("");
  }
  return <div className="fixed inset-0 z-[80] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
    <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[440px] max-h-[90vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-3"><div className="font-extrabold text-[15px]">Categorias</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
      {pendentes.length > 0 && <div className="mb-3">
        <div className="text-[11px] font-bold text-amber-600 uppercase mb-1 inline-flex items-center gap-1"><Sparkles size={12} /> Sugeridas pela IA — confirme</div>
        <div className="space-y-1">{pendentes.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-sm bg-amber-50 dark:bg-amber-950/20 rounded-lg px-2.5 py-1.5">
            <span className="flex-1 font-medium">{c.nome}</span>
            <button onClick={() => onConfirmar(c)} className="text-[11px] font-bold px-2 py-1 rounded bg-emerald-600 text-white inline-flex items-center gap-1"><Check size={12} /> Confirmar</button>
            <button onClick={() => void excluirCategoria(c.id)} className="text-rose-400 hover:text-rose-600" title="Descartar"><X size={14} /></button>
          </div>))}</div>
      </div>}
      <div className="text-[11px] font-bold text-gray-500 uppercase mb-1">Categorias ({confirmadas.length})</div>
      <div className="flex flex-wrap gap-1.5 mb-3">{confirmadas.length === 0 ? <span className="text-xs text-gray-400">Nenhuma ainda.</span> : confirmadas.map((c) => (
        <span key={c.id} className="text-[12px] px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 inline-flex items-center gap-1">{c.nome}<button onClick={() => void excluirCategoria(c.id)} className="text-gray-400 hover:text-rose-500"><X size={12} /></button></span>))}</div>
      <div className="flex gap-2">
        <input value={nova} onChange={(e) => setNova(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void adicionar(); }} placeholder="Nova categoria" className="flex-1 h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
        <button onClick={() => void adicionar()} disabled={!nova.trim()} className="px-3 h-10 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Adicionar</button>
      </div>
    </div>
  </div>;
}

// ── Modal: novo/editar lançamento (comprovante + IA + parcelas) ──────────────
function LancamentoModal(props: { registro: InvestLancamento | null; proj: InvestProjeto; rid: string; me: ReturnType<typeof useAuth>["pessoa"]; categorias: InvestCategoria[]; formas: InvestForma[]; onClose: () => void; onSay: (m: string) => void }) {
  const { registro, proj, rid, me, categorias, formas, onClose, onSay } = props;
  const [data, setData] = useState(registro?.data || new Date().toISOString().slice(0, 10));
  const [estabelecimento, setEstab] = useState(registro?.estabelecimento || "");
  const [categoriaNome, setCategoriaNome] = useState(registro?.categoriaNome || "");
  const [valor, setValor] = useState(registro ? String(registro.valor).replace(".", ",") : "");
  const [forma, setForma] = useState<string>(registro?.formaPagamento || "pix");
  const [parcelado, setParcelado] = useState(registro?.parcelado || false);
  const [parcelas, setParcelas] = useState<InvestParcela[]>(registro?.parcelas || []);
  const [observacao, setObs] = useState(registro?.observacao || "");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [iaBusy, setIaBusy] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [catSugerida, setCatSugerida] = useState("");   // sugestão da IA fora da lista
  const fileRef = useRef<HTMLInputElement>(null);

  const jaTemComprovante = !!registro?.comprovanteUrl;

  const catOptions = useMemo(() => [
    { value: "", label: "— sem categoria —" },
    ...categorias.map((c) => ({ value: c.nome, label: c.confirmada === false ? `${c.nome} · a confirmar` : c.nome })),
  ], [categorias]);
  const formaOptions = useMemo(() => {
    const extra = formas.filter((fc) => !FORMAS_FIXAS.some((x) => x.value === fc.nome || x.label.toLowerCase() === fc.nome.toLowerCase())).map((fc) => ({ value: fc.nome, label: fc.nome }));
    return [...FORMAS_FIXAS, ...extra];
  }, [formas]);

  async function addCategoria(nome: string) {
    if (categorias.some((c) => c.nome.toLowerCase() === nome.toLowerCase())) return;
    await salvarCategoria({ id: uid(), restaurantId: rid, nome, confirmada: true, criadoEm: new Date().toISOString() });
  }
  async function addForma(nome: string) {
    if (FORMAS_FIXAS.some((x) => x.value === nome || x.label.toLowerCase() === nome.toLowerCase())) return;
    if (formas.some((f) => f.nome.toLowerCase() === nome.toLowerCase())) return;
    await salvarForma({ id: uid(), restaurantId: rid, nome, criadoEm: new Date().toISOString() });
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
      if (typeof ex.valor === "number" && ex.valor > 0) setValor(String(ex.valor).replace(".", ","));
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
    const v = parseR(valor); if (!v || n < 1) return;
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

  async function salvar() {
    if (!estabelecimento.trim()) { setErro("Informe o estabelecimento."); return; }
    const v = parseR(valor); if (!v) { setErro("Informe o valor."); return; }
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
        valor: v, formaPagamento: forma, parcelado, parcelas: parcelado ? parcelas.filter((p) => p.valor > 0) : undefined,
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
          <div><label className={LBL}>Valor</label><input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={INP + " mt-1"} /></div>
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
