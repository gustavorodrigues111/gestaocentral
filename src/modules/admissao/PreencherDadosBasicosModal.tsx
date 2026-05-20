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

import { useMemo, useState } from "react";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { TimeInput } from "../../core/ui/TimeInput";
import type { Admissao, Cargo, HorarioDia, Restaurant } from "../../core/types";
import { atualizarDadosBasicos } from "../../core/admissao/admissaoHelpers";
import { useAuth } from "../../core/auth/AuthContext";
import {
  fmtHHMM,
  validateWorkScheduleDays,
} from "../../core/escala/horarios";

const DIAS_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ─── Máscara de salário em BRL ─────────────────────────────────────────────
// Aceita só dígitos do usuário, formata como "R$ X.XXX,XX". O número fica
// implícito nos centavos: "150" → "R$ 1,50". Apaga reinicia limpo.

function maskSalarioBRL(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  const cents = parseInt(digits, 10);
  if (!Number.isFinite(cents)) return "";
  const reais = cents / 100;
  return reais.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function parseSalarioBRL(masked: string): number | undefined {
  const digits = masked.replace(/\D/g, "");
  if (!digits) return undefined;
  const cents = parseInt(digits, 10);
  if (!Number.isFinite(cents) || cents <= 0) return undefined;
  return cents / 100;
}

function formatarSalarioBRL(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

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
  activeRestaurant: Restaurant;
  onClose: () => void;
  onSaved: () => void;
};

export function PreencherDadosBasicosModal({ admissao, cargos, activeRestaurant, onClose, onSaved }: Props) {
  const { pessoa: me } = useAuth();
  // Mesma config do módulo Pessoas: limites de carga semanal do restaurante.
  // Default CLT 44h/sem (entre 43h55 e 44h00).
  const cargaMinMin = activeRestaurant.horarioConfig?.cargaSemanalMinMin ?? 2635;
  const cargaMaxMin = activeRestaurant.horarioConfig?.cargaSemanalMaxMin ?? 2640;
  const [cargoId, setCargoId] = useState(admissao.cargoId || "");
  const [salario, setSalario] = useState(
    typeof admissao.salario === "number" ? formatarSalarioBRL(admissao.salario) : "",
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

  // Validação CLT em tempo real (reusa motor do módulo Pessoas/Escala).
  // Roda em todo render — barato porque são só 7 dias.
  const validacao = useMemo(
    () => validateWorkScheduleDays(dias, cargaMinMin, cargaMaxMin),
    [dias, cargaMinMin, cargaMaxMin],
  );
  const algumAtivo = Object.values(dias).some((d) => d.active);

  async function salvar() {
    setErro("");
    if (!cargoId) { setErro("Selecione o cargo."); return; }
    const salarioNum = parseSalarioBRL(salario);
    if (salario && salarioNum == null) {
      setErro("Salário inválido."); return;
    }
    if (!algumAtivo) {
      setErro("Marque pelo menos 1 dia ativo no horário.");
      return;
    }
    if (validacao.errors.length > 0) {
      setErro("Há violações CLT no horário — resolva pra salvar.");
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

    if (!me) { setErro("Sessão inválida. Tente recarregar a página."); return; }
    setSalvando(true);
    try {
      await atualizarDadosBasicos(admissao, {
        cargoId,
        salario: salarioNum,
        dataAdmissao: dataAdmissao || undefined,
        cargoConfianca,
        horariosCadastrados: Object.keys(horariosCadastrados).length > 0 ? horariosCadastrados : undefined,
      }, me);
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
            onChange={(e) => setSalario(maskSalarioBRL(e.target.value))}
            inputMode="numeric"
            placeholder="R$ 2.500,00"
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
            {/* Header só aparece em desktop. Em mobile cada linha vira card */}
            <div className="hidden sm:grid grid-cols-[60px_60px_1fr_1fr_80px] gap-2 text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold px-2">
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
                  className={`px-3 py-2 rounded-lg border ${
                    d.active ? "border-indigo-200 dark:border-indigo-900/40 bg-indigo-50/30 dark:bg-indigo-900/10" : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  {/* Desktop: 1 linha em grid. Mobile: empilha vertical */}
                  <div className="sm:grid sm:grid-cols-[60px_60px_1fr_1fr_80px] sm:gap-2 sm:items-center flex flex-col gap-2">
                    <div className="flex items-center justify-between sm:block">
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {DIAS_LABEL[i]}
                      </span>
                      {/* Em mobile, checkbox aparece junto do nome do dia */}
                      <label className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-400 sm:hidden">
                        <input
                          type="checkbox"
                          checked={d.active}
                          onChange={(e) => updDia(i, { active: e.target.checked })}
                          className="accent-indigo-600"
                        />
                        Ativo
                      </label>
                    </div>
                    {/* Checkbox separado em desktop */}
                    <input
                      type="checkbox"
                      checked={d.active}
                      onChange={(e) => updDia(i, { active: e.target.checked })}
                      className="accent-indigo-600 justify-self-center hidden sm:block"
                    />
                    <div className="grid grid-cols-3 gap-2 sm:contents">
                      <div className="flex flex-col gap-0.5 sm:contents">
                        <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold sm:hidden">Entrada</span>
                        <TimeInput
                          value={d.in || ""}
                          onChange={(v) => updDia(i, { in: v })}
                          placeholder="HH:MM"
                          disabled={!d.active}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5 sm:contents">
                        <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold sm:hidden">Saída</span>
                        <TimeInput
                          value={d.out || ""}
                          onChange={(v) => updDia(i, { out: v })}
                          placeholder="HH:MM"
                          disabled={!d.active}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5 sm:contents">
                        <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold sm:hidden">Interv. (min)</span>
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
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resumo da carga semanal + lista de violações CLT */}
        {algumAtivo && (
          <div className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Carga semanal: </span>
              <strong className={
                validacao.errors.some((e) => e.tipo === "carga_semanal")
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-700 dark:text-emerald-400"
              }>
                {fmtHHMM(validacao.totalContract)}
              </strong>
              <span className="text-gray-400"> (limite {fmtHHMM(cargaMinMin)}–{fmtHHMM(cargaMaxMin)})</span>
            </div>
            <div className="text-gray-500 dark:text-gray-400">
              {validacao.diasAtivos} dia(s) ativo(s)
            </div>
          </div>
        )}

        {validacao.errors.length > 0 && (
          <div className="rounded-lg border border-rose-300 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-900/20 p-3 space-y-1.5">
            <div className="text-xs font-bold text-rose-800 dark:text-rose-300">
              ⚠ {validacao.errors.length} violação(ões) CLT — bloqueia salvar:
            </div>
            <ul className="space-y-1">
              {validacao.errors.map((er, i) => (
                <li key={i} className="text-[11px] text-rose-800 dark:text-rose-300 flex items-start gap-1.5">
                  <span className="font-mono text-[10px] text-rose-700/80 dark:text-rose-400/70 shrink-0 pt-0.5">{er.artigo}</span>
                  <span>{er.mensagem}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            onClick={salvar}
            disabled={salvando || validacao.errors.length > 0}
            title={validacao.errors.length > 0 ? "Resolva as violações CLT antes de salvar" : undefined}
          >
            {salvando ? "Salvando…" : "💾 Salvar dados básicos"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
