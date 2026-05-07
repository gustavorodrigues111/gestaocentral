import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Mesa } from "../../core/types";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
};

export function MesasTab({ restaurantId, podeConfig }: Props) {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Mesa | "new" | null>(null);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "mesas"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Mesa);
      list.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome));
      setMesas(list);
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  // Agrupa por setor
  const porSetor = useMemo(() => {
    const m: Record<string, Mesa[]> = {};
    for (const mesa of mesas) {
      const s = mesa.setor || "(sem setor)";
      if (!m[s]) m[s] = [];
      m[s].push(mesa);
    }
    return m;
  }, [mesas]);

  async function excluir(m: Mesa) {
    if (!confirm(`Excluir mesa "${m.nome}"? Reservas antigas com essa mesa preservam o nome em snapshot.`)) return;
    await deleteDoc(doc(db, "mesas", m.id));
  }

  async function toggleAtiva(m: Mesa) {
    await updateDoc(doc(db, "mesas", m.id), { ativa: !m.ativa });
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  const totalCapacidade = mesas.filter(m => m.ativa).reduce((s, m) => s + (m.capacidade || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {mesas.filter(m => m.ativa).length} mesa(s) ativa(s) · capacidade total: <strong>{totalCapacidade}</strong> pessoa(s)
        </div>
        {podeConfig && (
          <Button onClick={() => setEditing("new")}>+ Nova mesa</Button>
        )}
      </div>

      {mesas.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🪑</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhuma mesa cadastrada</p>
          {podeConfig && (
            <p className="text-sm text-gray-500 mt-2">Cadastre clicando em "+ Nova mesa" pra usar nas reservas.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(porSetor).sort(([a], [b]) => a.localeCompare(b)).map(([setor, list]) => (
            <div key={setor}>
              <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
                {setor} <span className="text-gray-400 font-normal">({list.length})</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {list.map(m => (
                  <div
                    key={m.id}
                    className={`bg-white dark:bg-gray-900 border rounded-xl p-3 ${
                      m.ativa
                        ? "border-gray-200 dark:border-gray-800"
                        : "border-gray-200 dark:border-gray-800 opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-900 dark:text-gray-100 truncate">{m.nome}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          👥 {m.capacidade} pessoa(s)
                        </div>
                        {!m.ativa && <div className="text-[10px] uppercase text-gray-500 mt-1">Inativa</div>}
                      </div>
                    </div>
                    {podeConfig && (
                      <div className="flex gap-1 mt-2">
                        <Button variant="secondary" size="sm" onClick={() => setEditing(m)}>Editar</Button>
                        <Button variant="secondary" size="sm" onClick={() => toggleAtiva(m)}>{m.ativa ? "🚫" : "✓"}</Button>
                        <Button variant="danger" size="sm" onClick={() => excluir(m)}>×</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <MesaModal
          mesa={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
          ordemAtual={mesas.length}
        />
      )}
    </div>
  );
}

// ── MesaModal ──────────────────────────────────────────────────────────────

function MesaModal({
  mesa, restaurantId, onClose, ordemAtual,
}: {
  mesa: Mesa | null;
  restaurantId: string;
  onClose: () => void;
  ordemAtual: number;
}) {
  const isNew = !mesa;
  const [nome, setNome] = useState(mesa?.nome || "");
  const [capacidade, setCapacidade] = useState(String(mesa?.capacidade || 4));
  const [setor, setSetor] = useState(mesa?.setor || "");
  const [ativa, setAtiva] = useState(mesa?.ativa ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    const cap = parseInt(capacidade, 10);
    if (!cap || cap <= 0) { setErr("Capacidade inválida"); return; }
    setErr("");
    setSaving(true);
    try {
      const payload: Omit<Mesa, "id"> = {
        restaurantId,
        nome: nome.trim(),
        capacidade: cap,
        setor: setor.trim() || undefined,
        ativa,
        ordem: mesa?.ordem ?? ordemAtual,
      };
      if (isNew) {
        await addDoc(collection(db, "mesas"), sanitizeForFirestore(payload));
      } else {
        await updateDoc(doc(db, "mesas", mesa.id), sanitizeForFirestore(payload));
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
    <Modal title={isNew ? "+ Nova mesa" : `Editar — ${mesa.nome}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Mesa 4, Bar 2, Varanda 1"
          autoFocus
        />
        <Input
          label="Capacidade *"
          type="number"
          min={1}
          value={capacidade}
          onChange={(e) => setCapacidade(e.target.value)}
        />
        <Input
          label="Setor"
          value={setor}
          onChange={(e) => setSetor(e.target.value)}
          placeholder="ex: Salão interno, Varanda, Bar"
        />
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
          <span className="font-medium">Mesa ativa</span>
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
