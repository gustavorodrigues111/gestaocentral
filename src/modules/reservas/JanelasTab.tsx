import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  ConfiguracaoReservas, JanelaDiaReserva, Salao, SlotReserva,
} from "../../core/types";
import { DEFAULT_JANELA_ANTECEDENCIA_DIAS } from "../../core/types";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
  pessoaId: string;
  saloes: Salao[];
};

const DIAS = [
  { id: 0, label: "Domingo",   short: "Dom" },
  { id: 1, label: "Segunda",   short: "Seg" },
  { id: 2, label: "Terça",     short: "Ter" },
  { id: 3, label: "Quarta",    short: "Qua" },
  { id: 4, label: "Quinta",    short: "Qui" },
  { id: 5, label: "Sexta",     short: "Sex" },
  { id: 6, label: "Sábado",    short: "Sáb" },
];

// Aba "Janelas" — restaurante define, pra cada dia da semana, os horários
// (slots) em que aceita reservas e quais salões estão ativos em cada
// horário. Doc único por restaurante em /configReservas.
export function JanelasTab({ restaurantId, podeConfig, pessoaId, saloes }: Props) {
  const [cfg, setCfg] = useState<ConfiguracaoReservas | null>(null);
  const [loading, setLoading] = useState(true);
  const [duracao, setDuracao] = useState("90");
  const [janelaAntecedencia, setJanelaAntecedencia] = useState(String(DEFAULT_JANELA_ANTECEDENCIA_DIAS));
  const [janelas, setJanelas] = useState<JanelaDiaReserva[]>([]);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");

  // Carrega config existente
  useEffect(() => {
    setLoading(true);
    const unsub = onSnapshot(doc(db, "configReservas", restaurantId), (snap) => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() } as ConfiguracaoReservas;
        setCfg(data);
        setDuracao(String(data.duracaoSlotMin ?? 90));
        setJanelaAntecedencia(String(data.janelaAntecedenciaDias ?? DEFAULT_JANELA_ANTECEDENCIA_DIAS));
        setJanelas(normalizar(data.janelas));
      } else {
        // Default: 7 dias sem slots (fechado)
        setCfg(null);
        setDuracao("90");
        setJanelaAntecedencia(String(DEFAULT_JANELA_ANTECEDENCIA_DIAS));
        setJanelas(DIAS.map(d => ({ dia: d.id, slots: [] })));
      }
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  function addSlot(dia: number) {
    setJanelas(js => js.map(j => j.dia === dia
      ? { ...j, slots: [...j.slots, { horario: "", salaoIds: saloes.filter(s => s.ativo).map(s => s.id) }] }
      : j,
    ));
  }
  function removerSlot(dia: number, idx: number) {
    setJanelas(js => js.map(j => j.dia === dia
      ? { ...j, slots: j.slots.filter((_, i) => i !== idx) }
      : j,
    ));
  }
  function updateSlot(dia: number, idx: number, patch: Partial<SlotReserva>) {
    setJanelas(js => js.map(j => j.dia === dia
      ? { ...j, slots: j.slots.map((s, i) => i === idx ? { ...s, ...patch } : s) }
      : j,
    ));
  }
  function toggleSalao(dia: number, slotIdx: number, salaoId: string) {
    setJanelas(js => js.map(j => {
      if (j.dia !== dia) return j;
      return {
        ...j, slots: j.slots.map((s, i) => {
          if (i !== slotIdx) return s;
          const ja = s.salaoIds.includes(salaoId);
          return { ...s, salaoIds: ja ? s.salaoIds.filter(x => x !== salaoId) : [...s.salaoIds, salaoId] };
        }),
      };
    }));
  }

  async function salvar() {
    setErro("");
    const dur = parseInt(duracao, 10);
    if (!dur || dur < 15 || dur > 480) {
      setErro("Duração da reserva precisa ficar entre 15 e 480 minutos");
      return;
    }
    const antec = parseInt(janelaAntecedencia, 10);
    if (!antec || antec < 1 || antec > 365) {
      setErro("Janela de antecedência precisa ficar entre 1 e 365 dias");
      return;
    }
    // Validações por slot
    for (const j of janelas) {
      for (const s of j.slots) {
        if (!/^\d{2}:\d{2}$/.test(s.horario)) {
          setErro(`Horário inválido no ${DIAS.find(d => d.id === j.dia)?.label}: "${s.horario || "(vazio)"}". Use HH:MM`);
          return;
        }
        if (s.salaoIds.length === 0) {
          setErro(`Slot ${s.horario} no ${DIAS.find(d => d.id === j.dia)?.label}: escolha pelo menos 1 salão`);
          return;
        }
      }
    }
    // Ordena slots por horário pra UX
    const ordenadas = janelas.map(j => ({
      ...j,
      slots: [...j.slots].sort((a, b) => a.horario.localeCompare(b.horario)),
    }));

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: ConfiguracaoReservas = {
        id: restaurantId,
        restaurantId,
        janelas: ordenadas,
        duracaoSlotMin: dur,
        janelaAntecedenciaDias: antec,
        // Preserva templateConfirmacao do doc atual — sem isso, salvar
        // aqui zera o template editado em outra aba.
        ...(cfg?.templateConfirmacao ? { templateConfirmacao: cfg.templateConfirmacao } : {}),
        atualizadoEm: now,
        atualizadoPor: pessoaId,
      };
      await setDoc(doc(db, "configReservas", restaurantId), sanitizeForFirestore(payload));
    } catch (e) {
      console.error(e);
      setErro(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (saloes.filter(s => s.ativo).length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
        <div className="text-4xl mb-3">🏛️</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Cadastre salões primeiro</p>
        <p className="text-sm text-gray-500 mt-2">As janelas de horário precisam ao menos 1 salão ativo.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header com duração padrão + janela de antecedência */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Input
              label="Duração padrão da reserva (minutos)"
              type="number" min={15} max={480}
              value={duracao}
              onChange={(e) => setDuracao(e.target.value)}
              disabled={!podeConfig}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Tempo estimado que a mesa fica ocupada (cálculo de disponibilidade).
            </p>
          </div>
          <div>
            <Input
              label="Janela de antecedência (dias)"
              type="number" min={1} max={365}
              value={janelaAntecedencia}
              onChange={(e) => setJanelaAntecedencia(e.target.value)}
              disabled={!podeConfig}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Quantos dias à frente o cliente público pode reservar.
              Default: {DEFAULT_JANELA_ANTECEDENCIA_DIAS} (~3 meses).
            </p>
          </div>
        </div>
      </div>

      {/* Matriz dia × slots */}
      <div className="space-y-3">
        {DIAS.map(d => {
          const janela = janelas.find(j => j.dia === d.id) || { dia: d.id, slots: [] };
          return (
            <div key={d.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">{d.label}</h3>
                {podeConfig && (
                  <Button size="sm" variant="secondary" onClick={() => addSlot(d.id)}>+ horário</Button>
                )}
              </div>
              {janela.slots.length === 0 ? (
                <div className="text-xs text-gray-500 mt-2 italic">Sem reservas nesse dia.</div>
              ) : (
                <div className="space-y-2 mt-2">
                  {janela.slots.map((s, i) => (
                    <div key={i} className="border border-gray-200 dark:border-gray-800 rounded-lg p-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="time"
                          value={s.horario}
                          onChange={(e) => updateSlot(d.id, i, { horario: e.target.value })}
                          disabled={!podeConfig}
                          className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                        />
                        <span className="text-xs text-gray-500">salões neste horário:</span>
                        {saloes.filter(x => x.ativo).map(sal => {
                          const on = s.salaoIds.includes(sal.id);
                          return (
                            <button
                              key={sal.id}
                              type="button"
                              disabled={!podeConfig}
                              onClick={() => toggleSalao(d.id, i, sal.id)}
                              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                                on
                                  ? "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/40 dark:border-indigo-700 dark:text-indigo-300"
                                  : "bg-white border-gray-300 text-gray-600 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-400"
                              }`}
                            >
                              {on ? "✓ " : ""}{sal.nome}
                            </button>
                          );
                        })}
                        {podeConfig && (
                          <button
                            type="button"
                            onClick={() => removerSlot(d.id, i)}
                            className="ml-auto text-xs text-rose-600 hover:underline"
                          >
                            remover
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {erro && <div className="text-sm text-rose-600">{erro}</div>}

      {podeConfig && (
        <div className="flex justify-end gap-2 pt-2 sticky bottom-2">
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : cfg ? "Salvar alterações" : "Criar configuração"}
          </Button>
        </div>
      )}
    </div>
  );
}

// Garante que sempre existem 7 entries (1 por dia)
function normalizar(janelas: JanelaDiaReserva[] | undefined): JanelaDiaReserva[] {
  return DIAS.map(d => {
    const existing = janelas?.find(j => j.dia === d.id);
    return existing || { dia: d.id, slots: [] };
  });
}
