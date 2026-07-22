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
  const [busca, setBusca] = useState("");

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
  function removerParticipante(idx: number) {
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
  const bq = busca.trim().toLowerCase();
  const matches = bq
    ? empregadosOrdenados.filter(e => !empregadosSelecionados.has(e.id) && e.nome.toLowerCase().includes(bq)).slice(0, 8)
    : [];

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

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Tipo</label>
          <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
            {TIPOS.map(t => (
              <button key={t} type="button" onClick={() => setTipo(t)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tipo === t ? "bg-white dark:bg-gray-900 text-indigo-700 dark:text-indigo-300 shadow-sm" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
                {REUNIAO_TIPO_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Data *" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <Input label="Horário" type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
        </div>
        <Input label="Local" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="ex: Sala da gerência" />

        {/* Participantes — busca por nome (typeahead) + chips dos selecionados */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">
            Participantes {participantes.length > 0 && <span className="text-gray-400">· {participantes.length}</span>}
          </label>

          {participantes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {participantes.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[13px]">
                  {p.empregadoId ? p.nome : <span>👤 {p.nome} <span className="text-indigo-400 text-[11px]">externo</span></span>}
                  <button type="button" onClick={() => removerParticipante(i)} aria-label="remover" className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-indigo-200 dark:hover:bg-indigo-800 text-indigo-500 leading-none">×</button>
                </span>
              ))}
            </div>
          )}

          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="🔍 Digite o nome do empregado…"
          />
          {bq && (
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg mt-1 max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
              {matches.length === 0 ? (
                <div className="p-3 text-sm text-gray-500 text-center">Nenhum empregado ativo com esse nome.</div>
              ) : matches.map(e => {
                const cargo = cargoMap[e.cargoId];
                return (
                  <button key={e.id} type="button" onClick={() => { toggleEmp(e); setBusca(""); }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{e.nome}</span>
                      <span className="text-[11px] text-gray-500 block truncate">{cargo?.nome || "—"}{cargo?.area ? ` · ${cargo.area}` : ""}</span>
                    </span>
                    <span className="text-indigo-500 text-xs shrink-0">+ adicionar</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex gap-2 mt-2">
            <Input
              value={extName}
              onChange={(e) => setExtName(e.target.value)}
              placeholder="Participante externo (não-empregado)"
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
