// ⚠️ PROVISÓRIO — botão pra transferir os empregados de Porto Futuro → Cidade
// Velha no Puba Belém (a unidade Porto Futuro fechou em 01/07/2026, mas a unidade
// padrão dos empregados não foi trocada, então a gorjeta ainda divide em 2 bolos).
// Só troca `unidadePadraoId`. Escalas/horários não têm unidade por dia. REMOVER após uso.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import type { Empregado } from "../../core/types";

const RID_PUBA_BELEM = "T671zhYNYCeYDWt9vxTQ";
const PORTO_FUTURO = "u_1778464138769_z9ta14";
const CIDADE_VELHA = "u_1778464134320_4q1uw1";

export function TransferirUnidadePuba() {
  const [aberto, setAberto] = useState(false);
  const [emps, setEmps] = useState<Empregado[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(0);

  useEffect(() => {
    return onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", RID_PUBA_BELEM)),
      (s) => setEmps(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)));
  }, []);

  const alvos = useMemo(() => emps.filter((e) => e.unidadePadraoId === PORTO_FUTURO).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [emps]);

  async function aplicar() {
    if (!alvos.length) return;
    if (!confirm(`Transferir ${alvos.length} empregado(s) de Porto Futuro → Cidade Velha? (só muda a unidade padrão; a divisão de gorjeta passa a colocá-los no bolo de Cidade Velha)`)) return;
    setSalvando(true);
    let n = 0;
    try {
      for (const e of alvos) { await updateDoc(doc(db, "empregados", e.id), { unidadePadraoId: CIDADE_VELHA }); n++; }
      setFeito(n);
    } catch (err) { alert("Erro: " + (err instanceof Error ? err.message : "?")); }
    finally { setSalvando(false); }
  }

  return (
    <div className="mb-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20">
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
        <span>🔧 Provisório · transferir Porto Futuro → Cidade Velha ({alvos.length})</span>
        <span>{aberto ? "▲" : "▼"}</span>
      </button>
      {aberto && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[12px] text-amber-800/80 dark:text-amber-200/80">
            Porto Futuro fechou em 01/07. Isto troca a <b>unidade padrão</b> destes {alvos.length} de <b>Porto Futuro → Cidade Velha</b>, pra a gorjeta parar de dividir em 2 bolos. Depois, <b>recalcule/republique a divisão de julho</b>. (Não mexe em junho.)
          </p>
          {alvos.length === 0 ? (
            <div className="text-sm text-emerald-700 dark:text-emerald-300">✅ Ninguém em Porto Futuro — nada a transferir.</div>
          ) : (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900 p-2 text-[12px] text-gray-700 dark:text-gray-200">
              {alvos.map((e) => <div key={e.id} className="py-0.5">• {e.nome}</div>)}
            </div>
          )}
          {feito > 0 ? (
            <div className="text-sm text-emerald-700 dark:text-emerald-300">✅ {feito} transferido(s) pra Cidade Velha. Agora recalcule/republique a divisão de julho.</div>
          ) : alvos.length > 0 && (
            <Button onClick={() => void aplicar()} disabled={salvando}>{salvando ? "Transferindo…" : `Transferir ${alvos.length} pra Cidade Velha`}</Button>
          )}
        </div>
      )}
    </div>
  );
}
