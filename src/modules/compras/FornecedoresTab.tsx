import { useMemo, useState } from "react";
import { Building2, Smartphone, Mail, MessageSquare, Ban, Check, GitMerge, Sparkles } from "lucide-react";
import { addDoc, collection, deleteDoc, doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";
import { normalizar, tituloCaso, levenshtein } from "../contagens/sugestoesRecebimento";
import type { Fornecedor, Insumo } from "../../core/types";

type Props = {
  fornecedores: Fornecedor[];
  insumos?: Insumo[];
  restaurantId: string;
  podeConfig: boolean;
};

export function FornecedoresTab({ fornecedores, insumos = [], restaurantId, podeConfig }: Props) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Fornecedor | "new" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const abrirWhatsapp = useAbrirWhatsapp();

  // Clusters de possíveis DUPLICADOS: mesmo nome normalizado (caixa/acento) OU
  // muito parecido (1-2 letras, ex.: "Sobrinho" vs "Sorrinho").
  const duplicados = useMemo(() => {
    const fs = fornecedores;
    if (fs.length < 2) return [] as Fornecedor[][];
    const norm = fs.map(f => normalizar(f.nome));
    const parent = fs.map((_, i) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      const a = norm[i], b = norm[j];
      if (a === b) { parent[find(i)] = find(j); continue; }   // idêntico (caixa/acento)
      const lim = Math.max(a.length, b.length);
      if (lim >= 5 && levenshtein(a, b) <= 2 && levenshtein(a, b) / lim <= 0.25) parent[find(i)] = find(j);
    }
    const m = new Map<number, Fornecedor[]>();
    fs.forEach((f, i) => { const r = find(i); (m.get(r) || m.set(r, []).get(r)!).push(f); });
    return [...m.values()].filter(c => c.length >= 2);
  }, [fornecedores]);

  // Nomes fora do padrão (não são "Primeira Maiúscula") — pra o botão Padronizar.
  const foraPadrao = useMemo(() => fornecedores.filter(f => f.nome !== tituloCaso(f.nome)), [fornecedores]);

  // Padroniza os nomes (tituloCaso) de todos os que estão fora do padrão.
  async function padronizarNomes() {
    if (foraPadrao.length === 0) return;
    if (!confirm(`Padronizar ${foraPadrao.length} nome(s) para "Primeira Maiúscula, resto minúsculo"?`)) return;
    setOcupado(true);
    try {
      const batch = writeBatch(db);
      for (const f of foraPadrao) batch.update(doc(db, "fornecedores", f.id), { nome: tituloCaso(f.nome) });
      await batch.commit();
    } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : "?")); }
    finally { setOcupado(false); }
  }

  // Mescla um cluster num sobrevivente (mais completo). Repointa os insumos
  // vinculados (fornecedorPreferredId + fornecedores[]) e exclui os duplicados.
  async function mesclarCluster(cluster: Fornecedor[]) {
    const score = (f: Fornecedor) => (f.whatsapp ? 1 : 0) + (f.email ? 1 : 0) + (f.observacoes ? 1 : 0) + (f.ativo ? 1 : 0);
    const sobrev = [...cluster].sort((a, b) => score(b) - score(a))[0];
    const dupes = cluster.filter(f => f.id !== sobrev.id);
    const nomeFinal = tituloCaso(sobrev.nome);
    if (!confirm(`Mesclar ${cluster.length} fornecedores em "${nomeFinal}"?\n\nOs insumos vinculados passam pra ele e os outros ${dupes.length} são excluídos. Pedidos antigos preservam o nome que tinham.`)) return;
    setOcupado(true);
    try {
      const dupeIds = new Set(dupes.map(d => d.id));
      const patch: Partial<Fornecedor> = { nome: nomeFinal };
      if (!sobrev.whatsapp) { const d = dupes.find(x => x.whatsapp); if (d) patch.whatsapp = d.whatsapp; }
      if (!sobrev.email) { const d = dupes.find(x => x.email); if (d) patch.email = d.email; }
      if (!sobrev.observacoes) { const d = dupes.find(x => x.observacoes); if (d) patch.observacoes = d.observacoes; }
      const batch = writeBatch(db);
      batch.update(doc(db, "fornecedores", sobrev.id), sanitizeForFirestore(patch));
      for (const ins of insumos) {
        const upd: Record<string, unknown> = {};
        if (ins.fornecedorPreferredId && dupeIds.has(ins.fornecedorPreferredId)) upd.fornecedorPreferredId = sobrev.id;
        if ((ins.fornecedores || []).some(x => x.fornecedorId && dupeIds.has(x.fornecedorId))) {
          upd.fornecedores = (ins.fornecedores || []).map(x => x.fornecedorId && dupeIds.has(x.fornecedorId) ? { ...x, fornecedorId: sobrev.id, nome: nomeFinal } : x);
        }
        if (Object.keys(upd).length) batch.update(doc(db, "insumos", ins.id), sanitizeForFirestore(upd));
      }
      for (const d of dupes) batch.delete(doc(db, "fornecedores", d.id));
      await batch.commit();
    } catch (e) { alert("Erro ao mesclar: " + (e instanceof Error ? e.message : "?")); }
    finally { setOcupado(false); }
  }

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
        <div className="flex items-center gap-2">
          {podeConfig && foraPadrao.length > 0 && (
            <Button variant="secondary" onClick={() => void padronizarNomes()} disabled={ocupado} title="Corrige a caixa dos nomes (Primeira Maiúscula, resto minúsculo)">
              <span className="inline-flex items-center gap-1.5"><Sparkles size={14} /> Padronizar nomes ({foraPadrao.length})</span>
            </Button>
          )}
          {podeConfig && <Button onClick={() => setEditing("new")}>+ Novo fornecedor</Button>}
        </div>
      </div>

      {/* Possíveis duplicados — mesmo nome (caixa/acento) ou muito parecido. */}
      {podeConfig && duplicados.length > 0 && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-900/10 p-3 space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300 inline-flex items-center gap-1"><GitMerge size={12} /> Possíveis duplicados ({duplicados.length})</div>
          {duplicados.map((cluster, i) => (
            <div key={i} className="flex items-center justify-between gap-2 flex-wrap text-[13px] bg-white dark:bg-gray-900 rounded-md border border-rose-100 dark:border-rose-900/40 px-2.5 py-1.5">
              <span className="text-gray-800 dark:text-gray-100">{cluster.map(f => f.nome).join("  ≈  ")}</span>
              <button type="button" onClick={() => void mesclarCluster(cluster)} disabled={ocupado} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 inline-flex items-center gap-1"><GitMerge size={11} /> Mesclar</button>
            </div>
          ))}
          <p className="text-[10px] text-rose-600/70 dark:text-rose-400/70">Ao mesclar, os insumos vinculados passam pro fornecedor que sobra e os duplicados são excluídos.</p>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="flex justify-center mb-3 text-gray-400"><Building2 size={40} /></div>
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
                    {f.whatsapp && <span className="inline-flex items-center gap-1"><Smartphone size={12} /> {f.whatsapp}</span>}
                    {f.email && <span className="inline-flex items-center gap-1"><Mail size={12} /> {f.email}</span>}
                  </div>
                  {f.observacoes && <div className="text-xs text-gray-700 dark:text-gray-300 italic mt-1">{f.observacoes}</div>}
                </div>
                {podeConfig && (
                  <div className="flex gap-1">
                    {f.whatsapp && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void abrirWhatsapp(restaurantId, "fornecedores", f.whatsapp!, f.nome)}
                      ><span className="inline-flex items-center gap-1.5"><MessageSquare size={14} /> WhatsApp</span></Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => toggleAtivo(f)} title={f.ativo ? "Inativar" : "Ativar"}>{f.ativo ? <Ban size={15} /> : <Check size={15} />}</Button>
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
          fornecedores={fornecedores}
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
  fornecedor, fornecedores, restaurantId, onClose,
}: {
  fornecedor: Fornecedor | null;
  fornecedores: Fornecedor[];
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
    const nomeLimpo = tituloCaso(nome.trim());   // Primeira Maiúscula, resto minúsculo
    // Dedup por nome normalizado (sem acento/caixa) — bloqueia criar duplicado.
    const chave = normalizar(nomeLimpo);
    const jaExiste = fornecedores.find(f => f.id !== fornecedor?.id && normalizar(f.nome) === chave);
    if (jaExiste) { setErr(`Já existe um fornecedor "${jaExiste.nome}". Edite esse em vez de criar outro.`); return; }
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Omit<Fornecedor, "id"> = {
        restaurantId,
        nome: nomeLimpo,
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
