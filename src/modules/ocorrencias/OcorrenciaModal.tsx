import { useState } from "react";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { todayYmd } from "../../core/utils/date";
import {
  OCORRENCIA_GRAVIDADE_ICON, OCORRENCIA_GRAVIDADE_LABEL,
  OCORRENCIA_STATUS_LABEL,
} from "../../core/types";
import type { Cargo, Empregado, Ocorrencia, OcorrenciaGravidade, OcorrenciaStatus } from "../../core/types";
import { registrarAutoEvento } from "../trilha/autoEventos";

type Props = {
  ocorrencia: Ocorrencia | null;
  empregados: Empregado[];
  cargos: Cargo[];
  restaurantId: string;
  onClose: () => void;
};

const GRAVIDADES: OcorrenciaGravidade[] = ["elogio", "leve", "media", "grave"];
const STATUSES: OcorrenciaStatus[] = ["aberta", "em_apuracao", "resolvida", "arquivada"];
const CATEGORIAS_SUGERIDAS = ["Atendimento", "Cozinha", "Bar", "Salão", "Financeiro", "Equipamento", "Cliente", "Equipe"];

export function OcorrenciaModal({ ocorrencia, empregados, cargos, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !ocorrencia;

  const [data, setData] = useState(ocorrencia?.data || todayYmd());
  const [hora, setHora] = useState(ocorrencia?.hora || "");
  const [titulo, setTitulo] = useState(ocorrencia?.titulo || "");
  const [descricao, setDescricao] = useState(ocorrencia?.descricao || "");
  const [gravidade, setGravidade] = useState<OcorrenciaGravidade>(ocorrencia?.gravidade || "leve");
  const [status, setStatus] = useState<OcorrenciaStatus>(ocorrencia?.status || "aberta");
  const [categoria, setCategoria] = useState(ocorrencia?.categoria || "");
  const [empSel, setEmpSel] = useState<string[]>(ocorrencia?.empregadosEnvolvidos || []);
  const [clienteNome, setClienteNome] = useState(ocorrencia?.clienteNome || "");
  const [resolucao, setResolucao] = useState(ocorrencia?.resolucao || "");
  const [criarEvtTrilha, setCriarEvtTrilha] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function toggleEmp(id: string) {
    setEmpSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  // Empregados ativos ordenados (área + nome)
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

  async function salvar() {
    if (!titulo.trim()) { setErr("Título obrigatório"); return; }
    if (!descricao.trim()) { setErr("Descrição obrigatória"); return; }
    if (!data) { setErr("Data obrigatória"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      // Se virou resolvida AGORA, marca quem resolveu
      const acabouResolver = status === "resolvida" && ocorrencia?.status !== "resolvida";

      const payload: Omit<Ocorrencia, "id"> = {
        restaurantId,
        data,
        hora: hora || undefined,
        titulo: titulo.trim(),
        descricao: descricao.trim(),
        gravidade,
        status,
        categoria: categoria.trim() || undefined,
        empregadosEnvolvidos: empSel,
        clienteNome: clienteNome.trim() || undefined,
        resolucao: resolucao.trim() || undefined,
        resolvidaEm: acabouResolver ? now : (ocorrencia?.resolvidaEm ?? null),
        resolvidaPor: acabouResolver ? me.id : (ocorrencia?.resolvidaPor ?? null),
        criadaEm: ocorrencia?.criadaEm || now,
        criadaPor: ocorrencia?.criadaPor || me.id,
        criadaPorNome: ocorrencia?.criadaPorNome || me.nome,
        atualizadaEm: now,
      };

      if (isNew) {
        const ref = await addDoc(collection(db, "ocorrencias"), sanitizeForFirestore(payload));

        // Auto-evento na trilha pra cada empregado envolvido (se opção marcada)
        if (criarEvtTrilha) {
          const tipo = gravidade === "elogio" ? "feedback_positivo"
            : gravidade === "grave" || gravidade === "media" ? "feedback_negativo"
            : "ocorrencia";
          for (const empId of empSel) {
            const emp = empregados.find(e => e.id === empId);
            await registrarAutoEvento({
              restaurantId,
              empregadoId: empId,
              tipo,
              data,
              titulo: `${OCORRENCIA_GRAVIDADE_ICON[gravidade]} ${titulo.trim()}`,
              descricao: `${descricao.trim()}${emp ? ` (Ocorrência ref: ${ref.id})` : ""}`,
              registradoPor: me.id,
            });
          }
        }
      } else {
        await updateDoc(doc(db, "ocorrencias", ocorrencia.id), sanitizeForFirestore(payload));
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
    <Modal title={isNew ? "+ Nova ocorrência" : `Editar — ${ocorrencia.titulo}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Data *" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          <Input label="Hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>

        <Input
          label="Título *"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="ex: Cliente reclamou de comanda errada"
          autoFocus
        />

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Descrição *</label>
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={4}
            placeholder="O que aconteceu? Contexto, evidências, pessoas envolvidas..."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
          />
        </div>

        {/* Gravidade */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            Gravidade
          </label>
          <div className="grid grid-cols-4 gap-2">
            {GRAVIDADES.map(g => (
              <button
                key={g}
                type="button"
                onClick={() => setGravidade(g)}
                className={`px-2 py-2 text-sm rounded-lg border transition-colors ${
                  gravidade === g
                    ? g === "elogio" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700"
                    : g === "leve"   ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700"
                    : g === "media"  ? "border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-700"
                    :                  "border-rose-500 bg-rose-50 dark:bg-rose-900/30 text-rose-700"
                    : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                }`}
              >
                {OCORRENCIA_GRAVIDADE_ICON[g]} {OCORRENCIA_GRAVIDADE_LABEL[g]}
              </button>
            ))}
          </div>
        </div>

        {/* Categoria */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Categoria</label>
          <div className="flex gap-2 flex-wrap mt-1 mb-1">
            {CATEGORIAS_SUGERIDAS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoria(c === categoria ? "" : c)}
                className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                  categoria === c
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                    : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <Input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="ou digite outra" />
        </div>

        {/* Empregados envolvidos */}
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            Empregados envolvidos ({empSel.length})
          </label>
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg max-h-[180px] overflow-y-auto">
            {empregadosOrdenados.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">Sem empregados ativos.</div>
            ) : empregadosOrdenados.map(e => {
              const cargo = cargoMap[e.cargoId];
              return (
                <label
                  key={e.id}
                  className="flex items-center gap-3 px-3 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                >
                  <input type="checkbox" checked={empSel.includes(e.id)} onChange={() => toggleEmp(e.id)} />
                  <div className="flex-1 text-sm">
                    <div className="font-medium">{e.nome}</div>
                    <div className="text-[10px] text-gray-500">{cargo?.nome} · {cargo?.area}</div>
                  </div>
                </label>
              );
            })}
          </div>
          {isNew && empSel.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mt-2 cursor-pointer">
              <input type="checkbox" checked={criarEvtTrilha} onChange={(e) => setCriarEvtTrilha(e.target.checked)} />
              <span>🎯 Criar evento na trilha de cada empregado envolvido</span>
            </label>
          )}
        </div>

        {/* Cliente externo */}
        <Input
          label="Cliente envolvido (opcional)"
          value={clienteNome}
          onChange={(e) => setClienteNome(e.target.value)}
          placeholder="ex: Sr. Carlos (mesa 4)"
        />

        {/* Status + Resolução */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-1">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as OcorrenciaStatus)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          >
            {STATUSES.map(s => <option key={s} value={s}>{OCORRENCIA_STATUS_LABEL[s]}</option>)}
          </select>

          {(status === "resolvida" || resolucao) && (
            <div className="mt-2">
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Resolução</label>
              <textarea
                value={resolucao}
                onChange={(e) => setResolucao(e.target.value)}
                rows={3}
                placeholder="O que foi feito? Decisão, encaminhamento..."
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
              />
            </div>
          )}
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : isNew ? "Registrar" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
