import { useEffect, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { logAudit } from "../../core/audit/versionedChange";
import { AREAS } from "../../core/types";
import type { Area, Cargo, Comunicado, ComunicadoDestinatarios, ComunicadoPrioridade, Empregado } from "../../core/types";

type Props = {
  comunicado: Comunicado | null;
  restaurantId: string;
  onClose: () => void;
};

export function ComunicadoModal({ comunicado, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !comunicado;

  const [titulo, setTitulo] = useState(comunicado?.titulo || "");
  const [corpo, setCorpo] = useState(comunicado?.corpo || "");
  const [prioridade, setPrioridade] = useState<ComunicadoPrioridade>(comunicado?.prioridade || "info");
  const [validoAte, setValidoAte] = useState<string>(comunicado?.validoAte || "");
  const [ativo, setAtivo] = useState(comunicado?.ativo ?? true);

  // Destinatários
  type TipoDest = "todos" | "areas" | "empregados";
  const [tipoDest, setTipoDest] = useState<TipoDest>(comunicado?.destinatarios?.tipo || "todos");
  const [areasSel, setAreasSel] = useState<Area[]>(
    comunicado?.destinatarios.tipo === "areas" ? comunicado.destinatarios.areas : []
  );
  const [empSel, setEmpSel] = useState<string[]>(
    comunicado?.destinatarios.tipo === "empregados" ? comunicado.destinatarios.empregadoIds : []
  );

  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Carrega empregados (só pra "empregados específicos")
  useEffect(() => {
    if (tipoDest !== "empregados") return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [restaurantId, tipoDest]);

  useEffect(() => {
    if (tipoDest !== "empregados") return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [restaurantId, tipoDest]);

  function toggleArea(a: Area) {
    setAreasSel(s => s.includes(a) ? s.filter(x => x !== a) : [...s, a]);
  }
  function toggleEmp(id: string) {
    setEmpSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  async function salvar() {
    if (!titulo.trim()) { setErr("Título obrigatório"); return; }
    if (!corpo.trim()) { setErr("Corpo obrigatório"); return; }
    if (tipoDest === "areas" && areasSel.length === 0) { setErr("Escolha ao menos 1 área"); return; }
    if (tipoDest === "empregados" && empSel.length === 0) { setErr("Escolha ao menos 1 empregado"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const destinatarios: ComunicadoDestinatarios =
        tipoDest === "todos" ? { tipo: "todos" }
        : tipoDest === "areas" ? { tipo: "areas", areas: areasSel }
        : { tipo: "empregados", empregadoIds: empSel };

      const data: Omit<Comunicado, "id"> = {
        restaurantId,
        titulo: titulo.trim(),
        corpo: corpo.trim(),
        prioridade,
        destinatarios,
        validoAte: validoAte || null,
        ativo,
        criadoEm: comunicado?.criadoEm || now,
        criadoPor: comunicado?.criadoPor || me.id,
        atualizadoEm: now,
      };

      if (isNew) {
        const ref = await addDoc(collection(db, "comunicados"), sanitizeForFirestore(data));
        await logAudit({
          entityType: "restaurant",
          entityId: restaurantId,
          restaurantId,
          acao: "criado",
          diff: { comunicado: { antes: null, depois: titulo.trim() } },
          motivo: `Comunicado: ${titulo.trim()}`,
          registradoPor: me.id,
        });
        void ref;
      } else {
        await updateDoc(doc(db, "comunicados", comunicado.id), sanitizeForFirestore(data));
        await logAudit({
          entityType: "restaurant",
          entityId: restaurantId,
          restaurantId,
          acao: "alterado",
          diff: { comunicado: { antes: comunicado.titulo, depois: titulo.trim() } },
          registradoPor: me.id,
        });
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  // Cargos pra mostrar no toggle de empregados
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const empregadosOrdenados = [...empregados]
    .filter(e => e.estaAtivo)
    .sort((a, b) => {
      const ca = cargoMap[a.cargoId];
      const cb = cargoMap[b.cargoId];
      const areaA = ca?.area || "ZZ";
      const areaB = cb?.area || "ZZ";
      if (areaA !== areaB) return areaA.localeCompare(areaB);
      return a.nome.localeCompare(b.nome);
    });

  return (
    <Modal title={isNew ? "+ Novo comunicado" : `Editar — ${comunicado.titulo}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <Input
          label="Título *"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="ex: Mudança no horário de fim de semana"
          autoFocus
        />

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Corpo *</label>
          <textarea
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            rows={6}
            placeholder="Mensagem completa pra equipe..."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Prioridade</label>
            <select
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value as ComunicadoPrioridade)}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              <option value="info">ℹ️ Informativo</option>
              <option value="aviso">⚠️ Aviso</option>
              <option value="urgente">🚨 Urgente</option>
            </select>
          </div>
          <Input
            label="Válido até (opcional)"
            type="date"
            value={validoAte}
            onChange={(e) => setValidoAte(e.target.value)}
          />
        </div>

        {/* Destinatários */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
            Destinatários
          </label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <DestBtn ativo={tipoDest === "todos"} onClick={() => setTipoDest("todos")}>👥 Todos</DestBtn>
            <DestBtn ativo={tipoDest === "areas"} onClick={() => setTipoDest("areas")}>🏷️ Por área</DestBtn>
            <DestBtn ativo={tipoDest === "empregados"} onClick={() => setTipoDest("empregados")}>🎯 Específicos</DestBtn>
          </div>

          {tipoDest === "areas" && (
            <div className="grid grid-cols-4 gap-2">
              {AREAS.map(a => (
                <label key={a} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <input type="checkbox" checked={areasSel.includes(a)} onChange={() => toggleArea(a)} />
                  <span className="text-sm">{a}</span>
                </label>
              ))}
            </div>
          )}

          {tipoDest === "empregados" && (
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg max-h-[200px] overflow-y-auto">
              {empregadosOrdenados.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">Sem empregados ativos.</div>
              ) : empregadosOrdenados.map(e => {
                const cargo = cargoMap[e.cargoId];
                return (
                  <label key={e.id} className="flex items-center gap-3 px-3 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                    <input type="checkbox" checked={empSel.includes(e.id)} onChange={() => toggleEmp(e.id)} />
                    <div className="flex-1 text-sm">
                      <div className="font-medium">{e.nome}</div>
                      <div className="text-[10px] text-gray-500">{cargo?.nome} · {cargo?.area}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            <span className="font-medium">Ativo</span>
            <span className="text-xs text-gray-500">(desativado não aparece pros empregados)</span>
          </label>
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : isNew ? "Publicar" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DestBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
        ativo
          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
          : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      }`}
    >
      {children}
    </button>
  );
}
