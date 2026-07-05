// ════════════════════════════════════════════════════════════════════════════
//  /api/rotinas-notificar — cron (Vercel) que dispara os avisos de WhatsApp das
//  Rotinas. Roda de 30 em 30 min (vercel.json). Pra cada rotina ativa com
//  WhatsApp ligado que VENCE HOJE e cujo horário == slot atual, junta os
//  responsáveis e manda 1 mensagem-resumo por pessoa (template resumo_avisos).
//
//  Respeita folga (escala do dia), pula quem não tem WhatsApp / recusou, e não
//  duplica (trava em rotinaNotificacoes). Grava auditoria em whatsappEnvios.
//
//  Escreve/lê no Firestore via usuário de serviço (ver _firestoreRest).
//  Envio via Cloud API (env WHATSAPP_TOKEN / WHATSAPP_PHONE_ID).
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreDisponivel, firestoreListar, firestoreLer, firestoreCriar } from "./_firestoreRest.js";

export const config = { maxDuration: 60 };

// Status de escala que contam como "não trabalhando" (não recebe se respeitarFolga).
const FOLGA = new Set(["folga", "comp", "ferias", "falta_j", "falta_i"]);
const TEMPLATE = "resumo_avisos";
const APP_URL = "https://admin.planejamento.app";

// ── Recorrência (espelho de rotinasEngine.venceEm, inline pra função ser standalone) ──
type Rec = { tipo: string; diasSemana?: number[]; diaDoMes?: number; posicao?: number; diaSemana?: number; dataBase?: string };
function parse(ymd: string): [number, number, number] { const p = ymd.split("-").map(Number); return [p[0]!, (p[1]! || 1) - 1, p[2]! || 1]; }
function diasNoMes(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function weekday(ymd: string) { const [y, m, d] = parse(ymd); return new Date(y, m, d).getDay(); }
function diaDaPosicao(y: number, m: number, diaSemana: number, posicao: number): number | null {
  const dias: number[] = []; const total = diasNoMes(y, m);
  for (let d = 1; d <= total; d++) if (new Date(y, m, d).getDay() === diaSemana) dias.push(d);
  if (!dias.length) return null;
  return posicao === -1 ? dias[dias.length - 1]! : (dias[posicao - 1] ?? null);
}
function venceEm(rec: Rec, ymd: string): boolean {
  const [y, m, d] = parse(ymd);
  switch (rec.tipo) {
    case "semanal": return (rec.diasSemana || []).includes(weekday(ymd));
    case "mensal_dia": return d === Math.min(rec.diaDoMes || 1, diasNoMes(y, m));
    case "mensal_posicao": { const a = diaDaPosicao(y, m, rec.diaSemana || 0, rec.posicao || 1); return a != null && d === a; }
    case "quinzenal": {
      if (!rec.dataBase || ymd < rec.dataBase) return false;
      const [by, bm, bd] = parse(rec.dataBase);
      const diff = Math.round((new Date(y, m, d).getTime() - new Date(by, bm, bd).getTime()) / 86400000);
      return diff >= 0 && diff % 14 === 0;
    }
    default: return false;
  }
}

const slotDe = (hhmm: string) => { const [h, m] = (hhmm || "").split(":"); return `${(h || "00").padStart(2, "0")}:${Number(m) < 30 ? "00" : "30"}`; };
function normFone(raw: string): string { let d = (raw || "").replace(/\D/g, ""); if (!d) return d; if (d.length <= 11) d = "55" + d; return d; }

async function enviarResumo(to: string, nome: string, lista: string, link: string): Promise<{ ok: boolean; erro?: string; id?: string }> {
  const token = process.env.WHATSAPP_TOKEN, phone = process.env.WHATSAPP_PHONE_ID, ver = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !phone) return { ok: false, erro: "WHATSAPP_TOKEN/PHONE_ID ausentes" };
  const body = {
    messaging_product: "whatsapp", to: normFone(to), type: "template",
    template: { name: TEMPLATE, language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: nome }, { type: "text", text: lista }, { type: "text", text: link }] }] },
  };
  const resp = await fetch(`https://graph.facebook.com/${ver}/${phone}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await resp.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (resp.ok && j.messages?.[0]?.id) return { ok: true, id: j.messages[0].id };
  return { ok: false, erro: j.error?.message || `HTTP ${resp.status}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.authorization !== `Bearer ${expected}`) return res.status(401).json({ error: "Unauthorized" });
  if (!firestoreDisponivel()) return res.status(200).json({ ok: true, status: "firestore indisponível" });

  // Horário de Brasília (UTC-3, sem horário de verão desde 2019).
  const bras = new Date(Date.now() - 3 * 3600 * 1000);
  const iso = bras.toISOString();
  const hoje = iso.slice(0, 10);
  const slot = `${iso.slice(11, 13)}:${Number(iso.slice(14, 16)) < 30 ? "00" : "30"}`;

  try {
    // 1) Rotinas ativas, com WhatsApp, que vencem hoje e cujo horário == slot atual.
    const rotinas = (await firestoreListar("rotinas")).filter(r =>
      r.ativo !== false && r.notificarWhatsapp === true && venceEm((r.recorrencia || {}) as Rec, hoje) && slotDe(String(r.whatsappHora || "")) === slot);
    if (rotinas.length === 0) return res.status(200).json({ ok: true, slot, hoje, rotinas: 0 });

    // 2) Suporte: pessoas, empregados (folga) e escalas.
    const pessoas = await firestoreListar("pessoas");
    const pessoaMap: Record<string, { nome: string; whatsapp?: string; optIn?: boolean }> = {};
    for (const p of pessoas) pessoaMap[String(p.id)] = { nome: String(p.nome || ""), whatsapp: p.whatsapp ? String(p.whatsapp) : undefined, optIn: p.whatsappOptIn as boolean | undefined };

    const precisaFolga = rotinas.some(r => r.respeitarFolga === true);
    const empByPessoaRest: Record<string, string> = {};   // `${pid}_${rid}` → empregadoId
    let escalasByRid: Record<string, Array<Record<string, unknown>>> = {};
    if (precisaFolga) {
      for (const e of await firestoreListar("empregados")) if (e.pessoaId) empByPessoaRest[`${e.pessoaId}_${e.restaurantId}`] = String(e.id);
      escalasByRid = {};
      for (const esc of await firestoreListar("escalas")) { const rid = String(esc.restaurantId); (escalasByRid[rid] ||= []).push(esc); }
    }
    const statusEscala = (rid: string, empId: string): string | undefined => {
      for (const esc of escalasByRid[rid] || []) {
        const real = (esc.real || {}) as Record<string, Record<string, string>>;
        const s = real[empId]?.[hoje];
        if (s) return s;
      }
      return undefined;
    };

    // 3) Agrupa por pessoa (respeitando folga, dedup de conclusão).
    const porPessoa = new Map<string, { nome: string; whatsapp: string; titulos: string[]; rid: string }>();
    for (const r of rotinas) {
      const resp = Array.isArray(r.responsaveis) ? (r.responsaveis as string[]) : [];
      const rid = String(r.restaurantId);
      for (const pid of resp) {
        const pessoa = pessoaMap[pid];
        if (!pessoa?.whatsapp || pessoa.optIn === false) continue;
        // já concluiu hoje?
        if (await firestoreLer("rotinaConclusoes", `${r.id}_${hoje}_${pid}`)) continue;
        // folga?
        if (r.respeitarFolga === true) {
          const empId = empByPessoaRest[`${pid}_${rid}`];
          if (empId) { const st = statusEscala(rid, empId); if (st && FOLGA.has(st)) continue; }
        }
        const acc = porPessoa.get(pid) || { nome: pessoa.nome, whatsapp: pessoa.whatsapp, titulos: [], rid };
        acc.titulos.push(String(r.titulo || "rotina"));
        porPessoa.set(pid, acc);
      }
    }

    // 4) Envia 1 resumo por pessoa (dedup por slot).
    let enviados = 0, pulados = 0, erros = 0;
    for (const [pid, acc] of porPessoa) {
      const dedupId = `resumo_${hoje}_${slot.replace(":", "")}_${pid}`;
      if (await firestoreLer("rotinaNotificacoes", dedupId)) { pulados++; continue; }
      const lista = acc.titulos.join(", ");
      const link = `${APP_URL}/r/${acc.rid}/chat`;
      const r = await enviarResumo(acc.whatsapp, acc.nome.split(" ")[0] || acc.nome, lista, link);
      await firestoreCriar("rotinaNotificacoes", dedupId, { pessoaId: pid, hoje, slot, titulos: acc.titulos, enviadoEm: new Date().toISOString(), ok: r.ok });
      await firestoreCriar("whatsappEnvios", dedupId, { direcao: "out", template: TEMPLATE, to: acc.whatsapp, pessoaId: pid, restaurantId: acc.rid, contexto: "rotina_resumo", status: r.ok ? "enviado" : "erro", erro: r.erro || null, messageId: r.id || null, criadoEm: new Date().toISOString() });
      if (r.ok) enviados++; else erros++;
    }

    return res.status(200).json({ ok: true, slot, hoje, rotinas: rotinas.length, pessoas: porPessoa.size, enviados, pulados, erros });
  } catch (e) {
    console.log("[rotinas-notificar] erro:", (e as Error)?.message);
    return res.status(200).json({ ok: false, erro: (e as Error)?.message });
  }
}
