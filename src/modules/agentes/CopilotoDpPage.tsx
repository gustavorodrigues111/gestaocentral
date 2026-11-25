// ════════════════════════════════════════════════════════════════════════════
//  Copiloto DP — chat de IA embarcado no Departamento Pessoal.
//  Reusa o motor (api/agente.ts, tipo "dp") e o componente AgenteChat. Toda
//  escrita é REVERSÍVEL: cada ação do copiloto grava o "antes" em
//  `copilotoDpAcoes`, e o painel tem "Desfazer" por ação.
//  O agente é auto-criado por restaurante (id determinístico, idempotente).
//  Acesso: master sempre + quem tiver a permissão "copilotoDp" no perfil.
//
//  LAYOUT: duas colunas — Conversa (esquerda) + Painel ao vivo (direita, mostra
//  propostas aguardando aprovação e o que já foi feito). No mobile vira abas.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { applyVersionedChange } from "../../core/audit/versionedChange";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PageContainer } from "../../core/ui/PageContainer";
import { useTabPersistida } from "../../core/hooks/useTabPersistida";
import { fmtBR } from "../../core/utils/date";
import type { AgenteIA } from "../../core/types";
import { CATALOGO, DOMINIO_META } from "./catalogo";
import { AgenteChat } from "./AgentesPage";
import { Sparkles, History, Undo2, ShieldAlert, Loader2, Check, X, MessageSquare, LayoutDashboard, Pencil } from "lucide-react";

type AcaoDp = {
  id: string; acao: string; colecao: string; docId: string; descricao: string;
  antes: Record<string, unknown> | null; pessoaNome?: string; restaurantId?: string | null;
  criadoEm: string; desfeita?: boolean; desfeitaEm?: string;
  agendadaId?: string | null;   // mudança de cargo agendada (desfazer = deletar o doc)
};

// Proposta de escrita aguardando aprovação (card com Aprovar/Recusar).
type PropDp = {
  id: string; acao: string; colecao: string; docId: string; tipoOp: "criar" | "editar";
  payload: Record<string, unknown>; resumoCampos: { label: string; valor: string }[];
  titulo: string; descricao: string; sensivel?: boolean;
  restaurantId?: string | null; pessoaNome?: string; criadoEm: string; status: string;
  // Promoção (promover_empregado): metadados pro applyVersionedChange.
  vigenteApartir?: string; cargoAntesId?: string; cargoAntesNome?: string;
  cargoNovoId?: string; cargoNovoNome?: string; empregadoNome?: string; motivo?: string;
};

// Campos que "neutralizam" um doc recém-criado ao desfazer uma CRIAÇÃO.
const INATIVAR: Record<string, Record<string, unknown>> = {
  pessoas: { ativa: false }, cargos: { ativo: false }, ptrpAjustes: { cancelado: true },
};

const SENSIVEL = new Set(["cadastrar_cargo", "editar_cargo", "promover_empregado"]);

export function CopilotoDpPage() {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id || "";
  // No mobile alterna entre as duas colunas; no desktop as duas aparecem juntas.
  const [aba, setAba] = useTabPersistida<"chat" | "painel">("copilotoDpAba", "chat");
  const [agente, setAgente] = useState<AgenteIA | null>(null);
  const [erro, setErro] = useState("");
  const [acoes, setAcoes] = useState<AcaoDp[]>([]);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [pendentes, setPendentes] = useState<PropDp[]>([]);
  const [agindo, setAgindo] = useState<string | null>(null);
  // Contador de re-assinatura: se um listener cai (403 antes de liberar a regra,
  // rede), re-assina sozinho em alguns segundos em vez de ficar morto.
  const [reconectar, setReconectar] = useState(0);
  // Rascunho enviado ao chat quando o usuário clica "Editar" num card.
  const [prefill, setPrefill] = useState<{ texto: string; nonce: number } | undefined>();

  // Garante (idempotente) um agente DP por restaurante.
  useEffect(() => {
    if (!rid) return;
    let alive = true;
    const agenteId = `copilotoDp_${rid}`;
    (async () => {
      try {
        const ref = doc(db, "agentesIA", agenteId);
        const snap = await getDoc(ref);
        const tools = Object.fromEntries(CATALOGO.dp.map((f) => [f.key, true])); // leituras + escritas (catálogo atual)
        if (!snap.exists()) {
          await setDoc(ref, sanitizeForFirestore({
            id: agenteId, nome: `Copiloto DP · ${activeRestaurant?.nome || ""}`.trim(), tipo: "dp",
            systemPrompt: DOMINIO_META.dp.promptPadrao, tools, entidades: [rid],
            modoEscrita: "confirmar", ativo: true, criadoEm: new Date().toISOString(), criadoPor: pessoa?.id || null,
          }));
        } else {
          // Mantém as tools em dia com o catálogo (habilita ferramentas novas
          // sem precisar recriar o agente). Merge: só o campo tools.
          await setDoc(ref, { tools }, { merge: true });
        }
        const fresh = await getDoc(ref);
        if (alive && fresh.exists()) setAgente({ id: agenteId, ...(fresh.data() as object) } as AgenteIA);
      } catch (e) {
        if (alive) setErro(e instanceof Error ? e.message : "Falha ao preparar o copiloto.");
      }
    })();
    return () => { alive = false; };
  }, [rid, activeRestaurant?.nome, pessoa?.id]);

  // Histórico de ações (pro Desfazer).
  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(
      query(collection(db, "copilotoDpAcoes"), where("restaurantId", "==", rid)),
      (s) => setAcoes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as AcaoDp)
        .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))),
      () => { setTimeout(() => setReconectar((r) => r + 1), 3000); }, // re-assina sozinho
    );
    return () => u();
  }, [rid, reconectar]);

  async function desfazer(a: AcaoDp) {
    if (a.desfeita || desfazendo) return;
    setDesfazendo(a.id);
    try {
      if (a.agendadaId) {
        // Promoção AGENDADA (vigência futura): a mudança ainda não entrou no
        // cargo — basta apagar o agendamento. O cargo vivo não mudou.
        await deleteDoc(doc(db, "mudancasAgendadas", a.agendadaId));
      } else {
        const patch = a.antes && Object.keys(a.antes).length
          ? { ...a.antes, _cdpDesfeita: true }               // edição → restaura o "antes"
          : { ...(INATIVAR[a.colecao] || {}), _cdpDesfeita: true }; // criação → neutraliza
        await updateDoc(doc(db, a.colecao, a.docId), sanitizeForFirestore(patch));
      }
      await updateDoc(doc(db, "copilotoDpAcoes", a.id), { desfeita: true, desfeitaEm: new Date().toISOString() });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao desfazer.");
    } finally {
      setDesfazendo(null);
    }
  }

  // Propostas aguardando aprovação (um where só — filtra status no cliente pra
  // não exigir índice composto no Firestore).
  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(
      query(collection(db, "copilotoDpPendentes"), where("restaurantId", "==", rid)),
      (s) => setPendentes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as PropDp)
        .filter((p) => p.status === "aguardando")
        .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)))),
      () => { setTimeout(() => setReconectar((r) => r + 1), 3000); }, // re-assina sozinho
    );
    return () => u();
  }, [rid, reconectar]);

  async function logAcao(x: { acao: string; colecao: string; docId: string; antes: Record<string, unknown> | null; descricao: string; agendadaId?: string | null }) {
    const id = `cdp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, "copilotoDpAcoes", id), sanitizeForFirestore({
      id, acao: x.acao, colecao: x.colecao, docId: x.docId, antes: x.antes ?? null, descricao: x.descricao,
      agendadaId: x.agendadaId ?? null,
      pessoaNome: pessoa?.nome || "", restaurantId: rid, criadoEm: new Date().toISOString(), desfeita: false,
    }));
  }

  async function aprovar(p: PropDp) {
    if (agindo) return;
    setAgindo(p.id);
    try {
      if (p.acao === "promover_empregado") {
        // Mudança de cargo do EMPREGADO: usa o MESMO motor versionado do app
        // (imediato se vigência <= hoje; senão agenda). Mantém histórico+auditoria.
        const novoCargoId = String(p.cargoNovoId || (p.payload as Record<string, unknown>).cargoId || "");
        const r = await applyVersionedChange({
          entityType: "empregado", entityId: p.docId, restaurantId: rid,
          campo: "cargoId", valorAntes: p.cargoAntesId ?? null, valorDepois: novoCargoId,
          vigenteApartir: p.vigenteApartir || new Date().toISOString().slice(0, 10),
          motivo: p.motivo || `Promoção: ${p.cargoAntesNome || "?"} → ${p.cargoNovoNome || ""}`,
          registradoPor: pessoa?.id || "",
        });
        await logAcao({ acao: p.acao, colecao: "empregados", docId: p.docId, antes: { cargoId: p.cargoAntesId ?? null }, descricao: p.descricao, agendadaId: r.agendadaId ?? null });
      } else if (p.tipoOp === "criar") {
        await setDoc(doc(db, p.colecao, p.docId), sanitizeForFirestore(p.payload));
        await logAcao({ acao: p.acao, colecao: p.colecao, docId: p.docId, antes: null, descricao: p.descricao });
      } else {
        const snap = await getDoc(doc(db, p.colecao, p.docId));
        const atual = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
        const antes: Record<string, unknown> = {};
        for (const k of Object.keys(p.payload)) antes[k] = atual[k] ?? null;
        await updateDoc(doc(db, p.colecao, p.docId), sanitizeForFirestore(p.payload));
        await logAcao({ acao: p.acao, colecao: p.colecao, docId: p.docId, antes, descricao: p.descricao });
      }
      await updateDoc(doc(db, "copilotoDpPendentes", p.id), { status: "aprovada", aprovadaEm: new Date().toISOString(), aprovadaPor: pessoa?.nome || "" });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao aprovar.");
    } finally { setAgindo(null); }
  }

  async function recusar(p: PropDp) {
    if (agindo) return;
    setAgindo(p.id);
    try {
      await updateDoc(doc(db, "copilotoDpPendentes", p.id), { status: "recusada", recusadaEm: new Date().toISOString() });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao recusar.");
    } finally { setAgindo(null); }
  }

  // "Editar comando": recusa a proposta atual e joga um rascunho no chat com o
  // que estava proposto, pra o usuário dizer o ajuste e o copiloto remontar.
  async function editar(p: PropDp) {
    if (agindo) return;
    setAgindo(p.id);
    try {
      await updateDoc(doc(db, "copilotoDpPendentes", p.id), { status: "recusada", recusadaEm: new Date().toISOString(), motivoRecusa: "editar" });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao editar."); setAgindo(null); return;
    }
    setAgindo(null);
    const campos = (p.resumoCampos || []).map((c) => `${c.label}: ${c.valor}`).join("; ");
    setPrefill({ texto: `Ajusta a proposta "${p.titulo}"${campos ? ` (${campos})` : ""}. Muda: `, nonce: Date.now() });
    setAba("chat");
  }

  const fmtQuando = (iso: string) => {
    try { const d = new Date(iso); return `${fmtBR(iso)} ${d.toTimeString().slice(0, 5)}`; } catch { return iso; }
  };

  // Altura das colunas (descontando cabeçalho + abas do mobile).
  const PANE_H = "calc(100vh - 210px)";

  // ── Card de proposta (aguardando aprovação) ───────────────────────────────
  const CardProp = (p: PropDp) => (
    <div key={p.id} className={`rounded-xl border p-3 ${p.sensivel
      ? "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30"
      : "border-indigo-200 bg-indigo-50/70 dark:border-indigo-800 dark:bg-indigo-950/30"}`}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {p.sensivel ? <ShieldAlert size={15} className="text-amber-500 flex-none" /> : <Sparkles size={15} className="text-indigo-500 flex-none" />}
        <b className="text-sm text-gray-900 dark:text-gray-100">{p.titulo}</b>
        {p.sensivel && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100">afeta gorjeta/folha</span>}
      </div>
      <div className="space-y-1 mb-3">
        {(p.resumoCampos || []).map((c, i) => (
          <div key={i} className="flex gap-2 text-xs min-w-0">
            <span className="text-gray-400 dark:text-gray-500 w-24 flex-none">{c.label}</span>
            <span className="text-gray-800 dark:text-gray-200 font-medium break-words min-w-0">{c.valor}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => aprovar(p)} disabled={agindo === p.id}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white enabled:hover:bg-emerald-700 disabled:opacity-50">
          {agindo === p.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Aprovar
        </button>
        <button onClick={() => editar(p)} disabled={agindo === p.id}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 enabled:hover:bg-indigo-50 enabled:dark:hover:bg-indigo-950/40 disabled:opacity-50">
          <Pencil size={14} /> Editar
        </button>
        <button onClick={() => recusar(p)} disabled={agindo === p.id}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 enabled:hover:bg-gray-50 enabled:dark:hover:bg-gray-800 disabled:opacity-50">
          <X size={14} /> Recusar
        </button>
      </div>
    </div>
  );

  // ── Linha de ação (feito recentemente) ────────────────────────────────────
  const LinhaAcao = (a: AcaoDp) => (
    <div key={a.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${
      a.desfeita
        ? "border-gray-200 dark:border-gray-800 opacity-55"
        : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
    }`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {SENSIVEL.has(a.acao) && <ShieldAlert size={12} className="text-amber-500 flex-none" aria-label="sensível" />}
          <span className="text-[13px] font-medium text-gray-900 dark:text-gray-100 truncate">{a.descricao || a.acao}</span>
          {a.desfeita && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800">desfeita</span>}
        </div>
        <div className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
          {fmtQuando(a.criadoEm)}{a.pessoaNome ? ` · ${a.pessoaNome}` : ""}
        </div>
      </div>
      <button
        onClick={() => desfazer(a)}
        disabled={a.desfeita || desfazendo === a.id}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 enabled:hover:bg-gray-50 enabled:dark:hover:bg-gray-800 disabled:opacity-40 flex-none"
      >
        {desfazendo === a.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
        Desfazer
      </button>
    </div>
  );

  // ── Painel ao vivo (coluna direita) ───────────────────────────────────────
  const Painel = (
    <div className="h-full flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Painel ao vivo</span>
        {pendentes.length > 0 && (
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
            {pendentes.length} aguardando
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-5">
        {/* Aguardando aprovação */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-0.5">
            <Check size={13} /> Aguardando sua aprovação
          </h3>
          {pendentes.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-gray-500 px-0.5 py-3 leading-relaxed">
              Quando você pedir algo que altera dados, a proposta aparece aqui pra você conferir e aprovar.
            </div>
          ) : (
            <div className="space-y-2.5">{pendentes.map(CardProp)}</div>
          )}
        </section>

        {/* Feito recentemente */}
        <section>
          <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-0.5">
            <History size={13} /> Feito recentemente
          </h3>
          {acoes.length === 0 ? (
            <div className="text-xs text-gray-400 dark:text-gray-500 px-0.5 py-3 leading-relaxed">
              Nada por aqui ainda. Tudo que o copiloto fizer no sistema fica registrado aqui — com botão de desfazer.
            </div>
          ) : (
            <div className="space-y-1.5">{acoes.slice(0, 30).map(LinhaAcao)}</div>
          )}
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 px-0.5 leading-relaxed">
            Contrato e WhatsApp são ações externas: o copiloto só propõe, nunca dispara sozinho.
          </p>
        </section>
      </div>
    </div>
  );

  // ── Conversa (coluna esquerda) ────────────────────────────────────────────
  const Conversa = !agente ? (
    <div className="h-full flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 rounded-2xl border border-gray-200 dark:border-gray-800">
      <Loader2 size={16} className="animate-spin" /> Preparando o copiloto…
    </div>
  ) : (
    <div className="h-full rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <AgenteChat
        agente={agente}
        pessoaId={pessoa?.id}
        pessoaNome={pessoa?.nome}
        onVoltar={() => setAba("painel")}
        onConfig={() => setAba("painel")}
        soMinhaConversa
        prefill={prefill}
      />
    </div>
  );

  return (
    <PageContainer>
      <div className="mb-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
            <Sparkles size={18} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">Copiloto DP</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Converse à esquerda · o painel à direita mostra o que precisa de aprovação e o que já foi feito</p>
          </div>
        </div>
      </div>

      {/* Abas — só no mobile (no desktop as duas colunas aparecem juntas) */}
      <div className="lg:hidden flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        {([["chat", "Conversa", MessageSquare], ["painel", "Painel", LayoutDashboard]] as const).map(([k, label, Ic]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px ${
              aba === k
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            <Ic size={15} />{label}
            {k === "painel" && pendentes.length > 0 && (
              <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                {pendentes.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {erro && (
        <div className="mb-3 text-sm px-3 py-2 rounded-lg bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300">{erro}</div>
      )}

      {/* Duas colunas no desktop; no mobile mostra a aba escolhida */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(320px,400px)] gap-4" style={{ height: PANE_H, minHeight: 440 }}>
        <div className={`min-h-0 ${aba === "chat" ? "" : "hidden"} lg:block`}>{Conversa}</div>
        <div className={`min-h-0 ${aba === "painel" ? "" : "hidden"} lg:block`}>{Painel}</div>
      </div>
    </PageContainer>
  );
}
