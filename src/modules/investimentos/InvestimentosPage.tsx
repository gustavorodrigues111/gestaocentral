import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, TrendingUp, Trash2, Pencil, FolderOpen, Sparkles, X, Check, FileText, ExternalLink, Settings, Lock } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { auth } from "../../core/firebase/config";
import { uploadFileToFolder } from "../../core/google/driveClient";
import { pickDriveFolder } from "../../core/google/drivePicker";
import { fmtBR } from "../../core/utils/date";
import { INVEST_FORMA_LABEL } from "../../core/types";
import type { InvestProjeto, InvestCategoria, InvestLancamento, InvestParcela, InvestFormaPagamento } from "../../core/types";
import { ouvirProjetos, salvarProjeto, excluirProjeto, ouvirCategorias, salvarCategoria, excluirCategoria, ouvirLancamentos, salvarLancamento, excluirLancamento } from "./repository";
import { PageContainer } from "../../core/ui/PageContainer";

const uid = () => { try { return crypto.randomUUID(); } catch { return "id" + Date.now() + Math.random().toString(36).slice(2); } };
const fmtR = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseR = (s: string) => { const n = parseFloat((s || "").replace(/[R$\s.]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const FORMAS = Object.keys(INVEST_FORMA_LABEL) as InvestFormaPagamento[];

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
  const [lancamentos, setLancamentos] = useState<InvestLancamento[]>([]);
  const [projId, setProjId] = useState("");
  const proj = projetos.find((p) => p.id === projId) || projetos[0] || null;

  const [projModal, setProjModal] = useState<{ mode: "new" | "edit"; proj?: InvestProjeto } | null>(null);
  const [lancModal, setLancModal] = useState<InvestLancamento | "new" | null>(null);
  const [gerirCat, setGerirCat] = useState(false);
  const [toast, setToast] = useState("");
  function say(m: string) { setToast(m); setTimeout(() => setToast(""), 2600); }

  useEffect(() => { if (!rid) return; return ouvirProjetos(rid, setProjetos); }, [rid]);
  useEffect(() => { if (!rid) return; return ouvirCategorias(rid, setCategorias); }, [rid]);
  useEffect(() => { if (!rid || !proj) { setLancamentos([]); return; } return ouvirLancamentos(rid, proj.id, setLancamentos); }, [rid, proj?.id]);
  useEffect(() => { if (proj && projId !== proj.id) setProjId(proj.id); }, [proj, projId]);

  const total = useMemo(() => lancamentos.reduce((s, l) => s + (l.valor || 0), 0), [lancamentos]);
  const catConfirmadas = useMemo(() => categorias.filter((c) => c.confirmada !== false), [categorias]);
  const catPendentes = useMemo(() => categorias.filter((c) => c.criadaPorIa && c.confirmada === false), [categorias]);

  async function confirmarCategoria(c: InvestCategoria) { await salvarCategoria({ ...c, confirmada: true, criadaPorIa: false }); }

  if (!rid) return <PageContainer><div className="text-gray-500">Selecione um restaurante.</div></PageContainer>;

  return (
    <PageContainer>
      {/* Cabeçalho: seletor de projeto + ações */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <TrendingUp size={20} className="text-emerald-500" />
        {projetos.length > 0 ? (
          <select value={proj?.id || ""} onChange={(e) => setProjId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-semibold">
            {projetos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        ) : <span className="text-gray-500 text-sm">Nenhum projeto ainda</span>}
        {podeGerirProjetos && <button onClick={() => setProjModal({ mode: "new" })} className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold inline-flex items-center gap-1"><Plus size={15} /> Novo projeto</button>}
        {proj && podeGerirProjetos && <button onClick={() => setProjModal({ mode: "edit", proj })} className="h-9 w-9 grid place-items-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500" title="Editar projeto / pasta do Drive"><Settings size={16} /></button>}
        <div className="flex-1" />
        {proj && <div className="text-sm text-gray-500">Total: <b className="text-gray-800 dark:text-gray-100">{fmtR(total)}</b> · {lancamentos.length} lançamento(s)</div>}
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
              ? <span className="text-[12px] text-gray-500 inline-flex items-center gap-1"><FolderOpen size={13} className="text-amber-500" /> Comprovantes: <b className="text-gray-700 dark:text-gray-300">{proj.pastaDriveNome || "pasta do Drive"}</b></span>
              : <span className="text-[12px] text-amber-600 inline-flex items-center gap-1"><FolderOpen size={13} /> Sem pasta do Drive — configure no ⚙️ pra anexar comprovantes.</span>}
            <div className="flex-1" />
            {podeGerirCategorias && <button onClick={() => setGerirCat(true)} className="text-[12.5px] font-semibold px-3 h-8 rounded-lg border border-gray-200 dark:border-gray-700">Categorias{catPendentes.length ? ` · ${catPendentes.length} da IA a confirmar` : ""}</button>}
            {podeLancar && <button onClick={() => setLancModal("new")} className="text-[12.5px] font-semibold px-3 h-8 rounded-lg bg-indigo-600 text-white inline-flex items-center gap-1"><Plus size={14} /> Novo lançamento</button>}
          </div>

          {/* Tabela */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-500 text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Estabelecimento</th>
                  <th className="text-left px-3 py-2">Categoria</th><th className="text-right px-3 py-2">Valor</th>
                  <th className="text-left px-3 py-2">Pagamento</th><th className="text-left px-3 py-2">Parcelas</th>
                  <th className="text-center px-3 py-2">Comprovante</th><th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {lancamentos.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">Nenhum lançamento. Clique em "Novo lançamento" (dá pra subir o comprovante e a IA preenche).</td></tr>
                ) : lancamentos.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtBR(l.data)}</td>
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{l.estabelecimento || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{l.categoriaNome || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtR(l.valor)}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{l.formaPagamento ? INVEST_FORMA_LABEL[l.formaPagamento] : "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{l.parcelado && l.parcelas?.length ? `${l.parcelas.length}x` : "à vista"}</td>
                    <td className="px-3 py-2 text-center">{l.comprovanteUrl ? <a href={l.comprovanteUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 text-[12px]"><FileText size={13} /> ver <ExternalLink size={11} /></a> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {podeLancar && <>
                        <button onClick={() => setLancModal(l)} className="w-7 h-7 grid place-items-center rounded border border-gray-200 dark:border-gray-700 text-gray-500 inline-flex" title="Editar"><Pencil size={13} /></button>
                        <button onClick={async () => { if (confirm("Excluir este lançamento? O comprovante no Drive não é apagado.")) { await excluirLancamento(l.id); say("Lançamento excluído"); } }} className="w-7 h-7 grid place-items-center rounded border border-gray-200 dark:border-gray-700 text-rose-500 inline-flex ml-1" title="Excluir"><Trash2 size={13} /></button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {lancamentos.length > 0 && (
                <tfoot className="bg-gray-50 dark:bg-gray-800/40 font-bold text-gray-800 dark:text-gray-100">
                  <tr><td className="px-3 py-2" colSpan={3}>Total do projeto</td><td className="px-3 py-2 text-right tabular-nums">{fmtR(total)}</td><td colSpan={4}></td></tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {projModal && <ProjetoModal mode={projModal.mode} proj={projModal.proj} rid={rid} me={me} onClose={() => setProjModal(null)} onSay={say} onSaved={(id) => setProjId(id)} />}
      {gerirCat && <CategoriasModal categorias={categorias} rid={rid!} onConfirmar={confirmarCategoria} onClose={() => setGerirCat(false)} />}
      {lancModal && proj && <LancamentoModal registro={lancModal === "new" ? null : lancModal} proj={proj} rid={rid!} me={me} categorias={catConfirmadas} onClose={() => setLancModal(null)} onSay={say} />}

      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-xl z-[70]">{toast}</div>}
    </PageContainer>
  );
}

// ── Modal: criar/editar projeto (+ pasta Drive) ──────────────────────────────
function ProjetoModal(props: { mode: "new" | "edit"; proj?: InvestProjeto; rid: string; me: ReturnType<typeof useAuth>["pessoa"]; onClose: () => void; onSay: (m: string) => void; onSaved: (id: string) => void }) {
  const { mode, proj, rid, me, onClose, onSay, onSaved } = props;
  const [nome, setNome] = useState(proj?.nome || "");
  const [descricao, setDescricao] = useState(proj?.descricao || "");
  const [pastaId, setPastaId] = useState(proj?.pastaDriveId || "");
  const [pastaNome, setPastaNome] = useState(proj?.pastaDriveNome || "");
  const [erro, setErro] = useState("");

  async function escolherPasta() {
    setErro("");
    try {
      const f = await pickDriveFolder("Pasta dos comprovantes deste projeto");
      if (f) { setPastaId(f.id); setPastaNome(f.name); }
    } catch (e) { setErro("Não consegui abrir o Drive: " + (e instanceof Error ? e.message : "erro")); }
  }
  async function salvar() {
    if (!nome.trim()) return;
    const now = new Date().toISOString();
    const p: InvestProjeto = {
      id: proj?.id || uid(), restaurantId: rid, nome: nome.trim(), descricao: descricao.trim() || undefined,
      pastaDriveId: pastaId || undefined, pastaDriveNome: pastaNome || undefined,
      ativo: true, ordem: proj?.ordem ?? Date.now(), criadoEm: proj?.criadoEm || now, criadoPor: proj?.criadoPor || (me?.id || ""),
    };
    try { await salvarProjeto(p); onSay(mode === "new" ? "✓ Projeto criado" : "✓ Projeto salvo"); onSaved(p.id); onClose(); }
    catch (e) { setErro("Falha ao salvar: " + (e instanceof Error ? e.message : "erro")); }
  }
  async function excluir() { if (!proj) return; if (!confirm(`Excluir o projeto "${proj.nome}"? Os lançamentos ficam órfãos (não some do Drive).`)) return; await excluirProjeto(proj.id); onSay("Projeto excluído"); onClose(); }

  return <div className="fixed inset-0 z-[80] bg-black/40 grid place-items-center p-4" onClick={onClose}>
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-[480px] max-w-full p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-3"><div className="font-extrabold text-[15px]">{mode === "new" ? "Novo projeto" : "Editar projeto"}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
      <label className="text-[11px] font-bold text-gray-500 uppercase">Nome</label>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Reforma do salão" autoFocus className="w-full mt-1 mb-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
      <label className="text-[11px] font-bold text-gray-500 uppercase">Descrição <span className="text-gray-400 normal-case">(opcional)</span></label>
      <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className="w-full mt-1 mb-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
      <label className="text-[11px] font-bold text-gray-500 uppercase">Pasta do Drive (comprovantes)</label>
      <div className="flex items-center gap-2 mt-1">
        <button onClick={() => void escolherPasta()} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1.5"><FolderOpen size={15} className="text-amber-500" /> {pastaNome ? "Trocar pasta" : "Escolher pasta"}</button>
        {pastaNome && <span className="text-[12px] text-gray-600 dark:text-gray-300 truncate">{pastaNome}</span>}
      </div>
      <div className="text-[11px] text-gray-400 mt-1">Os comprovantes vão pra essa pasta, nomeados <b>Estabelecimento_Data</b>.</div>
      {erro && <div className="text-[12px] text-rose-600 mt-2">{erro}</div>}
      <div className="flex gap-2 mt-4">
        {mode === "edit" && <button onClick={() => void excluir()} className="px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-sm font-semibold inline-flex items-center gap-1"><Trash2 size={14} /> Excluir</button>}
        <div className="flex-1" />
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
        <button onClick={() => void salvar()} disabled={!nome.trim()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">Salvar</button>
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
  return <div className="fixed inset-0 z-[80] bg-black/40 grid place-items-center p-4" onClick={onClose}>
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-[440px] max-w-full p-5" onClick={(e) => e.stopPropagation()}>
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
        <input value={nova} onChange={(e) => setNova(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void adicionar(); }} placeholder="Nova categoria" className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm" />
        <button onClick={() => void adicionar()} disabled={!nova.trim()} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50">Adicionar</button>
      </div>
    </div>
  </div>;
}

// ── Modal: novo/editar lançamento (comprovante + IA + parcelas) ──────────────
function LancamentoModal(props: { registro: InvestLancamento | null; proj: InvestProjeto; rid: string; me: ReturnType<typeof useAuth>["pessoa"]; categorias: InvestCategoria[]; onClose: () => void; onSay: (m: string) => void }) {
  const { registro, proj, rid, me, categorias, onClose, onSay } = props;
  const [data, setData] = useState(registro?.data || new Date().toISOString().slice(0, 10));
  const [estabelecimento, setEstab] = useState(registro?.estabelecimento || "");
  const [categoriaNome, setCategoriaNome] = useState(registro?.categoriaNome || "");
  const [valor, setValor] = useState(registro ? String(registro.valor).replace(".", ",") : "");
  const [forma, setForma] = useState<InvestFormaPagamento>(registro?.formaPagamento || "pix");
  const [parcelado, setParcelado] = useState(registro?.parcelado || false);
  const [parcelas, setParcelas] = useState<InvestParcela[]>(registro?.parcelas || []);
  const [observacao, setObs] = useState(registro?.observacao || "");
  const [file, setFile] = useState<File | null>(null);
  const [iaBusy, setIaBusy] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [catSugerida, setCatSugerida] = useState("");   // sugestão da IA fora da lista
  const fileRef = useRef<HTMLInputElement>(null);

  const jaTemComprovante = !!registro?.comprovanteUrl;

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
      if (ex.formaPagamento && (FORMAS as string[]).includes(ex.formaPagamento)) setForma(ex.formaPagamento);
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
    const base = parseR(valor) / n;
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
        const up = await uploadFileToFolder(proj.pastaDriveId, renamed);
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

  const inp = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm";
  return <div className="fixed inset-0 z-[80] bg-black/40 grid place-items-center p-4" onClick={onClose}>
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-[560px] max-w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2"><div className="font-extrabold text-[15px]">{registro ? "Editar lançamento" : "Novo lançamento"}</div><div className="flex-1" /><button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-lg bg-gray-100 dark:bg-gray-800"><X size={16} /></button></div>
      <div className="p-4 overflow-auto space-y-3">
        {/* Comprovante + IA */}
        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
          <div className="text-[12px] font-semibold text-indigo-800 dark:text-indigo-200 mb-1.5 inline-flex items-center gap-1"><Sparkles size={14} /> Comprovante — a IA preenche a linha</div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); if (f) void preencherComIA(f); }} className="text-[12px]" />
          {jaTemComprovante && !file && <div className="text-[11px] text-gray-500 mt-1 inline-flex items-center gap-1"><FileText size={12} /> Já tem comprovante ({registro?.comprovanteNome}). Suba outro pra substituir.</div>}
          {iaBusy && <div className="text-[12px] text-indigo-600 mt-1 inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" /> Lendo o comprovante…</div>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-[11px] font-bold text-gray-500 uppercase">Data</label><input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inp} /></div>
          <div><label className="text-[11px] font-bold text-gray-500 uppercase">Valor</label><input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={inp} /></div>
        </div>
        <div><label className="text-[11px] font-bold text-gray-500 uppercase">Estabelecimento</label><input value={estabelecimento} onChange={(e) => setEstab(e.target.value)} className={inp} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-[11px] font-bold text-gray-500 uppercase">Categoria</label>
            <select value={categoriaNome} onChange={(e) => setCategoriaNome(e.target.value)} className={inp}>
              <option value="">— sem categoria —</option>{categorias.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
            </select>
            {catSugerida && <button onClick={() => void adicionarCatSugerida()} className="text-[11px] mt-1 text-amber-700 dark:text-amber-300 inline-flex items-center gap-1"><Sparkles size={11} /> IA sugeriu "{catSugerida}" — adicionar</button>}
          </div>
          <div><label className="text-[11px] font-bold text-gray-500 uppercase">Forma de pagamento</label>
            <select value={forma} onChange={(e) => setForma(e.target.value as InvestFormaPagamento)} className={inp}>{FORMAS.map((f) => <option key={f} value={f}>{INVEST_FORMA_LABEL[f]}</option>)}</select>
          </div>
        </div>
        {/* Parcelamento */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <label className="inline-flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={parcelado} onChange={(e) => { setParcelado(e.target.checked); if (e.target.checked && parcelas.length === 0) gerarParcelas(2); }} /> Parcelado</label>
          {parcelado && <div className="mt-2 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500">Gerar rápido:{[2, 3, 4, 6, 10, 12].map((n) => <button key={n} onClick={() => gerarParcelas(n)} className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">{n}x</button>)}</div>
            {parcelas.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 w-6">{p.n}ª</span>
                <input type="date" value={p.data} onChange={(e) => setParcelas((arr) => arr.map((x, j) => j === i ? { ...x, data: e.target.value } : x))} className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[12px]" />
                <input value={String(p.valor).replace(".", ",")} onChange={(e) => setParcelas((arr) => arr.map((x, j) => j === i ? { ...x, valor: parseR(e.target.value) } : x))} placeholder="valor" className="w-24 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[12px] text-right" />
                <button onClick={() => setParcelas((arr) => arr.filter((_, j) => j !== i))} className="text-rose-400 hover:text-rose-600"><X size={14} /></button>
              </div>
            ))}
            <button onClick={() => setParcelas((arr) => [...arr, { n: arr.length + 1, data, valor: 0 }])} className="text-[12px] font-semibold text-indigo-600">+ parcela</button>
          </div>}
        </div>
        <div><label className="text-[11px] font-bold text-gray-500 uppercase">Observação <span className="text-gray-400 normal-case">(opcional)</span></label><input value={observacao} onChange={(e) => setObs(e.target.value)} className={inp} /></div>
        {erro && <div className="text-[12px] text-rose-600">{erro}</div>}
      </div>
      <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold">Cancelar</button>
        <button onClick={() => void salvar()} disabled={salvando || iaBusy} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1">{salvando ? "Salvando…" : <><Lock size={13} /> Salvar</>}</button>
      </div>
    </div>
  </div>;
}
