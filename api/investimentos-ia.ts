// ════════════════════════════════════════════════════════════════════════════
//  /api/investimentos-ia — extrai os campos de um COMPROVANTE (imagem ou PDF)
//  pra pré-preencher uma linha de investimento. Recebe o arquivo em base64 + a
//  lista de categorias já existentes; a IA mapeia pra uma existente OU sugere
//  uma nova (que o usuário confirma no app). Sem estado — o cliente persiste.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const IMG = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." }); return; }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
    const idToken = String(body.idToken || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "");
    const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";
    if (!idToken || !apiKey) { res.status(401).json({ error: "não autorizado" }); return; }
    const chk = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
    if (!chk.ok) { res.status(401).json({ error: "sessão inválida" }); return; }

    const mimeType = String(body.mimeType || "");
    const dataB64 = String(body.dataBase64 || "");
    const categorias: string[] = Array.isArray(body.categorias) ? body.categorias.slice(0, 100).map(String) : [];
    if (!dataB64) { res.status(400).json({ error: "Falta o arquivo (dataBase64)." }); return; }

    const hoje = new Date().toISOString().slice(0, 10);
    const system = `Você extrai dados de um COMPROVANTE (nota fiscal, recibo, cupom, comprovante de pix/cartão/boleto) de um investimento de restaurante. Devolva SÓ JSON, sem texto fora do JSON, com o formato:
{"data":"YYYY-MM-DD","estabelecimento":"","categoriaExistente":"","categoriaSugerida":"","valor":0,"formaPagamento":"dinheiro|pix|debito|credito|boleto|transferencia|outro","parcelado":false,"parcelas":[{"data":"YYYY-MM-DD","valor":0}]}
Regras:
- data = data da compra/pagamento (se só houver a data de emissão, use-a). Se não achar, use "${hoje}".
- estabelecimento = nome do fornecedor/loja (razão social ou nome fantasia — o mais reconhecível).
- valor = valor TOTAL em reais (número, ponto decimal). Sem "R$".
- formaPagamento = uma das opções listadas (minúsculas). Cartão de crédito=credito, débito=debito. Se não der pra saber, "outro".
- categoriaExistente = escolha UMA da lista de categorias existentes se alguma se encaixar bem; senão deixe "".
- categoriaSugerida = se NENHUMA existente serve, sugira 1 categoria curta e genérica (ex.: "Equipamentos", "Reforma", "Móveis", "Tecnologia", "Utensílios"); senão deixe "".
- parcelado/parcelas = só se o comprovante indicar parcelamento (ex.: "3x"). Distribua o valor nas parcelas com as datas se houver; senão parcelas=[].
Categorias existentes: ${categorias.length ? categorias.join(", ") : "(nenhuma cadastrada ainda)"}.`;

    const fileBlock = IMG.has(mimeType)
      ? { type: "image", source: { type: "base64", media_type: mimeType, data: dataB64 } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: dataB64 } };

    const payload = {
      model: MODEL, max_tokens: 2000, system,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: "Extraia os campos deste comprovante." }] }],
    };
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
    if (!r.ok) { res.status(502).json({ error: j?.error?.message || "Falha na IA." }); return; }
    const texto = (j.content || []).map((c) => c.text || "").join("");
    const m = texto.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    res.status(200).json({ ok: true, extraido: parsed });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

export const config = { maxDuration: 60 };
