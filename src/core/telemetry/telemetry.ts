// ════════════════════════════════════════════════════════════════════════════
//  Telemetria de USO — instrumentação leve e transversal a todos os módulos.
//
//  O que é: eventos de USO (abriu o app, abriu um módulo, executou uma ação-chave)
//  pra entender adoção e comportamento — quais módulos são usados, por quem, com
//  que frequência. NÃO é log de erro (isso é o Monitor de falhas) nem dado do
//  negócio.
//
//  Princípios:
//   • Best-effort: telemetria JAMAIS pode quebrar a UX (fire-and-forget, erro engolido).
//   • Sem PII sensível: só quem (pessoaId + nome interno), onde (restaurantId),
//     quando (ts) e o quê (módulo/ação). Nunca conteúdo, CPF, valores, mensagens.
//   • Barato: views são throttladas (1 por pessoa|módulo|restaurante a cada 5 min).
//
//  Coleção Firestore: /telemetria — create p/ autenticado, read só master.
// ════════════════════════════════════════════════════════════════════════════
import { addDoc, collection } from "firebase/firestore";
import { db } from "../firebase/config";
import { APP_COMMIT } from "../version";

export type TelemetriaCtx = { pessoaId: string; pessoaNome?: string; restaurantId?: string };
type TelemetriaTipo = "app_open" | "view" | "acao";

// Sessão = uma carga do app (agrupa eventos). Gerado 1x por load.
let sessaoId = "";
function getSessao(): string {
  if (!sessaoId) sessaoId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return sessaoId;
}
const hojeYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Throttle de views (evita spam de re-render/navegação repetida).
const ultimoView: Record<string, number> = {};
const JANELA_VIEW_MS = 5 * 60 * 1000;
let appOpenEnviado = false;

function enviar(tipo: TelemetriaTipo, ctx: TelemetriaCtx, extra: Record<string, unknown> = {}) {
  if (!ctx.pessoaId) return;
  const evt = {
    ts: new Date().toISOString(),
    dia: hojeYmd(),
    tipo,
    pessoaId: ctx.pessoaId,
    ...(ctx.pessoaNome ? { pessoaNome: ctx.pessoaNome } : {}),
    ...(ctx.restaurantId ? { restaurantId: ctx.restaurantId } : {}),
    sessaoId: getSessao(),
    ...(APP_COMMIT ? { appCommit: APP_COMMIT } : {}),
    ...extra,
  };
  // fire-and-forget — telemetria nunca quebra a UX
  void addDoc(collection(db, "telemetria"), evt).catch(() => { /* best-effort */ });
}

// Marca o início da sessão (1x por carga do app).
export function telemetriaAppOpen(ctx: TelemetriaCtx) {
  if (appOpenEnviado || !ctx.pessoaId) return;
  appOpenEnviado = true;
  enviar("app_open", ctx);
}

// Abertura de um módulo — throttlada por (pessoa|módulo|restaurante).
export function telemetriaView(ctx: TelemetriaCtx, modulo: string) {
  if (!ctx.pessoaId || !modulo) return;
  const chave = `${ctx.pessoaId}|${modulo}|${ctx.restaurantId || "-"}`;
  const agora = Date.now();
  if (ultimoView[chave] && agora - ultimoView[chave] < JANELA_VIEW_MS) return;
  ultimoView[chave] = agora;
  enviar("view", ctx, { modulo });
}

// Ação-chave dentro de um módulo (criar, excluir, publicar…). Meta pequeno e sem PII.
export function telemetriaAcao(ctx: TelemetriaCtx, modulo: string, acao: string, meta?: Record<string, string | number | boolean>) {
  if (!ctx.pessoaId) return;
  enviar("acao", ctx, { modulo, acao, ...(meta ? { meta } : {}) });
}
