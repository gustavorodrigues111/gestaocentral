import { useEffect, useState } from "react";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import {
  MODELO_CAPACIDADE_LABEL,
  type ModeloCapacidadeSalao,
  type Salao,
} from "../../core/types";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
  pessoaId: string;
};

// Aba "Salões" — CRUD pros locais de mesa que o cliente vai escolher no
// form público de reserva. Cada salão escolhe como controla disponibilidade:
//   - "por_capacidade": total fixo de pax + tamanhos de mesa permitidos
//   - "por_mesas": N mesas com min/max pax cada
export function SaloesTab({ restaurantId, podeConfig, pessoaId }: Props) {
  const [saloes, setSaloes] = useState<Salao[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Salao | "new" | null>(null);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "saloes"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Salao);
      list.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome));
      setSaloes(list);
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  async function excluir(s: Salao) {
    if (!confirm(`Excluir salão "${s.nome}"? Reservas antigas preservam o nome em snapshot.`)) return;
    await deleteDoc(doc(db, "saloes", s.id));
  }

  async function toggleAtivo(s: Salao) {
    await updateDoc(doc(db, "saloes", s.id), {
      ativo: !s.ativo,
      atualizadoEm: new Date().toISOString(),
    });
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {saloes.filter(s => s.ativo).length} salão(ões) ativo(s)
        </div>
        {podeConfig && (
          <Button onClick={() => setEditing("new")}>+ Novo salão</Button>
        )}
      </div>

      {saloes.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🏛️</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum salão cadastrado</p>
          {podeConfig && (
            <p className="text-sm text-gray-500 mt-2">
              Cadastre salões pra que clientes possam escolher onde reservar.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {saloes.map(s => (
            <SalaoCard
              key={s.id}
              salao={s}
              podeConfig={podeConfig}
              onEditar={() => setEditing(s)}
              onToggle={() => toggleAtivo(s)}
              onExcluir={() => excluir(s)}
            />
          ))}
        </div>
      )}

      {editing && (
        <SalaoModal
          salao={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          pessoaId={pessoaId}
          ordemAtual={saloes.length}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── Card visual de salão ─────────────────────────────────────────────

function SalaoCard({
  salao, podeConfig, onEditar, onToggle, onExcluir,
}: {
  salao: Salao;
  podeConfig: boolean;
  onEditar: () => void;
  onToggle: () => void;
  onExcluir: () => void;
}) {
  const desc = descrevecapacidade(salao);
  return (
    <div className={`bg-white dark:bg-gray-900 border rounded-xl p-3 ${salao.ativo ? "border-gray-200 dark:border-gray-800" : "border-gray-200 dark:border-gray-800 opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-gray-900 dark:text-gray-100">{salao.nome}</div>
          {salao.descricao && (
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{salao.descricao}</div>
          )}
          <div className="text-xs text-gray-700 dark:text-gray-300 mt-2 space-y-0.5">
            <div>📐 <strong>{MODELO_CAPACIDADE_LABEL[salao.modeloCapacidade]}</strong></div>
            <div>{desc}</div>
          </div>
          {!salao.ativo && <div className="text-[10px] uppercase text-gray-500 mt-1">Inativo</div>}
        </div>
      </div>
      {podeConfig && (
        <div className="flex gap-1 mt-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={onEditar}>Editar</Button>
          <Button variant="secondary" size="sm" onClick={onToggle}>{salao.ativo ? "🚫" : "✓"}</Button>
          <Button variant="danger" size="sm" onClick={onExcluir}>×</Button>
        </div>
      )}
    </div>
  );
}

// Frase compacta descrevendo a capacidade configurada do salão
function descrevecapacidade(s: Salao): string {
  if (s.modeloCapacidade === "por_capacidade") {
    const cap = s.capacidadeMaxPax ?? 0;
    const min = s.paxMinPorMesaCap ?? 1;
    const max = s.paxMaxPorMesaCap ?? cap;
    return `👥 até ${cap} pax · mesas de ${min} a ${max} pax`;
  }
  const n = s.numMesas ?? 0;
  const min = s.paxMinPorMesa ?? 1;
  const max = s.paxMaxPorMesa ?? min;
  return `🍽️ ${n} mesa(s) · ${min === max ? `${min}` : `${min}–${max}`} pax cada`;
}

// ─── Modal de criação/edição ──────────────────────────────────────────

function SalaoModal({
  salao, restaurantId, pessoaId, ordemAtual, onClose,
}: {
  salao: Salao | null;
  restaurantId: string;
  pessoaId: string;
  ordemAtual: number;
  onClose: () => void;
}) {
  const isNew = !salao;
  const [nome, setNome] = useState(salao?.nome || "");
  const [descricao, setDescricao] = useState(salao?.descricao || "");
  const [ativo, setAtivo] = useState(salao?.ativo ?? true);
  const [modelo, setModelo] = useState<ModeloCapacidadeSalao>(salao?.modeloCapacidade || "por_capacidade");
  // Por capacidade
  const [capacidadeMax, setCapacidadeMax] = useState(String(salao?.capacidadeMaxPax ?? 10));
  const [paxMinCap, setPaxMinCap]         = useState(String(salao?.paxMinPorMesaCap ?? 2));
  const [paxMaxCap, setPaxMaxCap]         = useState(String(salao?.paxMaxPorMesaCap ?? 5));
  // Por mesas
  const [numMesas, setNumMesas]   = useState(String(salao?.numMesas ?? 6));
  const [paxMin, setPaxMin]       = useState(String(salao?.paxMinPorMesa ?? 4));
  const [paxMax, setPaxMax]       = useState(String(salao?.paxMaxPorMesa ?? 6));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    setErr("");
    if (!nome.trim()) { setErr("Nome do salão obrigatório"); return; }

    // Validações por modelo
    if (modelo === "por_capacidade") {
      const cap = parseInt(capacidadeMax, 10);
      const min = parseInt(paxMinCap, 10);
      const max = parseInt(paxMaxCap, 10);
      if (!cap || cap < 1) { setErr("Capacidade máx do salão inválida"); return; }
      if (!min || min < 1) { setErr("Tamanho mín de mesa inválido"); return; }
      if (!max || max < min) { setErr("Tamanho máx de mesa precisa ser ≥ mín"); return; }
      if (max > cap) { setErr("Tamanho máx de mesa não pode passar da capacidade do salão"); return; }
    } else {
      const n = parseInt(numMesas, 10);
      const min = parseInt(paxMin, 10);
      const max = parseInt(paxMax, 10);
      if (!n || n < 1) { setErr("Qtd de mesas inválida"); return; }
      if (!min || min < 1) { setErr("Pax mínimo inválido"); return; }
      if (!max || max < min) { setErr("Pax máximo precisa ser ≥ mínimo"); return; }
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const base = {
        restaurantId,
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        ordem: salao?.ordem ?? ordemAtual,
        ativo,
        modeloCapacidade: modelo,
        // Limpa campos do outro modelo
        capacidadeMaxPax:  modelo === "por_capacidade" ? parseInt(capacidadeMax, 10) : undefined,
        paxMinPorMesaCap:  modelo === "por_capacidade" ? parseInt(paxMinCap, 10) : undefined,
        paxMaxPorMesaCap:  modelo === "por_capacidade" ? parseInt(paxMaxCap, 10) : undefined,
        numMesas:          modelo === "por_mesas"      ? parseInt(numMesas, 10) : undefined,
        paxMinPorMesa:     modelo === "por_mesas"      ? parseInt(paxMin, 10) : undefined,
        paxMaxPorMesa:     modelo === "por_mesas"      ? parseInt(paxMax, 10) : undefined,
        atualizadoEm: now,
      };
      if (isNew) {
        const payload: Omit<Salao, "id"> = {
          ...base,
          criadoEm: now,
          criadoPor: pessoaId,
        };
        await addDoc(collection(db, "saloes"), sanitizeForFirestore(payload));
      } else {
        await updateDoc(doc(db, "saloes", salao.id), sanitizeForFirestore(base));
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? "+ Novo salão" : `Editar — ${salao.nome}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Salão Principal, Varanda, Jardim"
          autoFocus
        />
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Descrição (opcional — mostrada pro cliente)
          </label>
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={2}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            placeholder="ex: Vista para a rua, com música ambiente"
          />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span className="font-medium">Salão ativo (aparece no form de reserva)</span>
        </label>

        {/* Modelo de capacidade */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Como controlar disponibilidade *
          </label>
          <div className="mt-1 grid grid-cols-1 gap-1.5">
            {(Object.keys(MODELO_CAPACIDADE_LABEL) as ModeloCapacidadeSalao[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setModelo(m)}
                className={`px-3 py-2 rounded-lg text-sm text-left border ${
                  modelo === m
                    ? "bg-indigo-50 border-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-700"
                    : "bg-white border-gray-300 dark:bg-gray-900 dark:border-gray-700"
                }`}
              >
                <strong>{MODELO_CAPACIDADE_LABEL[m]}</strong>
                <span className="block text-xs opacity-80 mt-0.5">
                  {m === "por_capacidade"
                    ? "Defino um total de pax no salão e o tamanho mín/máx das mesas. Sistema soma reservas e libera vagas até o limite."
                    : "Defino quantidade de mesas e o tamanho mín/máx de pax por mesa. Cada reserva ocupa 1 mesa."
                  }
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Campos por modelo */}
        {modelo === "por_capacidade" ? (
          <div className="space-y-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800">
            <Input
              label="Capacidade total do salão (pax) *"
              type="number" min={1}
              value={capacidadeMax}
              onChange={(e) => setCapacidadeMax(e.target.value)}
              placeholder="10"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Mín. pax por mesa *"
                type="number" min={1}
                value={paxMinCap}
                onChange={(e) => setPaxMinCap(e.target.value)}
                placeholder="2"
              />
              <Input
                label="Máx. pax por mesa *"
                type="number" min={1}
                value={paxMaxCap}
                onChange={(e) => setPaxMaxCap(e.target.value)}
                placeholder="5"
              />
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Cliente escolhe quantos vai. Sistema permite a reserva enquanto a
              soma das pessoas no slot não passar de {capacidadeMax || "—"} pax.
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800">
            <Input
              label="Quantas mesas no salão? *"
              type="number" min={1}
              value={numMesas}
              onChange={(e) => setNumMesas(e.target.value)}
              placeholder="6"
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Pax mín por mesa *"
                type="number" min={1}
                value={paxMin}
                onChange={(e) => setPaxMin(e.target.value)}
                placeholder="4"
              />
              <Input
                label="Pax máx por mesa *"
                type="number" min={1}
                value={paxMax}
                onChange={(e) => setPaxMax(e.target.value)}
                placeholder="6"
              />
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Sistema permite até {numMesas || "—"} reservas por slot, cada uma
              com {paxMin}–{paxMax} pessoas.
            </p>
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>{saving ? "..." : isNew ? "Criar" : "Salvar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
