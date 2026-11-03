// /api/painel-acao — AÇÕES da estação do Painel do Salão (parede), autorizadas
// pelo TOKEN da estação (não por login de pessoa). A estação é monitorada por
// câmera; cada ação escolhe "quem está agindo" entre os usuários com acesso à
// estação (allow-list no doc estacoesTokens) e fica registrada no nome da pessoa.
// Só ações whitelisted e habilitadas na estação; as regras do Firestore seguem
// fechadas (nada de escrita anônima pela parede — tudo passa pelo usuário de
// serviço aqui, com escopo + atribuição).
//
// POST { token, acao, pessoaId?, ... }
//   acao="wa-thread"    { numeroId, waId }         → lê a conversa (e marca lido)
//   acao="wa-responder" { pessoaId, numeroId, waId, texto } → envia pela Evolution
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreDisponivel, firestoreLer, firestoreListar, firestoreRunQuery, firestoreAtualizar, fGte } from "./_firestoreRest.js";

function foneKey(waId?: string): string { let d = String(waId || "").replace(/\D/g, ""); if (d.startsWith("55")) d = d.slice(2); if (d.length >= 10) d = d.slice(0, 2) + d.slice(-8); return d; }
function normalizarFone(raw: string): string { let d = (raw || "").replace(/\D/g, ""); if (!d) return ""; if (d.length <= 11) d = "55" + d; return d; }
function toEvolution(waId: string): string { return waId.endsWith("@g.us") ? waId : waId.endsWith("@s.whatsapp.net") ? waId.replace(/\D/g, "") : normalizarFone(waId); }
function hhmmAgoraSP(): string { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })); const p = (n: number) => (n < 10 ? `0${n}` : `${n}`); return `${p(d.getHours())}:${p(d.getMinutes())}`; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).json({ ok: false, erro: "method" }); return; }
  if (!firestoreDisponivel()) { res.status(200).json({ ok: false, erro: "nao_configurado" }); return; }
  const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
  const token = String(body.token || "").trim();
  const acao = String(body.acao || "").trim();
  if (!token || token.length < 12 || !acao) { res.status(400).json({ ok: false, erro: "bad_request" }); return; }

  // Valida a estação (token).
  const est = await firestoreLer("estacoesTokens", token).catch(() => null);
  if (!est || est.ativo === false) { res.status(403).json({ ok: false, erro: "token_invalido" }); return; }
  const rid = String(est.restaurantId || "");
  const acoes = (est.acoes as Record<string, boolean>) || { whatsapp: true, checklist: true, freela: true };

  // Resolve os números que a estação pode tocar (do restaurante, e dentro do que
  // a estação fixou). Usado p/ validar numeroId das ações de WhatsApp.
  async function numerosPermitidos(): Promise<Set<string>> {
    const fix = Array.isArray(est!.whatsappNumeroIds) ? (est!.whatsappNumeroIds as string[]) : [];
    const todos = (await firestoreListar("whatsappNumeros")).filter((n) => Array.isArray(n.restaurantIds) && (n.restaurantIds as string[]).includes(rid) && n.ativo !== false);
    return new Set(todos.filter((n) => fix.length === 0 || fix.includes(String(n.id))).map((n) => String(n.id)));
  }
  // Valida a pessoa que está agindo (precisa estar na allow-list da estação).
  function validaPessoa(pessoaId: string): { id: string; nome: string } | null {
    const lista = (Array.isArray(est!.usuariosNomes) ? est!.usuariosNomes : []) as Array<{ id: string; nome: string }>;
    const ids = (Array.isArray(est!.usuariosIds) ? est!.usuariosIds : []) as string[];
    if (!ids.includes(pessoaId)) return null;
    return lista.find((u) => u.id === pessoaId) || { id: pessoaId, nome: "Estação" };
  }
  // Carrega a conversa (mensagens dos últimos 7 dias desse numeroId + waId).
  async function carregarThread(numeroId: string, waId: string) {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const msgs = await firestoreRunQuery({ from: [{ collectionId: "whatsappMensagens" }], where: fGte("timestamp", cutoff), orderBy: [{ field: { fieldPath: "timestamp" }, direction: "DESCENDING" }], limit: 500 });
    const key = foneKey(waId);
    return msgs.filter((m) => String(m.numeroId) === numeroId && foneKey(m.waId as string) === key);
  }

  try {
    if (acao === "wa-thread") {
      if (!acoes.whatsapp) { res.status(403).json({ ok: false, erro: "acao_desabilitada" }); return; }
      const numeroId = String(body.numeroId || "");
      const waId = String(body.waId || "");
      if (!numeroId || !waId || !(await numerosPermitidos()).has(numeroId)) { res.status(403).json({ ok: false, erro: "numero_invalido" }); return; }
      const thread = (await carregarThread(numeroId, waId)).sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
      // Marca as recebidas não-lidas como lidas (abrir = ler, igual ao inbox).
      await Promise.all(thread.filter((m) => m.direcao === "in" && !m.lido).map((m) => firestoreAtualizar("whatsappMensagens", String(m.id), { lido: true }).catch(() => false)));
      res.status(200).json({ ok: true, mensagens: thread.slice(-60).map((m) => ({ id: m.id, direcao: m.direcao, texto: m.texto || "", tipo: m.tipo || null, timestamp: m.timestamp || "", autorNome: m.autorNome || null })) });
      return;
    }

    if (acao === "wa-responder") {
      if (!acoes.whatsapp) { res.status(403).json({ ok: false, erro: "acao_desabilitada" }); return; }
      const pessoa = validaPessoa(String(body.pessoaId || ""));
      if (!pessoa) { res.status(403).json({ ok: false, erro: "pessoa_nao_autorizada" }); return; }
      const numeroId = String(body.numeroId || "");
      const waId = String(body.waId || "");
      const texto = String(body.texto || "").trim();
      if (!numeroId || !waId || !texto) { res.status(400).json({ ok: false, erro: "bad_request" }); return; }
      if (!(await numerosPermitidos()).has(numeroId)) { res.status(403).json({ ok: false, erro: "numero_invalido" }); return; }

      const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
      const key = process.env.EVOLUTION_API_KEY;
      if (!base || !key) { res.status(503).json({ ok: false, erro: "evolution_nao_configurada" }); return; }
      const to = toEvolution(waId);
      const corpo = `*${pessoa.nome}:*\n${texto}`; // atribuição visível no WhatsApp
      const r = await fetch(`${base}/message/sendText/${encodeURIComponent(numeroId)}`, {
        method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ number: to, text: corpo }),
      });
      if (!r.ok) { const t = await r.text(); res.status(502).json({ ok: false, erro: "evolution", detalhe: t.slice(0, 200) }); return; }
      const j = await r.json().catch(() => ({}));
      // Marca as recebidas da conversa como lidas (saiu da fila "a responder").
      const thread = await carregarThread(numeroId, waId);
      await Promise.all(thread.filter((m) => m.direcao === "in" && !m.lido).map((m) => firestoreAtualizar("whatsappMensagens", String(m.id), { lido: true }).catch(() => false)));
      res.status(200).json({ ok: true, messageId: (j as any)?.key?.id || null });
      return;
    }

    if (acao === "freela-abrir") {
      if (!acoes.freela) { res.status(403).json({ ok: false, erro: "acao_desabilitada" }); return; }
      const pessoa = validaPessoa(String(body.pessoaId || ""));
      if (!pessoa) { res.status(403).json({ ok: false, erro: "pessoa_nao_autorizada" }); return; }
      const shiftId = String(body.shiftId || "");
      if (!shiftId) { res.status(400).json({ ok: false, erro: "bad_request" }); return; }
      const sh = await firestoreLer("freelaShifts", shiftId).catch(() => null);
      if (!sh || String(sh.restaurantId) !== rid) { res.status(403).json({ ok: false, erro: "shift_invalido" }); return; }
      if (sh.status !== "agendado") { res.status(200).json({ ok: false, erro: "status", detalhe: `turno está '${sh.status}'` }); return; }
      await firestoreAtualizar("freelaShifts", shiftId, { status: "aberto", entrada: hhmmAgoraSP(), aberturaEstacaoPor: pessoa.nome, aberturaEstacaoEm: new Date().toISOString() });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, erro: "acao_desconhecida" });
  } catch (e) {
    res.status(200).json({ ok: false, erro: "falha", detalhe: String((e as Error)?.message || e).slice(0, 200) });
  }
}
