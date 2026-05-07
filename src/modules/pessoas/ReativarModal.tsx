import { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { logAudit } from "../../core/audit/versionedChange";
import type { Pessoa } from "../../core/types";

type Props = {
  pessoa: Pessoa;
  onClose: () => void;
};

export function ReativarModal({ pessoa, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [form, setForm] = useState({
    nome: pessoa.nome || "",
    email: pessoa.email || "",
    cpf: pessoa.cpf || "",
    whatsapp: pessoa.whatsapp || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function reativar() {
    if (!me) return;
    if (!form.nome.trim()) { setErr("Nome obrigatório"); return; }
    setErr("");
    setSaving(true);
    try {
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        ativa: true,
        inativadaEm: null,
        inativadaPor: null,
        motivoInativacao: null,
        nome: form.nome.trim(),
        email: form.email.trim().toLowerCase(),
        cpf: form.cpf.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
      });
      await logAudit({
        entityType: "pessoa",
        entityId: pessoa.id,
        acao: "reativado",
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
    <Modal title={`Reativar — ${pessoa.nome}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-800 dark:text-emerald-300">
          ✓ Reativar restaura o acesso da pessoa ao sistema.
          <p className="text-xs mt-1 opacity-80">
            Empregados vinculados continuam DEMITIDOS — pra readmitir como equipe num restaurante,
            edita a aba Vínculos depois (vai criar novo período preservando o histórico).
          </p>
        </div>

        <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
          Confirme/atualize os dados
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Nome completo *"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            autoFocus
          />
          <Input
            label="Email (login)"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            label="CPF"
            value={form.cpf}
            onChange={(e) => setForm({ ...form, cpf: e.target.value })}
          />
          <Input
            label="WhatsApp"
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          />
        </div>

        {pessoa.motivoInativacao && (
          <div className="text-[11px] text-gray-500 dark:text-gray-400 italic">
            Motivo da inativação anterior: <strong>{pessoa.motivoInativacao}</strong>
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={reativar} disabled={saving}>{saving ? "..." : "Reativar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
