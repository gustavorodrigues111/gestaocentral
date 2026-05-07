import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Fornecedor } from "../../core/types";

type Props = {
  fornecedores: Fornecedor[];
  restaurantId: string;
  podeConfig: boolean;
};

export function FornecedoresTab({ fornecedores, restaurantId, podeConfig }: Props) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Fornecedor | "new" | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return fornecedores;
    const s = search.toLowerCase();
    return fornecedores.filter(f =>
      f.nome.toLowerCase().includes(s) ||
      (f.whatsapp || "").toLowerCase().includes(s) ||
      (f.email || "").toLowerCase().includes(s)
    );
  }, [fornecedores, search]);

  async function excluir(f: Fornecedor) {
    if (!confirm(`Excluir fornecedor "${f.nome}"? Pedidos antigos preservam o snapshot do nome.`)) return;
    await deleteDoc(doc(db, "fornecedores", f.id));
  }

  async function toggleAtivo(f: Fornecedor) {
    await updateDoc(doc(db, "fornecedores", f.id), { ativo: !f.ativo });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Input
          placeholder="🔍 Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md"
        />
        {podeConfig && (
          <Button onClick={() => setEditing("new")}>+ Novo fornecedor</Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search ? "Nenhum fornecedor encontrado" : "Sem fornecedores"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(f => (
            <div
              key={f.id}
              className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 ${!f.ativo ? "opacity-60" : ""}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-gray-900 dark:text-gray-100">{f.nome}</h3>
                    {!f.ativo && <span className="text-[10px] uppercase text-gray-500">Inativo</span>}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 flex gap-3 flex-wrap">
                    {f.whatsapp && <span>📱 {f.whatsapp}</span>}
                    {f.email && <span>✉️ {f.email}</span>}
                  </div>
                  {f.observacoes && <div className="text-xs text-gray-700 dark:text-gray-300 italic mt-1">{f.observacoes}</div>}
                </div>
                {podeConfig && (
                  <div className="flex gap-1">
                    {f.whatsapp && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => window.open(`https://wa.me/${onlyDigits(f.whatsapp!)}`, "_blank")}
                      >📱 WA</Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => toggleAtivo(f)}>{f.ativo ? "🚫" : "✓"}</Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(f)}>Editar</Button>
                    <Button variant="danger" size="sm" onClick={() => excluir(f)}>×</Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <FornecedorModal
          fornecedor={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

// ── FornecedorModal ────────────────────────────────────────────────────────

function FornecedorModal({
  fornecedor, restaurantId, onClose,
}: {
  fornecedor: Fornecedor | null;
  restaurantId: string;
  onClose: () => void;
}) {
  const { pessoa: me } = useAuth();
  const isNew = !fornecedor;

  const [nome, setNome] = useState(fornecedor?.nome || "");
  const [whatsapp, setWhatsapp] = useState(fornecedor?.whatsapp || "");
  const [email, setEmail] = useState(fornecedor?.email || "");
  const [observacoes, setObservacoes] = useState(fornecedor?.observacoes || "");
  const [ativo, setAtivo] = useState(fornecedor?.ativo ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Omit<Fornecedor, "id"> = {
        restaurantId,
        nome: nome.trim(),
        whatsapp: whatsapp.trim() || undefined,
        email: email.trim() || undefined,
        observacoes: observacoes.trim() || undefined,
        ativo,
        criadoEm: fornecedor?.criadoEm || now,
        criadoPor: fornecedor?.criadoPor || me.id,
      };
      if (isNew) {
        await addDoc(collection(db, "fornecedores"), sanitizeForFirestore(payload));
      } else {
        await updateDoc(doc(db, "fornecedores", fornecedor.id), sanitizeForFirestore(payload));
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? "+ Novo fornecedor" : `Editar — ${fornecedor.nome}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Distribuidora Joaquim"
          autoFocus
        />
        <Input
          label="WhatsApp (com DDI 55)"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="ex: 5511999998888"
        />
        <p className="text-[10px] text-gray-500 -mt-2">
          Formato internacional (55 + DDD + número). Usado pra abrir wa.me/&lt;numero&gt;
        </p>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observações</label>
          <textarea
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={2}
            placeholder="ex: dia de entrega, condições de pagamento..."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
          />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span className="font-medium">Fornecedor ativo</span>
        </label>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "..." : isNew ? "Criar" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
