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
  const env = obj(resp.data);
  let inner = env.RespostaJson;
  if (typeof inner === "string") { try { inner = JSON.parse(inner); } catch { inner = {}; } }
  const inObj = obj(inner);
  const dados = obj(env.DadosTEF ?? inObj.DadosTEF ?? env.form ?? inObj.form);
  // Status do Smart TEF fica em payment_status (ex.: "PDT" pendente, "CNC" aprovado).
  const cand = [env.payment_status, inObj.payment_status, env.status, env.Status, inObj.status, dados.status, env.situacao]
    .find((v) => typeof v === "string" && v) as string | undefined;
  const status = (cand || "").toUpperCase();
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number") ? String(v) : undefined;
  const nsu = str(dados.nsu ?? dados.NSU ?? dados.nsuTef);
  const autorizacao = str(dados.autorizacao ?? dados.Autorizacao ?? dados.codigoAutorizacao);
  // Aprovado: código "CNC" OU já veio NSU + autorização (transação concluída).
  const aprovado = status === "CNC" || (!!nsu && !!autorizacao);
  const pendente = ["PDT", "PROC_PAG", "PROC", "AGU", "PENDENTE"].includes(status);
  const recusado = !aprovado && !pendente && (["REC", "CAN", "ERR", "NEG", "DEN", "EST"].includes(status) || env.Sucesso === false);
  return {
    status,
    aprovado,
    recusado,
    mensagem: str(env.MensagemErro ?? inObj.MensagemErro ?? env.message ?? inObj.message) || "",
    nsu,
    autorizacao,
    bandeira: str(dados.bandeira ?? dados.Bandeira),
    identifier: str(
      env.payment_identifier ?? inObj.payment_identifier ??
      env.id ?? env.order_id ?? env.orderId ?? env.payment_id ?? env.charge_id ??
      inObj.id ?? inObj.order_id ?? inObj.charge_id ?? dados.pagId ?? inObj.pagId,
    ),
    raw: resp.data,
  };
}
