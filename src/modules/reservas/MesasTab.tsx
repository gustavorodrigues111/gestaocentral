// Cadastro de mesas — agrupadas por salão, com bulk create pra agilizar
// a configuração inicial (ex: criar mesas 1-20 com 4 pax em 2 cliques).
//
// Mesa.salaoId é opcional pra retrocompat com mesas pre-refactor (mostradas
// em "Sem salão atribuído" com botão pra mover). Mesas novas SEMPRE têm
// salaoId — modal exige escolha.

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Mesa, Salao } from "../../core/types";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
};

export function MesasTab({ restaurantId, podeConfig }: Props) {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [saloes, setSaloes] = useState<Salao[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Mesa | "new" | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

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

  useEffect(() => {
    const q = query(collection(db, "saloes"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Salao);
      list.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));
      setSaloes(list);
    });
    return () => unsub();
  }, [restaurantId]);

  // Agrupa mesas por salaoId. "(sem salão)" pra mesas legadas sem salaoId.
  const grupos = useMemo(() => {
    const m = new Map<string, Mesa[]>();
    for (const mesa of mesas) {
      const k = mesa.salaoId || "__nenhum__";
      const arr = m.get(k) || [];
      arr.push(mesa);
      m.set(k, arr);
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
  const semSaloesCadastrados = saloes.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {mesas.filter(m => m.ativa).length} mesa(s) ativa(s) · capacidade total: <strong>{totalCapacidade}</strong> pessoa(s)
        </div>
        {podeConfig && !semSaloesCadastrados && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setBulkOpen(true)}>⚡ Adicionar várias</Button>
            <Button onClick={() => setEditing("new")}>+ Nova mesa</Button>
          </div>
        )}
      </div>

      {semSaloesCadastrados ? (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">🏛️</div>
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Cadastra um salão primeiro</p>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-2">
            Mesas pertencem a salões. Vai em <strong>Configurações → Salões</strong> e cadastra pelo menos um salão antes.
          </p>
        </div>
      ) : mesas.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🪑</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhuma mesa cadastrada</p>
          {podeConfig && (
            <p className="text-sm text-gray-500 mt-2">
              Use <strong>"+ Nova mesa"</strong> ou <strong>"⚡ Adicionar várias"</strong> pra começar.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Mesas agrupadas por salão */}
          {saloes.map(s => {
            const list = grupos.get(s.id) || [];
            if (list.length === 0) return null;
            return (
              <GrupoMesas
                key={s.id}
                titulo={s.nome}
                mesas={list}
                podeConfig={podeConfig}
                onEditar={(m) => setEditing(m)}
                onToggleAtiva={toggleAtiva}
                onExcluir={excluir}
              />
            );
          })}
          {/* Mesas sem salão atribuído (legado) */}
          {grupos.get("__nenhum__") && (
            <GrupoMesas
              titulo="Sem salão atribuído"
              mesas={grupos.get("__nenhum__")!}
              podeConfig={podeConfig}
              onEditar={(m) => setEditing(m)}
              onToggleAtiva={toggleAtiva}
              onExcluir={excluir}
            />
          )}
        </div>
      )}

      {editing && (
        <MesaModal
          mesa={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          saloes={saloes}
          onClose={() => setEditing(null)}
          ordemAtual={mesas.length}
        />
      )}
      {bulkOpen && (
        <BulkMesasModal
          restaurantId={restaurantId}
          saloes={saloes}
          mesasExistentes={mesas}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}

// ── Grupo de mesas (1 salão) ───────────────────────────────────────────
function GrupoMesas({
  titulo, mesas, podeConfig, onEditar, onToggleAtiva, onExcluir,
}: {
  titulo: string;
  mesas: Mesa[];
  podeConfig: boolean;
  onEditar: (m: Mesa) => void;
  onToggleAtiva: (m: Mesa) => void;
  onExcluir: (m: Mesa) => void;
}) {
  const total = mesas.filter(m => m.ativa).reduce((s, m) => s + (m.capacidade || 0), 0);
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
        {titulo}
        <span className="text-gray-400 font-normal ml-2">
          ({mesas.length} mesa(s) · {total} pax)
        </span>
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {mesas.map(m => (
          <div
            key={m.id}
            className={`bg-white dark:bg-gray-900 border rounded-xl p-2.5 ${
              m.ativa
                ? "border-gray-200 dark:border-gray-800"
                : "border-gray-200 dark:border-gray-800 opacity-60"
            }`}
          >
            <div className="font-bold text-gray-900 dark:text-gray-100 truncate">{m.nome}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              👥 {m.capacidade} pax
            </div>
            {!m.ativa && <div className="text-[10px] uppercase text-gray-500 mt-0.5">Inativa</div>}
            {podeConfig && (
              <div className="flex gap-1 mt-1.5">
                <Button variant="secondary" size="sm" onClick={() => onEditar(m)}>Editar</Button>
                <Button variant="secondary" size="sm" onClick={() => onToggleAtiva(m)}>{m.ativa ? "🚫" : "✓"}</Button>
                <Button variant="danger" size="sm" onClick={() => onExcluir(m)}>×</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MesaModal (individual) ─────────────────────────────────────────────
function MesaModal({
  mesa, restaurantId, saloes, onClose, ordemAtual,
}: {
  mesa: Mesa | null;
  restaurantId: string;
  saloes: Salao[];
  onClose: () => void;
  ordemAtual: number;
}) {
  const isNew = !mesa;
  const [nome, setNome] = useState(mesa?.nome || "");
  const [capacidade, setCapacidade] = useState(String(mesa?.capacidade || 4));
  const [salaoId, setSalaoId] = useState(mesa?.salaoId || (saloes[0]?.id || ""));
  const [ativa, setAtiva] = useState(mesa?.ativa ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    const cap = parseInt(capacidade, 10);
    if (!cap || cap <= 0) { setErr("Capacidade inválida"); return; }
    if (!salaoId) { setErr("Escolhe o salão"); return; }
    setErr("");
    setSaving(true);
    try {
      const payload: Omit<Mesa, "id"> = {
        restaurantId,
        nome: nome.trim(),
        capacidade: cap,
        salaoId,
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
          placeholder="ex: 1, 19, Bar A"
          autoFocus
        />
        <Input
          label="Capacidade (pax) *"
          type="number"
          min={1}
          value={capacidade}
          onChange={(e) => setCapacidade(e.target.value)}
        />
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">
            Salão *
          </label>
          <select
            value={salaoId}
            onChange={(e) => setSalaoId(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="">— escolhe —</option>
            {saloes.map(s => (
              <option key={s.id} value={s.id}>{s.nome}</option>
            ))}
          </select>
        </div>
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

// ── BulkMesasModal (criar várias de uma vez) ──────────────────────────
function BulkMesasModal({
  restaurantId, saloes, mesasExistentes, onClose,
}: {
  restaurantId: string;
  saloes: Salao[];
  mesasExistentes: Mesa[];
  onClose: () => void;
}) {
  const [salaoId, setSalaoId] = useState(saloes[0]?.id || "");
  const [de, setDe] = useState("1");
  const [ate, setAte] = useState("10");
  const [capacidade, setCapacidade] = useState("4");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const deN = parseInt(de, 10);
  const ateN = parseInt(ate, 10);
  const capN = parseInt(capacidade, 10);
  const validRange = !isNaN(deN) && !isNaN(ateN) && deN > 0 && ateN >= deN && ateN - deN < 100;
  const validCap = !isNaN(capN) && capN > 0;
  const total = validRange ? ateN - deN + 1 : 0;

  // Pré-detecta números que já existem no salão escolhido pra evitar
  // duplicatas. Compara nome exato (como string).
  const numerosOcupados = useMemo(() => {
    const s = new Set<string>();
    for (const m of mesasExistentes) {
      if (m.salaoId === salaoId) s.add(m.nome.trim());
    }
    return s;
  }, [mesasExistentes, salaoId]);

  const conflitos = useMemo(() => {
    if (!validRange) return [] as number[];
    const c: number[] = [];
    for (let i = deN; i <= ateN; i++) {
      if (numerosOcupados.has(String(i))) c.push(i);
    }
    return c;
  }, [validRange, deN, ateN, numerosOcupados]);

  async function criar() {
    if (!salaoId) { setErr("Escolhe o salão"); return; }
    if (!validRange) { setErr("Intervalo inválido (máx 100 mesas por vez)"); return; }
    if (!validCap) { setErr("Capacidade inválida"); return; }
    setErr("");
    setSaving(true);
    try {
      // writeBatch: até 500 ops, suficiente pro nosso limite de 100
      const batch = writeBatch(db);
      const ordemBase = mesasExistentes.length;
      let idx = 0;
      for (let i = deN; i <= ateN; i++) {
        if (numerosOcupados.has(String(i))) continue; // pula conflitos
        const ref = doc(collection(db, "mesas"));
        const payload: Omit<Mesa, "id"> = {
          restaurantId,
          nome: String(i),
          capacidade: capN,
          salaoId,
          ativa: true,
          ordem: ordemBase + idx,
        };
        batch.set(ref, sanitizeForFirestore(payload));
        idx++;
      }
      await batch.commit();
      onClose();
    } catch (e) {
      console.error("[bulk-mesas]", e);
      setErr(e instanceof Error ? e.message : "Erro ao criar mesas");
    } finally {
      setSaving(false);
    }
  }

  const naoConflito = total - conflitos.length;

  return (
    <Modal title="⚡ Adicionar várias mesas" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Cria várias mesas numeradas de uma vez. Útil pra setup inicial — depois você ajusta as exceções (capacidade diferente, nome custom).
        </p>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">
            Salão *
          </label>
          <select
            value={salaoId}
            onChange={(e) => setSalaoId(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            <option value="">— escolhe —</option>
            {saloes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="De (número) *"
            type="number"
            min={1}
            value={de}
            onChange={(e) => setDe(e.target.value)}
          />
          <Input
            label="Até (número) *"
            type="number"
            min={1}
            value={ate}
            onChange={(e) => setAte(e.target.value)}
          />
        </div>

        <Input
          label="Capacidade de cada (pax) *"
          type="number"
          min={1}
          value={capacidade}
          onChange={(e) => setCapacidade(e.target.value)}
        />

        {validRange && (
          <div className="text-sm rounded-lg p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-900 text-indigo-800 dark:text-indigo-300">
            Vai criar <strong>{naoConflito}</strong> mesa(s) ({String(deN)} até {String(ateN)})
            {conflitos.length > 0 && (
              <>
                {" "}— pula {conflitos.length} já cadastrada(s): {conflitos.join(", ")}
              </>
            )}
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={criar} disabled={saving || !validRange || !validCap || naoConflito === 0 || !salaoId}>
            {saving ? "Criando..." : `Criar ${naoConflito} mesa(s)`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
