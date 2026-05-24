import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, where, deleteDoc, getDocs } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { EspacoEvento, FaixaCancelamento } from "../../core/types";

// Default da política de cancelamento (gradiente semanal acordado com cliente)
const POLITICA_DEFAULT: FaixaCancelamento[] = [
  { diasAntesMin: 30, percentDevolucao: 100 },
  { diasAntesMin: 14, percentDevolucao: 75 },
  { diasAntesMin: 7,  percentDevolucao: 50 },
  { diasAntesMin: 0,  percentDevolucao: 0 },
];

type Props = {
  rid: string;
  podeEditar: boolean;
};

export function EspacoConfigTab({ rid, podeEditar }: Props) {
  const [espacos, setEspacos] = useState<EspacoEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "espacosEvento"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as EspacoEvento);
        list.sort((a, b) => a.nome.localeCompare(b.nome));
        setEspacos(list);
        setLoading(false);
        setErro("");
      },
      (err) => {
        setLoading(false);
        setErro(err.code === "permission-denied" ? "permission_denied" : (err.message || "Erro"));
      },
    );
    return () => unsub();
  }, [rid]);

  async function criarEspaco() {
    if (!rid || !podeEditar) return;
    const id = `${rid}_${Date.now()}`;
    const now = new Date().toISOString();
    const novo: EspacoEvento = {
      id,
      restaurantId: rid,
      nome: "Novo espaço",
      capacidadeMin: 10,
      capacidadeMax: 50,
      permiteDoisEventosNoDia: false,
      recursosInclusos: [],
      recursosOpcionais: [],
      politicaCancelamento: { faixas: POLITICA_DEFAULT, noShowPercent: 0 },
      ativo: true,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, "espacosEvento", id), sanitizeForFirestore(novo));
    setEditingId(id);
  }

  async function deletarEspaco(id: string) {
    if (!podeEditar) return;
    const ok = confirm(
      "Apagar este espaço?\n\n" +
      "Pacotes vinculados a ele ficam órfãos (não somem, mas precisam ser " +
      "reatribuídos). Eventos confirmados não são afetados (o histórico fica)."
    );
    if (!ok) return;
    // Verifica se tem pacote vinculado
    const pacotesQ = query(collection(db, "pacotesEvento"), where("espacoId", "==", id));
    const pacotesSnap = await getDocs(pacotesQ);
    if (pacotesSnap.size > 0) {
      const ok2 = confirm(
        `Esse espaço tem ${pacotesSnap.size} pacote(s) vinculado(s). ` +
        `Apagar mesmo assim?`
      );
      if (!ok2) return;
    }
    await deleteDoc(doc(db, "espacosEvento", id));
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Carregando...</div>;
  }
  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">
          ⚠ Regras do Firestore não publicadas
        </p>
        <p className="text-rose-800 dark:text-rose-300 text-[13px]">
          Rode no terminal:
        </p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border border-rose-200 dark:border-rose-700 text-rose-900 dark:text-rose-200">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (erro) {
    return <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">⚠ {erro}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Espaços</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Cadastre o(s) ambiente(s) que recebem eventos. Cada pacote
            é vinculado a um espaço.
          </p>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={criarEspaco}>+ Novo espaço</Button>
        )}
      </div>

      {espacos.length === 0 ? (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 p-6 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Nenhum espaço cadastrado ainda.
          </p>
          {podeEditar && (
            <Button size="sm" className="mt-3" onClick={criarEspaco}>
              + Cadastrar primeiro espaço
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {espacos.map(esp => (
            <EspacoCard
              key={esp.id}
              espaco={esp}
              editing={editingId === esp.id}
              podeEditar={podeEditar}
              onStartEdit={() => setEditingId(esp.id)}
              onStopEdit={() => setEditingId(null)}
              onDelete={() => deletarEspaco(esp.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EspacoCard({
  espaco, editing, podeEditar, onStartEdit, onStopEdit, onDelete,
}: {
  espaco: EspacoEvento;
  editing: boolean;
  podeEditar: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onDelete: () => void;
}) {
  if (!editing) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-bold text-gray-900 dark:text-gray-100">
              {espaco.nome}
              {!espaco.ativo && (
                <span className="ml-2 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                  inativo
                </span>
              )}
            </div>
            {espaco.descricao && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{espaco.descricao}</p>
            )}
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 space-y-0.5">
              <div>Capacidade: {espaco.capacidadeMin}–{espaco.capacidadeMax} pax</div>
              {espaco.permiteDoisEventosNoDia && (
                <div>✓ Permite 2 eventos/dia (almoço + jantar)</div>
              )}
              {espaco.recursosInclusos.length > 0 && (
                <div>Inclui: {espaco.recursosInclusos.join(", ")}</div>
              )}
              {espaco.recursosOpcionais.length > 0 && (
                <div>Opcionais: {espaco.recursosOpcionais.map(r => `${r.nome} (R$ ${r.valor})`).join(", ")}</div>
              )}
            </div>
          </div>
          {podeEditar && (
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="secondary" onClick={onStartEdit}>Editar</Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <EspacoEditor espaco={espaco} onClose={onStopEdit} onDelete={onDelete} />;
}

function EspacoEditor({
  espaco, onClose, onDelete,
}: {
  espaco: EspacoEvento;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState<EspacoEvento>(espaco);
  const [saving, setSaving] = useState(false);
  const [novoRecursoIncluso, setNovoRecursoIncluso] = useState("");
  const [novoOpcionalNome, setNovoOpcionalNome] = useState("");
  const [novoOpcionalValor, setNovoOpcionalValor] = useState("");

  function addRecursoIncluso() {
    const v = novoRecursoIncluso.trim();
    if (!v) return;
    setForm(f => ({ ...f, recursosInclusos: [...f.recursosInclusos, v] }));
    setNovoRecursoIncluso("");
  }
  function delRecursoIncluso(i: number) {
    setForm(f => ({ ...f, recursosInclusos: f.recursosInclusos.filter((_, idx) => idx !== i) }));
  }
  function addOpcional() {
    const nome = novoOpcionalNome.trim();
    const valor = parseFloat(novoOpcionalValor.replace(",", ".")) || 0;
    if (!nome) return;
    setForm(f => ({ ...f, recursosOpcionais: [...f.recursosOpcionais, { nome, valor }] }));
    setNovoOpcionalNome(""); setNovoOpcionalValor("");
  }
  function delOpcional(i: number) {
    setForm(f => ({ ...f, recursosOpcionais: f.recursosOpcionais.filter((_, idx) => idx !== i) }));
  }
  function setFaixa(idx: number, campo: "diasAntesMin" | "percentDevolucao", v: number) {
    setForm(f => ({
      ...f,
      politicaCancelamento: {
        ...f.politicaCancelamento,
        faixas: f.politicaCancelamento.faixas.map((fa, i) => i === idx ? { ...fa, [campo]: v } : fa),
      },
    }));
  }
  function addFaixa() {
    setForm(f => ({
      ...f,
      politicaCancelamento: {
        ...f.politicaCancelamento,
        faixas: [...f.politicaCancelamento.faixas, { diasAntesMin: 0, percentDevolucao: 0 }],
      },
    }));
  }
  function delFaixa(idx: number) {
    setForm(f => ({
      ...f,
      politicaCancelamento: {
        ...f.politicaCancelamento,
        faixas: f.politicaCancelamento.faixas.filter((_, i) => i !== idx),
      },
    }));
  }

  async function salvar() {
    if (!form.nome.trim()) {
      alert("Nome do espaço é obrigatório");
      return;
    }
    setSaving(true);
    try {
      // Ordena faixas desc por diasAntesMin (regra de negócio)
      const faixasOrdenadas = [...form.politicaCancelamento.faixas]
        .sort((a, b) => b.diasAntesMin - a.diasAntesMin);
      const payload: EspacoEvento = {
        ...form,
        nome: form.nome.trim(),
        descricao: form.descricao?.trim() || "",
        capacidadeMin: Math.max(1, form.capacidadeMin),
        capacidadeMax: Math.max(form.capacidadeMin, form.capacidadeMax),
        politicaCancelamento: {
          ...form.politicaCancelamento,
          faixas: faixasOrdenadas,
        },
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, "espacosEvento", form.id), sanitizeForFirestore(payload));
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-indigo-300 dark:border-indigo-700 p-4 bg-indigo-50/30 dark:bg-indigo-900/10 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-gray-900 dark:text-gray-100">Editar espaço</h3>
        <button onClick={onDelete} className="text-xs text-rose-600 hover:underline">apagar</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Nome *"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          placeholder="Laje do Lobozó"
        />
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Status
          </label>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, ativo: !form.ativo })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                form.ativo
                  ? "bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300"
                  : "bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300"
              }`}
            >
              {form.ativo ? "Ativo" : "Inativo"}
            </button>
          </div>
        </div>
      </div>

      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Descrição
        </label>
        <textarea
          value={form.descricao || ""}
          onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          rows={2}
          placeholder="Rooftop com vista, capacidade pra coquetel ou jantar..."
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          label="Capacidade mínima"
          type="number"
          value={String(form.capacidadeMin)}
          onChange={(e) => setForm({ ...form, capacidadeMin: parseInt(e.target.value) || 0 })}
        />
        <Input
          label="Capacidade máxima"
          type="number"
          value={String(form.capacidadeMax)}
          onChange={(e) => setForm({ ...form, capacidadeMax: parseInt(e.target.value) || 0 })}
        />
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            2 eventos/dia?
          </label>
          <button
            type="button"
            onClick={() => setForm({ ...form, permiteDoisEventosNoDia: !form.permiteDoisEventosNoDia })}
            className={`mt-1 w-full px-3 py-2 rounded-lg text-sm font-medium border ${
              form.permiteDoisEventosNoDia
                ? "bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300"
                : "bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300"
            }`}
            title="Quando ligado, valida 1 almoço + 1 jantar no mesmo dia. Quando desligado, máximo 1 evento por dia."
          >
            {form.permiteDoisEventosNoDia ? "✓ Permite" : "Apenas 1/dia"}
          </button>
        </div>
      </div>

      {/* Recursos inclusos */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Recursos inclusos
        </label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {form.recursosInclusos.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs">
              ✓ {r}
              <button onClick={() => delRecursoIncluso(i)} className="hover:text-rose-600">✕</button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <input
            value={novoRecursoIncluso}
            onChange={(e) => setNovoRecursoIncluso(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecursoIncluso(); } }}
            placeholder="ex: caixa de som"
            className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <Button size="sm" variant="secondary" onClick={addRecursoIncluso}>+ adicionar</Button>
        </div>
      </div>

      {/* Recursos opcionais com valor */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Recursos opcionais (cobrados à parte)
        </label>
        <div className="mt-1 space-y-1.5">
          {form.recursosOpcionais.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{r.nome}</span>
              <span className="tabular-nums text-gray-600 dark:text-gray-400">R$ {r.valor.toFixed(2)}</span>
              <button onClick={() => delOpcional(i)} className="text-rose-600 hover:underline text-xs">apagar</button>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-[1fr_120px_auto] gap-1.5">
          <input
            value={novoOpcionalNome}
            onChange={(e) => setNovoOpcionalNome(e.target.value)}
            placeholder="ex: projetor"
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <input
            value={novoOpcionalValor}
            onChange={(e) => setNovoOpcionalValor(e.target.value)}
            placeholder="valor R$"
            className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <Button size="sm" variant="secondary" onClick={addOpcional}>+ adicionar</Button>
        </div>
      </div>

      {/* Política de cancelamento */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Política de cancelamento (devolução do sinal)
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          Pra cada faixa, "diasAntesMin" = qtde mínima de dias antes do evento.
          Faixas são avaliadas da maior pra menor — primeira que casa vence.
        </p>
        <div className="mt-2 space-y-1.5">
          {form.politicaCancelamento.faixas.map((fa, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">≥</span>
              <input
                type="number"
                value={fa.diasAntesMin}
                onChange={(e) => setFaixa(i, "diasAntesMin", parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm tabular-nums"
              />
              <span className="text-gray-500">dias antes →</span>
              <input
                type="number"
                value={fa.percentDevolucao}
                onChange={(e) => setFaixa(i, "percentDevolucao", parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm tabular-nums"
              />
              <span className="text-gray-500">% devolve</span>
              <button onClick={() => delFaixa(i)} className="ml-auto text-rose-600 hover:underline text-xs">apagar</button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={addFaixa}>+ faixa</Button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span>No-show (evento no dia, cliente não veio):</span>
          <input
            type="number"
            value={form.politicaCancelamento.noShowPercent}
            onChange={(e) => setForm({
              ...form,
              politicaCancelamento: { ...form.politicaCancelamento, noShowPercent: parseInt(e.target.value) || 0 },
            })}
            className="w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm tabular-nums"
          />
          <span>% devolve</span>
        </div>
      </div>

      {/* Observações */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Observações (uso interno)
        </label>
        <textarea
          value={form.observacoes || ""}
          onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          rows={2}
          placeholder="ex: música ao vivo só até 22h por lei municipal"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-indigo-200 dark:border-indigo-800">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
      </div>
    </div>
  );
}
