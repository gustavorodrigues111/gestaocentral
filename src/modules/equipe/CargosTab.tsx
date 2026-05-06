import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { AREAS } from "../../core/types";
import type { Cargo, Area } from "../../core/types";

type Props = { restaurantId: string; podeConfig: boolean };

export function CargosTab({ restaurantId, podeConfig }: Props) {
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cargo | null | "new">(null);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo);
      setCargos(list.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome)));
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  const byArea: Record<string, Cargo[]> = {};
  AREAS.forEach(a => { byArea[a] = []; });
  cargos.forEach(c => { (byArea[c.area] = byArea[c.area] || []).push(c); });

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">{cargos.length} cargo(s) cadastrado(s)</p>
        {podeConfig && (
          <Button onClick={() => setEditing("new")}>+ Novo cargo</Button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : cargos.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🏷️</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum cargo cadastrado</p>
          {podeConfig && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Cadastre os cargos do restaurante (Garçom, Cozinheiro, Auxiliar, etc).
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {AREAS.map(area => {
            const lista = byArea[area];
            if (!lista.length) return null;
            return (
              <div key={area}>
                <div className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  {area}
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                  {lista.map((c, i) => (
                    <div
                      key={c.id}
                      className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""} ${!c.ativo ? "opacity-50" : ""}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {c.nome}
                          {!c.ativo && <span className="ml-2 text-xs text-gray-400">(inativo)</span>}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {c.semGorjeta ? "Sem gorjeta" : `${c.pontos} ponto(s)`}
                        </div>
                      </div>
                      {podeConfig && (
                        <Button variant="secondary" size="sm" onClick={() => setEditing(c)}>Editar</Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <CargoModal
          cargo={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CargoModal({ cargo, restaurantId, onClose }: { cargo: Cargo | null; restaurantId: string; onClose: () => void }) {
  const { pessoa } = useAuth();
  const [nome, setNome] = useState(cargo?.nome || "");
  const [area, setArea] = useState<Area>(cargo?.area || "Salão");
  const [pontos, setPontos] = useState<number>(cargo?.pontos ?? 1);
  const [semGorjeta, setSemGorjeta] = useState(cargo?.semGorjeta ?? false);
  const [ativo, setAtivo] = useState(cargo?.ativo ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (!pessoa) return;
    setErr("");
    setSaving(true);
    try {
      const data = {
        restaurantId,
        nome: nome.trim(),
        area,
        pontos: semGorjeta ? 0 : pontos,
        semGorjeta,
        ativo,
      };
      if (cargo) {
        await updateDoc(doc(db, "cargos", cargo.id), data);
      } else {
        await addDoc(collection(db, "cargos"), { ...data, ordem: 999, createdAt: new Date().toISOString() });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }
  async function excluir() {
    if (!cargo) return;
    if (!confirm(`Excluir o cargo "${cargo.nome}"?`)) return;
    await deleteDoc(doc(db, "cargos", cargo.id));
    onClose();
  }

  return (
    <Modal title={cargo ? "Editar cargo" : "+ Novo cargo"} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <Input label="Nome do cargo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex: Garçom 1, Cozinheiro 2, Barman" autoFocus />
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Área</label>
          <select
            value={area}
            onChange={(e) => setArea(e.target.value as Area)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <Input
          label="Pontos pra divisão de gorjeta"
          type="number"
          min="0" step="0.5"
          value={String(pontos)}
          onChange={(e) => setPontos(parseFloat(e.target.value) || 0)}
          disabled={semGorjeta}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={semGorjeta} onChange={(e) => setSemGorjeta(e.target.checked)} />
          Não recebe gorjeta (pontos = 0)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Ativo
        </label>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="flex justify-between items-center pt-2">
          <div>{cargo && <Button variant="danger" size="sm" onClick={excluir}>Excluir</Button>}</div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
