// ════════════════════════════════════════════════════════════════════════════
//  /api/pagina-dados — estado compartilhado (multi-usuário, tempo real por
//  polling) de PÁGINAS hospedadas que são apps colaborativos — ex.: o painel de
//  Implantação Sororoca Paraty. A página roda em iframe isolado SEM sessão
//  Firebase, então NÃO fala direto com o Firestore: fala com este endpoint, que
//  grava como usuário de serviço (via _firestoreRest). Nenhuma regra do Firestore
//  é aberta — a coleção `paginasDados` continua exigindo authed() e só o servidor
//  escreve aqui.
//
//  Modelo por página (doc `paginasDados/{page}`): mapas keyed-by-id de
//  `tarefas`, `pessoas`, `comentarios`, `historico` + objeto `config`.
//  Tarefas/comentários/histórico = colaborativo (basta o token). Equipe (pessoas)
//  e config = só MASTER (senha validada no servidor; a senha nunca é devolvida).
//
//  A senha de master NÃO vem no código: é definida na 1ª vez pela própria tela de
//  config (bootstrap `setMasterInicial`) e fica só no Firestore. `token` é um
//  portão leve contra bots; o master é o segredo que protege config/equipe.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreLer, firestoreCriar, firestorePatchCampos } from "./_firestoreRest.js";

export const config = { maxDuration: 15 };

const COL = "paginasDados";
const TOKEN = "sororoca-pages-2026";
const idOk = (s: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(s);
const campoOk = (s: string) => /^[a-zA-Z0-9_]{1,40}$/.test(s);

// ── Seed inicial por página (criado no 1º get). SEM senha — definida depois. ──
function seedImplantacao(): Record<string, unknown> {
  const nowISO = new Date().toISOString();
  const pessoas: Record<string, unknown> = {
    gustavo: { nome: "Gustavo", funcao: "", ativo: true, criadoEm: nowISO },
    marilia: { nome: "Marília", funcao: "", ativo: true, criadoEm: nowISO },
    antonio: { nome: "Antonio", funcao: "", ativo: true, criadoEm: nowISO },
  };
  const F = { JUR: "Jurídico e licenças", OBRA: "Obra e acabamento", MOB: "Mobiliário", EQUIP: "Equipamentos e utensílios", CV: "Comunicação visual", TEC: "Tecnologia", EQUIPE: "Equipe" };
  const lista: [string, string][] = [
    ["Lavagem de piso", F.OBRA],
    ["Pintura", F.OBRA],
    ["Gesso da parte interna do bar", F.OBRA],
    ["Instalação de som", F.TEC],
    ["Caixa de vidro do expositor", F.MOB],
    ["Letreiros externos", F.CV],
    ["Lousa de peixes", F.CV],
    ["Uniformes", F.EQUIPE],
    ["Louças", F.EQUIP],
    ["Talheres", F.EQUIP],
    ["Copos", F.EQUIP],
    ["Equipamentos cozinha de produção", F.EQUIP],
    ["Equipamentos faltantes de bar e cozinha", F.EQUIP],
    ["Configuração de rede", F.TEC],
    ["Contrato social e acordo de sócios", F.JUR],
    ["Licenças de funcionamento", F.JUR],
    ["Cadeiras de praia", F.MOB],
    ["Bancos lounge", F.MOB],
    ["Alteração do balcão do bar e revestimento", F.OBRA],
    ["Revestimento banheiro químico", F.OBRA],
    ["Pintura das paredes e móveis de ferro", F.OBRA],
  ];
  const tarefas: Record<string, unknown> = {};
  lista.forEach(([titulo, frente], i) => {
    tarefas["t" + (i + 1)] = {
      titulo, frente, responsavel: "", prazo: "", status: "a_fazer", obs: "",
      ordem: i + 1, excluida: false, criadoEm: nowISO, criadoPor: "Cadastro inicial",
      atualizadoEm: nowISO, atualizadoPor: "", concluidoEm: "", concluidoPor: "",
    };
  });
  return {
    config: { nome: "Implantação Sororoca Paraty", inauguracao: "", masterSenha: "" },
    pessoas, tarefas, comentarios: {}, historico: {}, criadoEm: nowISO,
  };
}

async function carregar(page: string): Promise<Record<string, unknown>> {
  const d = await firestoreLer(COL, page);
  if (d) return d;
  const seed = page === "implantacaoparaty" ? seedImplantacao() : { config: {}, pessoas: {}, tarefas: {}, comentarios: {}, historico: {}, criadoEm: new Date().toISOString() };
  await firestoreCriar(COL, page, seed).catch(() => {});
  return seed;
}
const COLS_COLAB = new Set(["tarefas", "comentarios", "historico"]);
const COLS_MASTER = new Set(["pessoas"]);

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
    if (String(body.token || "") !== TOKEN) { res.status(403).json({ ok: false, erro: "token" }); return; }
    const page = String(body.page || "").trim().toLowerCase();
    if (!idOk(page)) { res.status(400).json({ ok: false, erro: "page" }); return; }
    const op = String(body.op || "");
    const doc = await carregar(page);
    const cfg = (doc.config || {}) as Record<string, unknown>;
    const senhaDefinida = !!String(cfg.masterSenha || "");
    const ehMaster = senhaDefinida && String(body.master || "") === String(cfg.masterSenha || "");

    if (op === "get") {
      const { masterSenha: _omit, ...cfgPublica } = cfg;   // nunca devolve a senha
      void _omit;
      res.status(200).json({
        ok: true,
        tarefas: doc.tarefas || {}, pessoas: doc.pessoas || {},
        comentarios: doc.comentarios || {}, historico: doc.historico || {},
        config: cfgPublica, masterDefinido: senhaDefinida,
      });
      return;
    }

    if (op === "checkMaster") {
      if (!ehMaster) { res.status(403).json({ ok: false, erro: senhaDefinida ? "master" : "semMaster" }); return; }
      res.status(200).json({ ok: true }); return;
    }

    // Bootstrap: define a senha de master na 1ª vez (só enquanto não existir).
    if (op === "setMasterInicial") {
      if (senhaDefinida) { res.status(409).json({ ok: false, erro: "jaDefinido" }); return; }
      const nova = String(body.novaSenha || "").trim();
      if (nova.length < 4) { res.status(400).json({ ok: false, erro: "curta" }); return; }
      await firestorePatchCampos(COL, page, { "config.masterSenha": nova });
      res.status(200).json({ ok: true }); return;
    }

    if (op === "add") {
      const col = String(body.col || ""); const id = String(body.id || "");
      const obj = (body.obj && typeof body.obj === "object") ? body.obj as Record<string, unknown> : null;
      if (!idOk(id) || !obj || (!COLS_COLAB.has(col) && !COLS_MASTER.has(col))) { res.status(400).json({ ok: false, erro: "add" }); return; }
      if (COLS_MASTER.has(col) && !ehMaster) { res.status(403).json({ ok: false, erro: "master" }); return; }
      await firestorePatchCampos(COL, page, { [`${col}.${id}`]: obj });
      res.status(200).json({ ok: true, id }); return;
    }

    if (op === "update") {
      const col = String(body.col || ""); const id = String(body.id || "");
      const patch = (body.patch && typeof body.patch === "object") ? body.patch as Record<string, unknown> : null;
      if (!idOk(id) || !patch || (!COLS_COLAB.has(col) && !COLS_MASTER.has(col))) { res.status(400).json({ ok: false, erro: "update" }); return; }
      if (COLS_MASTER.has(col) && !ehMaster) { res.status(403).json({ ok: false, erro: "master" }); return; }
      const upd: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) { if (campoOk(k)) upd[`${col}.${id}.${k}`] = v; }
      if (Object.keys(upd).length === 0) { res.status(400).json({ ok: false, erro: "campos" }); return; }
      await firestorePatchCampos(COL, page, upd);
      res.status(200).json({ ok: true }); return;
    }

    if (op === "setConfig") {
      if (!ehMaster) { res.status(403).json({ ok: false, erro: "master" }); return; }
      const patch = (body.patch && typeof body.patch === "object") ? body.patch as Record<string, unknown> : null;
      if (!patch) { res.status(400).json({ ok: false, erro: "patch" }); return; }
      const upd: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!campoOk(k)) continue;
        if (k === "masterSenha") { const s = String(v || "").trim(); if (s.length >= 4) upd["config.masterSenha"] = s; continue; }
        upd[`config.${k}`] = typeof v === "string" ? v.slice(0, 200) : v;
      }
      if (Object.keys(upd).length) await firestorePatchCampos(COL, page, upd);
      res.status(200).json({ ok: true }); return;
    }

    res.status(400).json({ ok: false, erro: "op" });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e instanceof Error ? e.message : "?" });
  }
}
