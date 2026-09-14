// ════════════════════════════════════════════════════════════════════════════
//  /api/recebimento-reprocessar — reprocessa o OCR das notas SEM emissor NO
//  SERVIDOR (baixa do Drive, relê pela IA, preenche só o que está vazio). O
//  cliente dispara e pode sair da tela — a função continua rodando. Processa o
//  máximo que couber no tempo (Vercel roda até retornar/timeout mesmo se o
//  cliente desconectar). Sobrou nota? O usuário clica de novo.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreLer, firestoreAtualizar } from "./_firestoreRest.js";
import { getCentralAccessToken, downloadFileBase64, isCentralConfigured } from "./_googleDrive.js";

export const config = { maxDuration: 60 };

const MODEL = "claude-sonnet-4-6";
const PROMPT =
  "Esta é uma NOTA FISCAL (imagem ou PDF). Responda SOMENTE um objeto JSON (sem texto antes/depois). " +
  "Números em reais como NÚMERO (ex 1234.56), sem R$ nem separador de milhar. Se não tiver certeza, null.\n" +
  '{ "emissor": <razão social/nome do fornecedor que EMITIU a nota, ou null>, ' +
  '"cnpjEmissor": <CNPJ do emissor só dígitos, ou null>, ' +
  '"valorTotal": <valor TOTAL da nota, ou null>, ' +
  '"dataEmissao": <data de emissão YYYY-MM-DD, ou null> }';

async function ocr(base64: string, pdf: boolean, key: string): Promise<{ emissor?: string; cnpjEmissor?: string; valorTotal?: number; dataEmissao?: string } | null> {
  const block = pdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }] }),
  });
  if (!r.ok) return null;
  const j = await r.json() as { content?: Array<{ type?: string; text?: string }> };
  const txt = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
  const m = txt.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." }); return; }
  if (!isCentralConfigured()) { res.status(503).json({ error: "Drive central não configurado." }); return; }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
    // Auth: token do usuário (chamada do cliente).
    const idToken = String(body.idToken || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "");
    const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";
    if (!idToken || !apiKey) { res.status(401).json({ error: "não autorizado" }); return; }
    const chk = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
    if (!chk.ok) { res.status(401).json({ error: "sessão inválida" }); return; }

    const force = !!body.force;   // reprocessa mesmo notas já com emissor (sobrescreve)
    const notaIds: string[] = Array.isArray(body.notaIds) ? body.notaIds.map(String).slice(0, 500) : [];
    if (notaIds.length === 0) { res.status(200).json({ processados: 0, restantes: 0 }); return; }

    const inicio = Date.now();
    const driveToken = await getCentralAccessToken();
    // Motivos p/ o cliente saber POR QUE algo não foi preenchido:
    let processados = 0, atualizados = 0, idx = 0;
    let semArquivo = 0, baixaFalhou = 0, ocrFalhou = 0, nadaNovo = 0;
    for (; idx < notaIds.length; idx++) {
      if (Date.now() - inicio > 52000) break;   // deixa margem pro timeout de 60s
      const nota = await firestoreLer("recebimentos", notaIds[idx]) as Record<string, unknown> | null;
      if (!nota || nota.excluidoEm) continue;   // inexistente/excluída
      // "completa" = tem emissor + valor + data. Reprocessa se falta algum (ou force).
      const completa = !!nota.emissor && nota.valorTotal != null && !!nota.dataEmissao;
      if (!force && completa) continue;
      const paginas = nota.notaPaginas as Array<{ driveFileId?: string }> | undefined;
      const fileId = (nota.notaDriveFileId as string) || paginas?.[0]?.driveFileId;
      if (!fileId) { semArquivo++; continue; }   // não tem imagem/PDF salvo pra reler
      processados++;
      try {
        const base64 = await downloadFileBase64(String(fileId), driveToken);
        const pdf = String(nota.notaNome || "").toLowerCase().endsWith(".pdf");
        const oj = await ocr(base64, pdf, key);
        if (!oj) { ocrFalhou++; continue; }   // a IA não devolveu JSON legível
        const patch: Record<string, unknown> = {};
        if ((force || !nota.emissor) && oj.emissor) patch.emissor = oj.emissor;
        if ((force || !nota.cnpjEmissor) && oj.cnpjEmissor) patch.cnpjEmissor = oj.cnpjEmissor;
        if ((force || nota.valorTotal == null) && typeof oj.valorTotal === "number") patch.valorTotal = oj.valorTotal;
        if ((force || !nota.dataEmissao) && oj.dataEmissao) patch.dataEmissao = oj.dataEmissao;
        if (Object.keys(patch).length) { await firestoreAtualizar("recebimentos", notaIds[idx], patch); atualizados++; }
        else nadaNovo++;   // leu o arquivo mas não achou os campos que faltavam
      } catch { baixaFalhou++; }   // falha ao baixar do Drive / ler o arquivo
    }
    res.status(200).json({ processados, atualizados, restantes: Math.max(0, notaIds.length - idx), semArquivo, baixaFalhou, ocrFalhou, nadaNovo });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}
