import { useEffect, useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd } from "../../core/utils/date";
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
  const isNew = !run;

  // Inicializa execução: se run existe, usa-o. Se novo, gera a partir do template.
  const [executor, setExecutor] = useState<string>(
    run?.executorEmpregadoId || ""
  );
  const [executorNome, setExecutorNome] = useState(
    run?.executorNome || me?.nome || ""
  );
  const [data, setData] = useState(run?.data || todayYmd());
  const [resultados, setResultados] = useState<ChecklistRunItemResultado[]>(
    run?.itens
      || template.itens.map(i => ({
        itemId: i.id,
        textoSnapshot: i.texto,
        feito: false,
        observacao: undefined,
      }))
  );
  const [obsGeral, setObsGeral] = useState(run?.observacaoGeral || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

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

  async function salvar(finalizar: boolean) {
    if (!executorNome.trim()) { setErr("Quem está executando? Informe o nome ou selecione um empregado."); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const stats = calcStats();
      const isCompleto = finalizar && stats.obrigatoriosFeitos === stats.obrigatoriosTotal;
      const status: ChecklistRunStatus = finalizar
        ? (isCompleto ? "completo" : "incompleto")
        : "rascunho";

      // Validação: se finalizar e tem item obrigatório não feito, alerta
      if (finalizar && stats.obrigatoriosFeitos < stats.obrigatoriosTotal) {
        const ok = confirm(`Faltam ${stats.obrigatoriosTotal - stats.obrigatoriosFeitos} item(ns) obrigatório(s). Finalizar mesmo assim como INCOMPLETO?`);
        if (!ok) { setSaving(false); return; }
      }

      // Validação: items que exigem obs/foto precisam ter (só pros marcados)
      for (const item of template.itens) {
        const r = resultados.find(rr => rr.itemId === item.id);
        if (item.exigeObs && r?.feito && !r.observacao?.trim()) {
          setErr(`Item "${item.texto}" exige observação quando marcado.`);
          setSaving(false); return;
        }
        if (item.exigeFoto && r?.feito && !r.fotoUrl) {
          setErr(`Item "${item.texto}" exige foto quando marcado.`);
          setSaving(false); return;
        }
      }

      const now = new Date().toISOString();
      const payload: Omit<ChecklistRun, "id"> = {
        restaurantId,
        templateId: template.id,
        templateNomeSnapshot: template.nome,
        templateAreaSnapshot: template.area,
        data,
        executorEmpregadoId: executor || null,
        executorNome: executorNome.trim(),
        itens: resultados,
        totalItens: stats.total,
        feitos: stats.feitos,
        obrigatoriosFeitos: stats.obrigatoriosFeitos,
        obrigatoriosTotal: stats.obrigatoriosTotal,
        status,
        iniciadoEm: run?.iniciadoEm || now,
        finalizadoEm: finalizar ? now : (run?.finalizadoEm ?? null),
        observacaoGeral: obsGeral.trim() || undefined,
      };

      if (isNew) {
        await addDoc(collection(db, "checklistRuns"), sanitizeForFirestore(payload));
      } else {
        await updateDoc(doc(db, "checklistRuns", run.id), sanitizeForFirestore(payload));
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  const stats = calcStats();
  const pct = Math.round((stats.feitos / Math.max(1, stats.total)) * 100);

  // Opções de executor: empregados ativos + pessoa logada
  const empregadosOrdenados = [...empregados]
    .filter(e => e.estaAtivo)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const isReadonly = !podeConfig;

  return (
    <Modal title={`▶ ${template.nome}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        {/* Header info */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Data</label>
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                disabled={isReadonly}
                className="w-full mt-0.5 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Executor</label>
              <select
                value={executor}
                onChange={(e) => setExecutor(e.target.value)}
                disabled={isReadonly}
                className="w-full mt-0.5 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-60"
              >
                <option value="">— eu mesmo: {me?.nome || ""} —</option>
                {empregadosOrdenados.map(e => (
                  <option key={e.id} value={e.id}>{e.nome}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Stats progresso */}
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-indigo-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
              {stats.feitos}/{stats.total} ({pct}%)
            </span>
          </div>
          {stats.obrigatoriosTotal > 0 && (
            <div className="text-[11px] text-gray-500 mt-1">
              Obrigatórios: {stats.obrigatoriosFeitos}/{stats.obrigatoriosTotal}
            </div>
          )}
        </div>

        {/* Itens */}
        <div className="space-y-1 max-h-[50vh] overflow-y-auto">
          {template.itens.map((item, idx) => {
            const r = resultados.find(rr => rr.itemId === item.id) || { itemId: item.id, textoSnapshot: item.texto, feito: false };
            return (
              <div
                key={item.id}
                className={`p-2 rounded border ${
                  r.feito
                    ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
                    : item.obrigatorio
                      ? "bg-white dark:bg-gray-900 border-amber-200 dark:border-amber-800"
                      : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                }`}
              >
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.feito}
                    onChange={(e) => patchItem(item.id, { feito: e.target.checked })}
                    disabled={isReadonly}
                    className="mt-1 w-5 h-5 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className={`text-sm ${r.feito ? "line-through text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>
                      <span className="text-xs text-gray-500 font-mono mr-1">{idx + 1}.</span>
                      {item.texto}
                      {item.obrigatorio && <span className="text-rose-600 ml-1">*</span>}
                    </div>
                    {item.descricao && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 whitespace-pre-wrap">💡 {item.descricao}</div>}
                    {item.fotoGuiaUrl && <a href={item.fotoGuiaUrl} target="_blank" rel="noreferrer" className="inline-block mt-1"><img src={item.fotoGuiaUrl} alt="guia" className="w-14 h-14 rounded-lg object-cover border border-gray-200 dark:border-gray-700" title="Foto-guia: como deve ficar" /></a>}
                  </div>
                </label>
                {/* Foto-prova */}
                {(item.exigeFoto || r.fotoUrl) && (
                  <div className="ml-7 mt-1 flex items-center gap-2">
                    {isReadonly
                      ? (r.fotoUrl ? <a href={r.fotoUrl} target="_blank" rel="noreferrer"><img src={r.fotoUrl} alt="prova" className="w-14 h-14 rounded-lg object-cover border border-gray-200 dark:border-gray-700" /></a> : <span className="text-[11px] text-gray-400">sem foto</span>)
                      : <><span className={`text-[11px] ${item.exigeFoto && r.feito && !r.fotoUrl ? "text-rose-600 font-medium" : "text-gray-500"}`}>Foto-prova{item.exigeFoto ? " (obrigatória)" : ""}:</span>
                        <FotoUpload rid={restaurantId} pathPrefix={`prova_${template.id}_${item.id}`} url={r.fotoUrl} onChange={(u) => patchItem(item.id, { fotoUrl: u || undefined })} label="foto" /></>}
                  </div>
                )}
                {(item.exigeObs || r.observacao) && !isReadonly && (
                  <textarea
                    value={r.observacao || ""}
                    onChange={(e) => patchItem(item.id, { observacao: e.target.value })}
                    placeholder={item.exigeObs ? "Observação obrigatória..." : "Observação (opcional)"}
                    rows={1}
                    className={`w-full mt-1 ml-7 px-2 py-1 text-xs rounded border ${
                      item.exigeObs && r.feito && !r.observacao
                        ? "border-rose-300 bg-rose-50 dark:bg-rose-900/10"
                        : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
                    }`}
                  />
                )}
                {isReadonly && r.observacao && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 italic ml-7 mt-1">{r.observacao}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Observação geral */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação geral</label>
          <textarea
            value={obsGeral}
            onChange={(e) => setObsGeral(e.target.value)}
            disabled={isReadonly}
            rows={2}
            placeholder="Notas, exceções, contexto..."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y disabled:opacity-60"
          />
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        {!isReadonly && (
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            <Button variant="secondary" onClick={() => salvar(false)} disabled={saving}>
              {saving ? "..." : "💾 Salvar rascunho"}
            </Button>
            <Button onClick={() => salvar(true)} disabled={saving}>
              {saving ? "..." : "✓ Finalizar"}
            </Button>
          </div>
        )}
        {isReadonly && (
          <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
