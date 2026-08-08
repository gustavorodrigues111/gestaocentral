// ════════════════════════════════════════════════════════════════════════════
//  /api/reservas-confirmacao — cron (Vercel) que dispara o pedido de confirmação
//  das RESERVAS pelo WhatsApp INTERNO (Evolution), sozinho.
//
//  Pra cada restaurante com confirmacaoAuto.ativo:
//   • gatilho "horas_antes": manda X horas antes do horário da reserva
//   • gatilho "horario_fixo": manda todo dia num horário, pras reservas do dia
//  Respeita a janela diurna, filtra por origem, só reservas PENDENTES, e não
//  duplica (marca reserva.confirmacaoEnviadaEm). A mensagem é gravada em
//  whatsappMensagens (aparece no inbox) → a resposta volta pro mesmo lugar e a
//  Fase 2 (IA) consegue ler. Envio via Evolution (número do papel "reservas").
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreDisponivel, firestoreListar, firestoreLer, firestoreAtualizar, firestoreCriar } from "./_firestoreRest.js";

export const config = { maxDuration: 60 };

const DEFAULT_TEMPLATE =
  "Oi {primeiro_nome}! Aqui é do {restaurante} 👋\n" +
  "Confirmando sua reserva pra {data} às {hora}, mesa pra {pax} pessoas.\n" +
  "Você confirma que vem? 🙂";

type ConfAuto = {
  ativo?: boolean; gatilho?: "horas_antes" | "horario_fixo"; horasAntes?: number; horarioFixo?: string;
  janelaInicio?: string; janelaFim?: string; origens?: string[];
};

// Telefone → dígitos E.164. Só prefixa 55 quando parece número BR local (<=11).
function normFone(raw: string): string { let d = (raw || "").replace(/\D/g, ""); if (!d) return d; if (d.length <= 11) d = "55" + d; return d; }

function render(tpl: string, v: { nome: string; restaurante: string; data: string; hora: string; pax: string; salao: string }): string {
  const [, mo, d] = (v.data || "").split("-");
  const dataFmt = d && mo ? `${d}/${mo}` : v.data;
  const primeiro = (v.nome || "").split(" ")[0] || v.nome;
  return tpl
    .replaceAll("{primeiro_nome}", primeiro).replaceAll("{nome}", v.nome)
    .replaceAll("{restaurante}", v.restaurante).replaceAll("{data}", dataFmt)
    .replaceAll("{hora}", v.hora).replaceAll("{pax}", v.pax).replaceAll("{salao}", v.salao);
}

async function enviarEvolution(instancia: string, numero: string, texto: string): Promise<{ ok: boolean; id?: string | null; erro?: string }> {
  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, ""); const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) return { ok: false, erro: "Evolution não configurada" };
  const resp = await fetch(`${base}/message/sendText/${encodeURIComponent(instancia)}`, {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ number: numero, text: texto }),
  });
  const txt = await resp.text(); let j: { key?: { id?: string } } | null = null; try { j = JSON.parse(txt); } catch { /* ok */ }
  if (!resp.ok) return { ok: false, erro: `HTTP ${resp.status}: ${txt.slice(0, 120)}` };
  return { ok: true, id: j?.key?.id || null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const expected = process.env.CRON_SECRET;
  const ehCron = !!req.headers["x-vercel-cron"];
  if (expected && !ehCron && req.headers.authorization !== `Bearer ${expected}`) return res.status(401).json({ error: "Unauthorized" });
  if (!firestoreDisponivel()) return res.status(200).json({ ok: true, status: "firestore indisponível" });

  // "Wall clock" de Brasília (UTC-3): tratamos como se fosse UTC pra comparar
  // com o horário da reserva (também tratado como UTC-wall).
  const bras = new Date(Date.now() - 3 * 3600 * 1000);
  const nowMs = bras.getTime();
  const hoje = bras.toISOString().slice(0, 10);
  const hhmm = bras.toISOString().slice(11, 16);
  const nowIso = new Date().toISOString();

  try {
    const configs = (await firestoreListar("configReservas")).filter((c) => {
      const a = (c as { confirmacaoAuto?: ConfAuto }).confirmacaoAuto; return a && a.ativo;
    });
    if (!configs.length) return res.status(200).json({ ok: true, restaurantes: 0 });

    // Suporte: nome dos restaurantes + roteios (número do papel "reservas").
    const restNome: Record<string, string> = {};
    for (const r of await firestoreListar("restaurants")) restNome[String(r.id)] = String((r as { nome?: unknown }).nome || "Restaurante");
    const roteios: Record<string, Record<string, string>> = {};
    for (const rt of await firestoreListar("whatsappRoteios")) roteios[String(rt.id)] = rt as Record<string, string>;

    // Todas as reservas (sem query no REST) → agrupa por restaurante.
    const reservasPorRid: Record<string, Array<Record<string, unknown>>> = {};
    for (const r of await firestoreListar("reservas")) { const rid = String(r.restaurantId || ""); (reservasPorRid[rid] ||= []).push(r); }

    const resultado: Array<Record<string, unknown>> = [];
    for (const c of configs) {
      const rid = String(c.id);
      const a = (c as { confirmacaoAuto?: ConfAuto }).confirmacaoAuto || {};
      const instancia = roteios[rid]?.reservas;
      if (!instancia) { resultado.push({ rid, erro: "sem número do papel 'reservas' configurado" }); continue; }
      const tpl = String((c as { templateConfirmacao?: unknown }).templateConfirmacao || "").trim() || DEFAULT_TEMPLATE;
      const janIni = a.janelaInicio || "09:00", janFim = a.janelaFim || "21:00";
      const dentroJanela = hhmm >= janIni && hhmm <= janFim;
      const origensFiltro = a.origens && a.origens.length ? a.origens : null;

      let enviadas = 0, erros = 0;
      for (const r of reservasPorRid[rid] || []) {
        if (String(r.status || "") !== "pendente") continue;
        if (r.confirmacaoEnviadaEm) continue;
        const origem = String(r.origem || "interno");
        if (origensFiltro && !origensFiltro.includes(origem)) continue;
        const data = String(r.data || ""); const hora = String(r.horario || "00:00");
        if (!data) continue;
        const resMs = new Date(`${data}T${(hora || "00:00")}:00Z`).getTime();
        if (isNaN(resMs) || nowMs > resMs) continue;   // já passou / inválida

        // Está na hora de mandar?
        let naHora = false;
        if ((a.gatilho || "horas_antes") === "horario_fixo") {
          naHora = data === hoje && hhmm >= (a.horarioFixo || "10:00");
        } else {
          const sendAt = resMs - Math.max(1, a.horasAntes || 2) * 3600 * 1000;
          naHora = nowMs >= sendAt;
        }
        if (!naHora || !dentroJanela) continue;

        // PII (nome/telefone).
        const pii = await firestoreLer("reservasPII", String(r.id));
        const nome = String(pii?.clienteNomeSnapshot || r.clienteNomeSnapshot || "");
        const foneRaw = String(pii?.clienteTelefoneSnapshot || r.clienteTelefoneSnapshot || "");
        const fone = normFone(foneRaw);
        if (!fone) continue;

        const texto = render(tpl, {
          nome, restaurante: restNome[rid] || "Restaurante", data, hora,
          pax: String(r.pessoas || ""), salao: String(r.salaoNomeSnapshot || ""),
        });
        const env = await enviarEvolution(instancia, fone, texto);
        if (!env.ok) { erros++; continue; }
        // Grava no inbox (aparece na conversa; dedup com o eco do webhook via id).
        const msgId = env.id ? `${instancia}_${env.id}` : `conf_${r.id}`;
        await firestoreCriar("whatsappMensagens", msgId, {
          waId: fone, nome: nome || null, direcao: "out", tipo: "text", texto,
          timestamp: nowIso, recebidoEm: nowIso, lido: true, numeroId: instancia,
          autorNome: "🤖 Confirmação automática", status: 1,
          messageId: env.id || null, confirmacaoReservaId: String(r.id),
        }).catch(() => {});
        await firestoreAtualizar("reservas", String(r.id), { confirmacaoEnviadaEm: nowIso }).catch(() => {});
        enviadas++;
      }
      resultado.push({ rid, nome: restNome[rid], enviadas, erros });
    }
    return res.status(200).json({ ok: true, hoje, hhmm, resultado });
  } catch (e) {
    return res.status(200).json({ ok: false, erro: (e as Error)?.message });
  }
}
