import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, where, deleteDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { AdicionalPacote, CardapioPdf, EspacoEvento, PacoteEvento, PacotePrecoModo } from "../../core/types";
import { pacotePrecoLabel } from "../../core/types";

const MAX_CARDAPIOS = 3;
const MAX_PDF_MB = 20;

type Props = {
  rid: string;
  podeEditar: boolean;
};

export function PacotesTab({ rid, podeEditar }: Props) {
  const [espacos, setEspacos] = useState<EspacoEvento[]>([]);
  const [pacotes, setPacotes] = useState<PacoteEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "espacosEvento"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEspacos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as EspacoEvento));
      },
      (err) => {
        setErro(err.code === "permission-denied" ? "permission_denied" : (err.message || "Erro"));
      },
    );
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "pacotesEvento"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as PacoteEvento);
        list.sort((a, b) => a.ordem - b.ordem);
        setPacotes(list);
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

  const espacosAtivos = useMemo(() => espacos.filter(e => e.ativo), [espacos]);

  async function criarPacote() {
    if (!rid || !podeEditar) return;
    if (espacosAtivos.length === 0) {
      alert("Cadastre pelo menos um espaço antes de criar pacotes.");
      return;
    }
    const id = `${rid}_${Date.now()}`;
    const now = new Date().toISOString();
    const ordem = pacotes.length;
    const espaco = espacosAtivos[0];
    const novo: PacoteEvento = {
      id,
      restaurantId: rid,
      espacoId: espaco.id,
      nome: `Pacote ${String.fromCharCode(65 + ordem)}`, // A, B, C...
      descricao: "",
      tipo: "fixo",
      duracaoHoras: 4,
      precoModo: "por_pessoa",
      precoPorPessoa: 0,
      capacidadeMin: espaco.capacidadeMin,
      capacidadeMax: espaco.capacidadeMax,
      cardapios: [],
      adicionais: [],
      inclusos: [],
      naoInclusos: [],
      ativo: true,
      ordem,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, "pacotesEvento", id), sanitizeForFirestore(novo));
    setEditingId(id);
  }

  async function deletar(id: string) {
    if (!podeEditar) return;
    const ok = confirm("Apagar pacote? Propostas/leads que apontavam pra ele continuam existindo (histórico preservado), mas o pacote some da vitrine.");
    if (!ok) return;
    await deleteDoc(doc(db, "pacotesEvento", id));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">
          ⚠ Regras do Firestore não publicadas
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

  if (espacosAtivos.length === 0) {
    return (
      <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-sm">
        <p className="font-semibold text-amber-900 dark:text-amber-200">⚠ Cadastre um espaço primeiro</p>
        <p className="text-amber-800 dark:text-amber-300 mt-1 text-[13px]">
          Pacotes precisam estar vinculados a um espaço. Vai em <strong>Configurações</strong> e cadastra o seu primeiro espaço.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Pacotes</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Templates de evento. Cada pacote tem cardápio, duração e preço por pessoa — montar
            uma proposta significa partir de um deles e ajustar.
          </p>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={criarPacote}>+ Novo pacote</Button>
        )}
      </div>

      {pacotes.length === 0 ? (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 p-6 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">Nenhum pacote cadastrado ainda.</p>
          {podeEditar && (
            <Button size="sm" className="mt-3" onClick={criarPacote}>+ Cadastrar primeiro pacote</Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {pacotes.map(p => (
            <PacoteCard
              key={p.id}
              pacote={p}
              espacos={espacos}
              editing={editingId === p.id}
              podeEditar={podeEditar}
              onStartEdit={() => setEditingId(p.id)}
              onStopEdit={() => setEditingId(null)}
              onDelete={() => deletar(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PacoteCard({
  pacote, espacos, editing, podeEditar, onStartEdit, onStopEdit, onDelete,
}: {
  pacote: PacoteEvento;
  espacos: EspacoEvento[];
  editing: boolean;
  podeEditar: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onDelete: () => void;
}) {
  const espaco = espacos.find(e => e.id === pacote.espacoId);

  if (!editing) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-900 dark:text-gray-100">{pacote.nome}</span>
              <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
                pacote.tipo === "fixo"
                  ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                  : "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
              }`}>
                {pacote.tipo === "fixo" ? "fixo" : "personalizável"}
              </span>
              {!pacote.ativo && (
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                  inativo
                </span>
              )}
            </div>
            {pacote.descricao && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{pacote.descricao}</p>
            )}
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 space-y-0.5">
              <div>Espaço: {espaco?.nome || "—"}</div>
              <div>
                Duração: {pacote.duracaoHoras}h ·{" "}
                Capacidade: {pacote.capacidadeMin}–{pacote.capacidadeMax} pax ·{" "}
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                  {pacotePrecoLabel(pacote)}
                </span>
              </div>
              <div>
                {pacote.cardapios?.length || 0} PDF(s) de cardápio
                {(pacote.adicionais?.length || 0) > 0 && ` · ${pacote.adicionais!.length} adicional(is)`}
              </div>
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

  return (
    <PacoteEditor pacote={pacote} espacos={espacos} onClose={onStopEdit} onDelete={onDelete} />
  );
}

function PacoteEditor({
  pacote, espacos, onClose, onDelete,
}: {
  pacote: PacoteEvento;
  espacos: EspacoEvento[];
  onClose: () => void;
  onDelete: () => void;
}) {
  // Backfill defensivo: pacotes antigos no Firestore podem não ter o campo
  // `cardapios` (substituiu o `cardapio` legado). Garante array sempre.
  const [form, setForm] = useState<PacoteEvento>(() => ({
    ...pacote,
    cardapios: pacote.cardapios || [],
    adicionais: pacote.adicionais || [],
  }));
  const [saving, setSaving] = useState(false);
  const [novoIncluso, setNovoIncluso] = useState("");
  const [novoNaoIncluso, setNovoNaoIncluso] = useState("");
  // Form inline pra novo adicional. precoModo default = por_pessoa, mais comum
  // pra extras de catering (bolo, drink etc.). User pode trocar pra total_fixo.
  const [novoAdicional, setNovoAdicional] = useState<{ nome: string; preco: string; precoModo: "por_pessoa" | "total_fixo" }>({
    nome: "", preco: "", precoModo: "por_pessoa",
  });

  function addIncluso() {
    const v = novoIncluso.trim();
    if (!v) return;
    setForm(f => ({ ...f, inclusos: [...f.inclusos, v] }));
    setNovoIncluso("");
  }
  function delIncluso(i: number) {
    setForm(f => ({ ...f, inclusos: f.inclusos.filter((_, idx) => idx !== i) }));
  }
  function addNaoIncluso() {
    const v = novoNaoIncluso.trim();
    if (!v) return;
    setForm(f => ({ ...f, naoInclusos: [...f.naoInclusos, v] }));
    setNovoNaoIncluso("");
  }
  function delNaoIncluso(i: number) {
    setForm(f => ({ ...f, naoInclusos: f.naoInclusos.filter((_, idx) => idx !== i) }));
  }
  function addCardapio(novo: CardapioPdf) {
    setForm(f => ({ ...f, cardapios: [...(f.cardapios || []), novo] }));
  }
  function updateCardapioNome(id: string, nome: string) {
    setForm(f => ({
      ...f,
      cardapios: (f.cardapios || []).map(c => c.id === id ? { ...c, nome } : c),
    }));
  }
  function addAdicional() {
    const nome = novoAdicional.nome.trim();
    const preco = parseFloat(novoAdicional.preco.replace(",", ".")) || 0;
    if (!nome) return;
    const item: AdicionalPacote = {
      id: `ad_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      nome,
      precoModo: novoAdicional.precoModo,
      preco,
      ordem: (form.adicionais || []).length,
    };
    setForm(f => ({ ...f, adicionais: [...(f.adicionais || []), item] }));
    setNovoAdicional({ nome: "", preco: "", precoModo: novoAdicional.precoModo });
  }
  function delAdicional(id: string) {
    setForm(f => ({ ...f, adicionais: (f.adicionais || []).filter(a => a.id !== id) }));
  }

  async function delCardapio(id: string) {
    const alvo = (form.cardapios || []).find(c => c.id === id);
    if (!alvo) return;
    if (!confirm("Apagar esse PDF? Propostas já enviadas continuam apontando pro arquivo original — esse apaga só do template.")) return;
    // Tenta apagar do Storage também (best effort). Se falhar, segue —
    // o arquivo vira órfão mas não bloqueia o user.
    try {
      const path = `pacotes-cardapios/${form.restaurantId}/${form.id}/${id}.pdf`;
      await deleteObject(storageRef(storage, path));
    } catch { /* arquivo já não existe ou path mudou — silent */ }
    setForm(f => ({ ...f, cardapios: (f.cardapios || []).filter(c => c.id !== id) }));
  }

  async function salvar() {
    if (!form.nome.trim()) {
      alert("Nome do pacote é obrigatório");
      return;
    }
    setSaving(true);
    try {
      // Garante que campo de preço não-usado vai zerado pra Firestore,
      // evita confusão na consulta (ex: pacote total_fixo com precoPorPessoa
      // residual de quando era "por pessoa").
      const modo = form.precoModo || "por_pessoa";
      const payload: PacoteEvento = {
        ...form,
        nome: form.nome.trim(),
        descricao: form.descricao.trim(),
        capacidadeMin: Math.max(1, form.capacidadeMin),
        capacidadeMax: Math.max(form.capacidadeMin, form.capacidadeMax),
        precoModo: modo,
        precoPorPessoa: modo === "por_pessoa" ? Math.max(0, form.precoPorPessoa) : 0,
        precoTotal: modo === "total_fixo" ? Math.max(0, form.precoTotal || 0) : undefined,
        duracaoHoras: Math.max(0.5, form.duracaoHoras),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, "pacotesEvento", form.id), sanitizeForFirestore(payload));
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
        <h3 className="font-bold text-gray-900 dark:text-gray-100">Editar pacote</h3>
        <button onClick={onDelete} className="text-xs text-rose-600 hover:underline">apagar</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Nome *"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          placeholder="Pacote A — Aniversário"
        />
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Espaço
          </label>
          <select
            value={form.espacoId}
            onChange={(e) => setForm({ ...form, espacoId: e.target.value })}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          >
            {espacos.map(e => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Descrição
        </label>
        <textarea
          value={form.descricao}
          onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          rows={2}
          placeholder="Descrição que vai pra proposta do cliente"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Tipo
          </label>
          <select
            value={form.tipo}
            onChange={(e) => setForm({ ...form, tipo: e.target.value as PacoteEvento["tipo"] })}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            title="Fixo = cliente escolhe direto. Personalizável = vendedor monta a partir do zero."
          >
            <option value="fixo">Fixo</option>
            <option value="personalizavel">Personalizável</option>
          </select>
        </div>
        <Input
          label="Duração (h)"
          type="number"
          step="0.5"
          value={String(form.duracaoHoras)}
          onChange={(e) => setForm({ ...form, duracaoHoras: parseFloat(e.target.value) || 0 })}
        />
        <div className="sm:col-span-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Status
          </label>
          <button
            type="button"
            onClick={() => setForm({ ...form, ativo: !form.ativo })}
            className={`mt-1 w-full px-3 py-2 rounded-lg text-sm font-medium border ${
              form.ativo
                ? "bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300"
                : "bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300"
            }`}
          >
            {form.ativo ? "Ativo" : "Inativo"}
          </button>
        </div>
      </div>

      {/* Modelo de cobrança — separado em bloco próprio porque é decisão estrutural */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-white dark:bg-gray-900/40">
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
          Modelo de cobrança
        </label>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
          {([
            { v: "por_pessoa", titulo: "Por pessoa", desc: "Multiplica pelo nº de convidados" },
            { v: "total_fixo", titulo: "Total fixo", desc: "Valor fechado (ex: locação cheia)" },
            { v: "personalizado", titulo: "Personalizado", desc: "Sem preço de tabela — vendedor monta" },
          ] as { v: PacotePrecoModo; titulo: string; desc: string }[]).map(opt => {
            const ativo = (form.precoModo || "por_pessoa") === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => setForm(f => ({ ...f, precoModo: opt.v }))}
                className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                  ativo
                    ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700"
                    : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:border-indigo-200"
                }`}
              >
                <div className={`font-semibold text-sm ${ativo ? "text-indigo-800 dark:text-indigo-300" : "text-gray-900 dark:text-gray-100"}`}>
                  {opt.titulo}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-3">
          {(form.precoModo || "por_pessoa") === "por_pessoa" && (
            <Input
              label="Preço / pax R$"
              type="number"
              step="0.01"
              value={String(form.precoPorPessoa)}
              onChange={(e) => setForm({ ...form, precoPorPessoa: parseFloat(e.target.value) || 0 })}
            />
          )}
          {form.precoModo === "total_fixo" && (
            <Input
              label="Valor total R$"
              type="number"
              step="0.01"
              value={String(form.precoTotal || 0)}
              onChange={(e) => setForm({ ...form, precoTotal: parseFloat(e.target.value) || 0 })}
            />
          )}
          {form.precoModo === "personalizado" && (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">
              Sem valor de tabela. Em cada proposta o vendedor define o preço a partir das características do evento.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
      </div>

      {/* Cardápio */}
      {/* Cardápios PDF — até 3 anexos. Cada um com nome editável.
          Cliente recebe esses links direto no WhatsApp na hora da proposta. */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Cardápios (PDF) · até {MAX_CARDAPIOS}
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          Suba os PDFs montados/diagramados. O cliente vai receber os links na hora da proposta. Máx {MAX_PDF_MB}MB cada.
        </p>
        <div className="mt-2 space-y-2">
          {(form.cardapios || []).map(c => (
            <CardapioPdfRow
              key={c.id}
              cardapio={c}
              onNomeChange={(nome) => updateCardapioNome(c.id, nome)}
              onDelete={() => delCardapio(c.id)}
            />
          ))}
          {(form.cardapios || []).length < MAX_CARDAPIOS && (
            <CardapioPdfUploader
              restaurantId={form.restaurantId}
              pacoteId={form.id}
              proximaOrdem={(form.cardapios || []).length}
              onUploaded={addCardapio}
            />
          )}
        </div>
      </div>

      {/* Adicionais — extras opcionais que o vendedor marca por proposta */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Adicionais opcionais
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          Extras que o vendedor pode marcar na hora da proposta. Ex: "Hora extra", "DJ", "Bolo".
        </p>
        <div className="mt-2 space-y-1.5">
          {(form.adicionais || []).map(a => (
            <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-sm">
              <span className="text-base">➕</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-gray-100">{a.nome}</div>
                <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  R$ {a.preco.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  {a.precoModo === "por_pessoa" ? " /pessoa" : " (total)"}
                </div>
              </div>
              <button onClick={() => delAdicional(a.id)} className="text-xs text-rose-600 hover:underline shrink-0">apagar</button>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-[1fr_110px_140px_auto] gap-1.5 items-center">
          <input
            value={novoAdicional.nome}
            onChange={(e) => setNovoAdicional(n => ({ ...n, nome: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAdicional(); } }}
            placeholder="Nome (ex: Hora extra)"
            className="w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <input
            value={novoAdicional.preco}
            onChange={(e) => setNovoAdicional(n => ({ ...n, preco: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAdicional(); } }}
            placeholder="R$"
            type="number"
            step="0.01"
            className="w-full px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <select
            value={novoAdicional.precoModo}
            onChange={(e) => setNovoAdicional(n => ({ ...n, precoModo: e.target.value as "por_pessoa" | "total_fixo" }))}
            className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          >
            <option value="por_pessoa">por pessoa</option>
            <option value="total_fixo">total fixo</option>
          </select>
          <Button size="sm" variant="secondary" onClick={addAdicional}>+ adicionar</Button>
        </div>
      </div>

      {/* Inclusos */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Inclusos
        </label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {form.inclusos.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs">
              ✓ {r}
              <button onClick={() => delIncluso(i)} className="hover:text-rose-600">✕</button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <input
            value={novoIncluso}
            onChange={(e) => setNovoIncluso(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addIncluso(); } }}
            placeholder="ex: som ambiente"
            className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <Button size="sm" variant="secondary" onClick={addIncluso}>+ adicionar</Button>
        </div>
      </div>

      {/* Não inclusos */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Não inclusos (deixar explícito pro cliente)
        </label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {form.naoInclusos.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs">
              ✗ {r}
              <button onClick={() => delNaoIncluso(i)} className="hover:text-rose-900">✕</button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5">
          <input
            value={novoNaoIncluso}
            onChange={(e) => setNovoNaoIncluso(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNaoIncluso(); } }}
            placeholder="ex: bolo, DJ"
            className="flex-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
          <Button size="sm" variant="secondary" onClick={addNaoIncluso}>+ adicionar</Button>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-indigo-200 dark:border-indigo-800">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
      </div>
    </div>
  );
}

// Linha pra um PDF já enviado: nome editável inline + link "ver" + apagar.
function CardapioPdfRow({
  cardapio, onNomeChange, onDelete,
}: {
  cardapio: CardapioPdf;
  onNomeChange: (nome: string) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
      <span className="text-base">📄</span>
      <input
        value={cardapio.nome}
        onChange={(e) => onNomeChange(e.target.value)}
        placeholder="Ex: Comidas e bebidas"
        className="flex-1 min-w-0 px-2 py-1 rounded border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-indigo-300 focus:outline-none text-sm bg-transparent"
      />
      <a
        href={cardapio.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-indigo-600 hover:underline shrink-0"
      >
        ver PDF
      </a>
      <button onClick={onDelete} className="text-xs text-rose-600 hover:underline shrink-0 ml-1">
        apagar
      </button>
    </div>
  );
}

// Card de upload — input file + progress bar. Quando termina, chama onUploaded
// com o CardapioPdf pronto pra adicionar ao state do pacote.
function CardapioPdfUploader({
  restaurantId, pacoteId, proximaOrdem, onUploaded,
}: {
  restaurantId: string;
  pacoteId: string;
  proximaOrdem: number;
  onUploaded: (c: CardapioPdf) => void;
}) {
  const { pessoa: me } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  function escolher() {
    inputRef.current?.click();
  }

  function upload(file: File) {
    setErro("");
    if (file.type !== "application/pdf") {
      setErro("Só PDF.");
      return;
    }
    const mb = file.size / (1024 * 1024);
    if (mb > MAX_PDF_MB) {
      setErro(`Arquivo muito grande (${mb.toFixed(1)} MB). Máximo: ${MAX_PDF_MB} MB.`);
      return;
    }
    setUploading(true);
    setProgresso(0);

    const id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // Path determinístico por restaurante + pacote + id. Permite apagar
    // depois sem precisar guardar storagePath separado.
    const path = `pacotes-cardapios/${restaurantId}/${pacoteId}/${id}.pdf`;
    const ref = storageRef(storage, path);
    const task = uploadBytesResumable(ref, file, {
      contentType: "application/pdf",
      customMetadata: { restaurantId, pacoteId, uploadedBy: me?.id || "" },
    });

    task.on(
      "state_changed",
      (snap) => {
        setProgresso(Math.max(5, Math.round((snap.bytesTransferred / snap.totalBytes) * 100)));
      },
      (err) => {
        console.error("Storage upload error:", err);
        const cod = (err as { code?: string }).code || "";
        if (cod.includes("unauthorized") || cod.includes("permission")) {
          setErro(
            "Sem permissão pra subir. Regras do Storage podem não estar publicadas: " +
            "firebase deploy --only storage --project gestaocentral",
          );
        } else {
          setErro(err.message || "Erro ao enviar");
        }
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          const nomeBase = file.name.replace(/\.pdf$/i, "").slice(0, 60);
          onUploaded({
            id,
            nome: nomeBase || "Cardápio",
            url,
            uploadedAt: new Date().toISOString(),
            uploadedBy: me?.id,
            ordem: proximaOrdem,
          });
          setProgresso(100);
        } catch (e) {
          console.error(e);
          setErro(e instanceof Error ? e.message : "Erro ao salvar");
        } finally {
          setUploading(false);
          if (inputRef.current) inputRef.current.value = "";
        }
      },
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
      />
      <button
        type="button"
        onClick={escolher}
        disabled={uploading}
        className="w-full px-3 py-2 rounded-lg border border-dashed border-indigo-300 dark:border-indigo-700 text-sm text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-500 transition-colors disabled:opacity-60"
      >
        {uploading ? `Enviando... ${progresso}%` : "+ Adicionar PDF de cardápio"}
      </button>
      {erro && (
        <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{erro}</div>
      )}
    </div>
  );
}
