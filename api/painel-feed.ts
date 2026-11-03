// /api/painel-feed?token=<token> — feed READ-ONLY do Painel do Salão para a
// ESTAÇÃO de parede. O token (doc id em /estacoesTokens) amarra a estação a UM
// restaurante; aqui o servidor valida o token, descobre o rid e devolve APENAS o
// painel daquele restaurante (reservas, freelas/turnos, checklists e o resumo do
// WhatsApp já resolvido por restaurante). A estação nunca toca o Firestore
// direto nem carrega credencial de pessoa — só tem o token, revogável no admin
// (ativo:false). Só LEITURA: este endpoint jamais grava.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreDisponivel, firestoreLer, firestoreListar, firestoreRunQuery, fEq, fGte, fAnd } from "./_firestoreRest.js";

function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function hhmmToMin(s?: string): number { if (!s) return -1; const [h, m] = String(s).split(":").map(Number); return (h || 0) * 60 + (m || 0); }
function daysBetween(a: string, b: string): number { const da = new Date(a + "T12:00:00-03:00").getTime(); const dbt = new Date(b + "T12:00:00-03:00").getTime(); return Math.round((dbt - da) / 86400000); }
function foneKey(waId?: string): string { let d = String(waId || "").replace(/\D/g, ""); if (d.startsWith("55")) d = d.slice(2); if (d.length >= 10) d = d.slice(0, 2) + d.slice(-8); return d; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (!firestoreDisponivel()) { res.status(200).json({ ok: false, erro: "nao_configurado" }); return; }
  const token = String((req.query.token ?? req.query.t) || "").trim();
  if (!token || token.length < 12) { res.status(400).json({ ok: false, erro: "sem_token" }); return; }

  // Valida o token (doc id). get-by-id: a estação precisa SABER o token.
  const est = await firestoreLer("estacoesTokens", token).catch(() => null);
  if (!est || est.ativo === false) { res.status(403).json({ ok: false, erro: "token_invalido" }); return; }
  const rid = String(est.restaurantId || "");
  const nome = String(est.restaurantNome || "Restaurante");
  if (!rid) { res.status(403).json({ ok: false, erro: "sem_rest" }); return; }

  try {
    const hoje = hojeSP();
    const dow = new Date(hoje + "T12:00:00-03:00").getUTCDay(); // 0=Dom..6=Sáb (Brasil = -03:00)

    // ── Reservas (base + PII pro nome) ──
    const [resBase, resPii] = await Promise.all([
      firestoreRunQuery({ from: [{ collectionId: "reservas" }], where: fAnd(fEq("restaurantId", rid), fEq("data", hoje)) }),
      firestoreRunQuery({ from: [{ collectionId: "reservasPII" }], where: fAnd(fEq("restaurantId", rid), fEq("data", hoje)) }).catch(() => [] as any[]),
    ]);
    const piiMap = new Map(resPii.map((p) => [p.id, p]));
    const reservas = resBase
      .filter((r) => r.status !== "cancelada" && r.status !== "no_show")
      .map((r) => ({ id: String(r.id), horario: r.horario, status: r.status, nome: (piiMap.get(String(r.id)) as any)?.clienteNomeSnapshot || r.clienteNomeSnapshot, pessoas: r.pessoas, mesas: (Array.isArray(r.mesasNomesSnapshot) ? r.mesasNomesSnapshot.join(" + ") : "") || r.mesaNomeSnapshot || "" }));

    // ── Freelas & turnos ──
    const shifts = await firestoreRunQuery({ from: [{ collectionId: "freelaShifts" }], where: fEq("restaurantId", rid) });
    const freelasAbertos = shifts.filter((s) => s.status === "aberto" && !s.saida).sort((a, b) => hhmmToMin(a.entrada as string) - hhmmToMin(b.entrada as string)).map((s) => ({ id: String(s.id), nome: s.nomeSnapshot, area: s.area, entrada: s.entrada }));
    const freelasProgramados = shifts.filter((s) => s.status === "agendado" && s.date === hoje).sort((a, b) => hhmmToMin(a.entradaPrevista as string) - hhmmToMin(b.entradaPrevista as string)).map((s) => ({ id: String(s.id), nome: s.nomeSnapshot, area: s.area, entradaPrevista: s.entradaPrevista, saidaPrevista: s.saidaPrevista }));

    // ── Checklists ──
    const [tmpls, runs] = await Promise.all([
      firestoreRunQuery({ from: [{ collectionId: "checklistTemplates" }], where: fEq("restaurantId", rid) }),
      firestoreRunQuery({ from: [{ collectionId: "checklistRuns" }], where: fEq("restaurantId", rid) }),
    ]);
    const runHoje = new Map<string, any>();
    const ultimoRun = new Map<string, string>();
    for (const r of runs) {
      const tid = String(r.templateId || "");
      if (r.data === hoje && !runHoje.has(tid)) runHoje.set(tid, r);
      const prev = ultimoRun.get(tid);
      if (!prev || String(r.data || "") > prev) ultimoRun.set(tid, String(r.data || ""));
    }
    const checklists = tmpls.filter((t) => {
      if (t.ativo === false) return false;
      const f = t.frequencia;
      const diasSemana = t.diasSemana as number[] | undefined;
      if (f === "diaria") return !diasSemana || diasSemana.length === 0 || diasSemana.includes(dow);
      if (f === "semanal") { const lr = ultimoRun.get(String(t.id)); return !lr || daysBetween(lr, hoje) >= 7; }
      if (f === "mensal") { const lr = ultimoRun.get(String(t.id)); return !lr || lr.slice(0, 7) !== hoje.slice(0, 7); }
      return runHoje.has(String(t.id));
    }).map((t) => {
      const run = runHoje.get(String(t.id));
      const pct = run ? Math.round(((Number(run.feitos) || 0) / Math.max(1, Number(run.totalItens) || 1)) * 100) : 0;
      return { id: String(t.id), nome: t.nome || "Checklist", turno: t.turno, area: t.area, hora: t.horarioReferencia, pct, completo: run?.status === "completo" };
    }).sort((a, b) => String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")));

    // ── WhatsApp (resumo de não respondidas, resolvido por restaurante) ──
    const numeros = (await firestoreListar("whatsappNumeros")).filter((n) => Array.isArray(n.restaurantIds) && (n.restaurantIds as string[]).includes(rid) && n.ativo !== false);
    const numIds = new Set(numeros.map((n) => String(n.id)));
    let waList: Array<{ key: string; nome?: string; naoLidas: number; preview?: string; _ts: string }> = [];
    if (numIds.size) {
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const msgs = await firestoreRunQuery({ from: [{ collectionId: "whatsappMensagens" }], where: fGte("timestamp", cutoff), orderBy: [{ field: { fieldPath: "timestamp" }, direction: "DESCENDING" }], limit: 300 });
      const conv = new Map<string, any>();
      for (const m of msgs) {
        if (!m.numeroId || !numIds.has(String(m.numeroId)) || m.ehGrupo) continue;
        const k = foneKey(m.waId as string);
        let c = conv.get(k);
        if (!c) { c = { key: k, nome: undefined, naoLidas: 0, preview: m.texto || (m.tipo ? `[${m.tipo}]` : ""), _ts: String(m.timestamp || "") }; conv.set(k, c); }
        if (String(m.timestamp || "") > c._ts) { c._ts = String(m.timestamp || ""); c.preview = m.texto || (m.tipo ? `[${m.tipo}]` : ""); }
        if (m.nome && m.direcao === "in" && !c.nome) c.nome = m.nome;
        if (m.direcao === "in" && !m.lido) c.naoLidas++;
      }
      waList = [...conv.values()].filter((c) => c.naoLidas > 0).sort((a, b) => b._ts.localeCompare(a._ts));
    }
    const waTotal = waList.reduce((s, c) => s + c.naoLidas, 0);

    res.status(200).json({
      ok: true, rid, nome, ts: Date.now(),
      reservas, freelasAbertos, freelasProgramados, checklists,
      wa: { list: waList.map((c) => ({ key: c.key, nome: c.nome, naoLidas: c.naoLidas, preview: c.preview })), total: waTotal },
    });
  } catch (e) {
    res.status(200).json({ ok: false, erro: "falha", detalhe: String((e as Error)?.message || e).slice(0, 200) });
  }
}
