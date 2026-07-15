// Execução de checklist — COLABORATIVO AO VIVO. Vários usuários preenchem o
// mesmo run simultaneamente: cada mudança grava só o item (campo resultado.{id}),
// todos veem via onSnapshot, e cada ação fica assinada (feitoPor) + no log.
import { useEffect, useMemo, useRef, useState } from "react";
import { arrayUnion, collection, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd, fmtBR } from "../../core/utils/date";
import type {
  ChecklistRun, ChecklistRunItemResultado, ChecklistRunLog, ChecklistRunStatus,
  ChecklistTemplate, Empregado,
} from "../../core/types";
import { FotoUpload } from "./FotoUpload";
import { itemDoDia, temFreqPorItem } from "./recorrencia";

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const hhmm = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
type ResMap = Record<string, ChecklistRunItemResultado>;

type Props = {
  template: ChecklistTemplate;
  run: ChecklistRun | null;
  empregados: Empregado[];
  restaurantId: string;
  podeConfig: boolean;
  onClose: () => void;
};

export function ChecklistRunModal({ template, run, empregados, restaurantId, podeConfig, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isReadonly = !podeConfig;

  function mapaInicial(): ResMap {
    if (run?.resultado) return { ...run.resultado };
    const m: ResMap = {};
    const baseItens = temFreqPorItem(template.itens) ? template.itens.filter(i => itemDoDia(i, run?.data || todayYmd())) : template.itens;
    const arr = run?.itens || baseItens.map(i => ({ itemId: i.id, textoSnapshot: i.texto, feito: false }));
    for (const r of arr) m[r.itemId] = r;
    return m;
  }

  const [etapa, setEtapa] = useState<"inicio" | "itens">(run ? "itens" : "inicio");
  const [executor, setExecutor] = useState<string>(run?.executorEmpregadoId || "");
  const [executorNome, setExecutorNome] = useState(run?.executorNome || me?.nome || "");
  const [data, setData] = useState(run?.data || todayYmd());
  const [resMap, setResMap] = useState<ResMap>(mapaInicial);
  const [obsGeral, setObsGeral] = useState(run?.observacaoGeral || "");
  const [obsAbertas, setObsAbertas] = useState<Set<string>>(new Set());
  const [obsGeralAberta, setObsGeralAberta] = useState(false);
  const [logList, setLogList] = useState<ChecklistRunLog[]>(run?.log || []);
  const [logAberto, setLogAberto] = useState(false);
  const [confirmarRmObs, setConfirmarRmObs] = useState<string | "__geral__" | null>(null);
  const [saving, setSaving] = useState(false);
  const [salvoEm, setSalvoEm] = useState<"" | "salvando" | "salvo">(run ? "salvo" : "");
  const [err, setErr] = useState("");
  const [runId, setRunId] = useState<string | null>(run?.id ?? null);
  const iniRef = useRef<string>(run?.iniciadoEm || new Date().toISOString());
  const finalizadoRef = useRef<string | null>(run?.finalizadoEm ?? null);
  const editandoRef = useRef<string | null>(null);   // item (ou "__geral__") em edição — não sobrescrever com o remoto

  useEffect(() => { if (executor) { const emp = empregados.find(e => e.id === executor); if (emp) setExecutorNome(emp.nome); } }, [executor, empregados]);

  // ── Ao vivo: escuta o run e atualiza o que os outros marcaram ──
  useEffect(() => {
    if (!runId) return;
    const unsub = onSnapshot(doc(db, "checklistRuns", runId), snap => {
      const d = snap.data() as ChecklistRun | undefined;
      if (!d) return;
      if (d.resultado) setResMap(prev => {
        const next: ResMap = { ...prev, ...d.resultado };
        if (editandoRef.current && editandoRef.current !== "__geral__" && prev[editandoRef.current]) next[editandoRef.current] = prev[editandoRef.current];
        return next;
      });
      if (Array.isArray(d.log)) setLogList(d.log);
      if (editandoRef.current !== "__geral__" && d.observacaoGeral !== undefined) setObsGeral(d.observacaoGeral || "");
      if (d.finalizadoEm) finalizadoRef.current = d.finalizadoEm;
    });
    return () => unsub();
  }, [runId]);

  // Itens que valem PRA ESTE DIA (freq por item). Sem freq → todos (retrocompat).
  const itensDia = useMemo(
    () => temFreqPorItem(template.itens) ? template.itens.filter(i => itemDoDia(i, data)) : template.itens,
    [template.itens, data],
  );

  function resArray(map: ResMap = resMap): ChecklistRunItemResultado[] {
    return itensDia.map(i => map[i.id] ?? { itemId: i.id, textoSnapshot: i.texto, feito: false });
  }
  function statsFrom(map: ResMap) {
    const total = itensDia.length;
    const feitos = itensDia.filter(i => map[i.id]?.feito).length;
    const obrig = itensDia.filter(i => i.obrigatorio);
    return { total, feitos, obrigatoriosTotal: obrig.length, obrigatoriosFeitos: obrig.filter(i => map[i.id]?.feito).length };
  }

  // Grava um item (campo resultado.{id}) + counts + log. Concorrência-safe (field-path).
  async function gravarItem(itemId: string, novo: ChecklistRunItemResultado, log?: ChecklistRunLog) {
    const nextMap = { ...resMap, [itemId]: novo };
    setResMap(nextMap);
    if (!runId) return;
    setSalvoEm("salvando");
    const st = statsFrom(nextMap);
    const upd: Record<string, unknown> = {
      [`resultado.${itemId}`]: sanitizeForFirestore(novo),
      feitos: st.feitos, totalItens: st.total, obrigatoriosFeitos: st.obrigatoriosFeitos, obrigatoriosTotal: st.obrigatoriosTotal,
      atualizadoEm: new Date().toISOString(),
    };
    if (log) upd.log = arrayUnion(sanitizeForFirestore(log));
    try { await updateDoc(doc(db, "checklistRuns", runId), upd); setSalvoEm("salvo"); }
    catch { setSalvoEm(""); }
  }
  const mkLog = (tipo: ChecklistRunLog["tipo"], itemId: string | null, texto: string): ChecklistRunLog =>
    ({ id: uid(), em: new Date().toISOString(), autorId: me?.id, autorNome: me?.nome, itemId, tipo, texto });

  function toggleFeito(itemId: string, texto: string, checked: boolean) {
    const prev = resMap[itemId] || { itemId, textoSnapshot: texto, feito: false };
    const now = new Date().toISOString();
    const novo: ChecklistRunItemResultado = { ...prev, feito: checked, marcadoEm: checked ? now : undefined, feitoPorId: checked ? (me?.id || null) : null, feitoPorNome: checked ? (me?.nome || null) : null };
    void gravarItem(itemId, novo, mkLog(checked ? "marcou" : "desmarcou", itemId, texto));
  }
  function setFotoItem(itemId: string, texto: string, url: string | undefined) {
    const prev = resMap[itemId] || { itemId, textoSnapshot: texto, feito: false };
    void gravarItem(itemId, { ...prev, fotoUrl: url }, url ? mkLog("foto", itemId, texto) : undefined);
  }
  // Obs: edita local no digitar, grava no blur (evita 1 log por tecla).
  function editarObsLocal(itemId: string, texto: string, valor: string) {
    setResMap(m => ({ ...m, [itemId]: { ...(m[itemId] || { itemId, textoSnapshot: texto, feito: false }), observacao: valor } }));
  }
  function gravarObs(itemId: string, texto: string) {
    editandoRef.current = null;
    const cur = resMap[itemId]; if (!cur) return;
    void gravarItem(itemId, cur, (cur.observacao || "").trim() ? mkLog("obs", itemId, texto) : undefined);
  }
  function removerObs(itemId: string) {
    const texto = template.itens.find(i => i.id === itemId)?.texto || "";
    const prev = resMap[itemId] || { itemId, textoSnapshot: texto, feito: false };
    void gravarItem(itemId, { ...prev, observacao: undefined }, mkLog("removeu_obs", itemId, texto));
    setObsAbertas(s => { const n = new Set(s); n.delete(itemId); return n; });
  }

  // Payload completo (criação e finalização).
  function payload(status: ChecklistRunStatus, finalizar: boolean): Omit<ChecklistRun, "id"> {
    const st = statsFrom(resMap);
    return {
      restaurantId, templateId: template.id, templateNomeSnapshot: template.nome, templateAreaSnapshot: template.area,
      data, executorEmpregadoId: executor || null, executorNome: executorNome.trim() || me?.nome || "",
      itens: resArray(), resultado: resMap, log: logList,
      totalItens: st.total, feitos: st.feitos, obrigatoriosFeitos: st.obrigatoriosFeitos, obrigatoriosTotal: st.obrigatoriosTotal,
      status, iniciadoEm: iniRef.current, finalizadoEm: finalizar ? new Date().toISOString() : finalizadoRef.current,
      atualizadoEm: new Date().toISOString(), observacaoGeral: obsGeral.trim() || undefined,
    };
  }

  async function comecar() {
    if (!executorNome.trim() && !me?.nome) { setErr("Informe quem está executando."); return; }
    setErr(""); setSaving(true);
    try {
      if (!runId) {
        const ref = doc(collection(db, "checklistRuns"));
        const p = payload("rascunho", false);
        p.log = [mkLog("iniciou", null, `iniciou o checklist`)];
        await setDoc(ref, sanitizeForFirestore(p));
        setRunId(ref.id);
      }
      setSalvoEm("salvo"); setEtapa("itens");
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  async function salvar(finalizar: boolean) {
    setErr("");
    const st = statsFrom(resMap);
    if (finalizar) {
      if (st.obrigatoriosFeitos < st.obrigatoriosTotal && !confirm(`Faltam ${st.obrigatoriosTotal - st.obrigatoriosFeitos} item(ns) obrigatório(s). Finalizar mesmo assim como INCOMPLETO?`)) return;
      for (const item of itensDia) {
        const r = resMap[item.id];
        if (item.exigeObs && r?.feito && !r.observacao?.trim()) { setErr(`Item "${item.texto}" exige observação quando marcado.`); return; }
        if (item.exigeFoto && r?.feito && !r.fotoUrl) { setErr(`Item "${item.texto}" exige foto quando marcado.`); return; }
      }
    }
    setSaving(true);
    try {
      const status: ChecklistRunStatus = finalizar ? (st.obrigatoriosFeitos === st.obrigatoriosTotal ? "completo" : "incompleto") : "rascunho";
      if (runId) {
        const upd: Record<string, unknown> = { ...payload(status, finalizar) };
        delete (upd as { resultado?: unknown }).resultado; // resultado é escrito item-a-item; não sobrescreve concorrente
        delete (upd as { log?: unknown }).log;
        if (finalizar) upd.log = arrayUnion(sanitizeForFirestore(mkLog("finalizou", null, `finalizou como ${status}`)));
        await updateDoc(doc(db, "checklistRuns", runId), sanitizeForFirestore(upd) as Record<string, unknown>);
      } else {
        const ref = doc(collection(db, "checklistRuns"));
        await setDoc(ref, sanitizeForFirestore(payload(status, finalizar)));
        setRunId(ref.id);
      }
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro"); setSaving(false); }
  }

  const st = statsFrom(resMap);
  const pct = Math.round((st.feitos / Math.max(1, st.total)) * 100);
  const empregadosOrdenados = [...empregados].filter(e => e.estaAtivo).sort((a, b) => a.nome.localeCompare(b.nome));
  // text-base (16px) evita o zoom automático do iOS/Safari ao focar o campo.
  const inputTa = "w-full px-3 py-2 text-base rounded-lg border resize-none";

  return (
    <Modal title={`▶ ${template.nome}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {etapa === "inicio" && !isReadonly ? (
          <div className="space-y-4 py-1">
            <p className="text-sm text-gray-600 dark:text-gray-300">Confirme a data e quem vai executar. Depois abre a lista — e <b>vários podem preencher juntos ao vivo</b>; cada item marcado fica assinado.</p>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Data</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-full h-12 px-3 text-base rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Quem está iniciando</label>
              <select value={executor} onChange={(e) => setExecutor(e.target.value)} className="w-full h-12 px-3 text-base rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                <option value="">— eu mesmo: {me?.nome || ""} —</option>
                {empregadosOrdenados.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-400">{itensDia.length} {itensDia.length === 1 ? "item" : "itens"} pra marcar{temFreqPorItem(template.itens) ? " hoje" : ""}</p>
            {err && <div className="text-sm text-rose-600">{err}</div>}
            <Button onClick={() => void comecar()} disabled={saving} className="w-full">{saving ? "Abrindo…" : "Começar checklist →"}</Button>
          </div>
        ) : (<>
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-gray-500 truncate">📋 {fmtBR(data)} · iniciado por {executorNome || me?.nome}</span>
              {!isReadonly && salvoEm && <span className={`shrink-0 ${salvoEm === "salvando" ? "text-gray-400" : "text-emerald-600 dark:text-emerald-400"}`}>{salvoEm === "salvando" ? "salvando…" : "✓ salvo"}</span>}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{st.feitos}/{st.total} feitos</span>
                <span className="text-xs text-gray-500">{pct}%{st.obrigatoriosTotal > 0 ? ` · obrig. ${st.obrigatoriosFeitos}/${st.obrigatoriosTotal}` : ""}</span>
              </div>
              <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                <div className={`h-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {itensDia.map((item, idx) => {
              const r = resMap[item.id] || { itemId: item.id, textoSnapshot: item.texto, feito: false };
              const obsVisivel = item.exigeObs || r.observacao != null || obsAbertas.has(item.id);
              return (
                <div key={item.id} className={`rounded-2xl border ${r.feito ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-300 dark:border-emerald-800" : item.obrigatorio ? "bg-white dark:bg-gray-900 border-amber-200 dark:border-amber-800" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"}`}>
                  <label className="flex items-start gap-3 cursor-pointer p-3.5">
                    <input type="checkbox" checked={r.feito} onChange={(e) => toggleFeito(item.id, item.texto, e.target.checked)} disabled={isReadonly} className="mt-0.5 w-7 h-7 rounded-md accent-emerald-600 cursor-pointer shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`text-[15px] leading-snug ${r.feito ? "line-through text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>
                        <span className="text-gray-400 mr-1">{idx + 1}.</span>{item.texto}{item.obrigatorio && <span className="text-rose-500 ml-1">*</span>}
                      </div>
                      {r.feito && r.feitoPorNome && <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">✓ por {r.feitoPorNome}{r.marcadoEm ? ` · ${hhmm(r.marcadoEm)}` : ""}</div>}
                      {item.descricao && <div className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 whitespace-pre-wrap">💡 {item.descricao}</div>}
                      {item.fotoGuiaUrl && <a href={item.fotoGuiaUrl} target="_blank" rel="noreferrer" className="inline-block mt-1.5"><img src={item.fotoGuiaUrl} alt="guia" className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700" title="Foto-guia" /></a>}
                    </div>
                  </label>
                  {(item.exigeFoto || r.fotoUrl) && (
                    <div className="px-3.5 pb-3 pl-14 flex items-center gap-2 flex-wrap">
                      {isReadonly ? (r.fotoUrl ? <a href={r.fotoUrl} target="_blank" rel="noreferrer"><img src={r.fotoUrl} alt="prova" className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700" /></a> : <span className="text-xs text-gray-400">sem foto</span>)
                        : <><span className={`text-xs ${item.exigeFoto && r.feito && !r.fotoUrl ? "text-rose-600 font-medium" : "text-gray-500"}`}>Foto-prova{item.exigeFoto ? " (obrigatória)" : ""}:</span>
                          <FotoUpload rid={restaurantId} pathPrefix={`prova_${template.id}_${item.id}`} url={r.fotoUrl} onChange={(u) => setFotoItem(item.id, item.texto, u || undefined)} label="foto" /></>}
                    </div>
                  )}
                  {obsVisivel && !isReadonly && (
                    <div className="px-3.5 pb-3 pl-14 space-y-1">
                      <textarea value={r.observacao || ""} onFocus={() => { editandoRef.current = item.id; }} onBlur={() => gravarObs(item.id, item.texto)}
                        onChange={(e) => editarObsLocal(item.id, item.texto, e.target.value)}
                        placeholder={item.exigeObs ? "Observação obrigatória…" : "Observação sobre o item…"} rows={2}
                        autoFocus={obsAbertas.has(item.id) && !r.observacao}
                        className={`${inputTa} ${item.exigeObs && r.feito && !r.observacao ? "border-rose-300 bg-rose-50 dark:bg-rose-900/10" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`} />
                      {!item.exigeObs && <button type="button" onClick={() => setConfirmarRmObs(item.id)} className="text-[11px] text-gray-400 hover:text-rose-600">✕ excluir observação</button>}
                    </div>
                  )}
                  {!isReadonly && !obsVisivel && (
                    <div className="px-3.5 pb-2.5 pl-14"><button type="button" onClick={() => setObsAbertas(s => new Set(s).add(item.id))} className="text-[11px] text-gray-400 hover:text-indigo-600">💬 observação</button></div>
                  )}
                  {isReadonly && r.observacao && <div className="px-3.5 pb-3 pl-14 text-sm text-gray-600 dark:text-gray-400 italic">💬 {r.observacao}</div>}
                </div>
              );
            })}
          </div>

          {/* Observação geral */}
          {!isReadonly ? (
            (obsGeral || obsGeralAberta) ? (
              <div className="pt-1">
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação geral</label>
                <textarea value={obsGeral} onFocus={() => { editandoRef.current = "__geral__"; }} onBlur={() => { editandoRef.current = null; if (runId) void updateDoc(doc(db, "checklistRuns", runId), { observacaoGeral: obsGeral.trim() || null, atualizadoEm: new Date().toISOString() }); }}
                  onChange={(e) => setObsGeral(e.target.value)} rows={2} autoFocus={obsGeralAberta && !obsGeral} placeholder="Notas do checklist inteiro…" className={`${inputTa} mt-1 border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900`} />
                <button type="button" onClick={() => setConfirmarRmObs("__geral__")} className="text-[11px] text-gray-400 hover:text-rose-600 mt-0.5">✕ excluir observação geral</button>
              </div>
            ) : <button type="button" onClick={() => setObsGeralAberta(true)} className="text-xs text-gray-400 hover:text-indigo-600">＋ observação geral</button>
          ) : (obsGeral && <div className="pt-1"><span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação geral:</span> <span className="text-sm text-gray-600 dark:text-gray-400 italic">{obsGeral}</span></div>)}

          {/* Log de atividade */}
          {logList.length > 0 && (
            <div className="pt-1">
              <button type="button" onClick={() => setLogAberto(v => !v)} className="text-xs text-gray-500 hover:text-indigo-600">📜 Atividade ({logList.length}) {logAberto ? "▲" : "▾"}</button>
              {logAberto && (
                <div className="mt-1 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30 p-2 max-h-40 overflow-y-auto space-y-0.5">
                  {[...logList].reverse().map(l => (
                    <div key={l.id} className="text-[11px] text-gray-600 dark:text-gray-300 flex gap-2">
                      <span className="text-gray-400 tabular-nums shrink-0">{hhmm(l.em)}</span>
                      <span className="flex-1"><b>{l.autorNome || "?"}</b> {l.tipo === "marcou" ? "marcou" : l.tipo === "desmarcou" ? "desmarcou" : l.tipo === "obs" ? "observou" : l.tipo === "removeu_obs" ? "removeu obs de" : l.tipo === "foto" ? "anexou foto em" : l.tipo === "finalizou" ? "finalizou" : "iniciou"}{l.texto && l.tipo !== "iniciou" && l.tipo !== "finalizou" ? `: ${l.texto}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {err && <div className="text-sm text-rose-600">{err}</div>}

          {!isReadonly && (
            <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-800 sticky bottom-0 bg-white dark:bg-gray-900">
              <Button variant="secondary" onClick={onClose} className="flex-1">Fechar</Button>
              <Button onClick={() => void salvar(true)} disabled={saving} className="flex-1">{saving ? "…" : "✓ Finalizar"}</Button>
            </div>
          )}
          {isReadonly && <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>}
        </>)}
      </div>

      {confirmarRmObs && (
        <div className="fixed inset-0 bg-black/50 z-[300] flex items-center justify-center p-4" onClick={() => setConfirmarRmObs(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 dark:text-gray-100">Excluir observação?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">A observação será apagada. Fica registrado no log quem removeu.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmarRmObs(null)}>Cancelar</Button>
              <Button onClick={() => {
                if (confirmarRmObs === "__geral__") { setObsGeral(""); if (runId) void updateDoc(doc(db, "checklistRuns", runId), { observacaoGeral: null, log: arrayUnion(sanitizeForFirestore(mkLog("removeu_obs", null, "observação geral"))), atualizadoEm: new Date().toISOString() }); setObsGeralAberta(false); }
                else removerObs(confirmarRmObs);
                setConfirmarRmObs(null);
              }}>Excluir</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
