// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — pega o quadro de horários (work schedule) de TODOS
//  os empregados ativos da Sólides em UMA chamada. Faz:
//    1) GET /employee/find-all → lista empregados ativos
//    2) Pra cada empregado, em paralelo, GET /employee-work-schedule/{id}?date=
//    3) Normaliza pra { byDay: {0..6}: {active, in, out, break} }
//
//  GET /api/solides-work-schedules?restaurant=SRC&date=YYYY-MM-DD
//    → 200 { schedules: { [employeeId]: NormalizedSchedule | null }, count, errors }
//    → 4xx/5xx { error }
//
//  Estrutura da resposta crua do Tangerino:
//    {
//      schedule: {
//        id, name, standard,
//        workScheduleTimetableList: [
//          {
//            day,                   // 1=dom, 2=seg, ..., 7=sáb (Java Calendar)
//            startShift1, endShift1, startShift2, endShift2,  // ms UTC do dia
//            startMainInterval, endMainInterval,              // janela do almoço
//          }
//        ]
//      }
//    }
//
//  Horários vêm em ms desde 00:00 UTC. Pra exibir em BRT, subtrai 3h (10800000ms).
//  Dias 1..7 (Java) viram 0..6 (DOW JS) pra casar com o Empregado.workSchedules.
// ════════════════════════════════════════════════════════════════════════════

const EMPLOYEE_LIST_API = "https://employer.tangerino.com.br/employee/find-all";
const WORK_SCHEDULE_API = "https://employer.tangerino.com.br/employee-work-schedule";
const PAGE_SIZE = 200;
const MAX_PAGES = 20;
const REQ_TIMEOUT_MS = 25_000;
const BRT_OFFSET_MIN = -180; // BRT = UTC-3

type VercelReq = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
};
type VercelRes = {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

function resolveToken(restaurantKey: string): { token: string } | { error: string; status: number } {
  const mapRaw = process.env.SOLIDES_TOKENS;
  if (!mapRaw) return { error: "SOLIDES_TOKENS não configurado.", status: 500 };
  let map: Record<string, string>;
  try {
    map = JSON.parse(mapRaw) as Record<string, string>;
  } catch {
    return { error: "SOLIDES_TOKENS com JSON inválido.", status: 500 };
  }
  const token = map[restaurantKey];
  if (!token) return { error: `Sem token pra restaurante "${restaurantKey}".`, status: 400 };
  return { token };
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const r = await fetchJsonWithMeta(url, token);
  return r.data;
}

// Versão que devolve também status HTTP e amostra do body pra debug.
async function fetchJsonWithMeta(
  url: string,
  token: string,
): Promise<{ data: unknown; status: number; bodyPreview: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    const bodyPreview = text.slice(0, 200);
    if (resp.status === 404) return { data: null, status: resp.status, bodyPreview };
    if (!resp.ok) {
      throw new HttpError(502, `HTTP ${resp.status} em ${url}. ${bodyPreview}`);
    }
    try {
      return { data: JSON.parse(text), status: resp.status, bodyPreview };
    } catch {
      throw new HttpError(502, `Resposta não-JSON em ${url}: ${bodyPreview}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ms desde 00:00 UTC → "HH:MM" em BRT
function msToBrTime(ms: number | undefined | null): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const totalMin = Math.round(ms / 60000) + BRT_OFFSET_MIN;
  const wrapped = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// day 1..7 (Java) → 0..6 (JS DOW: 0=dom, 6=sáb)
function javaDayToJsDow(d: number): number {
  return ((d - 1) % 7 + 7) % 7;
}

type Timetable = {
  day?: number;
  startShift1?: number;
  endShift1?: number;
  startShift2?: number;
  endShift2?: number;
  startMainInterval?: number;
  endMainInterval?: number;
};

type NormalizedDay =
  | { active: true; in: string; out: string; break: number }
  | { active: false };

type NormalizedSchedule = {
  scheduleId: number | null;
  scheduleName: string | null;
  byDay: Record<number, NormalizedDay>;
};

function normalizeSchedule(raw: unknown): NormalizedSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { schedule?: { id?: unknown; name?: unknown; workScheduleTimetableList?: unknown } };
  const sched = obj.schedule;
  if (!sched) return null;
  const list = Array.isArray(sched.workScheduleTimetableList)
    ? (sched.workScheduleTimetableList as Timetable[])
    : [];
  const byDay: Record<number, NormalizedDay> = {
    0: { active: false }, 1: { active: false }, 2: { active: false },
    3: { active: false }, 4: { active: false }, 5: { active: false },
    6: { active: false },
  };
  for (const t of list) {
    if (typeof t.day !== "number") continue;
    const dow = javaDayToJsDow(t.day);
    const inTime  = msToBrTime(t.startShift1);
    const outTime = msToBrTime(t.endShift2 ?? t.endShift1);
    if (!inTime || !outTime) continue;
    // Intervalo = endShift1 → startShift2, ou janela main se faltar
    let breakMin = 0;
    if (typeof t.endShift1 === "number" && typeof t.startShift2 === "number") {
      breakMin = Math.max(0, Math.round((t.startShift2 - t.endShift1) / 60000));
    } else if (typeof t.startMainInterval === "number" && typeof t.endMainInterval === "number") {
      breakMin = Math.max(0, Math.round((t.endMainInterval - t.startMainInterval) / 60000));
    }
    byDay[dow] = { active: true, in: inTime, out: outTime, break: breakMin };
  }
  return {
    scheduleId: typeof sched.id === "number" ? sched.id : null,
    scheduleName: typeof sched.name === "string" ? sched.name : null,
    byDay,
  };
}

async function listEmployees(token: string): Promise<{ id: number; name: string; cpf: string }[]> {
  const all: { id: number; name: string; cpf: string }[] = [];
  let page = 0;
  while (page < MAX_PAGES) {
    const url = `${EMPLOYEE_LIST_API}?page=${page}&size=${PAGE_SIZE}&showFired=false`;
    const data = (await fetchJson(url, token)) as { content?: unknown[]; last?: boolean } | null;
    if (!data) break;
    const content = Array.isArray(data.content) ? data.content : [];
    type Raw = { id?: unknown; name?: unknown; cpf?: unknown };
    for (const e of content) {
      const r = e as Raw;
      const id = typeof r.id === "number" ? r.id : Number(r.id);
      if (!Number.isFinite(id)) continue;
      all.push({
        id,
        name: typeof r.name === "string" ? r.name : "",
        cpf: typeof r.cpf === "string" ? r.cpf.replace(/\D/g, "") : "",
      });
    }
    if (data.last === true || content.length === 0 || content.length < PAGE_SIZE) break;
    page += 1;
  }
  return all;
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  const restaurantKey = String(req.query.restaurant ?? "").trim();
  const date = String(req.query.date ?? "").trim();
  const datesRaw = String(req.query.dates ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) && !datesRaw) {
    res.status(400).json({ error: "Informe date= (YYYY-MM-DD) ou dates= (CSV)." });
    return;
  }
  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;
  function ymdToMs(ymd: string): number {
    const [yy, mm, dd] = ymd.split("-").map(Number);
    return Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0);
  }
  // A Sólides retorna o quadro vigente NA data informada — mas devolve null
  // de forma inconsistente pra algumas datas mesmo quando o quadro existe
  // (bug observado em produção). Solução: tentar várias datas em ordem,
  // pegar a primeira que retornar um quadro real.
  const datesToTry: string[] = datesRaw
    ? datesRaw.split(",").map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
    : [date];
  if (datesToTry.length === 0) {
    res.status(400).json({ error: "Nenhuma data válida em dates=." });
    return;
  }

  try {
    const employees = await listEmployees(token);
    const results: Record<string, NormalizedSchedule | null> = {};
    const errors: { employeeId: number; name: string; error: string; triedDates?: string[] }[] = [];
    const dateUsed: Record<string, string | null> = {};
    // Debug: amostra da resposta crua pra UM empregado-chave (o 1º que tentar)
    let sampleProbe: { employeeId: number; name: string; tryDate: string; url: string; status: number; bodyPreview: string; parsedShape: string } | null = null;
    const CONCURRENCY = 5;
    let idx = 0;
    async function worker() {
      while (idx < employees.length) {
        const i = idx++;
        const emp = employees[i];
        let schedule: NormalizedSchedule | null = null;
        let usedDate: string | null = null;
        const tried: string[] = [];
        for (const tryDate of datesToTry) {
          tried.push(tryDate);
          const ms = ymdToMs(tryDate);
          const url = `${WORK_SCHEDULE_API}/${emp.id}?date=${ms}`;
          try {
            const meta = await fetchJsonWithMeta(url, token);
            // Captura amostra da PRIMEIRA chamada do PRIMEIRO empregado pro debug
            if (!sampleProbe) {
              const d = meta.data;
              let parsedShape = "null/undefined";
              if (d && typeof d === "object") {
                const keys = Object.keys(d as Record<string, unknown>);
                parsedShape = `object com keys: [${keys.join(", ")}]`;
                const sched = (d as { schedule?: unknown }).schedule;
                if (sched === undefined) parsedShape += " (schedule UNDEFINED)";
                else if (sched === null) parsedShape += " (schedule NULL)";
                else if (typeof sched === "object") {
                  const sk = Object.keys(sched as Record<string, unknown>);
                  parsedShape += ` (schedule é objeto com keys: [${sk.join(", ")}])`;
                }
              }
              sampleProbe = {
                employeeId: emp.id,
                name: emp.name,
                tryDate,
                url,
                status: meta.status,
                bodyPreview: meta.bodyPreview,
                parsedShape,
              };
            }
            const norm = normalizeSchedule(meta.data);
            if (norm) {
              schedule = norm;
              usedDate = tryDate;
              break;
            }
          } catch (e) {
            errors.push({
              employeeId: emp.id,
              name: emp.name,
              error: e instanceof Error ? e.message : String(e),
              triedDates: [...tried],
            });
          }
        }
        results[String(emp.id)] = schedule;
        dateUsed[String(emp.id)] = usedDate;
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    res.status(200).json({
      employees,
      schedules: results,
      count: Object.keys(results).length,
      dateUsed,
      errors,
      sampleProbe,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "Erro desconhecido." });
  }
}
