// Configurações do módulo Freelas (por restaurante). 1ª config: datas de corte
// de pagamento — turno ENCERRADO até {dia} {hora} é pago em {dia}. 1+ linhas.
import { useEffect, useState } from "react";
import { Plus, Trash2, CalendarClock } from "lucide-react";
import { Button } from "../../core/ui/Button";
import { TimeInput } from "../../core/ui/TimeInput";
import type { FreelasCortePagamento } from "../../core/types";
import { DIAS_SEMANA_CAP } from "./cortePagamento";

function novoCorte(): FreelasCortePagamento {
  return { id: Math.random().toString(36).slice(2, 10), corteDiaSemana: 1, corteHora: "18:00", pagamentoDiaSemana: 2 };
}

export function ConfiguracoesTab({ cortes, podeEditar, onSave }: {
  cortes: FreelasCortePagamento[];
  podeEditar: boolean;
  onSave: (cortes: FreelasCortePagamento[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<FreelasCortePagamento[]>(cortes);
  const [salvando, setSalvando] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  useEffect(() => { setDraft(cortes); }, [cortes]);

  const set = (id: string, patch: Partial<FreelasCortePagamento>) => setDraft(d => d.map(c => c.id === id ? { ...c, ...patch } : c));
  const selCls = "px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

  async function salvar() {
    setSalvando(true);
    try { await onSave(draft); setSavedAt(new Date().toLocaleTimeString("pt-BR")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-center gap-2 mb-1">
          <CalendarClock size={16} className="text-indigo-500" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Datas de corte de pagamento</h3>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          O freela cujo turno é <b>encerrado</b> até o dia/hora de corte é pago no dia indicado.
          Pode ter mais de uma linha na semana. Turno encerrado depois do corte cai no próximo pagamento.
        </p>

        <div className="space-y-2">
          {draft.map(c => (
            <div key={c.id} className="flex items-center gap-2 flex-wrap text-sm bg-gray-50 dark:bg-gray-800/40 rounded-lg px-3 py-2">
              <span className="text-gray-500">Encerrado até</span>
              <select disabled={!podeEditar} value={c.corteDiaSemana} onChange={e => set(c.id, { corteDiaSemana: Number(e.target.value) })} className={selCls}>
                {DIAS_SEMANA_CAP.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
              <div className="w-24"><TimeInput value={c.corteHora} onChange={(v) => set(c.id, { corteHora: v })} placeholder="HH:MM" /></div>
              <span className="text-gray-500">→ pago</span>
              <select disabled={!podeEditar} value={c.pagamentoDiaSemana} onChange={e => set(c.id, { pagamentoDiaSemana: Number(e.target.value) })} className={selCls}>
                {DIAS_SEMANA_CAP.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
              {podeEditar && (
                <button type="button" onClick={() => setDraft(d => d.filter(x => x.id !== c.id))} className="ml-auto text-gray-400 hover:text-rose-500 p-1" title="Remover"><Trash2 size={15} /></button>
              )}
            </div>
          ))}
          {draft.length === 0 && <p className="text-sm text-gray-400 py-2">Nenhuma linha de corte — os freelas não veem previsão de pagamento.</p>}
        </div>

        {podeEditar && (
          <div className="flex items-center gap-2 mt-3">
            <button type="button" onClick={() => setDraft(d => [...d, novoCorte()])} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"><Plus size={13} /> Adicionar linha</button>
            <div className="flex-1" />
            {savedAt && <span className="text-xs text-emerald-600">✓ Salvo às {savedAt}</span>}
            <Button size="sm" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
