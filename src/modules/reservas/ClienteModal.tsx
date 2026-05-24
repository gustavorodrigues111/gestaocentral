import { useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { upsertClienteLookup } from "./clienteLookup";
import type { Cliente } from "../../core/types";

type Props = {
  cliente: Cliente | null;
  restaurantId: string;
  onClose: () => void;
  onCreated?: (id: string, nome: string) => void;
};

const TAGS_SUGERIDAS = ["VIP", "Frequente", "Aniversariante", "Influenciador", "Imprensa", "Empresarial", "Família"];

export function ClienteModal({ cliente, restaurantId, onClose, onCreated }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !cliente;

  const [nome, setNome] = useState(cliente?.nome || "");
  const [telefone, setTelefone] = useState(cliente?.telefone || "");
  const [email, setEmail] = useState(cliente?.email || "");
  // Aniversário: aceita MM-DD ou YYYY-MM-DD
  const [aniversario, setAniversario] = useState(
    cliente?.aniversario && cliente.aniversario.length > 5
      ? cliente.aniversario.slice(5)
      : (cliente?.aniversario || "")
  );
  const [observacoes, setObservacoes] = useState(cliente?.observacoes || "");
  const [restricoes, setRestricoes] = useState(cliente?.restricoesAlimentares || "");
  const [tags, setTags] = useState<string[]>(cliente?.tags || []);
  const [novaTag, setNovaTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function toggleTag(t: string) {
    setTags(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t]);
  }
  function adicionarTag() {
    const t = novaTag.trim();
    if (!t) return;
    if (!tags.includes(t)) setTags([...tags, t]);
    setNovaTag("");
  }

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Omit<Cliente, "id"> = {
        restaurantId,
        nome: nome.trim(),
        telefone: telefone.trim() || undefined,
        email: email.trim() || undefined,
        aniversario: aniversario.trim() || null,
        observacoes: observacoes.trim() || undefined,
        restricoesAlimentares: restricoes.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        totalReservas: cliente?.totalReservas ?? 0,
        totalCompareceu: cliente?.totalCompareceu ?? 0,
        totalNoShow: cliente?.totalNoShow ?? 0,
        ultimaVisita: cliente?.ultimaVisita ?? null,
        criadoEm: cliente?.criadoEm || now,
        criadoPor: cliente?.criadoPor || me.id,
        atualizadoEm: now,
      };
      let clienteId: string;
      if (isNew) {
        const ref = await addDoc(collection(db, "clientes"), sanitizeForFirestore(payload));
        clienteId = ref.id;
        onCreated?.(ref.id, nome.trim());
      } else {
        clienteId = cliente.id;
        await updateDoc(doc(db, "clientes", cliente.id), sanitizeForFirestore(payload));
      }
      // Propaga pro lookup público — assim o form de reservas reconhece
      // clientes que o admin cadastrou/editou manualmente.
      try {
        await upsertClienteLookup({
          restaurantId,
          telefone: payload.telefone,
          nome: payload.nome,
          email: payload.email,
          clienteId,
        });
      } catch (e) {
        // Não bloqueia o save do cliente — só loga.
        console.warn("[cliente] lookup upsert falhou:", e);
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
    <Modal title={isNew ? "+ Novo cliente" : `Editar — ${cliente.nome}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Maria Silva"
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Telefone"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="(11) 99999-9999"
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Aniversário (MM-DD)</label>
          <Input
            value={aniversario}
            onChange={(e) => setAniversario(e.target.value)}
            placeholder="ex: 03-25 (25 de março)"
          />
          <p className="text-[10px] text-gray-500 mt-0.5">Formato MM-DD (ano não é necessário). Permite alerta no dia.</p>
        </div>

        <Input
          label="Restrições alimentares"
          value={restricoes}
          onChange={(e) => setRestricoes(e.target.value)}
          placeholder="ex: alérgico a camarão, vegano"
        />

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observações</label>
          <textarea
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={2}
            placeholder="ex: gosta de mesa próxima da janela, indicado pelo Sr. João..."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
          />
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            Tags
          </label>
          <div className="flex gap-2 flex-wrap mb-2">
            {TAGS_SUGERIDAS.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                  tags.includes(t)
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                    : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50"
                }`}
              >
                {tags.includes(t) ? "✓ " : ""}{t}
              </button>
            ))}
          </div>
          {tags.filter(t => !TAGS_SUGERIDAS.includes(t)).length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {tags.filter(t => !TAGS_SUGERIDAS.includes(t)).map(t => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                >
                  {t}
                  <button type="button" onClick={() => toggleTag(t)} className="hover:text-rose-700">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={novaTag}
              onChange={(e) => setNovaTag(e.target.value)}
              placeholder="+ Tag custom"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarTag(); } }}
              className="flex-1"
            />
            <Button variant="secondary" onClick={adicionarTag} disabled={!novaTag.trim()}>+</Button>
          </div>
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : isNew ? "Criar cliente" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
