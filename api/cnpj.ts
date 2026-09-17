// ════════════════════════════════════════════════════════════════════════════
//  /api/cnpj?cnpj=00000000000000 — consulta cadastral na Receita Federal via
//  BrasilAPI (grátis, sem chave), pra pré-preencher o cadastro de fornecedor.
//  Só usuário logado. Feito no servidor pra evitar CORS/limite do cliente.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 15 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try { await requireUser(req); } catch (e) { res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." }); return; }

  const cnpj = String(req.query.cnpj || "").replace(/\D/g, "");
  if (cnpj.length !== 14) { res.status(400).json({ error: "CNPJ deve ter 14 dígitos." }); return; }

  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { Accept: "application/json" } });
    if (r.status === 404) { res.status(404).json({ error: "CNPJ não encontrado na Receita." }); return; }
    if (!r.ok) { res.status(502).json({ error: `Consulta falhou (HTTP ${r.status}).` }); return; }
    const j = await r.json() as Record<string, unknown>;
    const s = (k: string) => (typeof j[k] === "string" ? (j[k] as string) : j[k] != null ? String(j[k]) : "");
    const endereco = [s("logradouro"), s("numero"), s("bairro"), s("municipio"), s("uf")].filter(Boolean).join(", ");
    res.status(200).json({
      cnpj,
      razaoSocial: s("razao_social"),
      nomeFantasia: s("nome_fantasia"),
      situacao: s("descricao_situacao_cadastral"),
      atividade: s("cnae_fiscal_descricao"),
      telefone: s("ddd_telefone_1"),
      email: s("email").toLowerCase(),
      endereco,
      cep: s("cep"),
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Erro ao consultar a Receita." });
  }
}
