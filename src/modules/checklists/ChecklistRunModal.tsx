import { useEffect, useRef, useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd, fmtBR } from "../../core/utils/date";
import type {
  ChecklistRun, ChecklistRunItemResultado, ChecklistRunStatus,
  ChecklistTemplate, Empregado,
} from "../../core/types";
import { FotoUpload } from "./FotoUpload";

type Props = {
  template: ChecklistTemplate;
  run: ChecklistRun | null;       // se null, é um novo run pra hoje
  empregados: Empregado[];
  restaurantId: string;
  podeConfig: boolean;
  onClose: () => void;
};

export function ChecklistRunModal({ template, run, empregados, restaurantId, podeConfig, onClose }: Props) {
  const { pessoa: me } = useAuth();

  // 2 passos: "inicio" (confirmar data/executor) → "itens". Run existente já entra nos itens.
  const [etapa, setEtapa] = useState<"inicio" | "itens">(run ? "itens" : "inicio");
  const [executor, setExecutor] = useState<string>(run?.executorEmpregadoId || "");
  const [executorNome, setExecutorNome] = useState(run?.executorNome || me?.nome || "");
  const [data, setData] = useState(run?.data || todayYmd());
  const [resultados, setResultados] = useState<ChecklistRunItemResultado[]>(
    run?.itens || template.itens.map(i => ({ itemId: i.id, textoSnapshot: i.texto, feito: false, observacao: undefined })),
  );
  const [obsGeral, setObsGeral] = useState(run?.observacaoGeral || "");
  const [obsAbertas, setObsAbertas] = useState<Set<string>>(new Set());  // itens com campo de obs aberto sob demanda
  const [obsGeralAberta, setObsGeralAberta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [salvoEm, setSalvoEm] = useState<"" | "salvando" | "salvo">(run ? "salvo" : "");
  const [err, setErr] = useState("");
  const isReadonly = !podeConfig;
  const runIdRef = useRef<string | null>(run?.id ?? null);      // id do doc — cria no "Começar", autosave depois
  const iniRef = useRef<string>(run?.iniciadoEm || new Date().toISOString());
  const finalizadoRef = useRef<string | null>(run?.finalizadoEm ?? null);
  const skipRef = useRef(true);

  // Sincroniza nome do executor quando muda empregado
  useEffect(() => {
    if (executor) {
      const emp = empregados.find(e => e.id === executor);
      if (emp) setExecutorNome(emp.nome);
    }
  }, [executor, empregados]);

  function patchItem(itemId: string, patch: Partial<ChecklistRunItemResultado>) {
    setResultados(s => s.map(r => r.itemId === itemId ? {
      ...r,
      ...patch,
      ...(patch.feito !== undefined ? { marcadoEm: patch.feito ? new Date().toISOString() : undefined } : {}),
    } : r));
  }

  function calcStats() {
    const total = resultados.length;
    const feitos = resultados.filter(r => r.feito).length;
    const obrigatorios = template.itens.filter(i => i.obrigatorio);
    const obrigatoriosTotal = obrigatorios.length;
    const obrigatoriosFeitos = obrigatorios.filter(i => resultados.find(r => r.itemId === i.id)?.feito).length;
    return { total, feitos, obrigatoriosTotal, obrigatoriosFeitos };
  }

  function buildPayload(status: ChecklistRunStatus, finalizar: boolean): Omit<ChecklistRun, "id"> {
    const stats = calcStats();
    return {
      restaurantId, templateId: template.id, templateNomeSnapshot: template.nome, templateAreaSnapshot: template.area,
      data, executorEmpregadoId: executor || null, executorNome: executorNome.trim() || me?.nome || "",
      itens: resultados, totalItens: stats.total, feitos: stats.feitos, obrigatoriosFeitos: stats.obrigatoriosFeitos, obrigatoriosTotal: stats.obrigatoriosTotal,
      status, iniciadoEm: iniRef.current, finalizadoEm: finalizar ? new Date().toISOString() : finalizadoRef.current,
      observacaoGeral: obsGeral.trim() || undefined,
    };
  }

  // Autosave: toda mudança grava um rascunho (não perde o que a pessoa marcou).
  useEffect(() => {
    if (isReadonly || etapa !== "itens" || !runIdRef.current) return;
    if (skipRef.current) { skipRef.current = false; return; }
    setSalvoEm("salvando");
    const t = setTimeout(async () => {
      try { await updateDoc(doc(db, "checklistRuns", runIdRef.current as string), sanitizeForFirestore(buildPayload("rascunho", false))); setSalvoEm("salvo"); }
      catch { setSalvoEm(""); }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultados, obsGeral, executor, data, etapa]);

  // Passo 1 → 2: cria o rascunho na hora (pra o autosave ter onde gravar).
  async function comecar() {
    if (!executorNome.trim() && !me?.nome) { setErr("Informe quem está executando."); return; }
    setErr(""); setSaving(true);
    try {
      if (!runIdRef.current) {
        const refDoc = await addDoc(collection(db, "checklistRuns"), sanitizeForFirestore(buildPayload("rascunho", false)));
        runIdRef.current = refDoc.id;
      }
      setSalvoEm("salvo"); skipRef.current = true; setEtapa("itens");
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  async function salvar(finalizar: boolean) {
    setErr("");
    const stats = calcStats();
    if (finalizar) {
      if (stats.obrigatoriosFeitos < stats.obrigatoriosTotal) {
        const ok = confirm(`Faltam ${stats.obrigatoriosTotal - stats.obrigatoriosFeitos} item(ns) obrigatório(s). Finalizar mesmo assim como INCOMPLETO?`);
        if (!ok) return;
      }
      for (const item of template.itens) {
        const r = resultados.find(rr => rr.itemId === item.id);
        if (item.exigeObs && r?.feito && !r.observacao?.trim()) { setErr(`Item "${item.texto}" exige observação quando marcado.`); return; }
        if (item.exigeFoto && r?.feito && !r.fotoUrl) { setErr(`Item "${item.texto}" exige foto quando marcado.`); return; }
      }
    }
    setSaving(true);
    try {
      const status: ChecklistRunStatus = finalizar ? (stats.obrigatoriosFeitos === stats.obrigatoriosTotal ? "completo" : "incompleto") : "rascunho";
      const payload = buildPayload(status, finalizar);
      if (runIdRef.current) await updateDoc(doc(db, "checklistRuns", runIdRef.current), sanitizeForFirestore(payload));
      else { const refDoc = await addDoc(collection(db, "checklistRuns"), sanitizeForFirestore(payload)); runIdRef.current = refDoc.id; }
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro"); setSaving(false); }
  }

  const stats = calcStats();
  const pct = Math.round((stats.feitos / Math.max(1, stats.total)) * 100);

  // Opções de executor: empregados ativos + pessoa logada
  const empregadosOrdenados = [...empregados]
    .filter(e => e.estaAtivo)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <Modal title={`▶ ${template.nome}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {etapa === "inicio" && !isReadonly ? (
          /* PASSO 1 — confirmar data + executor */
          <div className="space-y-4 py-1">
            <p className="text-sm text-gray-600 dark:text-gray-300">Confirme a data e quem vai executar. Depois abre a lista — e cada item que você marcar é <b>salvo na hora</b>.</p>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Data</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-full h-12 px-3 text-base rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Quem está executando</label>
              <select value={executor} onChange={(e) => setExecutor(e.target.value)} className="w-full h-12 px-3 text-base rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                <option value="">— eu mesmo: {me?.nome || ""} —</option>
                {empregadosOrdenados.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-400">{template.itens.length} {template.itens.length === 1 ? "item" : "itens"} pra marcar</p>
            {err && <div className="text-sm text-rose-600">{err}</div>}
            <Button onClick={() => void comecar()} disabled={saving} className="w-full">{saving ? "Abrindo…" : "Começar checklist →"}</Button>
          </div>
        ) : (<>
          {/* PASSO 2 — cabeçalho slim + progresso + itens */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              {isReadonly
                ? <span className="text-gray-500 truncate">{executorNome || me?.nome} · {fmtBR(data)}</span>
                : <button type="button" onClick={() => setEtapa("inicio")} className="text-indigo-600 dark:text-indigo-400 hover:underline truncate">✏️ {executorNome || me?.nome} · {fmtBR(data)}</button>}
              {!isReadonly && salvoEm && <span className={`shrink-0 ${salvoEm === "salvando" ? "text-gray-400" : "text-emerald-600 dark:text-emerald-400"}`}>{salvoEm === "salvando" ? "salvando…" : "✓ salvo"}</span>}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{stats.feitos}/{stats.total} feitos</span>
                <span className="text-xs text-gray-500">{pct}%{stats.obrigatoriosTotal > 0 ? ` · obrig. ${stats.obrigatoriosFeitos}/${stats.obrigatoriosTotal}` : ""}</span>
              </div>
              <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                <div className={`h-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

        {/* Itens — mobile-first: toque grande, texto legível (scroll único: o do modal) */}
        <div className="space-y-2">
          {template.itens.map((item, idx) => {
            const r = resultados.find(rr => rr.itemId === item.id) || { itemId: item.id, textoSnapshot: item.texto, feito: false };
            return (
              <div
                key={item.id}
                className={`rounded-2xl border ${
                  r.feito
                    ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-300 dark:border-emerald-800"
                    : item.obrigatorio
                      ? "bg-white dark:bg-gray-900 border-amber-200 dark:border-amber-800"
                      : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                }`}
              >
                <label className="flex items-start gap-3 cursor-pointer p-3.5">
                  <input
                    type="checkbox"
                    checked={r.feito}
                    onChange={(e) => patchItem(item.id, { feito: e.target.checked })}
                    disabled={isReadonly}
                    className="mt-0.5 w-7 h-7 rounded-md accent-emerald-600 cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[15px] leading-snug ${r.feito ? "line-through text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>
                      <span className="text-gray-400 mr-1">{idx + 1}.</span>
                      {item.texto}
                      {item.obrigatorio && <span className="text-rose-500 ml-1">*</span>}
                    </div>
                    {item.descricao && <div className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-wrap">💡 {item.descricao}</div>}
                    {item.fotoGuiaUrl && <a href={item.fotoGuiaUrl} target="_blank" rel="noreferrer" className="inline-block mt-1.5"><img src={item.fotoGuiaUrl} alt="guia" className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700" title="Foto-guia: como deve ficar" /></a>}
                  </div>
                </label>
                {/* Foto-prova */}
                {(item.exigeFoto || r.fotoUrl) && (
                  <div className="px-3.5 pb-3 pl-14 flex items-center gap-2 flex-wrap">
                    {isReadonly
                      ? (r.fotoUrl ? <a href={r.fotoUrl} target="_blank" rel="noreferrer"><img src={r.fotoUrl} alt="prova" className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700" /></a> : <span className="text-xs text-gray-400">sem foto</span>)
                      : <><span className={`text-xs ${item.exigeFoto && r.feito && !r.fotoUrl ? "text-rose-600 font-medium" : "text-gray-500"}`}>Foto-prova{item.exigeFoto ? " (obrigatória)" : ""}:</span>
                        <FotoUpload rid={restaurantId} pathPrefix={`prova_${template.id}_${item.id}`} url={r.fotoUrl} onChange={(u) => patchItem(item.id, { fotoUrl: u || undefined })} label="foto" /></>}
                  </div>
                )}
                {(item.exigeObs || r.observacao || obsAbertas.has(item.id)) && !isReadonly && (
                  <div className="px-3.5 pb-3 pl-14">
                    <textarea
                      value={r.observacao || ""}
                      onChange={(e) => patchItem(item.id, { observacao: e.target.value })}
                      placeholder={item.exigeObs ? "Observação obrigatória…" : "Observação sobre o item…"}
                      rows={2}
                      autoFocus={obsAbertas.has(item.id) && !r.observacao}
                      className={`w-full px-3 py-2 text-sm rounded-lg border resize-none ${
                        item.exigeObs && r.feito && !r.observacao
                          ? "border-rose-300 bg-rose-50 dark:bg-rose-900/10"
                          : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
                      }`}
                    />
                  </div>
                )}
                {!isReadonly && !item.exigeObs && !r.observacao && !obsAbertas.has(item.id) && (
                  <div className="px-3.5 pb-2.5 pl-14">
                    <button type="button" onClick={() => setObsAbertas(s => new Set(s).add(item.id))} className="text-[11px] text-gray-400 hover:text-indigo-600">💬 observação</button>
                  </div>
                )}
                {isReadonly && r.observacao && (
                  <div className="px-3.5 pb-3 pl-14 text-sm text-gray-600 dark:text-gray-400 italic">💬 {r.observacao}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Observação geral — só quando precisa (sem barra de rolagem própria) */}
        {!isReadonly ? (
          (obsGeral || obsGeralAberta) ? (
            <div className="pt-1">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação geral</label>
              <textarea value={obsGeral} onChange={(e) => setObsGeral(e.target.value)} rows={2} autoFocus={obsGeralAberta && !obsGeral} placeholder="Notas do checklist inteiro…" className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 resize-none" />
            </div>
          ) : (
            <button type="button" onClick={() => setObsGeralAberta(true)} className="text-xs text-gray-400 hover:text-indigo-600">＋ observação geral</button>
          )
        ) : (obsGeral && (
          <div className="pt-1"><span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação geral:</span> <span className="text-sm text-gray-600 dark:text-gray-400 italic">{obsGeral}</span></div>
        ))}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        {!isReadonly && (
          <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-800 sticky bottom-0 bg-white dark:bg-gray-900">
            <Button variant="secondary" onClick={() => void salvar(false)} disabled={saving} className="flex-1">Fechar</Button>
            <Button onClick={() => void salvar(true)} disabled={saving} className="flex-1">{saving ? "…" : "✓ Finalizar"}</Button>
          </div>
        )}
        {isReadonly && (
          <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
          </div>
        )}
        </>)}
      </div>
    </Modal>
  );
}
