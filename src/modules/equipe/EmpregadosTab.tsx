import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import type { Cargo, Empregado } from "../../core/types";

type Props = { restaurantId: string; podeConfig: boolean };

export function EmpregadosTab({ restaurantId, podeConfig }: Props) {
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Empregado | null | "new">(null);

  useEffect(() => {
    setLoading(true);
    const qE = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    const unsubE = onSnapshot(qE, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
      setLoading(false);
    });
    const qC = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsubC = onSnapshot(qC, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => { unsubE(); unsubC(); };
  }, [restaurantId]);

  const cargosById: Record<string, Cargo> = {};
  cargos.forEach(c => { cargosById[c.id] = c; });

  const today = new Date().toISOString().slice(0, 10);
  const filtered = empregados
    .filter(e => {
      const isInactiveNow = !!(e.inativa && e.inativaFrom && e.inativaFrom <= today);
      if (!showInactive && isInactiveNow) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        return (e.nome || "").toLowerCase().includes(s) || (e.cpf || "").includes(s);
      }
      return true;
    })
    .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

  return (
    <div>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} de {empregados.length} empregado(s)</p>
        {podeConfig && (
          <Button onClick={() => setEditing("new")} disabled={cargos.length === 0} title={cargos.length === 0 ? "Cadastre um cargo antes" : ""}>
            + Novo empregado
          </Button>
        )}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Input
          placeholder="🔍 Buscar por nome ou CPF..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px]"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 px-3 border border-gray-300 dark:border-gray-700 rounded-lg">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar inativos
        </label>
      </div>

      {cargos.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2 text-sm text-amber-900 dark:text-amber-300 mb-4">
          ⚠️ Cadastre pelo menos um cargo na aba "Cargos" antes de cadastrar empregados.
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">👥</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search ? "Nenhum empregado encontrado" : "Nenhum empregado cadastrado"}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {filtered.map((e, i) => {
            const cargo = cargosById[e.cargoId];
            const inactive = !!(e.inativa && e.inativaFrom && e.inativaFrom <= today);
            return (
              <div
                key={e.id}
                onClick={() => podeConfig && setEditing(e)}
                className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""} ${podeConfig ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800" : ""} ${inactive ? "opacity-60" : ""}`}
              >
                <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-semibold">
                  {(e.nome || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {e.nome}
                    {e.isFreela && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300 uppercase font-semibold">Freela</span>}
                    {e.isProducao && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300 uppercase font-semibold">Produção</span>}
                    {inactive && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400 uppercase font-semibold">Inativo</span>}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {cargo ? `${cargo.nome} · ${cargo.area}` : "(sem cargo)"}
                    {e.cpf && ` · ${e.cpf}`}
                  </div>
                </div>
                {podeConfig && <span className="text-gray-400 text-sm">›</span>}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <EmpregadoModal
          empregado={editing === "new" ? null : editing}
          cargos={cargos.filter(c => c.ativo)}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EmpregadoModal({ empregado, cargos, restaurantId, onClose }: {
  empregado: Empregado | null;
  cargos: Cargo[];
  restaurantId: string;
  onClose: () => void;
}) {
  const { pessoa } = useAuth();
  const [form, setForm] = useState<Partial<Empregado>>({
    nome:           empregado?.nome || "",
    cpf:            empregado?.cpf || "",
    cargoId:        empregado?.cargoId || cargos[0]?.id || "",
    admissao:       empregado?.admissao || new Date().toISOString().slice(0, 10),
    empCode:        empregado?.empCode || "",
    codigoContabil: empregado?.codigoContabil || "",
    isFreela:       empregado?.isFreela ?? false,
    isProducao:     empregado?.isProducao ?? false,
    isProlaborista: empregado?.isProlaborista ?? false,
    inativa:        empregado?.inativa ?? false,
    inativaFrom:    empregado?.inativaFrom || "",
    email:          empregado?.email || "",
    telefone:       empregado?.telefone || "",
    vtAtivo:           empregado?.vtAtivo ?? false,
    vtPassagensPorDia: empregado?.vtPassagensPorDia,
    vtValorPassagem:   empregado?.vtValorPassagem,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function set<K extends keyof Empregado>(k: K, v: Empregado[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function salvar() {
    if (!form.nome?.trim() || !form.cargoId || !form.admissao) {
      setErr("Nome, cargo e admissão obrigatórios");
      return;
    }
    if (form.vtAtivo) {
      if (!form.vtPassagensPorDia || form.vtPassagensPorDia <= 0) {
        setErr("Quando VT está ativo, passagens/dia é obrigatório");
        return;
      }
      if (!form.vtValorPassagem || form.vtValorPassagem <= 0) {
        setErr("Quando VT está ativo, valor da passagem é obrigatório");
        return;
      }
    }
    if (!pessoa) return;
    setErr("");
    setSaving(true);
    try {
      const data: Omit<Empregado, "id" | "createdAt" | "createdBy"> & { createdAt?: string; createdBy?: string } = {
        restaurantId,
        nome: form.nome.trim(),
        cpf: form.cpf?.trim() || null,
        cargoId: form.cargoId,
        admissao: form.admissao,
        empCode: form.empCode?.trim() || null,
        codigoContabil: form.codigoContabil?.trim() || null,
        isFreela: !!form.isFreela,
        isProducao: !!form.isProducao,
        isProlaborista: !!form.isProlaborista,
        inativa: !!form.inativa,
        inativaFrom: form.inativaFrom || null,
        demitidoEm: empregado?.demitidoEm || null,
        email: form.email?.trim() || null,
        telefone: form.telefone?.trim() || null,
        emergenciaNome: empregado?.emergenciaNome || null,
        emergenciaTelefone: empregado?.emergenciaTelefone || null,
        pessoaId: empregado?.pessoaId || null,
        vtAtivo: !!form.vtAtivo,
        ...(typeof form.vtPassagensPorDia === "number" ? { vtPassagensPorDia: form.vtPassagensPorDia } : {}),
        ...(typeof form.vtValorPassagem   === "number" ? { vtValorPassagem:   form.vtValorPassagem   } : {}),
      };
      if (empregado) {
        await updateDoc(doc(db, "empregados", empregado.id), data);
      } else {
        await addDoc(collection(db, "empregados"), { ...data, createdAt: new Date().toISOString(), createdBy: pessoa.id });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }
  async function excluir() {
    if (!empregado) return;
    if (!confirm(`Excluir "${empregado.nome}" PERMANENTEMENTE? (use Inativar pra não perder histórico)`)) return;
    await deleteDoc(doc(db, "empregados", empregado.id));
    onClose();
  }

  return (
    <Modal title={empregado ? `Editar — ${empregado.nome}` : "+ Novo empregado"} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Nome completo *" value={form.nome || ""} onChange={(e) => set("nome", e.target.value)} autoFocus />
          <Input label="CPF" value={form.cpf || ""} onChange={(e) => set("cpf", e.target.value)} placeholder="000.000.000-00" />
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Cargo *</label>
            <select
              value={form.cargoId || ""}
              onChange={(e) => set("cargoId", e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              {cargos.map(c => (
                <option key={c.id} value={c.id}>{c.nome} · {c.area}</option>
              ))}
            </select>
          </div>
          <Input label="Data de admissão *" type="date" value={form.admissao || ""} onChange={(e) => set("admissao", e.target.value)} />
          <Input label="Código interno" value={form.empCode || ""} onChange={(e) => set("empCode", e.target.value)} placeholder="ex: LOB001" />
          <Input label="Código contábil" value={form.codigoContabil || ""} onChange={(e) => set("codigoContabil", e.target.value.replace(/\D/g, ""))} />
          <Input label="Email" type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} />
          <Input label="Telefone" value={form.telefone || ""} onChange={(e) => set("telefone", e.target.value)} placeholder="(11) 99999-9999" />
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-2">Flags</label>
          <div className="flex gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.isFreela} onChange={(e) => set("isFreela", e.target.checked)} />
              <span title="Freela esporádico — nunca entra na divisão de gorjeta">Freela</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.isProducao} onChange={(e) => set("isProducao", e.target.checked)} />
              <span title="Recebe gorjeta TODOS os dias (cozinha, etc)">Produção</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.isProlaborista} onChange={(e) => set("isProlaborista", e.target.checked)} />
              <span title="Sócio — não é assalariado">Sócio (Pró-labore)</span>
            </label>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.vtAtivo} onChange={(e) => set("vtAtivo", e.target.checked)} />
            <span className="font-medium">Recebe VT (Vale Transporte)</span>
          </label>
          {form.vtAtivo && (
            <>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Input
                  label="Passagens/dia *"
                  type="number" min="0" step="1"
                  value={form.vtPassagensPorDia === undefined ? "" : String(form.vtPassagensPorDia)}
                  onChange={(e) => set("vtPassagensPorDia", e.target.value === "" ? undefined : parseInt(e.target.value, 10))}
                  placeholder="ex: 2 (ida + volta)"
                />
                <Input
                  label="Valor unitário da passagem (R$) *"
                  type="number" min="0" step="0.01"
                  value={form.vtValorPassagem === undefined ? "" : String(form.vtValorPassagem)}
                  onChange={(e) => set("vtValorPassagem", e.target.value === "" ? undefined : parseFloat(e.target.value))}
                  placeholder="ex: 5.00"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Cada empregado pode usar um modal/quantidade diferente — preencha conforme o trajeto dele.
              </p>
            </>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.inativa} onChange={(e) => set("inativa", e.target.checked)} />
            Inativar
          </label>
          {form.inativa && (
            <div className="mt-2">
              <Input
                label="Inativo a partir de"
                type="date"
                value={form.inativaFrom || ""}
                onChange={(e) => set("inativaFrom", e.target.value)}
              />
            </div>
          )}
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="flex justify-between items-center pt-3 border-t border-gray-200 dark:border-gray-800">
          <div>{empregado && <Button variant="danger" size="sm" onClick={excluir}>Excluir permanente</Button>}</div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar"}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
