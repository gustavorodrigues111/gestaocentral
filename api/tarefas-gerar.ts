// API Route — endpoint de cron pra geração de tarefas-lembrete diária.
//
// **Status atual (Fase 1):** placeholder ativo.
//
// O cron do Vercel (vercel.json) chama este endpoint todo dia às 9h UTC
// (6h Brasília). Por enquanto, este endpoint não executa a geração de fato
// — a lógica real (gerarTarefasDoDia) usa Firestore SDK do CLIENTE e precisa
// de pessoa autenticada, e a org policy do Workspace bloqueia criação de
// service account keys (= sem Firebase Admin SDK em serverless).
//
// **O QUE realmente roda hoje:**
// ToastListener (montado no AppShell) executa gerarTarefasDoDia() 1× por dia
// quando um master abre o app. Em prática, isso é confiável — master abre
// admin.planejamento.app várias vezes ao dia.
//
// **Próximo passo (Fase 2+):** quando a org policy permitir, criar service
// account, configurar GOOGLE_APPLICATION_CREDENTIALS no Vercel, importar
// firebase-admin e portar gerarTarefasDoDia pra rodar server-side. O resto
// (clientes, geração) fica intocado.
//
// Este endpoint, hoje:
//   - Responde 200 OK (cron Vercel não acumula erros)
//   - Valida CRON_SECRET se presente (impede invocação externa abusiva)
//   - Loga timestamp pra audit

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Aceita GET (cron Vercel usa GET) e POST
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Se CRON_SECRET estiver setado no env, exige header Authorization: Bearer <secret>
  // O Vercel Cron envia esse header automaticamente quando há `CRON_SECRET` configurado.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${expected}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const now = new Date().toISOString();
  console.log("[cron] tarefas-gerar invocado em", now);

  return res.status(200).json({
    ok: true,
    timestamp: now,
    status: "placeholder",
    mensagem: "Geração real é executada client-side por ToastListener (Fase 1). " +
              "Server-side com Firebase Admin entra na Fase 2+ (bloqueado por org policy hoje).",
  });
}
