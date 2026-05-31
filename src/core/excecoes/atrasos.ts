// ════════════════════════════════════════════════════════════════════════════
//  Atrasos — auto-processamento ao gerar/atualizar relatório de ponto.
//
//  Pra cada exceção `atrasoEntrada` detectada:
//   1. Grava em escalas/{rid}_{ano-mes}.atrasos[empId][date] (minutos, previsto,
//      realizado, detectadoEm, eventoTrilhaId).
//   2. Cria evento `ponto_atraso` na Trilha do Empregado (idempotente via
//      refOrigem = "atraso:<empId>:<date>").
//   3. Não muda ScheduleStatus — célula da escala continua "trabalho", só
//      ganha o marcador 🕐.
//
//  Idempotente: roda toda vez que o líder atualiza o relatório, mas não
//  duplica eventos nem sobrescreve atrasos existentes.
// ════════════════════════════════════════════════════════════════════════════

import { doc, getDoc, updateDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { sanitizeForFirestore } from "../firebase/sanitize";
import { fmtAnoMes } from "../utils/date";
import type { AtrasoEscalaMeta } from "../types";
import type { ExceptionRecord } from "./types";

// Extrai minutos do detail/description do apontamento.
// Padrão: "Entrada às HH:MM (previsto HH:MM) — Xmin de atraso."
function extrairMinutos(exc: ExceptionRecord): number | null {
  const fonte = `${exc.detail || ""} ${exc.description || ""}`;
  // Procura "<num>min" ou "<num> min"
  const m = fonte.match(/(\d+)\s*min/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

function extrairHorarios(exc: ExceptionRecord): { previsto?: string; realizado?: string } {
  const fonte = `${exc.detail || ""} ${exc.description || ""}`;
  // "Entrada às HH:MM (previsto HH:MM)"
  const m = fonte.match(/(\d{2}:\d{2}).*previsto\s+(\d{2}:\d{2})/i);
  if (m) return { realizado: m[1], previsto: m[2] };
  return {};
}

export type ProcessarAtrasosInput = {
  restaurantId: string;
  excecoes: ExceptionRecord[];
  empIdByCpf: Map<string, string>;
  por: { id: string; nome?: string };
};

export type ProcessarAtrasosResult = {
  novos: number;
  jaExistentes: number;
  ignorados: number;       // empregadoId não encontrado pelo CPF
};

export async function processarAtrasos(input: ProcessarAtrasosInput): Promise<ProcessarAtrasosResult> {
  const { restaurantId, excecoes, empIdByCpf, por } = input;
  const atrasos = excecoes.filter(e => e.ruleId === "atrasoEntrada");
  if (atrasos.length === 0) return { novos: 0, jaExistentes: 0, ignorados: 0 };

  // Lazy load Trilha repository pra evitar ciclo de imports
  const { registrarEvento } = await import("../../modules/trilha/repository");

  // Agrupa por mês pra fazer 1 getDoc por mês
  const porMes = new Map<string, ExceptionRecord[]>();
  for (const exc of atrasos) {
    const yyyymm = exc.date.slice(0, 7);
    const arr = porMes.get(yyyymm) || [];
    arr.push(exc);
    porMes.set(yyyymm, arr);
  }

  let novos = 0;
  let jaExistentes = 0;
  let ignorados = 0;

  for (const [yyyymm, lista] of porMes) {
    const ano = parseInt(yyyymm.slice(0, 4), 10);
    const mes = parseInt(yyyymm.slice(5, 7), 10);
    const escalaId = `${restaurantId}_${fmtAnoMes(ano, mes)}`;
    const ref = doc(db, "escalas", escalaId);
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : null;
    const atrasosAtuais = (existing?.atrasos || {}) as Record<string, Record<string, AtrasoEscalaMeta>>;

    // Cria doc se não existir
    if (!snap.exists()) {
      await setDoc(ref, sanitizeForFirestore({
        id: escalaId,
        restaurantId,
        ano, mes,
        prevista: {},
        real: {},
        updatedAt: new Date().toISOString(),
      }));
    }

    const updates: Record<string, unknown> = {};
    const now = new Date().toISOString();

    for (const exc of lista) {
      const cpfD = (exc.cpf || "").replace(/\D/g, "");
      const empregadoId = empIdByCpf.get(cpfD);
      if (!empregadoId) { ignorados++; continue; }

      // Idempotência: se já tem atraso pra esse (empId, date), pula
      if (atrasosAtuais[empregadoId]?.[exc.date]) {
        jaExistentes++;
        continue;
      }

      const minutos = extrairMinutos(exc) ?? 0;
      const { previsto, realizado } = extrairHorarios(exc);

      // Registra evento na Trilha (idempotente via refOrigem)
      let eventoTrilhaId: string | undefined;
      try {
        eventoTrilhaId = await registrarEvento({
          restaurantId,
          empregadoId,
          empregadoNomeSnapshot: exc.employeeName,
          tipo: "ponto_atraso",
          data: exc.date,
          titulo: `Atraso de ${minutos}min`,
          descricao: exc.description,
          metadados: { minutos, previsto, realizado, ruleId: exc.ruleId },
          fonte: "auto",
          refOrigem: `atraso:${empregadoId}:${exc.date}`,
          registradoPor: { id: por.id, nome: por.nome || "—" },
        });
      } catch (e) {
        console.warn("[atrasos] falha ao registrar trilha:", e);
      }

      const meta: AtrasoEscalaMeta = {
        minutos,
        previsto,
        realizado,
        detectadoEm: now,
        eventoTrilhaId,
      };
      updates[`atrasos.${empregadoId}.${exc.date}`] = meta;
      novos++;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = now;
      await updateDoc(ref, sanitizeForFirestore(updates));
    }
  }

  return { novos, jaExistentes, ignorados };
}
