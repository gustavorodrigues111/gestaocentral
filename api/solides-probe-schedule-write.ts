// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — sondagem do método PUT em /employee-work-schedule
//  da Sólides (Tangerino). Objetivo: descobrir SEM RISCO se a API aceita
//  escrita do quadro de horários com o token que temos.
//
//  Estratégia "echo": faz GET pra pegar o quadro atual cru, e em seguida
//  PUT no mesmo endpoint com o BODY IDÊNTICO ao recebido. Se a API
//  processar e retornar 200/2xx, escrita está liberada. Se 401/403,
//  token é read-only. Se 405, endpoint não suporta PUT. Se 400, a Sólides
//  espera campos diferentes — devolvemos o body pra inspeção.
//
//  POST /api/solides-probe-schedule-write?restaurant=SOR&employeeId=12345
//    → 200 {
//        getStatus, getBodyPreview,
//        putStatus, putBodyPreview, putHeaders,
//        echoBytes,  // tamanho do body reenviado
//      }
//    → 4xx { error }
//
//  IMPORTANTE: nenhuma modificação real de dados — o body do PUT é o
//  output exato do GET prévio. Mas a Sólides PODE registrar a chamada
//  em log/auditoria interna. Use só com 1 empregado escolhido como
//  cobaia (cadastro de teste / freela / estagiário).
// ════════════════════════════════════════════════════════════════════════════

const WORK_SCHEDULE_API = "https://employer.tangerino.com.br/employee-work-schedule";
const REQ_TIMEOUT_MS = 25_000;

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

// API Tangerino espera `date` como epoch ms (Long), NÃO como string YYYY-MM-DD.
// Passar string dá 400 "Failed to convert value of type java.lang.String to
// required type java.lang.Long".
function todayMs(): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // meio-dia local pra não ter ambiguidade de fuso
  return d.getTime();
}

async function doFetch(url: string, init: RequestInit): Promise<{ status: number; bodyText: string; headers: Record<string, string> }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    const bodyText = await resp.text();
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => { headers[k] = v; });
    return { status: resp.status, bodyText, headers };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new HttpError(504, `Timeout consultando Sólides (${REQ_TIMEOUT_MS / 1000}s).`);
    }
    throw new HttpError(502, `Falha de rede: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const restaurantKey = String(req.query.restaurant ?? "").trim();
  const employeeIdRaw = String(req.query.employeeId ?? "").trim();
  const employeeId = parseInt(employeeIdRaw, 10);
  if (!restaurantKey) {
    res.status(400).json({ error: "Parâmetro restaurant obrigatório." });
    return;
  }
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    res.status(400).json({ error: "Parâmetro employeeId (numérico) obrigatório." });
    return;
  }

  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  try {
    // 1) GET quadro atual
    const getUrl = `${WORK_SCHEDULE_API}/${employeeId}?date=${todayMs()}`;
    const getResp = await doFetch(getUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${token}`,
        Accept: "application/json",
      },
    });

    // Se GET já não passou, não tem sentido tentar PUT
    if (getResp.status >= 400) {
      res.status(200).json({
        ok: false,
        step: "get",
        getStatus: getResp.status,
        getBodyPreview: getResp.bodyText.slice(0, 500),
        diagnostic: getResp.status === 404
          ? "Empregado sem quadro cadastrado pra essa data — escolha outro pra sondar."
          : "GET falhou; token pode estar inválido ou empregado fora do escopo.",
      });
      return;
    }

    // 2) Tenta uma cadeia de verbos: PUT primeiro; se 405, tenta POST.
    // Também tenta POST em /employee-work-schedule (sem id) caso a Sólides
    // expose um endpoint de "criar/atualizar" sem path-param.
    const attempts: Array<{
      label: string;
      url: string;
      method: string;
      status?: number;
      bodyPreview?: string;
      headers?: Record<string, string>;
    }> = [];

    async function tryVerb(label: string, url: string, method: string): Promise<{ status: number; bodyText: string; headers: Record<string, string> }> {
      const r = await doFetch(url, {
        method,
        headers: {
          Authorization: `Basic ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: getResp.bodyText,
      });
      attempts.push({
        label,
        url,
        method,
        status: r.status,
        bodyPreview: r.bodyText.slice(0, 1000),
        headers: r.headers,
      });
      return r;
    }

    let ok = false;
    let vencedor: typeof attempts[number] | null = null;

    // Verbo 1: PUT em /employee-work-schedule/{id}
    const putResp = await tryVerb("PUT /employee-work-schedule/{id}", `${WORK_SCHEDULE_API}/${employeeId}`, "PUT");
    if (putResp.status >= 200 && putResp.status < 300) {
      ok = true;
      vencedor = attempts[attempts.length - 1];
    } else if (putResp.status === 405) {
      // PUT bloqueado — tenta POST no mesmo path
      const postSameResp = await tryVerb("POST /employee-work-schedule/{id}", `${WORK_SCHEDULE_API}/${employeeId}`, "POST");
      if (postSameResp.status >= 200 && postSameResp.status < 300) {
        ok = true;
        vencedor = attempts[attempts.length - 1];
      } else if (postSameResp.status === 405 || postSameResp.status === 404) {
        // Tenta POST na coleção (sem id)
        const postCollResp = await tryVerb("POST /employee-work-schedule (coleção)", `${WORK_SCHEDULE_API}`, "POST");
        if (postCollResp.status >= 200 && postCollResp.status < 300) {
          ok = true;
          vencedor = attempts[attempts.length - 1];
        }
      }
    }

    const ultima = attempts[attempts.length - 1];

    // 3) Diagnóstico amigável baseado na última tentativa
    let diagnostic = "";
    if (ok && vencedor) {
      diagnostic = `✅ ESCRITA AUTORIZADA via ${vencedor.label}. Token aceita escrita — pode planejar a Fase 1.`;
    } else if (ultima.status === 401 || ultima.status === 403) {
      diagnostic = "❌ Token é read-only. Sólides retornou 401/403 — precisa de credencial com escopo de escrita.";
    } else if (ultima.status === 405) {
      diagnostic = `❌ Nenhum dos verbos testados (PUT, POST) foi aceito. Tentamos: ${attempts.map(a => `${a.method} ${new URL(a.url).pathname} → ${a.status}`).join("; ")}. Provavelmente a escrita não é exposta na API pública — checar com suporte Tangerino se há rota oficial.`;
    } else if (ultima.status === 400 || ultima.status === 422) {
      diagnostic = `⚠ Body rejeitado (HTTP ${ultima.status}) na tentativa "${ultima.label}". API espera formato diferente do GET — leia o body pra ver o que reclamou.`;
    } else if (ultima.status === 404) {
      diagnostic = `❌ Endpoint não encontrado (404) em "${ultima.label}". Rota de escrita pode ser outra.`;
    } else if (ultima.status === 429) {
      diagnostic = "⏳ Rate limit (429). Tentar de novo daqui a pouco.";
    } else {
      diagnostic = `⚠ Última tentativa "${ultima.label}" retornou HTTP ${ultima.status}. Inspecione o body abaixo.`;
    }

    res.status(200).json({
      ok,
      step: "put",
      getStatus: getResp.status,
      getBodyPreview: getResp.bodyText.slice(0, 500),
      // Compat com versão anterior — putStatus/body são da PRIMEIRA tentativa
      putStatus: attempts[0]?.status,
      putBodyPreview: attempts[0]?.bodyPreview,
      putHeaders: attempts[0]?.headers,
      echoBytes: getResp.bodyText.length,
      attempts, // todas as tentativas pra mostrar na UI
      diagnostic,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message });
    } else {
      res.status(500).json({ error: `Erro inesperado: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
}
