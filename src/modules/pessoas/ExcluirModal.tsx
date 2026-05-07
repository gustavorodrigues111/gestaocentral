import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { logAudit } from "../../core/audit/versionedChange";
import type { Empregado, Pessoa } from "../../core/types";

type Props = {
  pessoa: Pessoa;
  onClose: () => void;
};

export function ExcluirModal({ pessoa, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [confirmacao, setConfirmacao] = useState("");
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [loadingEmps, setLoadingEmps] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const q = query(collection(db, "empregados"), where("pessoaId", "==", pessoa.id));
        const snap = await getDocs(q);
        if (!alive) return;
        setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
      } finally {
        if (alive) setLoadingEmps(false);
      }
    })();
    return () => { alive = false; };
  }, [pessoa.id]);

  const podeExcluir = confirmacao.trim() === pessoa.nome.trim();

  async function excluir() {
    if (!me || !podeExcluir) return;
    setErr("");
    setSaving(true);
    try {
      // 1. Apaga empregados vinculados (gorjetas/VT antigas mantêm snapshot do nome)
      for (const emp of empregados) {
        await deleteDoc(doc(db, "empregados", emp.id));
        await logAudit({
          entityType: "empregado",
          entityId: emp.id,
          restaurantId: emp.restaurantId,
          acao: "excluido",
          motivo: `Pessoa ${pessoa.nome} excluída definitivamente`,
          registradoPor: me.id,
        });
      }
      // 2. Apaga a Pessoa
      await deleteDoc(doc(db, "pessoas", pessoa.id));
      await logAudit({
        entityType: "pessoa",
        entityId: pessoa.id,
        acao: "excluido",
        diff: { nome: { antes: pessoa.nome, depois: null } },
        registradoPor: me.id,
      });
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Excluir definitivamente — ${pessoa.nome}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="rounded-lg bg-rose-50 dark:bg-rose-900/30 border-2 border-rose-300 dark:border-rose-700 p-3 text-sm text-rose-800 dark:text-rose-200">
          🚨 <strong>AÇÃO IRREVERSÍVEL.</strong>
          <ul className="list-disc ml-5 mt-1 text-xs space-y-0.5">
            <li>Apaga a Pessoa do sistema</li>
            <li>Apaga {loadingEmps ? "..." : empregados.length} empregado(s) vinculado(s)</li>
            <li>Gorjetas/VT antigas mantêm o nome congelado (snapshot histórico)</li>
            <li>Sem possibilidade de reativar — só recadastrar do zero</li>
          </ul>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            Pra confirmar, digite o nome exato: <strong>{pessoa.nome}</strong>
          </label>
          <Input
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            placeholder={pessoa.nome}
            autoFocus
          />
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={excluir} disabled={!podeExcluir || saving}>
            {saving ? "..." : "Excluir definitivamente"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
