// Importa um checklist existente (planilha, foto ou PDF) e vira um template.
//  · Planilha (.xlsx/.csv) → lida no cliente (SheetJS), sem IA.
//  · Foto / PDF → sobe pro Storage e o endpoint /api/importar-checklist (Claude)
//    extrai nome + itens (com obrigatório e "como fazer" inferidos).
// Nada é gravado sem revisão: cai numa tela editável e você cria o template.
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { addDoc, collection } from "firebase/firestore";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { authHeader } from "../../core/firebase/idToken";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { ChecklistTemplate } from "../../core/types";
import { parsePeriodicidade, freqItemLabel, type FreqParcial } from "./recorrencia";

type ItemImp = { key: string; texto: string; obrigatorio: boolean; descricao: string; periodicidade?: string } & FreqParcial;
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const semExt = (n: string) => n.replace(/\.[^.]+$/, "");

function parsePlanilha(buf: ArrayBuffer): { nome: string; itens: ItemImp[] } {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = (XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as unknown[][]);
  if (rows.length === 0) return { nome: "", itens: [] };
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const head = (rows[0] || []).map(norm);
  const hasHeader = head.some(h => /item|tarefa|checklist|descri|o que|obrigat|como|instru/.test(h));
  let colTexto = 0, colObrig = -1, colDesc = -1, colFreq = -1;
  if (hasHeader) {
    head.forEach((h, i) => {
      if (/obrigat/.test(h)) colObrig = i;
      else if (/periodic|frequ[eê]nc/.test(h)) colFreq = i;
      else if (/descri|como|instru/.test(h)) colDesc = i;
      else if (/item|tarefa|o que|checklist|equipament|instala/.test(h) && colTexto === 0) colTexto = i;
    });
    if ([colObrig, colDesc, colFreq].includes(colTexto)) { const c = head.findIndex((_, i) => ![colObrig, colDesc, colFreq].includes(i)); if (c >= 0) colTexto = c; }
  }
  const body = hasHeader ? rows.slice(1) : rows;
  const truthy = (v: unknown) => /^(sim|s|x|true|1|obrig)/i.test(String(v ?? "").trim());
  const itens = body.map(r => {
    const periodicidade = colFreq >= 0 ? String(r[colFreq] ?? "").trim() : "";
    return {
      key: uid(),
      texto: String(r[colTexto] ?? "").trim(),
      obrigatorio: colObrig >= 0 ? truthy(r[colObrig]) : true,
      descricao: colDesc >= 0 ? String(r[colDesc] ?? "").trim() : "",
      periodicidade: periodicidade || undefined,
      ...parsePeriodicidade(periodicidade),
    };
  }).filter(i => i.texto);
  const nomeAba = wb.SheetNames[0];
  return { nome: nomeAba && !/^sheet\d*$|^plan\d*$|^planilha\d*$/i.test(nomeAba) ? nomeAba : "", itens };
}

export function ImportarChecklistModal({ rid, onClose, onCriado }: {
  rid: string; onClose: () => void; onCriado: (tpl: ChecklistTemplate) => void;
}) {
  const { pessoa: me } = useAuth();
  const [fase, setFase] = useState<"upload" | "revisao">("upload");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [nome, setNome] = useState("");
  const [itens, setItens] = useState<ItemImp[]>([]);
  const [salvando, setSalvando] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function uploadImport(file: File): Promise<string> {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const task = uploadBytesResumable(storageRef(storage, `checklists/${rid}/import/${Date.now()}.${ext}`), file, { contentType: file.type });
    await new Promise<void>((res, rej) => task.on("state_changed", () => {}, rej, () => res()));
    return getDownloadURL(task.snapshot.ref);
  }

  async function onFile(file: File) {
    setErro(""); setCarregando(true);
    try {
      const low = file.name.toLowerCase();
      const ehPlanilha = /\.(xlsx|xls|csv)$/.test(low) || file.type.includes("sheet") || file.type.includes("csv") || file.type.includes("excel");
      if (ehPlanilha) {
        const r = parsePlanilha(await file.arrayBuffer());
        if (r.itens.length === 0) throw new Error("Não achei itens na planilha. Deve ter uma coluna com as tarefas.");
        setNome(r.nome || semExt(file.name)); setItens(r.itens); setFase("revisao");
      } else if (file.type.startsWith("image/") || file.type === "application/pdf" || low.endsWith(".pdf")) {
        const url = await uploadImport(file);
        const resp = await fetch("/api/importar-checklist", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ fileUrl: url, mime: file.type }) });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error((data as { error?: string })?.error || `Erro ${resp.status}`);
        const its = (Array.isArray((data as { itens?: unknown }).itens) ? (data as { itens: { texto: string; obrigatorio?: boolean; descricao?: string; periodicidade?: string }[] }).itens : []);
        if (its.length === 0) throw new Error("A IA não achou itens. Tente uma foto mais nítida ou enquadrada.");
        setNome(((data as { nome?: string }).nome || semExt(file.name)).trim());
        setItens(its.map(i => ({ key: uid(), texto: i.texto, obrigatorio: i.obrigatorio !== false, descricao: i.descricao || "", periodicidade: (i.periodicidade || "").trim() || undefined, ...parsePeriodicidade(i.periodicidade || "") }))); setFase("revisao");
      } else {
        throw new Error("Formato não suportado. Use planilha (.xlsx/.csv), foto ou PDF.");
      }
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setCarregando(false); }
  }

  const patch = (key: string, p: Partial<ItemImp>) => setItens(s => s.map(i => i.key === key ? { ...i, ...p } : i));
  const remover = (key: string) => setItens(s => s.filter(i => i.key !== key));

  async function criar() {
    if (!nome.trim()) { setErro("Dê um nome ao checklist."); return; }
    const validos = itens.filter(i => i.texto.trim());
    if (validos.length === 0) { setErro("Sem itens."); return; }
    setSalvando(true); setErro("");
    try {
      const now = new Date().toISOString();
      const payload: Omit<ChecklistTemplate, "id"> = {
        restaurantId: rid, nome: nome.trim(), frequencia: "avulsa", ativo: true,
        itens: validos.map((it, idx) => ({ id: `i_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`, texto: it.texto.trim(), ordem: idx + 1, obrigatorio: !!it.obrigatorio, descricao: it.descricao.trim() || undefined, freq: it.freq, diasSemana: it.diasSemana, semanaParidade: it.semanaParidade, diaDoMes: it.diaDoMes, intervaloDias: it.intervaloDias })),
        criadoEm: now, criadoPor: me?.id || "", atualizadoEm: now,
      };
      const refDoc = await addDoc(collection(db, "checklistTemplates"), sanitizeForFirestore(payload));
      onCriado({ id: refDoc.id, ...payload } as ChecklistTemplate);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); setSalvando(false); }
  }

  return (
    <Modal title="📥 Importar checklist" onClose={onClose} maxWidth="max-w-2xl">
      {fase === "upload" ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">Tem um checklist pronto? Suba uma <b>planilha</b> (lida na hora), ou uma <b>foto</b>/<b>PDF</b> (a IA lê e monta pra você). Se houver uma coluna de <b>periodicidade</b> (semanal, quinzenal, dia sim/dia não…), já viro em frequência por item. Você revisa antes de criar.</p>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          <button type="button" disabled={carregando} onClick={() => inputRef.current?.click()} className="w-full rounded-2xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 p-8 text-center hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 disabled:opacity-60">
            <div className="text-3xl mb-1">{carregando ? "⏳" : "📄"}</div>
            <div className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{carregando ? "Lendo…" : "Escolher arquivo"}</div>
            <div className="text-[11px] text-gray-500 mt-0.5">planilha (.xlsx/.csv) · foto · PDF</div>
          </button>
          {erro && <p className="text-xs text-rose-600">⚠ {erro}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <Input label="Nome do checklist" value={nome} onChange={e => setNome(e.target.value)} placeholder="ex: Abertura do salão" />
          <div className="text-[11px] text-gray-500">{itens.length} {itens.length === 1 ? "item" : "itens"} — confira, ajuste obrigatórios e o “como fazer”, depois crie.</div>
          <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {itens.map((it, idx) => (
              <div key={it.key} className="p-2 space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-[11px] text-gray-400 font-mono mt-2 w-5">{idx + 1}.</span>
                  <input value={it.texto} onChange={e => patch(it.key, { texto: e.target.value })} className="flex-1 px-2 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                  <label className="flex items-center gap-1 text-[11px] text-gray-500 mt-2 cursor-pointer whitespace-nowrap"><input type="checkbox" checked={it.obrigatorio} onChange={e => patch(it.key, { obrigatorio: e.target.checked })} />obrig.</label>
                  <button type="button" onClick={() => remover(it.key)} className="text-rose-500 hover:text-rose-700 mt-1.5">×</button>
                </div>
                <input value={it.descricao} onChange={e => patch(it.key, { descricao: e.target.value })} placeholder="como fazer (opcional)" className="w-full ml-7 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" style={{ width: "calc(100% - 1.75rem)" }} />
                {(it.periodicidade || it.freq) && (
                  <div className="ml-7 flex items-center gap-1.5 flex-wrap">
                    {it.freq ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">🔁 {freqItemLabel(it)}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">⚠ periodicidade não reconhecida</span>
                    )}
                    {it.periodicidade && <span className="text-[10px] text-gray-400">no papel: “{it.periodicidade}”</span>}
                    {it.freq && <button type="button" onClick={() => patch(it.key, { freq: undefined, diasSemana: undefined, semanaParidade: undefined, diaDoMes: undefined, intervaloDias: undefined })} className="text-[10px] text-gray-400 hover:text-rose-500 underline">limpar</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setItens(s => [...s, { key: uid(), texto: "", obrigatorio: true, descricao: "" }])} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">+ adicionar item</button>
          {erro && <p className="text-xs text-rose-600">⚠ {erro}</p>}
          <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-800">
            <button type="button" onClick={() => { setFase("upload"); setItens([]); setNome(""); setErro(""); }} className="text-xs text-gray-500 hover:text-gray-800">← outro arquivo</button>
            <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void criar()} disabled={salvando}>{salvando ? "Criando…" : "Criar template"}</Button></div>
          </div>
          <p className="text-[11px] text-gray-400">Itens com periodicidade reconhecida já vêm com <b>frequência própria</b> (o dia da semana exato você ajusta no editor). Turno e responsáveis também se definem depois.</p>
        </div>
      )}
    </Modal>
  );
}
