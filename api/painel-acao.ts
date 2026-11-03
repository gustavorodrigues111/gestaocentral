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
import { firestoreDisponivel, firestoreLer, firestoreListar, firestoreRunQuery, firestoreAtualizar, firestoreCriar, firestorePatchCampos, fEq, fGte } from "./_firestoreRest.js";

function hojeSP(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function uidRun(): string { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

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

    // Carrega template + run de hoje de um checklist. Helpers compartilhados.
    async function loadChecklist(templateId: string): Promise<{ template: any; run: any | null } | null> {
      const template = await firestoreLer("checklistTemplates", templateId).catch(() => null);
      if (!template || String(template.restaurantId) !== rid) return null;
      const hoje = hojeSP();
      const runs = await firestoreRunQuery({ from: [{ collectionId: "checklistRuns" }], where: fEq("restaurantId", rid) }).catch(() => [] as any[]);
      const run = runs.find((r) => r.data === hoje && String(r.templateId) === templateId) || null;
      return { template, run };
    }

    if (acao === "checklist-abrir") {
      if (!acoes.checklist) { res.status(403).json({ ok: false, erro: "acao_desabilitada" }); return; }
      const lc = await loadChecklist(String(body.templateId || ""));
      if (!lc) { res.status(403).json({ ok: false, erro: "template_invalido" }); return; }
      const resultado = (lc.run?.resultado || {}) as Record<string, any>;
      const itens = (Array.isArray(lc.template.itens) ? lc.template.itens : []).map((i: any) => ({ id: i.id, texto: i.texto, obrigatorio: !!i.obrigatorio, exigeObs: !!i.exigeObs, exigeFoto: !!i.exigeFoto, feito: !!resultado[i.id]?.feito, observacao: resultado[i.id]?.observacao || "", feitoPorNome: resultado[i.id]?.feitoPorNome || null }));
      res.status(200).json({ ok: true, nome: lc.template.nome || "Checklist", itens });
      return;
    }

    if (acao === "checklist-item") {
      if (!acoes.checklist) { res.status(403).json({ ok: false, erro: "acao_desabilitada" }); return; }
      const pessoa = validaPessoa(String(body.pessoaId || ""));
      if (!pessoa) { res.status(403).json({ ok: false, erro: "pessoa_nao_autorizada" }); return; }
      const templateId = String(body.templateId || "");
      const itemId = String(body.itemId || "");
      const feito = !!body.feito;
      const observacao = typeof body.observacao === "string" ? body.observacao : undefined;
      const lc = await loadChecklist(templateId);
      if (!lc) { res.status(403).json({ ok: false, erro: "template_invalido" }); return; }
      const itensT = (Array.isArray(lc.template.itens) ? lc.template.itens : []) as any[];
      const it = itensT.find((i) => i.id === itemId);
      if (!it) { res.status(400).json({ ok: false, erro: "item_invalido" }); return; }
      const now = new Date().toISOString();
      const novo = { itemId, textoSnapshot: it.texto, feito, marcadoEm: feito ? now : null, feitoPorId: feito ? pessoa.id : null, feitoPorNome: feito ? pessoa.nome : null, observacao: observacao ?? (lc.run?.resultado?.[itemId]?.observacao || undefined) };
      const resultado: Record<string, any> = { ...(lc.run?.resultado || {}), [itemId]: novo };
      const total = itensT.length;
      const feitos = itensT.filter((i) => resultado[i.id]?.feito).length;
      const obrig = itensT.filter((i) => i.obrigatorio);
      const obrigatoriosTotal = obrig.length;
      const obrigatoriosFeitos = obrig.filter((i) => resultado[i.id]?.feito).length;
      const completo = total > 0 && feitos === total;
      const status = completo ? "completo" : "rascunho";
      if (lc.run) {
        await firestorePatchCampos("checklistRuns", String(lc.run.id), {
          [`resultado.${itemId}`]: novo, feitos, totalItens: total, obrigatoriosFeitos, obrigatoriosTotal,
          status, finalizadoEm: completo ? now : null, atualizadoEm: now,
        });
      } else {
        const id = uidRun();
        await firestoreCriar("checklistRuns", id, {
          restaurantId: rid, templateId, templateNomeSnapshot: lc.template.nome, templateAreaSnapshot: lc.template.area || null,
          data: hojeSP(), executorNome: pessoa.nome,
          itens: itensT.map((i) => resultado[i.id] || { itemId: i.id, textoSnapshot: i.texto, feito: false }),
          resultado, totalItens: total, feitos, obrigatoriosFeitos, obrigatoriosTotal,
          status, iniciadoEm: now, finalizadoEm: completo ? now : null, atualizadoEm: now, log: [],
        });
      }
      res.status(200).json({ ok: true, feito, feitos, total });
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

    if (acao === "reserva-criar") {
      if (!acoes.reserva) { res.status(403).json({ ok: false, erro: "acao_desabilitada" }); return; }
      const pessoa = validaPessoa(String(body.pessoaId || ""));
      if (!pessoa) { res.status(403).json({ ok: false, erro: "pessoa_nao_autorizada" }); return; }
      const data = String(body.data || "");
      const horario = String(body.horario || "");
      const pessoas = Number(body.pessoas) || 0;
      const clienteNome = String(body.clienteNome || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{1,2}:\d{2}$/.test(horario) || pessoas <= 0) { res.status(400).json({ ok: false, erro: "bad_request" }); return; }
      const now = new Date().toISOString();
      const id = "res_" + uidRun();
      await firestoreCriar("reservas", id, { restaurantId: rid, data, horario, pessoas, status: "confirmada", origem: "interno", confirmadaEm: now, registradoEm: now, registradoPor: pessoa.id, registradoPorNome: pessoa.nome, atualizadoEm: now });
      if (clienteNome) await firestoreCriar("reservasPII", id, { restaurantId: rid, data, clienteNomeSnapshot: clienteNome, registradoEm: now });
      res.status(200).json({ ok: true, id });
      return;
    }

    res.status(400).json({ ok: false, erro: "acao_desconhecida" });
  } catch (e) {
    res.status(200).json({ ok: false, erro: "falha", detalhe: String((e as Error)?.message || e).slice(0, 200) });
  }
}
