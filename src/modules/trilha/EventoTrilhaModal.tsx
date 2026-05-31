import { useState } from "react";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { todayYmd } from "../../core/utils/date";
import { EVENTO_TRILHA_ICON, EVENTO_TRILHA_LABEL } from "../../core/types";
import type { Cargo, Empregado, EventoTrilha, EventoTrilhaTipo } from "../../core/types";
import { editarEvento, registrarEvento } from "./repository";

type Props = {
  empregadoId: string;
  empregados: Empregado[];
  cargoMap: Record<string, Cargo>;
  evento: EventoTrilha | null;
  restaurantId: string;
  onClose: () => void;
};

// Tipos disponíveis pra cadastro manual (auto não dá pra escolher)
// Demais tipos (admissao, demissao, exame_realizado, ferias, ponto_*, etc.)
// são SEMPRE auto-gerados pelos hooks dos módulos correspondentes.
const TIPOS_MANUAL: EventoTrilhaTipo[] = [
  "treinamento", "feedback_positivo", "feedback_negativo",
  "ocorrencia", "premiacao", "advertencia",
  "promocao", "reuniao_individual", "outro",
];

export function EventoTrilhaModal({ empregadoId, empregados, cargoMap, evento, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !evento;

  const [empId, setEmpId] = useState(empregadoId);
  const [tipo, setTipo] = useState<EventoTrilhaTipo>(evento?.tipo || "treinamento");
  const [data, setData] = useState(evento?.data || todayYmd());
  const [titulo, setTitulo] = useState(evento?.titulo || "");
  const [descricao, setDescricao] = useState(evento?.descricao || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function salvar() {
    if (!titulo.trim()) { setErr("Título obrigatório"); return; }
    if (!empId) { setErr("Escolha um empregado"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const emp = empregados.find(e => e.id === empId);
      if (isNew) {
        await registrarEvento({
          restaurantId,
          empregadoId: empId,
          empregadoNomeSnapshot: emp?.nome,
          tipo,
          data,
          titulo: titulo.trim(),
          descricao: descricao.trim() || undefined,
          fonte: "manual",
          registradoPor: { id: me.id, nome: me.nome },
        });
      } else if (evento) {
        await editarEvento(evento.id, {
          tipo,
          data,
          titulo: titulo.trim(),
          descricao: descricao.trim() || undefined,
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

  return (
    <Modal title={isNew ? "+ Novo evento de trilha" : "Editar evento"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Empregado *</label>
          <select
            value={empId}
            onChange={(e) => setEmpId(e.target.value)}
            disabled={!isNew}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:opacity-60"
          >
            {empregados.map(e => (
              <option key={e.id} value={e.id}>
                {e.nome} ({cargoMap[e.cargoId]?.area || "?"})
                {!e.estaAtivo ? " — inativo" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Tipo *</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
            {TIPOS_MANUAL.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`px-2 py-2 text-xs rounded-lg border text-left transition-colors ${
                  tipo === t
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                    : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                }`}
              >
                <div className="text-base">{EVENTO_TRILHA_ICON[t]}</div>
                <div className="font-medium leading-tight">{EVENTO_TRILHA_LABEL[t]}</div>
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Data *"
          type="date"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />

        <Input
          label="Título *"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder={
            tipo === "treinamento" ? "ex: Treinamento de vinhos da casa" :
            tipo === "feedback_positivo" ? "ex: Excelente domingo cheio" :
            tipo === "feedback_negativo" ? "ex: Erros recorrentes em comandas" :
            tipo === "ocorrencia" ? "ex: Atraso de 1h sem aviso" :
            tipo === "premiacao" ? "ex: Funcionário do mês" :
            tipo === "promocao" ? "ex: Promoção a líder de salão" :
            "ex: ..."
          }
        />

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Descrição</label>
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={4}
            placeholder="Contexto, decisões, próximos passos..."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 resize-y"
          />
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : isNew ? "Criar evento" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
