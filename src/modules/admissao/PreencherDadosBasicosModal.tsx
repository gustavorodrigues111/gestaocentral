// ════════════════════════════════════════════════════════════════════════════
//  Modal "Preencher dados básicos" — RH define cargo, salário, data de
//  admissão e horário da semana. Pode ser chamado a qualquer momento
//  (antes ou depois do envio do link).
//
//  Horário: editor simplificado por dia da semana (dom-sáb). Cada dia
//  pode ser ativo ou folga; se ativo, entrada/saída/intervalo.
//  Equivalente estrutural a um WorkSchedule.days do módulo Escala, mas
//  sem alternating (single only — admissão MVP).
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { TimeInput } from "../../core/ui/TimeInput";
import type { Admissao, Cargo, HorarioDia } from "../../core/types";
import { atualizarDadosBasicos } from "../../core/admissao/admissaoHelpers";

const DIAS_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type DiasState = Record<number, HorarioDia>;

function diasIniciais(salvos?: Record<string, unknown>): DiasState {
  const out: DiasState = {};
  for (let i = 0; i < 7; i++) {
    const s = (salvos?.[String(i)] as HorarioDia | undefined);
    out[i] = {
      active: s?.active || false,
      in: s?.in || "",
      out: s?.out || "",
      break: s?.break || 0,
    };
  }
  return out;
}

type Props = {
  admissao: Admissao;
  cargos: Cargo[];
  onClose: () => void;
  onSaved: () => void;
};

export function PreencherDadosBasicosModal({ admissao, cargos, onClose, onSaved }: Props) {
  const [cargoId, setCargoId] = useState(admissao.cargoId || "");
  const [salario, setSalario] = useState(
    typeof admissao.salario === "number" ? String(admissao.salario).replace(".", ",") : "",
  );
  const [dataAdmissao, setDataAdmissao] = useState(admissao.dataAdmissao || "");
  const [cargoConfianca, setCargoConfianca] = useState(!!admissao.cargoConfianca);
  const [dias, setDias] = useState<DiasState>(diasIniciais(admissao.horariosCadastrados));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const cargosAtivos = cargos.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome));

  function updDia(idx: number, patch: Partial<HorarioDia>) {
    setDias((cur) => ({ ...cur, [idx]: { ...cur[idx], ...patch } }));
  }

  async function salvar() {
    setErro("");
    if (!cargoId) { setErro("Selecione o cargo."); return; }
    const salarioNum = salario ? parseFloat(salario.replace(",", ".")) : undefined;
    if (salario && (!salarioNum || Number.isNaN(salarioNum))) {
      setErro("Salário inválido."); return;
    }
    // Validação leve: pelo menos 1 dia ativo com entrada/saída
    const algumValido = Object.values(dias).some(
      (d) => d.active && d.in && d.out,
    );
    if (!algumValido && Object.values(dias).some((d) => d.active)) {
      setErro("Preencha entrada e saída nos dias ativos.");
      return;
    }

    // Monta o objeto a salvar — só inclui dias ativos OU com info
    const horariosCadastrados: Record<string, HorarioDia> = {};
    for (const [k, d] of Object.entries(dias)) {
      if (d.active || d.in || d.out || d.break) {
        horariosCadastrados[k] = {
          active: d.active,
          in: d.in || "",
          out: d.out || "",
          break: d.break || 0,
        };
      }
    }

    setSalvando(true);
    try {
      await atualizarDadosBasicos(admissao.id, {
        cargoId,
        salario: salarioNum,
        dataAdmissao: dataAdmissao || undefined,
        cargoConfianca,
        horariosCadastrados: Object.keys(horariosCadastrados).length > 0 ? horariosCadastrados : undefined,
      });
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  return (
    <Modal
      title={`Dados básicos da vaga — ${admissao.candidato.nome}`}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Esses dados são da empresa (não do candidato). Pra avançar pra
          "Solicitação Enviada pra Contabilidade" todos precisam estar preenchidos.
        </p>

        {/* Cargo / Salário / Data */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Cargo *</label>
            <select
              value={cargoId}
              onChange={(e) => setCargoId(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              <option value="">— selecione —</option>
              {cargosAtivos.map((c) => (
                <option key={c.id} value={c.id}>{c.nome} ({c.area})</option>
              ))}
            </select>
          </div>
          <Input
            label="Salário *"
            value={salario}
            onChange={(e) => setSalario(e.target.value)}
            inputMode="decimal"
            placeholder="2500,00"
          />
          <Input
            label="Data de admissão *"
            type="date"
            value={dataAdmissao}
            onChange={(e) => setDataAdmissao(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 select-none mt-6">
            <input
              type="checkbox"
              checked={cargoConfianca}
              onChange={(e) => setCargoConfianca(e.target.checked)}
              className="accent-indigo-600"
            />
            Cargo de confiança
          </label>
        </div>

        {/* Horário */}
        <div className="space-y-2">
          <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">
            🕐 Horário de trabalho *
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Marque os dias ativos e informe entrada, saída e intervalo (min). Dias
            sem marcação ficam como folga.
          </p>
          <div className="space-y-1.5">
            <div className="grid grid-cols-[60px_60px_1fr_1fr_80px] gap-2 text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold px-2">
              <div>Dia</div>
              <div>Ativo</div>
              <div>Entrada</div>
              <div>Saída</div>
              <div>Interv.</div>
            </div>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const d = dias[i];
              return (
                <div
                  key={i}
                  className={`grid grid-cols-[60px_60px_1fr_1fr_80px] gap-2 items-center px-2 py-1.5 rounded-lg border ${
                    d.active ? "border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/30 dark:bg-indigo-900/10" : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {DIAS_LABEL[i]}
                  </div>
                  <input
                    type="checkbox"
                    checked={d.active}
                    onChange={(e) => updDia(i, { active: e.target.checked })}
                    className="accent-indigo-600 justify-self-center"
                  />
                  <TimeInput
                    value={d.in || ""}
                    onChange={(v) => updDia(i, { in: v })}
                    placeholder="HH:MM"
                    disabled={!d.active}
                  />
                  <TimeInput
                    value={d.out || ""}
                    onChange={(v) => updDia(i, { out: v })}
                    placeholder="HH:MM"
                    disabled={!d.active}
                  />
                  <input
                    type="number"
                    min={0}
                    max={300}
                    step={5}
                    value={d.break || 0}
                    onChange={(e) => updDia(i, { break: parseInt(e.target.value, 10) || 0 })}
                    disabled={!d.active}
                    className="w-full text-sm px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 disabled:bg-gray-100 dark:disabled:bg-gray-800"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "💾 Salvar dados básicos"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
