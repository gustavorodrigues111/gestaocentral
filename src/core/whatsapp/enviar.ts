// Serviço CENTRAL de WhatsApp (cliente). Qualquer módulo chama enviarWhatsapp()
// pra disparar uma mensagem via /api/whatsapp-enviar (Cloud API da Meta) e
// registra o envio em `whatsappEnvios` (log/auditoria). Fica inerte (sem
// quebrar) enquanto as env vars não estiverem configuradas — devolve
// { ok:false, naoConfigurado:true }.
import { addDoc, collection } from "firebase/firestore";
import { db } from "../firebase/config";
import { sanitizeForFirestore } from "../firebase/sanitize";
import { authHeader } from "../firebase/idToken";

export type EnvioWhats = {
  to: string;                       // telefone (só dígitos; DDI 55 é assumido se faltar)
  template?: string;                // nome do modelo aprovado na Meta (proativo)
  idioma?: string;                  // default pt_BR
  params?: string[];                // variáveis do corpo do template, na ordem
  texto?: string;                   // texto livre (só dentro da janela de 24h)
  // Metadados só pro log/auditoria (não vão pra Meta):
  restaurantId?: string;
  pessoaId?: string;
  contexto?: string;                // ex.: "checklist_lembrete", "admissao_link"
  criadoPor?: string;
};

export type ResultadoEnvio = { ok: boolean; messageId?: string | null; erro?: string; naoConfigurado?: boolean };

export async function enviarWhatsapp(e: EnvioWhats): Promise<ResultadoEnvio> {
  let resultado: ResultadoEnvio = { ok: false };
  try {
    const resp = await fetch("/api/whatsapp-enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ to: e.to, template: e.template, idioma: e.idioma, params: e.params, texto: e.texto }),
    });
    const j = await resp.json().catch(() => ({}));
    if (resp.ok && (j as { ok?: boolean }).ok) resultado = { ok: true, messageId: (j as { messageId?: string }).messageId ?? null };
    else resultado = { ok: false, erro: (j as { error?: string }).error || `Erro ${resp.status}`, naoConfigurado: !!(j as { naoConfigurado?: boolean }).naoConfigurado };
  } catch (err) {
    resultado = { ok: false, erro: err instanceof Error ? err.message : String(err) };
  }
  // Log (best-effort — não bloqueia o fluxo se falhar)
  try {
    await addDoc(collection(db, "whatsappEnvios"), sanitizeForFirestore({
      to: e.to, template: e.template || null, contexto: e.contexto || null,
      restaurantId: e.restaurantId || null, pessoaId: e.pessoaId || null,
      status: resultado.ok ? "enviado" : (resultado.naoConfigurado ? "nao_configurado" : "erro"),
      messageId: resultado.messageId || null, erro: resultado.erro || null,
      criadoEm: new Date().toISOString(), criadoPor: e.criadoPor || null,
    }));
  } catch { /* log é secundário */ }
  return resultado;
}
