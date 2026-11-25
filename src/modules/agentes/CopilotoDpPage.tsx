// ════════════════════════════════════════════════════════════════════════════
//  Copiloto DP — chat de IA embarcado no Departamento Pessoal.
//  Reusa o motor (api/agente.ts, tipo "dp") e o componente AgenteChat. Toda
//  escrita é REVERSÍVEL: cada ação do copiloto grava o "antes" em
//  `copilotoDpAcoes`, e a aba Histórico tem "Desfazer" por ação.
//  O agente é auto-criado por restaurante (id determinístico, idempotente).
//  Acesso: master sempre + quem tiver a permissão "copilotoDp" no perfil.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PageContainer } from "../../core/ui/PageContainer";
import { useTabPersistida } from "../../core/hooks/useTabPersistida";
import { fmtBR } from "../../core/utils/date";
import type { AgenteIA } from "../../core/types";
import { CATALOGO, DOMINIO_META } from "./catalogo";
import { AgenteChat } from "./AgentesPage";
import { Sparkles, History, Undo2, ShieldAlert, Loader2, Check, X } from "lucide-react";

type AcaoDp = {
  id: string; acao: string; colecao: string; docId: string; descricao: string;
  antes: Record<string, unknown> | null; pessoaNome?: string; restaurantId?: string | null;
  criadoEm: string; desfeita?: boolean; desfeitaEm?: string;
};

// Proposta de escrita aguardando aprovação (card com Aprovar/Recusar).
type PropDp = {
  id: string; acao: string; colecao: string; docId: string; tipoOp: "criar" | "editar";
  payload: Record<string, unknown>; resumoCampos: { label: string; valor: string }[];
  titulo: string; descricao: string; sensivel?: boolean;
  restaurantId?: string | null; pessoaNome?: string; criadoEm: string; status: string;
};

// Campos que "neutralizam" um doc recém-criado ao desfazer uma CRIAÇÃO.
const INATIVAR: Record<string, Record<string, unknown>> = {
  pessoas: { ativa: false }, cargos: { ativo: false }, ptrpAjustes: { cancelado: true },
};

export function CopilotoDpPage() {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id || "";
  const [aba, setAba] = useTabPersistida<"chat" | "hist">("copilotoDpAba", "chat");
  const [agente, setAgente] = useState<AgenteIA | null>(null);
  const [erro, setErro] = useState("");
  const [acoes, setAcoes] = useState<AcaoDp[]>([]);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [pendentes, setPendentes] = useState<PropDp[]>([]);
  const [agindo, setAgindo] = useState<string | null>(null);

  // Garante (idempotente) um agente DP por restaurante.
  useEffect(() => {
    if (!rid) return;
    let alive = true;
    const agenteId = `copilotoDp_${rid}`;
    (async () => {
      try {
        const ref = doc(db, "agentesIA", agenteId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          const tools = Object.fromEntries(CATALOGO.dp.map((f) => [f.key, true])); // leituras + escritas
          await setDoc(ref, sanitizeForFirestore({
            id: agenteId, nome: `Copiloto DP · ${activeRestaurant?.nome || ""}`.trim(), tipo: "dp",
            systemPrompt: DOMINIO_META.dp.promptPadrao, tools, entidades: [rid],
            modoEscrita: "confirmar", ativo: true, criadoEm: new Date().toISOString(), criadoPor: pessoa?.id || null,
          }));
        }
        const fresh = await getDoc(ref);
        if (alive && fresh.exists()) setAgente({ id: agenteId, ...(fresh.data() as object) } as AgenteIA);
      } catch (e) {
        if (alive) setErro(e instanceof Error ? e.message : "Falha ao preparar o copiloto.");
      }
    })();
    return () => { alive = false; };
  }, [rid, activeRestaurant?.nome, pessoa?.id]);

  // Histórico de ações (pra aba Desfazer).
  useEffect(() => {
    if (!rid) return;
    const u = onSnapshot(
      query(collection(db, "copilotoDpAcoes"), where("restaurantId", "==", rid)),
      (s) => setAcoes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as AcaoDp)
        .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))),
      () => { /* permissão/rede — mantém o último valor */ },
    );
    return () => u();
  }, [rid]);

  async function desfazer(a: AcaoDp) {
    if (a.desfeita || desfazendo) return;
    setDesfazendo(a.id);
    try {
      const patch = a.antes && Object.keys(a.antes).length
        ? { ...a.antes, _cdpDesfeita: true }               // edição → restaura o "antes"
        : { ...(INATIVAR[a.colecao] || {}), _cdpDesfeita: true }; // criação → neutraliza
      await updateDoc(doc(db, a.colecao, a.docId), sanitizeForFirestore(patch));
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
      () => { /* permissão/rede */ },
    );
    return () => u();
  }, [rid]);

  async function logAcao(x: { acao: string; colecao: string; docId: string; antes: Record<string, unknown> | null; descricao: string }) {
    const id = `cdp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, "copilotoDpAcoes", id), sanitizeForFirestore({
      id, acao: x.acao, colecao: x.colecao, docId: x.docId, antes: x.antes ?? null, descricao: x.descricao,
      pessoaNome: pessoa?.nome || "", restaurantId: rid, criadoEm: new Date().toISOString(), desfeita: false,
    }));
  }

  async function aprovar(p: PropDp) {
    if (agindo) return;
    setAgindo(p.id);
    try {
      if (p.tipoOp === "criar") {
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

  const SENSIVEL = new Set(["cadastrar_cargo", "editar_cargo"]);
  const fmtQuando = (iso: string) => {
    try { const d = new Date(iso); return `${fmtBR(iso)} ${d.toTimeString().slice(0, 5)}`; } catch { return iso; }
  };

  return (
    <PageContainer>
      <div className="mb-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
            <Sparkles size={18} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">Copiloto DP</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Consulta e escreve com confirmação · tudo reversível</p>
          </div>
        </div>
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        {([["chat", "Conversa", Sparkles], ["hist", "Histórico / Desfazer", History]] as const).map(([k, label, Ic]) => (
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
            {k === "chat" && pendentes.length > 0 && (
              <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                {pendentes.length}
              </span>
            )}
            {k === "hist" && acoes.some((a) => !a.desfeita) && (
              <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
                {acoes.filter((a) => !a.desfeita).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {erro && (
        <div className="mb-3 text-sm px-3 py-2 rounded-lg bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300">{erro}</div>
      )}

      {aba === "chat" && (
        <div className="space-y-3">
          {/* Cards de aprovação — o copiloto propõe aqui; a escrita só acontece no Aprovar. */}
          {pendentes.map((p) => (
            <div key={p.id} className={`rounded-2xl border p-3.5 ${p.sensivel
              ? "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30"
              : "border-indigo-200 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/30"}`}>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {p.sensivel ? <ShieldAlert size={16} className="text-amber-500 flex-none" /> : <Sparkles size={16} className="text-indigo-500 flex-none" />}
                <b className="text-sm text-gray-900 dark:text-gray-100">{p.titulo}</b>
                {p.sensivel && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100">afeta gorjeta/folha</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mb-3">
                {(p.resumoCampos || []).map((c, i) => (
                  <div key={i} className="flex gap-2 text-xs min-w-0">
                    <span className="text-gray-400 dark:text-gray-500 w-24 flex-none">{c.label}</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium break-words min-w-0">{c.valor}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => aprovar(p)} disabled={agindo === p.id}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white enabled:hover:bg-emerald-700 disabled:opacity-50">
                  {agindo === p.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Aprovar
                </button>
                <button onClick={() => recusar(p)} disabled={agindo === p.id}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 enabled:hover:bg-gray-50 enabled:dark:hover:bg-gray-800 disabled:opacity-50">
                  <X size={14} /> Recusar
                </button>
              </div>
            </div>
          ))}

          {!agente ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-16 justify-center">
              <Loader2 size={16} className="animate-spin" /> Preparando o copiloto…
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
              style={{ height: pendentes.length ? "calc(100vh - 380px)" : "calc(100vh - 230px)", minHeight: 360 }}>
              <AgenteChat
                agente={agente}
                pessoaId={pessoa?.id}
                pessoaNome={pessoa?.nome}
                onVoltar={() => setAba("hist")}
                onConfig={() => setAba("hist")}
              />
            </div>
          )}
        </div>
      )}

      {aba === "hist" && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Cada alteração que o copiloto fez no sistema. <b>Desfazer</b> volta ao estado anterior.
            Ações externas (contrato, WhatsApp) não aparecem aqui porque o copiloto só as propõe — não as dispara.
          </p>
          {acoes.length === 0 && (
            <div className="text-sm text-gray-400 dark:text-gray-500 py-12 text-center">Nenhuma ação ainda.</div>
          )}
          {acoes.map((a) => (
            <div key={a.id} className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border ${
              a.desfeita
                ? "border-gray-200 dark:border-gray-800 opacity-55"
                : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
            }`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {SENSIVEL.has(a.acao) && <ShieldAlert size={13} className="text-amber-500 flex-none" aria-label="sensível" />}
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{a.descricao || a.acao}</span>
                  {a.desfeita && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800">desfeita</span>}
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
                  {fmtQuando(a.criadoEm)}{a.pessoaNome ? ` · ${a.pessoaNome}` : ""}
                </div>
              </div>
              <button
                onClick={() => desfazer(a)}
                disabled={a.desfeita || desfazendo === a.id}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 enabled:hover:bg-gray-50 enabled:dark:hover:bg-gray-800 disabled:opacity-40 flex-none"
              >
                {desfazendo === a.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                Desfazer
              </button>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
