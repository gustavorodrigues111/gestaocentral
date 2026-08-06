// ════════════════════════════════════════════════════════════════════════════
//  /api/evento-lead-notificar — avisa a CASA no WhatsApp quando entra um lead
//  de evento pelo site. Chamado (fire-and-forget) pelo EventosPublicaPage logo
//  após criar o lead. Lê o lead + o número de avisos (restaurants.eventosConfig
//  .whatsappAvisos) via usuário de serviço e manda um resumo via Cloud API.
//
//  Guardas: só notifica lead com origem "publico" e ainda não avisado (marca
//  avisoWhatsEnviadoEm no lead pra não duplicar).
//  Envio via Cloud API (env WHATSAPP_TOKEN / WHATSAPP_PHONE_ID) — TEXTO livre
//  (a casa é operadora e costuma ter janela de 24h aberta com o bot).
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreDisponivel, firestoreLer, firestoreAtualizar } from "./_firestoreRest.js";

export const config = { maxDuration: 20 };
const APP_URL = "https://admin.planejamento.app";

function normFone(raw: string): string { let d = (raw || "").replace(/\D/g, ""); if (!d) return d; if (d.length <= 11) d = "55" + d; return d; }
function dBR(iso?: string): string { const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || "—"); }

const OCASIAO: Record<string, string> = { aniversario: "Aniversário", corporativo: "Corporativo", casamento: "Casamento", confraternizacao: "Confraternização", formatura: "Formatura", outros: "Outros" };
const MODELO: Record<string, string> = { locacao: "Locação (consumo em comanda)", pacote_por_pessoa: "Pacote por pessoa" };

// Envio via TEMPLATE aprovado (resumo_avisos: {{1}}=nome, {{2}}=lista, {{3}}=link).
// Template funciona FORA da janela de 24h (proativo). Params não podem ter
// quebra de linha nem >4 espaços seguidos → lista é uma linha só com " · ".
const TEMPLATE = "resumo_avisos";
function limpaParam(s: string): string { return String(s || "").replace(/\s+/g, " ").trim(); }
async function enviarTemplate(to: string, nome: string, lista: string, link: string): Promise<{ ok: boolean; erro?: string }> {
  const token = process.env.WHATSAPP_TOKEN, phone = process.env.WHATSAPP_PHONE_ID, ver = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !phone) return { ok: false, erro: "WHATSAPP_TOKEN/PHONE_ID ausentes" };
  const body = {
    messaging_product: "whatsapp", to: normFone(to), type: "template",
    template: { name: TEMPLATE, language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: limpaParam(nome) }, { type: "text", text: limpaParam(lista) }, { type: "text", text: limpaParam(link) }] }] },
  };
  const resp = await fetch(`https://graph.facebook.com/${ver}/${phone}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await resp.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (resp.ok && j.messages?.[0]?.id) return { ok: true };
  return { ok: false, erro: j.error?.message || `HTTP ${resp.status}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!firestoreDisponivel()) return res.status(200).json({ ok: true, status: "firestore indisponível" });

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { leadId?: string; rid?: string } | null;
  const leadId = (body?.leadId || "").toString();
  const rid = (body?.rid || "").toString();
  if (!leadId || !rid) return res.status(400).json({ error: "leadId/rid ausentes" });

  try {
    const lead = await firestoreLer("leadsEvento", leadId);
    if (!lead || String(lead.restaurantId) !== rid) return res.status(200).json({ ok: true, status: "lead não encontrado" });
    if (lead.origem !== "publico") return res.status(200).json({ ok: true, status: "não é lead público" });
    if (lead.avisoWhatsEnviadoEm) return res.status(200).json({ ok: true, status: "já avisado" });

    const rest = await firestoreLer("restaurants", rid);
    const cfg = (rest?.eventosConfig || {}) as { whatsappAvisos?: string };
    const to = (cfg.whatsappAvisos || "").toString().trim();
    if (!to) return res.status(200).json({ ok: true, status: "sem número de avisos configurado" });

    const cliente = (lead.cliente || {}) as { nome?: string; whatsapp?: string };
    const ocas = OCASIAO[String(lead.ocasiao || "")] || (lead.ocasiaoOutros ? String(lead.ocasiaoOutros) : String(lead.ocasiao || "—"));
    const modelo = MODELO[String(lead.modeloEvento || "")] || String(lead.modeloEvento || "—");
    // lista = resumo em UMA linha (restrição de template): campos separados por " · ".
    const lista = [
      `Novo lead de evento — ${cliente.nome || "cliente"}`,
      cliente.whatsapp ? `wpp ${cliente.whatsapp}` : "",
      `${dBR(String(lead.dataDesejada || ""))}`,
      lead.horaInicio ? `${lead.horaInicio}${lead.horaFim ? `-${lead.horaFim}` : ""}` : "",
      `${lead.numConvidados ?? "—"} pessoas`,
      ocas,
      modelo,
    ].filter(Boolean).join(" · ");
    const link = `${APP_URL}/r/${rid}/eventos`;
    const r = await enviarTemplate(to, "Equipe", lista, link);
    await firestoreAtualizar("leadsEvento", leadId, { avisoWhatsEnviadoEm: new Date().toISOString(), avisoWhatsOk: r.ok }).catch(() => {});
    return res.status(200).json({ ok: r.ok, erro: r.erro || null });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: (e as Error)?.message });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
