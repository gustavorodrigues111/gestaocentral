// ════════════════════════════════════════════════════════════════════════════
//  Roteador do WhatsApp (número da API) → Agentes de IA.
//
//  Quando chega mensagem no número oficial (Cloud API), decide qual agente
//  responde e devolve a resposta pelo mesmo número:
//   - agentes DISPONÍVEIS pro remetente = ativos cujo `numerosWhatsapp` inclui
//     o número (autorização por número).
//   - 0 disponíveis → ignora (não responde).
//   - 1 disponível → fala direto com ele.
//   - >1 → mostra um menu ("1) DP  2) Financeiro …") e memoriza a escolha.
//  Sessão por remetente em `whatsappAgenteSessoes/{numero}`. Contexto entre
//  turnos em `agenteMensagens` (conversaId = `${agenteId}__wa_${numero}`).
// ════════════════════════════════════════════════════════════════════════════
import { firestoreListar, firestoreLer, firestoreCriar } from "./_firestoreRest.js";
import { runAgenteCore } from "./agente.js";

type Doc = Record<string, unknown>;
const soDig = (s?: string) => (s || "").replace(/\D/g, "");
// Chave BR: ignora DDI 55 e o 9º dígito de celular → casa formatos diferentes.
function chaveBR(raw?: string): string {
  let d = soDig(raw);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
}
const numeroBate = (autorizado: string, from: string) => chaveBR(autorizado) === chaveBR(from);
const rid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function enviarWhats(to: string, texto: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  const versao = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !phoneId || !texto.trim()) return;
  try {
    await fetch(`https://graph.facebook.com/${versao}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: soDig(to), type: "text", text: { preview_url: true, body: texto.slice(0, 4000) } }),
    });
  } catch { /* best-effort */ }
}

const menuTexto = (agentes: Doc[]) =>
  "Com qual assistente você quer falar? Responde só o número:\n" +
  agentes.map((a, i) => `${i + 1}) ${a.nome as string}`).join("\n");

export async function atenderWhatsAgente(from: string, textoIn: string, nome?: string | null): Promise<void> {
  const texto = (textoIn || "").trim();
  if (!from || !texto) return;

  const todos = await firestoreListar("agentesIA");
  const agentes = todos.filter(a =>
    a.ativo !== false && Array.isArray(a.numerosWhatsapp) &&
    (a.numerosWhatsapp as string[]).some(n => numeroBate(n, from)),
  );
  if (!agentes.length) return; // ninguém liberado pra este número → ignora silenciosamente

  const sid = chaveBR(from);
  const sessao = (await firestoreLer("whatsappAgenteSessoes", sid)) as Doc | null;
  const low = texto.toLowerCase();
  const querMenu = ["menu", "trocar", "trocar agente", "voltar", "agentes", "assistentes"].includes(low);
  const now = () => new Date().toISOString();
  const salvarSessao = (agenteId: string | null, aguardando: boolean) =>
    firestoreCriar("whatsappAgenteSessoes", sid, { waId: from, agenteId, aguardandoEscolha: aguardando, atualizadoEm: now() }).catch(() => {});

  // Resolve o agente a usar.
  let agente: Doc | null = (!querMenu && sessao?.agenteId && !sessao?.aguardandoEscolha)
    ? (agentes.find(a => a.id === sessao.agenteId) || null) : null;

  if (!agente) {
    if (agentes.length === 1) {
      agente = agentes[0];
      await salvarSessao(agente.id as string, false);
    } else if (sessao?.aguardandoEscolha && !querMenu) {
      // Interpreta a escolha do menu (número ou 1ª palavra do nome).
      const idx = parseInt(low, 10);
      const escolhido = (Number.isFinite(idx) && idx >= 1 && idx <= agentes.length)
        ? agentes[idx - 1]
        : agentes.find(a => low.includes(((a.nome as string) || "").toLowerCase().split(" ")[0] || "###"));
      if (!escolhido) { await enviarWhats(from, "Não entendi. " + menuTexto(agentes)); return; }
      await salvarSessao(escolhido.id as string, false);
      await enviarWhats(from, `Falando com *${escolhido.nome}*. Manda sua pergunta 👍`);
      return;
    } else {
      // >1 disponível e sem escolha ainda → mostra o menu.
      await salvarSessao((sessao?.agenteId as string) || null, true);
      await enviarWhats(from, menuTexto(agentes));
      return;
    }
  }

  // Roda o agente resolvido com o histórico da conversa.
  const conversaId = `${agente.id}__wa_${sid}`;
  const hist = (await firestoreListar("agenteMensagens"))
    .filter(m => m.conversaId === conversaId)
    .sort((a, b) => String(a.criadoEm || "").localeCompare(String(b.criadoEm || "")))
    .slice(-12)
    .map(m => ({ role: m.role as string, texto: m.texto as string }));

  await firestoreCriar("agenteMensagens", `am_${rid()}`, {
    agenteId: agente.id, conversaId, restaurantId: null, role: "user", texto, pessoaId: null, pessoaNome: nome || null, canal: "whatsapp", criadoEm: now(),
  }).catch(() => {});

  let out;
  try {
    out = await runAgenteCore(agente, { mensagem: texto, historico: hist, pessoaNome: nome || from, pessoaId: `wa_${sid}`, canal: "whatsapp" });
  } catch {
    await enviarWhats(from, "Tive um problema pra responder agora. Tenta de novo daqui a pouco 🙏");
    return;
  }
  const resposta = (out.resposta || "").trim() || "(sem resposta)";
  await firestoreCriar("agenteMensagens", `am_${rid()}`, {
    agenteId: agente.id, conversaId, restaurantId: null, role: "assistant", texto: resposta, pessoaId: null, canal: "whatsapp", pdfUrl: out.pdfUrl || null, criadoEm: now(),
  }).catch(() => {});
  await enviarWhats(from, out.pdfUrl ? `${resposta}\n\n📄 ${out.pdfUrl}` : resposta);
}
