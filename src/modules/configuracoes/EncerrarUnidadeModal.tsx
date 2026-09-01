import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Unidade } from "../../core/types";
import { aplicarEncerramento, contarImpacto, type ImpactoEncerramento } from "./encerrarUnidade";

type Props = {
  rid: string;
  unidade: Unidade;
  unidades: Unidade[];
  onClose: () => void;
  onDone: (novas: Unidade[]) => void;
};

export function EncerrarUnidadeModal({ rid, unidade, unidades, onClose, onDone }: Props) {
  // Destinos possíveis: outras unidades de ATENDIMENTO ativas.
  const destinos = useMemo(
    () => unidades.filter((u) => u.id !== unidade.id && u.tipo === "atendimento" && u.ativa && !u.encerradaEm),
    [unidades, unidade.id],
  );
  const [corte, setCorte] = useState("");
  const [destinoId, setDestinoId] = useState(destinos.length === 1 ? destinos[0].id : "");
  const [impacto, setImpacto] = useState<ImpactoEncerramento | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [err, setErr] = useState("");

  async function calcular() {
    if (!corte) { setErr("Informe o último dia de funcionamento."); return; }
    setErr(""); setCarregando(true); setImpacto(null);
    try {
      setImpacto(await contarImpacto(rid, unidade.id, corte));
    } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao calcular impacto."); }
    finally { setCarregando(false); }
  }

  async function confirmar() {
    if (!corte) { setErr("Informe o último dia de funcionamento."); return; }
    const precisaDestino = (impacto?.empregados.length || 0) > 0 || (impacto?.turnos || 0) > 0
      || (impacto?.gorjetas || 0) > 0 || (impacto?.escalaCelulas || 0) > 0;
    if (precisaDestino && !destinoId) { setErr("Escolha a unidade que vai absorver empregados e lançamentos."); return; }
    setErr(""); setAplicando(true);
    try {
      if (precisaDestino) await aplicarEncerramento(rid, unidade.id, corte, destinoId);
      // Marca a unidade como encerrada e persiste o array inteiro.
      const novas = unidades.map((u) => u.id === unidade.id
        ? { ...u, ativa: false, encerradaEm: corte, ...(precisaDestino ? { encerradaMigradaPara: destinoId } : {}) }
        : u);
      await updateDoc(doc(db, "restaurants", rid), { unidades: sanitizeForFirestore(novas) });
      onDone(novas);
    } catch (e) { setErr(e instanceof Error ? e.message : "Falha ao encerrar."); setAplicando(false); }
  }

  const lbl = "text-xs font-semibold text-gray-600 dark:text-gray-400";
  const inp = "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

  return (
    <Modal title={`Encerrar unidade · ${unidade.nome}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="text-[12px] text-gray-600 dark:text-gray-300 bg-amber-50/60 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5">
          O histórico <strong>até</strong> a data de corte fica intacto (continua nessa unidade).
          A partir do dia seguinte, empregados e lançamentos passam pra unidade que você escolher.
        </div>

        <div className="flex flex-col gap-1">
          <label className={lbl}>Último dia de funcionamento *</label>
          <input type="date" value={corte} onChange={(e) => { setCorte(e.target.value); setImpacto(null); }} className={inp} />
        </div>

        <div className="flex flex-col gap-1">
          <label className={lbl}>Transferir para a unidade *</label>
          {destinos.length === 0 ? (
            <div className="text-[12px] text-rose-600">Não há outra unidade de atendimento ativa pra receber. Cadastre/ative uma antes.</div>
          ) : (
            <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} className={inp}>
              <option value="">— selecione —</option>
              {destinos.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          )}
        </div>

        <div>
          <Button variant="secondary" size="sm" onClick={() => void calcular()} disabled={carregando || !corte}>
            {carregando ? "Calculando…" : "🔎 Calcular impacto"}
          </Button>
        </div>

        {impacto && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-[12.5px] text-gray-700 dark:text-gray-200 space-y-1">
            <div className="font-semibold text-gray-900 dark:text-gray-100">A partir de {corte} vão migrar:</div>
            <div>👥 <strong>{impacto.empregados.length}</strong> empregado(s) vinculado(s){impacto.empregados.length > 0 ? `: ${impacto.empregados.map((e) => e.nome).join(", ")}` : ""}</div>
            <div>🎒 <strong>{impacto.turnos}</strong> turno(s) de freela após a data</div>
            <div>🎁 <strong>{impacto.gorjetas}</strong> gorjeta(s) após a data</div>
            <div>📅 <strong>{impacto.escalaCelulas}</strong> dia(s) de escala com essa unidade após a data</div>
            {impacto.empregados.length + impacto.turnos + impacto.gorjetas + impacto.escalaCelulas === 0 && (
              <div className="text-gray-500 italic">Nada após a data — só marca a unidade como encerrada.</div>
            )}
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={aplicando}>Cancelar</Button>
          <Button onClick={() => void confirmar()} disabled={aplicando || !corte || (destinos.length === 0)}>
            {aplicando ? "Encerrando…" : "Encerrar unidade"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
