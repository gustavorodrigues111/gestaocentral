// Geração de documentos EM LOTE. Dois modos:
//  • vários documentos → 1 empregado
//  • 1 documento → vários empregados
// Só entram no lote os documentos "automáticos" (campos vêm de empresa/empregado/
// data; sem opções, tabelas ou textos redigidos — esses precisam do gerador manual).
// Saída: baixar em .zip, baixar um a um, ou salvar na pasta do empregado no Drive.
import { useMemo, useState } from "react";
import JSZip from "jszip";
import { FileText, Users, Download, FolderUp, Loader2, Check, Search } from "lucide-react";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { authHeader } from "../../core/firebase/idToken";
import { fmtBR } from "../../core/utils/date";
import type { DocModelo } from "./DocumentosPage";
import type { Empregado, Pessoa } from "../../core/types";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

type Saida = "zip" | "individual" | "drive";
type ItemResultado = { doc: string; empregado: string; nomeArq: string; blob: Blob; faltando: string[] };

export function LoteModal({ docsElegiveis, empresaData, empregados, pessoas, empresaNome, onSalvarDrive, onClose }: {
  docsElegiveis: DocModelo[];
  empresaData: Record<string, string>;
  empregados: Empregado[];
  pessoas: Pessoa[];
  empresaNome: string;
  onSalvarDrive?: (emp: Empregado, blob: Blob, nomeArq: string) => Promise<void>;
  onClose: () => void;
}) {
  const [modo, setModo] = useState<"docs-1emp" | "1doc-emps">("docs-1emp");
  const [docIds, setDocIds] = useState<Set<string>>(new Set());
  const [empIds, setEmpIds] = useState<Set<string>>(new Set());
  const [buscaEmp, setBuscaEmp] = useState("");
  const [buscaDoc, setBuscaDoc] = useState("");
  const [gerando, setGerando] = useState(false);
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 });
  const [erro, setErro] = useState("");
  const [resultados, setResultados] = useState<ItemResultado[] | null>(null);

  const empsAtivos = useMemo(() => empregados.filter(e => e.estaAtivo !== false).sort((a, b) => (a.nome || "").localeCompare(b.nome || "")), [empregados]);
  const empFiltrados = useMemo(() => {
    const b = buscaEmp.trim().toLowerCase();
    return b ? empsAtivos.filter(e => (e.nome || "").toLowerCase().includes(b)) : empsAtivos;
  }, [empsAtivos, buscaEmp]);
  const docsFiltrados = useMemo(() => {
    const b = buscaDoc.trim().toLowerCase();
    return b ? docsElegiveis.filter(d => `${d.titulo} ${d.categoria}`.toLowerCase().includes(b)) : docsElegiveis;
  }, [docsElegiveis, buscaDoc]);

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n);
  };

  // Quantos documentos vão sair (modo A = docs escolhidos; modo B = 1 doc × empregados).
  const totalDocs = modo === "docs-1emp" ? docIds.size : (docIds.size ? empIds.size : 0);
  const podeGerar = modo === "docs-1emp"
    ? (docIds.size > 0 && empIds.size === 1)
    : (docIds.size === 1 && empIds.size > 0);

  function dadosDe(modelo: DocModelo, emp: Empregado): Record<string, string> {
    const pes = emp.pessoaId ? pessoas.find(p => p.id === emp.pessoaId) : null;
    const h = new Date();
    const dia = String(h.getDate()), mes = MESES[h.getMonth()], ano2 = String(h.getFullYear()).slice(-2);
    const nome = emp.nome || pes?.nome || "";
    const cpf = emp.cpf || pes?.cpf || "";
    const adm = emp.admissaoAtual || emp.periodos?.[(emp.periodos?.length || 1) - 1]?.admissao || "";
    const base: Record<string, string> = {
      DIA: dia, DIA_1: dia, DIA_2: dia, MES: mes, MES_1: mes, MES_2: mes,
      ANO2: ano2, ANO2_1: ano2, ANO2_2: ano2, DATA: fmtBR(h.toISOString()), CIDADE: empresaData.CIDADE || "",
      NOME_EMPREGADO: nome, CPF_EMPREGADO: cpf, DATA_ADMISSAO: adm ? fmtBR(adm) : "",
      ...empresaData,
    };
    const dados: Record<string, string> = {};
    for (const c of modelo.campos) dados[c.token] = base[c.token] ?? "";
    // completa tokens de data/empresa que não estão em campos mas o modelo usa
    return { ...base, ...dados };
  }

  async function gerarUm(modelo: DocModelo, emp: Empregado): Promise<ItemResultado> {
    const r = await fetch("/api/documento-preencher", {
      method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ modeloId: modelo.id, dados: dadosDe(modelo, emp) }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `Falha em "${modelo.titulo}" (${emp.nome}).`);
    const bin = atob(String(data.docxBase64 || ""));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const st = new Date();
    const stamp = `${st.getFullYear()}.${String(st.getMonth() + 1).padStart(2, "0")}.${String(st.getDate()).padStart(2, "0")}`;
    const nomeArq = `${stamp} ${modelo.titulo} - ${emp.nome}.docx`;
    return { doc: modelo.titulo, empregado: emp.nome || "", nomeArq, blob, faltando: Array.isArray(data.faltando) ? data.faltando : [] };
  }

  async function gerar(saida: Saida) {
    setErro(""); setGerando(true); setResultados(null);
    try {
      const pares: { modelo: DocModelo; emp: Empregado }[] = [];
      if (modo === "docs-1emp") {
        const emp = empsAtivos.find(e => empIds.has(e.id));
        if (!emp) throw new Error("Selecione um empregado.");
        for (const id of docIds) { const d = docsElegiveis.find(x => x.id === id); if (d) pares.push({ modelo: d, emp }); }
      } else {
        const d = docsElegiveis.find(x => docIds.has(x.id));
        if (!d) throw new Error("Selecione um documento.");
        for (const eid of empIds) { const e = empsAtivos.find(x => x.id === eid); if (e) pares.push({ modelo: d, emp: e }); }
      }
      setProgresso({ feito: 0, total: pares.length });
      const out: ItemResultado[] = [];
      for (const p of pares) {
        const res = await gerarUm(p.modelo, p.emp);
        out.push(res);
        setProgresso(s => ({ ...s, feito: s.feito + 1 }));
        if (saida === "individual") {
          const url = URL.createObjectURL(res.blob);
          const a = document.createElement("a"); a.href = url; a.download = res.nomeArq; document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
        } else if (saida === "drive" && onSalvarDrive) {
          await onSalvarDrive(p.emp, res.blob, res.nomeArq);
        }
      }
      if (saida === "zip") {
        const zip = new JSZip();
        for (const res of out) zip.file(res.nomeArq, res.blob);
        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const a = document.createElement("a"); a.href = url;
        a.download = `Documentos - ${empresaNome} - ${fmtBR(new Date().toISOString())}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
      setResultados(out);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar em lote.");
    } finally { setGerando(false); }
  }

  const comFalta = (resultados || []).filter(r => r.faltando.length);

  return (
    <Modal title={<span className="inline-flex items-center gap-2"><FileText size={18} /> Gerar documentos em lote</span>} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Modo */}
        <div className="grid grid-cols-2 gap-2">
          {([["docs-1emp", "Vários documentos", "para 1 empregado", FileText], ["1doc-emps", "1 documento", "para vários empregados", Users]] as const).map(([id, t, sub, Ico]) => (
            <button key={id} type="button" onClick={() => { setModo(id); setDocIds(new Set()); setEmpIds(new Set()); setResultados(null); }}
              className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${modo === id ? "border-indigo-400 bg-indigo-50/60 dark:bg-indigo-900/20" : "border-gray-200 dark:border-gray-800 hover:border-indigo-300"}`}>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5"><Ico size={14} /> {t}</div>
              <div className="text-[11px] text-gray-500">{sub}</div>
            </button>
          ))}
        </div>

        {/* Documentos */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{modo === "docs-1emp" ? `Documentos (${docIds.size})` : "Documento (1)"}</label>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={buscaDoc} onChange={e => setBuscaDoc(e.target.value)} placeholder="buscar" className="pl-7 pr-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-40" />
            </div>
          </div>
          <div className="max-h-44 overflow-auto rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {docsFiltrados.map(d => {
              const on = docIds.has(d.id);
              return (
                <button key={d.id} type="button"
                  onClick={() => { if (modo === "1doc-emps") { setDocIds(new Set(on ? [] : [d.id])); } else { toggle(docIds, d.id, setDocIds); } setResultados(null); }}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm ${on ? "bg-indigo-50/60 dark:bg-indigo-900/15" : "hover:bg-gray-50 dark:hover:bg-gray-800/40"}`}>
                  <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${on ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-600"}`}>{on && <Check size={11} />}</span>
                  <span className="min-w-0"><span className="text-gray-900 dark:text-gray-100">{d.titulo}</span> <span className="text-[11px] text-gray-400">· {d.categoria}</span></span>
                </button>
              );
            })}
            {docsFiltrados.length === 0 && <div className="px-3 py-4 text-xs text-gray-400 text-center">Nenhum documento automático elegível pra lote.</div>}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Só aparecem documentos que se preenchem sozinhos. Os que pedem opções, tabelas ou textos redigidos precisam do gerador individual.</p>
        </div>

        {/* Empregados */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{modo === "1doc-emps" ? `Empregados (${empIds.size})` : "Empregado (1)"}</label>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={buscaEmp} onChange={e => setBuscaEmp(e.target.value)} placeholder="buscar" className="pl-7 pr-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-40" />
            </div>
          </div>
          <div className="max-h-44 overflow-auto rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {empFiltrados.map(e => {
              const on = empIds.has(e.id);
              return (
                <button key={e.id} type="button"
                  onClick={() => { if (modo === "docs-1emp") { setEmpIds(new Set(on ? [] : [e.id])); } else { toggle(empIds, e.id, setEmpIds); } setResultados(null); }}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm ${on ? "bg-indigo-50/60 dark:bg-indigo-900/15" : "hover:bg-gray-50 dark:hover:bg-gray-800/40"}`}>
                  <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center ${on ? "bg-indigo-600 border-indigo-600 text-white" : "border-gray-300 dark:border-gray-600"}`}>{on && <Check size={11} />}</span>
                  <span className="text-gray-900 dark:text-gray-100">{e.nome}</span>
                </button>
              );
            })}
            {empFiltrados.length === 0 && <div className="px-3 py-4 text-xs text-gray-400 text-center">Nenhum empregado ativo.</div>}
          </div>
        </div>

        {gerando && (
          <div className="text-sm text-gray-600 dark:text-gray-300 inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Gerando {progresso.feito}/{progresso.total}…</div>
        )}
        {erro && <div className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}
        {resultados && !erro && (
          <div className="text-[13px] rounded-lg px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200">
            <div className="inline-flex items-center gap-1.5 font-semibold"><Check size={14} /> {resultados.length} documento(s) gerado(s).</div>
            {comFalta.length > 0 && <div className="text-amber-700 dark:text-amber-300 mt-1 text-[12px]">{comFalta.length} com campos em branco pra completar à mão (ex.: endereço do empregado).</div>}
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-gray-500">{totalDocs > 0 ? `${totalDocs} documento(s) serão gerados` : "Selecione documento(s) e empregado(s)"}</span>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button variant="secondary" disabled={!podeGerar || gerando} onClick={() => void gerar("individual")}><span className="inline-flex items-center gap-1.5"><Download size={14} /> Baixar um a um</span></Button>
          {onSalvarDrive && <Button variant="secondary" disabled={!podeGerar || gerando} onClick={() => void gerar("drive")}><span className="inline-flex items-center gap-1.5"><FolderUp size={14} /> Salvar no Drive</span></Button>}
          <Button disabled={!podeGerar || gerando} onClick={() => void gerar("zip")}><span className="inline-flex items-center gap-1.5"><Download size={14} /> Baixar .zip</span></Button>
        </div>
      </div>
    </Modal>
  );
}
