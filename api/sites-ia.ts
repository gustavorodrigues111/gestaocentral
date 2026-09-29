// ════════════════════════════════════════════════════════════════════════════
//  /api/sites-ia — assistente de conteúdo do módulo Sites.
//
//  Modos (POST { modo, ... }):
//    "site"     → gera o conteúdo editorial inteiro a partir de nome/tipo/tom.
//                 Retorna { slogan, historia, heroTitulo, heroSubtitulo,
//                           heroCtaLabel, historiaTitulo }.
//    "campo"    → melhora/reescreve UM texto. { campo, texto, instrucao } →
//                 { texto }.
//    "traduzir" → traduz um texto pro inglês. { texto } → { texto }.
//
//  Auth: Firebase ID token (idToken no body). Sem estado — o cliente persiste
//  em sitesConfig. Nada publica sozinho.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

function primeiroJson(txt: string): Record<string, unknown> {
  const m = txt.match(/\{[\s\S]*\}/);
  return m ? (JSON.parse(m[0]) as Record<string, unknown>) : {};
}

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

    const modo = String(body.modo || "site");
    let system = "";
    let userMsg = "";

    if (modo === "campo") {
      const campo = String(body.campo || "texto");
      const texto = String(body.texto || "");
      const instrucao = String(body.instrucao || "Melhore o texto, deixando-o mais claro e elegante.");
      system = `Você é redator de sites de restaurantes (PT-BR). Reescreva o texto do campo "${campo}" seguindo a instrução, mantendo o sentido e um tom profissional e acolhedor. Devolva SÓ JSON: {"texto":"..."}. Sem markdown, sem aspas fora do JSON. Não invente fatos (preços, prêmios, endereços).`;
      userMsg = `Instrução: ${instrucao}\n\nTexto atual:\n"""${texto}"""`;
    } else if (modo === "traduzir") {
      const texto = String(body.texto || "");
      system = `Você traduz textos de sites de restaurantes de PT-BR para inglês natural (en-US), tom acolhedor. Devolva SÓ JSON: {"texto":"..."}. Não traduza nomes próprios do restaurante.`;
      userMsg = `Traduza:\n"""${texto}"""`;
    } else {
      const nome = String(body.nome || "Restaurante");
      const tipoCozinha = String(body.tipoCozinha || "");
      const tom = String(body.tom || "acolhedor");
      const cidade = String(body.cidade || "");
      const diferenciais = String(body.diferenciais || "");
      system = `Você é redator de sites de restaurantes (PT-BR). Gere o conteúdo editorial do site com base nos dados. Tom: ${tom}. Devolva SÓ JSON, sem markdown, no formato:
{"slogan":"","heroTitulo":"","heroSubtitulo":"","heroCtaLabel":"","historiaTitulo":"","historia":""}
Regras:
- slogan: tagline curta (até ~6 palavras).
- heroTitulo: chamada principal forte (até ~8 palavras).
- heroSubtitulo: 1 frase (até ~20 palavras) que complementa o herói.
- heroCtaLabel: rótulo curto de botão (ex.: "Reservar", "Ver cardápio").
- historiaTitulo: título curto da seção sobre (ex.: "Nossa história").
- historia: 2 parágrafos curtos (use \\n\\n entre eles), sobre a proposta do lugar.
- NÃO invente fatos específicos (prêmios, datas, nomes de chef, preços). Fale da proposta e da experiência de forma verdadeira e genérica quando faltar dado.`;
      userMsg = `Restaurante: ${nome}
Tipo de cozinha: ${tipoCozinha || "(não informado)"}
Cidade: ${cidade || "(não informada)"}
Diferenciais: ${diferenciais || "(não informados)"}`;
    }

    const payload = { model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: [{ type: "text", text: userMsg }] }] };
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
    if (!r.ok) { res.status(502).json({ error: j?.error?.message || "Falha na IA." }); return; }
    const texto = (j.content || []).map((c) => c.text || "").join("");
    res.status(200).json({ ok: true, resultado: primeiroJson(texto) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

export const config = { maxDuration: 60 };
