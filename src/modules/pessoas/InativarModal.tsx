import { useEffect, useState } from "react";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { logAudit } from "../../core/audit/versionedChange";
import { registrarDemissao } from "../trilha/autoEventos";
import { desativarExamesPorDemissao } from "../exames/gerador";
import { todayYmd, fmtBR } from "../../core/utils/date";
import type { Empregado, Pessoa } from "../../core/types";

const MOTIVOS: { id: string; label: string }[] = [
  { id: "demissao",   label: "Demissão / desligamento" },
  { id: "afastamento", label: "Afastamento (saúde, licença)" },
  { id: "encerramento", label: "Encerramento de parceria" },
  { id: "outro",      label: "Outro" },
];

type Props = {
  pessoa: Pessoa;
  onClose: () => void;
  onInativada?: (ultimoDiaTrabalhado: string) => void;  // SUCESSO (pra encadear, ex: demitir na Sólides)
  titulo?: string;
};

export function InativarModal({ pessoa, onClose, onInativada, titulo }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();

  const [motivoId, setMotivoId] = useState("demissao");
  const [motivoTexto, setMotivoTexto] = useState("");
  const [dataEfetiva, setDataEfetiva] = useState(todayYmd());
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [loadingEmps, setLoadingEmps] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Carrega TODOS os empregados desta pessoa em qualquer restaurante
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const q = query(collection(db, "empregados"), where("pessoaId", "==", pessoa.id));
        const snap = await getDocs(q);
        if (!alive) return;
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado);
        setEmpregados(list.filter(e => e.estaAtivo !== false));
      } finally {
        if (alive) setLoadingEmps(false);
      }
    })();
    return () => { alive = false; };
  }, [pessoa.id]);

  async function inativar() {
    if (!me) return;
    if (motivoId === "outro" && !motivoTexto.trim()) {
      setErr("Motivo descrito é obrigatório quando 'Outro' está selecionado");
      return;
    }
    setErr("");
    setSaving(true);
    try {
      const motivoLabel =
        motivoId === "outro"
          ? motivoTexto.trim()
          : MOTIVOS.find(m => m.id === motivoId)?.label || motivoId;
      const now = new Date().toISOString();

      // 1. Inativa a Pessoa (perde acesso em <= 30s via polling)
      await updateDoc(doc(db, "pessoas", pessoa.id), {
        ativa: false,
        inativadaEm: now,
        inativadaPor: me.id,
        inativadaUltimoDia: dataEfetiva, // último dia trabalhado (pra espelhar na Sólides)
        motivoInativacao: motivoLabel,
      });
      await logAudit({
        entityType: "pessoa",
        entityId: pessoa.id,
        acao: "inativado",
        motivo: motivoLabel,
        registradoPor: me.id,
      });

      // 2. Demite empregados ligados (em todos os restaurantes)
      // demitidoEm = primeiro dia FORA = dataEfetiva + 1
      const demitidoEm = nextDay(dataEfetiva);
      for (const emp of empregados) {
        const periodos = (emp.periodos || []).map((p, idx, arr) => {
          if (idx === arr.length - 1 && !p.demissao) {
            return {
              ...p,
              demissao: demitidoEm,
              motivoDemissao: motivoLabel,
            };
          }
          return p;
        });
        await updateDoc(doc(db, "empregados", emp.id), {
          periodos,
          estaAtivo: false,
          demitidoEm,
        });
        await logAudit({
          entityType: "empregado",
          entityId: emp.id,
          restaurantId: emp.restaurantId,
          acao: "demitido",
          diff: { demitidoEm: { antes: null, depois: demitidoEm } },
          motivo: motivoLabel,
          registradoPor: me.id,
        });
        // Auto-evento de trilha: demissão (data = último dia ativo)
        await registrarDemissao({
          restaurantId: emp.restaurantId,
          empregadoId: emp.id,
          empregadoNome: emp.nome,
          ultimoDia: dataEfetiva,
          motivo: motivoLabel,
          registradoPor: me.id,
        });
        // Fase 7: desativa todos os exames médicos do empregado
        try {
          await desativarExamesPorDemissao(
            emp.id,
            { id: me.id, nome: me.nome || "" },
            motivoLabel,
          );
        } catch (e) {
          console.warn("[demissao] falha ao desativar exames:", e);
        }
      }

      if (onInativada) onInativada(dataEfetiva); else onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={titulo || `Inativar — ${pessoa.nome}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-300">
          ⚠ Ao inativar:
          <ul className="list-disc ml-5 mt-1 text-xs space-y-0.5">
            <li>Acesso ao sistema bloqueado em até 30 segundos</li>
            <li>Empregados vinculados são demitidos em todos os restaurantes</li>
            <li>Histórico (gorjetas, escalas, VT pagos) preservado</li>
            <li>Pode reativar depois pela aba "Inativas"</li>
          </ul>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Motivo *</label>
          <select
            value={motivoId}
            onChange={(e) => setMotivoId(e.target.value)}
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            {MOTIVOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        {motivoId === "outro" && (
          <Input
            label="Descreva o motivo *"
            value={motivoTexto}
            onChange={(e) => setMotivoTexto(e.target.value)}
            placeholder="ex: encerramento de contrato"
          />
        )}

        <Input
          label="Último dia ativo *"
          type="date"
          value={dataEfetiva}
          onChange={(e) => setDataEfetiva(e.target.value)}
        />
        <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1">
          A pessoa não trabalha mais a partir do dia seguinte. Escalas e gorjetas até esse dia ficam preservadas.
        </p>

        {/* Empregados afetados */}
        {loadingEmps ? (
          <div className="text-sm text-gray-500">Carregando vínculos de equipe...</div>
        ) : empregados.length > 0 ? (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
              Empregados afetados ({empregados.length})
            </div>
            <ul className="space-y-1 text-sm">
              {empregados.map(emp => {
                const rest = restaurants.find(r => r.id === emp.restaurantId);
                return (
                  <li key={emp.id} className="text-gray-700 dark:text-gray-300">
                    • {rest?.nome || emp.restaurantId} — admissão: {emp.admissaoAtual ? fmtBR(emp.admissaoAtual) : "—"}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
            Sem vínculos de equipe ativos. Apenas a Pessoa é inativada.
          </p>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={inativar} disabled={saving}>
            {saving ? "..." : "Confirmar inativação"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function nextDay(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
