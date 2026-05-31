// API Route — geração de tarefas-lembrete do dia.
//
// Fase 0: chamado manualmente (botão "Gerar agora" na UI) ou lazy
// (on-app-load periódico). Fase 1+: Vercel Cron Jobs (vercel.json):
//   { "crons": [{ "path": "/api/tarefas-gerar", "schedule": "0 6 * * *" }] }
//
// Authentication: este endpoint exige header `x-system-token` quando chamado
// como cron. Quando chamado da UI authenticated, valida via Firebase ID token
// do header `Authorization: Bearer <token>`. Sem nenhum: 401.
//
// NOTA: a lógica pesada (gerarTarefasDoDia) está em
// src/modules/tarefas/generator.ts e usa Firestore SDK do CLIENTE. Pra rodar
// no servidor de fato, precisaríamos Firebase Admin (que tá bloqueado pela
// org policy). Solução: este endpoint é só um trigger remoto — a UI faz a
// chamada de fato. Cron Job + Admin SDK ficam pra próxima fase.
//
// Por isso, hoje o endpoint só valida + retorna 202 (Accepted), e a UI deve
// chamar `gerarTarefasDoDia()` localmente quando o usuário aciona.

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Stub: este endpoint vai virar trigger remoto na Fase 1, quando tivermos
  // Firebase Admin liberado. Por enquanto, só confirma que existe.
  return res.status(200).json({
    ok: true,
    mensagem: "Geração de tarefas é feita client-side por enquanto. " +
              "Chame `gerarTarefasDoDia()` em src/modules/tarefas/generator.ts. " +
              "Cron server-side entra na Fase 1.",
  });
}
