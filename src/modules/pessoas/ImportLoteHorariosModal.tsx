import { useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { useEffect } from "react";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import type { Empregado, HorarioDia, SundayCycle, WorkSchedule } from "../../core/types";

// PROVISÓRIO — botão "Importar horários" no módulo Pessoas, restrito ao master.
// Cola JSON com 1 entry por empregado (busca por CPF), adiciona uma nova
// WorkSchedule no array workSchedules de cada um. Não sobrescreve nem deleta
// — só empurra a nova versão (que vira a vigente pelo lifecycle de validFrom).

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// HH:MM válido
function isHHMM(s: unknown): boolean {
  return typeof s === "string" && /^\d{1,2}:\d{2}$/.test(s);
}

type ItemSingle = {
  cpf: string;
  nome?: string;             // só pra log
  validFrom: string;         // YYYY-MM-DD
  type: "single";
  days: Partial<Record<"0"|"1"|"2"|"3"|"4"|"5"|"6", HorarioDia>>;
  sundayCycle?: SundayCycle | null;
  motivo?: string;
};

type ItemAlternating = {
  cpf: string;
  nome?: string;
  validFrom: string;
  type: "alternating";
  weeks: {
    A: { days: Partial<Record<string, HorarioDia>>; sundayCycle?: SundayCycle | null };
    B: { days: Partial<Record<string, HorarioDia>>; sundayCycle?: SundayCycle | null };
  };
  anchor: { date: string; week: "A" | "B" };
  motivo?: string;
};

type ItemImport = ItemSingle | ItemAlternating;

type ItemValidado =
  | { ok: true; item: ItemImport; cpfDigits: string }
  | { ok: false; raw: unknown; errors: string[] };

function validarDays(daysRaw: unknown, ctxLabel: string): { ok: boolean; days: { [k: number]: HorarioDia }; erros: string[] } {
  const erros: string[] = [];
  const out: { [k: number]: HorarioDia } = {};
  if (!daysRaw || typeof daysRaw !== "object") {
    erros.push(`${ctxLabel}: days ausente ou inválido`);
    return { ok: false, days: out, erros };
  }
  const entries = Object.entries(daysRaw as Record<string, unknown>);
  for (const [k, v] of entries) {
    const di = parseInt(k, 10);
    if (Number.isNaN(di) || di < 0 || di > 6) {
      erros.push(`${ctxLabel}: dia "${k}" inválido (use 0..6, 0=Dom 6=Sáb)`);
      continue;
    }
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const active = o.active === false ? false : true;
    if (!active) {
      out[di] = { active: false };
      continue;
    }
    if (!isHHMM(o.in))  { erros.push(`${ctxLabel}: dia ${di}.in inválido`); continue; }
    if (!isHHMM(o.out)) { erros.push(`${ctxLabel}: dia ${di}.out inválido`); continue; }
    const brk = typeof o.break === "number" ? o.break : Number(o.break) || 0;
    out[di] = {
      active: true,
      in: o.in as string,
      out: o.out as string,
      break: brk,
      ...(o.unidadeId ? { unidadeId: o.unidadeId as string } : {}),
    };
  }
  return { ok: erros.length === 0, days: out, erros };
}

function validarItem(raw: unknown): ItemValidado {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, raw, errors: ["item não é um objeto"] };
  const r = raw as Record<string, unknown>;

  const cpfDigits = onlyDigits(String(r.cpf ?? ""));
  if (cpfDigits.length !== 11) errors.push(`cpf inválido (${cpfDigits.length} dígitos, esperado 11)`);

  const validFrom = typeof r.validFrom === "string" ? r.validFrom : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) errors.push(`validFrom inválido (use YYYY-MM-DD)`);

  const type = r.type === "alternating" ? "alternating" : "single";

  let item: ItemImport;
  if (type === "single") {
    const vd = validarDays(r.days, "days");
    errors.push(...vd.erros);
    item = {
      cpf: cpfDigits,
      nome: typeof r.nome === "string" ? r.nome : undefined,
      validFrom,
      type: "single",
      days: vd.days as ItemSingle["days"],
      sundayCycle: (r.sundayCycle as SundayCycle) || null,
      motivo: typeof r.motivo === "string" ? r.motivo : undefined,
    };
  } else {
    const weeksRaw = r.weeks as { A?: { days?: unknown; sundayCycle?: SundayCycle | null }; B?: { days?: unknown; sundayCycle?: SundayCycle | null } } | undefined;
    if (!weeksRaw || !weeksRaw.A || !weeksRaw.B) {
      errors.push(`weeks: precisa ter A e B`);
    }
    const a = validarDays(weeksRaw?.A?.days, "weeks.A.days");
    const b = validarDays(weeksRaw?.B?.days, "weeks.B.days");
    errors.push(...a.erros, ...b.erros);
    const anchor = r.anchor as { date?: string; week?: "A"|"B" } | undefined;
    if (!anchor?.date || !/^\d{4}-\d{2}-\d{2}$/.test(anchor.date)) errors.push("anchor.date inválido");
    if (anchor?.week !== "A" && anchor?.week !== "B") errors.push("anchor.week deve ser A ou B");
    item = {
      cpf: cpfDigits,
      nome: typeof r.nome === "string" ? r.nome : undefined,
      validFrom,
      type: "alternating",
      weeks: {
        A: { days: a.days as Partial<Record<string, HorarioDia>>, sundayCycle: weeksRaw?.A?.sundayCycle || null },
        B: { days: b.days as Partial<Record<string, HorarioDia>>, sundayCycle: weeksRaw?.B?.sundayCycle || null },
      },
      anchor: { date: anchor!.date!, week: anchor!.week! },
      motivo: typeof r.motivo === "string" ? r.motivo : undefined,
    };
  }

  if (errors.length > 0) return { ok: false, raw, errors };
  return { ok: true, item, cpfDigits };
}

// Calcula totalContract em minutos (soma de jornada líquida da semana)
function totalContractMinutos(days: { [k: number]: HorarioDia }): number {
  let total = 0;
  for (const d of Object.values(days)) {
    if (!d.active || !d.in || !d.out) continue;
    const [hi, mi] = d.in.split(":").map(Number);
    const [ho, mo] = d.out.split(":").map(Number);
    let inicio = hi * 60 + mi;
    let fim = ho * 60 + mo;
    if (fim < inicio) fim += 24 * 60;
    total += Math.max(0, fim - inicio - (d.break || 0));
  }
  return total;
}

type Props = {
  restaurantId: string;
  onClose: () => void;
};

const EXEMPLO_SINGLE = JSON.stringify([{
  cpf: "12345678901",
  nome: "João Silva (informativo, busca pelo CPF)",
  validFrom: "2026-01-01",
  type: "single",
  days: {
    "1": { "in": "14:00", "out": "23:00", "break": 60 },
    "2": { "in": "14:00", "out": "23:00", "break": 60 },
    "3": { "in": "14:00", "out": "23:00", "break": 60 },
    "4": { "in": "14:00", "out": "23:00", "break": 60 },
    "5": { "in": "14:00", "out": "23:00", "break": 60 },
    "6": { "in": "14:00", "out": "23:00", "break": 60 },
  },
  sundayCycle: { workCount: 3, offCount: 1, refDate: "2026-01-04" },
}], null, 2);

export function ImportLoteHorariosModal({ restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [raw, setRaw] = useState("");
  const [parseErr, setParseErr] = useState("");
  const [resultados, setResultados] = useState<ItemValidado[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);

  // Carrega empregados ativos pra mapear CPF → empregadoId
  useEffect(() => {
    if (!restaurantId) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", restaurantId));
    return onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado));
    });
  }, [restaurantId]);

  const empPorCpf = useMemo(() => {
    const m = new Map<string, Empregado>();
    for (const e of empregados) {
      const c = onlyDigits(e.cpf || "");
      if (c.length === 11) m.set(c, e);
    }
    return m;
  }, [empregados]);

  const validos = useMemo(
    () => (resultados || []).filter((r): r is Extract<ItemValidado, { ok: true }> => r.ok),
    [resultados],
  );
  const invalidos = useMemo(
    () => (resultados || []).filter((r): r is Extract<ItemValidado, { ok: false }> => !r.ok),
    [resultados],
  );

  function validar() {
    setParseErr(""); setResultados(null); setImportLog([]);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch (e) { setParseErr(`JSON inválido: ${e instanceof Error ? e.message : String(e)}`); return; }
    if (!Array.isArray(parsed)) { setParseErr("JSON precisa ser um array"); return; }
    setResultados(parsed.map(validarItem));
  }

  async function importar() {
    if (!me) return;
    if (validos.length === 0) return;
    setImporting(true);
    const log: string[] = [];
    let criados = 0, pulados = 0, semCpf = 0, falhas = 0;

    for (const { item, cpfDigits } of validos) {
      const emp = empPorCpf.get(cpfDigits);
      if (!emp) {
        log.push(`⚠️ ${item.nome || cpfDigits} — CPF não encontrado em empregados deste restaurante. Cadastre primeiro.`);
        semCpf++;
        setImportLog([...log]);
        continue;
      }

      // Dedup por validFrom: se já existe WorkSchedule com mesmo validFrom, pula
      const existentes = emp.workSchedules || [];
      const jaTem = existentes.some((w) => w.validFrom === item.validFrom);
      if (jaTem) {
        log.push(`⏭ ${emp.nome} — já existe WorkSchedule com validFrom=${item.validFrom}, pulado`);
        pulados++;
        setImportLog([...log]);
        continue;
      }

      try {
        const nowIso = new Date().toISOString();
        let novoSchedule: WorkSchedule;
        if (item.type === "single") {
          const total = totalContractMinutos(item.days as { [k: number]: HorarioDia });
          novoSchedule = {
            validFrom: item.validFrom,
            type: "single",
            totalContract: total,
            days: item.days as { [k: number]: HorarioDia },
            ...(item.sundayCycle ? { sundayCycle: item.sundayCycle } : {}),
            registradoEm: nowIso,
            registradoPor: me.id,
            ...(item.motivo ? { motivo: item.motivo } : { motivo: "Importação em lote" }),
          };
        } else {
          const totalA = totalContractMinutos(item.weeks.A.days as { [k: number]: HorarioDia });
          const totalB = totalContractMinutos(item.weeks.B.days as { [k: number]: HorarioDia });
          novoSchedule = {
            validFrom: item.validFrom,
            type: "alternating",
            totalContract: Math.round((totalA + totalB) / 2),
            weeks: {
              A: {
                days: item.weeks.A.days as { [k: number]: HorarioDia },
                totalContract: totalA,
                ...(item.weeks.A.sundayCycle ? { sundayCycle: item.weeks.A.sundayCycle } : {}),
              },
              B: {
                days: item.weeks.B.days as { [k: number]: HorarioDia },
                totalContract: totalB,
                ...(item.weeks.B.sundayCycle ? { sundayCycle: item.weeks.B.sundayCycle } : {}),
              },
            },
            anchor: item.anchor,
            registradoEm: nowIso,
            registradoPor: me.id,
            ...(item.motivo ? { motivo: item.motivo } : { motivo: "Importação em lote" }),
          };
        }

        const novoArray = [...existentes, novoSchedule].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
        await updateDoc(doc(db, "empregados", emp.id), {
          workSchedules: novoArray,
        });
        const totalHoras = (novoSchedule.totalContract / 60).toFixed(1);
        log.push(`✅ ${emp.nome} — ${item.type} ${item.validFrom} (~${totalHoras}h/sem)`);
        criados++;
        setImportLog([...log]);
      } catch (e) {
        falhas++;
        log.push(`❌ ${emp.nome} — erro: ${e instanceof Error ? e.message : String(e)}`);
        setImportLog([...log]);
      }
    }

    log.push("");
    log.push(`Fim. ${criados} criado(s), ${pulados} pulado(s), ${semCpf} sem CPF correspondente, ${falhas} falha(s).`);
    setImportLog([...log]);
    setImporting(false);
  }

  return (
    <Modal title="🧪 Importar lote de horários (provisório)" onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-3 text-sm">
        <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
          <p>
            <strong>Cole um JSON</strong> array com 1 entry por empregado.
            Cada entry adiciona UMA nova <code>WorkSchedule</code> ao histórico do empregado.
            Match feito por <strong>CPF</strong>.
          </p>
          <p>
            Tipos suportados: <code>type: "single"</code> (horário fixo) ou
            <code> "alternating"</code> (semana A/B).
            Dias da semana: <code>"0"</code> a <code>"6"</code> (0=Dom, 6=Sáb).
            <code> in/out</code> em HH:MM (overnight ok),
            <code> break</code> em minutos.
          </p>
          <p>
            <strong>Dedup:</strong> empregado que já tem WorkSchedule com mesmo
            <code> validFrom</code> é pulado (não duplica). Pra atualizar uma
            versão existente, mude o <code>validFrom</code>.
          </p>
        </div>

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={EXEMPLO_SINGLE}
          className="w-full h-72 font-mono text-xs p-3 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />

        {parseErr && <div className="text-xs text-red-600 dark:text-red-400">{parseErr}</div>}

        <div className="flex justify-between gap-2 flex-wrap">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRaw(EXEMPLO_SINGLE)}>
              Colar exemplo (single)
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setRaw(""); setResultados(null); setImportLog([]); }}>
              Limpar
            </Button>
          </div>
          <div className="flex gap-2">
            <Button onClick={validar}>1. Validar</Button>
            <Button
              onClick={importar}
              disabled={!resultados || validos.length === 0 || invalidos.length > 0 || importing}
            >
              {importing ? "Importando…" : `2. Importar ${validos.length} horário(s)`}
            </Button>
          </div>
        </div>

        {resultados && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-2">
            <div className="text-xs font-semibold">
              Preview: {validos.length} válido(s), {invalidos.length} com erro
            </div>
            {invalidos.length > 0 && (
              <div className="text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2 space-y-1">
                <div className="font-semibold text-red-700 dark:text-red-300">Itens inválidos:</div>
                {invalidos.map((it, i) => (
                  <div key={i} className="text-red-700 dark:text-red-300">
                    #{i + 1}: {it.errors.join(" · ")}
                  </div>
                ))}
              </div>
            )}
            {validos.length > 0 && (
              <div className="text-xs space-y-1 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded p-2">
                {validos.map((v, i) => {
                  const emp = empPorCpf.get(v.cpfDigits);
                  return (
                    <div key={i} className="flex justify-between gap-2">
                      <span>
                        <strong>{v.item.nome || v.cpfDigits}</strong> · {v.item.type} · validFrom={v.item.validFrom}
                      </span>
                      <span className={emp ? "text-emerald-700" : "text-amber-700"}>
                        {emp ? `→ ${emp.nome}` : "⚠️ CPF não cadastrado"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {importLog.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <div className="text-xs font-semibold mb-1">Log:</div>
            <pre className="text-[11px] font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded p-2 max-h-64 overflow-y-auto">
{importLog.join("\n")}
            </pre>
          </div>
        )}
      </div>
    </Modal>
  );
}
