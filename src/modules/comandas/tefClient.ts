// Cliente do TEF (Smart TEF) — chama o nosso backend /api/tef (que guarda os
// segredos). O navegador nunca fala com a API do Smart TEF direto.
import { authHeader } from "../../core/firebase/idToken";

export type TefResp = { ok: boolean; httpStatus: number; data: unknown; error?: string };

async function call(acao: string, payload: Record<string, unknown>): Promise<TefResp> {
  const r = await fetch("/api/tef", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ acao, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error || `Erro no TEF (${r.status})`);
  return j as TefResp;
}

export const tefCriar = (p: { value: number; payment_type: string; charge_id: string; serial_pos?: string; installments?: number; cpf?: string; nome?: string }) => call("criar", p);
export const tefStatus = (payment_identifier: string) => call("status", { payment_identifier });
export const tefEstornar = (payment_identifier: string) => call("estornar", { payment_identifier });
export const tefCancelar = (payment_identifier: string) => call("cancelar", { payment_identifier });

// ── Interpretação do envelope { Sucesso, MensagemErro, RespostaJson, DadosTEF } ──
export type TefLeitura = { status: string; aprovado: boolean; recusado: boolean; mensagem: string; nsu?: string; autorizacao?: string; bandeira?: string; identifier?: string; raw: unknown };

function obj(x: unknown): Record<string, unknown> { return x && typeof x === "object" ? x as Record<string, unknown> : {}; }

export function lerTef(resp: TefResp): TefLeitura {
  const raw = resp.data;
  // O STATUS (/pooling/order/get) vem como ARRAY [ {...} ]; o CREATE vem objeto.
  let el: unknown = raw;
  if (Array.isArray(raw)) el = raw[raw.length - 1] ?? raw[0];   // estado mais recente
  const env = obj(el);
  let inner = env.RespostaJson;
  if (typeof inner === "string") { try { inner = JSON.parse(inner); } catch { inner = {}; } }
  const inObj = obj(inner);
  const g = (k: string) => env[k] ?? inObj[k];
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number") ? String(v) : undefined;

  const status = String(g("payment_status") ?? g("status") ?? g("situacao") ?? "").toUpperCase();
  const nsu = str(g("nsu_host") || g("nsu_sitef") || g("nsu") || g("NSU"));
  const autorizacao = str(g("autorization_code") ?? g("authorization_code") ?? g("autorizacao"));
  const bandeira = str(g("card_brand") ?? g("bandeira") ?? g("Bandeira"));
  // Aprovado: código "CNC" OU já veio NSU + autorização (transação concluída).
  const aprovado = status === "CNC" || (!!nsu && !!autorizacao && status !== "EST");
  // Recusa só em códigos CONHECIDOS; qualquer outro = segue consultando (evita falso-negativo).
  const recusado = !aprovado && ["REC", "CAN", "CAE", "NEG", "DEN", "ERR", "EST", "EXP"].includes(status);
  return {
    status, aprovado, recusado,
    mensagem: str(g("MensagemErro") ?? g("message") ?? g("reason")) || "",
    nsu, autorizacao, bandeira,
    identifier: str(g("payment_identifier") ?? g("charge_id") ?? g("id")),
    raw,
  };
}
