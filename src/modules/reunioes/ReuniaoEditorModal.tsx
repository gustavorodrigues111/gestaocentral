import { useEffect, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { logAudit } from "../../core/audit/versionedChange";
import { todayYmd } from "../../core/utils/date";
import { REUNIAO_TIPO_LABEL } from "../../core/types";
import type { Cargo, Empregado, ParticipanteReuniao, Reuniao, ReuniaoTipo } from "../../core/types";

type Props = {
  reuniao: Reuniao | null;
  restaurantId: string;
  onClose: () => void;
};

const TIPOS: ReuniaoTipo[] = ["lideres", "equipe", "individual", "outro"];

export function ReuniaoEditorModal({ reuniao, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !reuniao;

  const [titulo, setTitulo] = useState(reuniao?.titulo || "");
  const [tipo, setTipo] = useState<ReuniaoTipo>(reuniao?.tipo || "equipe");
  const [data, setData] = useState(reuniao?.data || todayYmd());
  const [horario, setHorario] = useState(reuniao?.horario || "");
  const [local, setLocal] = useState(reuniao?.local || "");
  const [participantes, setParticipantes] = useState<ParticipanteReuniao[]>(reuniao?.participantes || []);
  const [extName, setExtName] = useState("");

  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const q = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    const q = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [restaurantId]);

  function toggleEmp(emp: Empregado) {
    setParticipantes(s => {
      const exists = s.find(p => p.empregadoId === emp.id);
      if (exists) return s.filter(p => p.empregadoId !== emp.id);
      return [...s, { empregadoId: emp.id, nome: emp.nome }];
    });
  }
  function addExterno() {
    const n = extName.trim();
    if (!n) return;
    setParticipantes(s => [...s, { nome: n }]);
    setExtName("");
  }
  function removerExterno(idx: number) {
    setParticipantes(s => s.filter((_, i) => i !== idx));
  }

  async function salvar() {
    if (!titulo.trim()) { setErr("Título obrigatório"); return; }
    if (!data) { setErr("Data obrigatória"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Omit<Reuniao, "id"> = {
        restaurantId,
        titulo: titulo.trim(),
        tipo,
        data,
        horario: horario || undefined,
        local: local.trim() || undefined,
        participantes,
        pauta: reuniao?.pauta || [],
        ata: reuniao?.ata || undefined,
        acoes: reuniao?.acoes || [],
        status: reuniao?.status || "planejada",
        criadoEm: reuniao?.criadoEm || now,
        criadoPor: reuniao?.criadoPor || me.id,
        atualizadoEm: now,
      };
      if (isNew) {
        await addDoc(collection(db, "reunioes"), sanitizeForFirestore(payload));
        await logAudit({
          entityType: "restaurant",
          entityId: restaurantId,
          restaurantId,
          acao: "criado",
          diff: { reuniao: { antes: null, depois: titulo.trim() } },
          motivo: `Reunião: ${titulo.trim()}`,
          registradoPor: me.id,
        });
      } else {
        await updateDoc(doc(db, "reunioes", reuniao.id), sanitizeForFirestore(payload));
        await logAudit({
          entityType: "restaurant",
          entityId: restaurantId,
          restaurantId,
          acao: "alterado",
          diff: { reuniao: { antes: reuniao.titulo, depois: titulo.trim() } },
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

  // Empregados ativos ordenados por área + nome
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

  const empregadosSelecionados = new Set(participantes.filter(p => p.empregadoId).map(p => p.empregadoId!));
  const externos = participantes.map((p, i) => ({ ...p, _idx: i })).filter(p => !p.empregadoId);

  return (
    <Modal
      title={isNew ? "+ Nova reunião" : `Editar — ${reuniao.titulo}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-3">
        <Input
          label="Título *"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="ex: Reunião de líderes — abril"
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Tipo</label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as ReuniaoTipo)}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              {TIPOS.map(t => <option key={t} value={t}>{REUNIAO_TIPO_LABEL[t]}</option>)}
            </select>
          </div>
          <Input
            label="Data *"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
          <Input
            label="Horário"
            type="time"
            value={horario}
            onChange={(e) => setHorario(e.target.value)}
          />
          <Input
            label="Local"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="ex: Sala da gerência"
          />
        </div>

        {/* Participantes */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
            Participantes ({participantes.length})
          </label>

          <div className="border border-gray-200 dark:border-gray-800 rounded-lg max-h-[200px] overflow-y-auto mb-2">
            {empregadosOrdenados.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">Sem empregados ativos.</div>
            ) : empregadosOrdenados.map(e => {
              const cargo = cargoMap[e.cargoId];
              const checked = empregadosSelecionados.has(e.id);
              return (
                <label
                  key={e.id}
                  className="flex items-center gap-3 px-3 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleEmp(e)} />
                  <div className="flex-1 text-sm">
                    <div className="font-medium">{e.nome}</div>
                    <div className="text-[10px] text-gray-500">{cargo?.nome} · {cargo?.area}</div>
                  </div>
                </label>
              );
            })}
          </div>

          {externos.length > 0 && (
            <div className="space-y-1 mb-2">
              {externos.map(p => (
                <div key={p._idx} className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 rounded text-sm">
                  <span>👤 {p.nome} <span className="text-xs text-gray-500">(externo)</span></span>
                  <button type="button" onClick={() => removerExterno(p._idx)} className="text-rose-600 hover:text-rose-700 text-xs">remover</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              value={extName}
              onChange={(e) => setExtName(e.target.value)}
              placeholder="Adicionar participante externo (não-empregado)"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExterno(); } }}
              className="flex-1"
            />
            <Button variant="secondary" onClick={addExterno} disabled={!extName.trim()}>+ Externo</Button>
          </div>
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : isNew ? "Criar" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
