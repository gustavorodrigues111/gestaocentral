// ════════════════════════════════════════════════════════════════════════════
//  Destino da impressão de etiquetas
//
//  O módulo pede "imprimir esta etiqueta" e esta camada decide para onde vai:
//   • app Android da Sunmi V2s (android-v2s/) → impressora interna, com
//     posicionamento pelo sensor de gap (window.SunmiBridge)
//   • qualquer outro lugar → abre a imagem no tamanho da bobina e chama o
//     diálogo de impressão do navegador
//  Futuro: ponte TSPL da estação (LP01/Elgin), já prevista na Produção SISP.
// ════════════════════════════════════════════════════════════════════════════
import { canvasParaBase64, type Bobina, BOBINA_PADRAO } from "./etiquetaTermica";

// Interface exposta pelo app Android (MainActivity → @JavascriptInterface).
// Métodos síncronos devolvem JSON; impressão e leitura respondem por callback.
type SunmiBridge = {
  status: () => string;                                     // {"conectada":bool,"estado":n,"modo":n,"modelo":"..."}
  imprimirEtiqueta: (id: string, pngBase64: string, copias: number) => void;
  lerQr: (id: string) => void;
  verificarAtualizacao?: () => void;                        // checa/instala nova versão do app (só no app antigo pode faltar)
};

// Ponte exposta pelo app Electron do CAIXA (desktop/): imprime o PNG da etiqueta
// SILENCIOSO numa impressora do PC escolhida pelo nome (ex.: impressora de
// etiqueta USB 55×55 do caixa), sem o diálogo do navegador. Métodos retornam
// Promise (ipcRenderer.invoke).
type EtiquetaBridge = {
  versao?: number;
  listarImpressoras: () => Promise<string[]>;
  imprimir: (pngBase64: string, opts: { larguraMm: number; alturaMm: number; larguraImgMm?: number; deviceName?: string; copias?: number }) => Promise<{ ok: boolean; erro?: string }>;
};

declare global {
  interface Window {
    SunmiBridge?: SunmiBridge;
    __sunmiRetorno?: (id: string, json: string) => void;
    __sunmiTeclaScan?: () => void;   // botão físico de leitura da maquininha
    etiquetaBridge?: EtiquetaBridge;
  }
}

export type StatusSunmi = { conectada: boolean; estado?: number; modo?: number; modelo?: string; erro?: string };
export type ResultadoImpressao = { ok: boolean; via: Destino; erro?: string };

const pendentes = new Map<string, (r: { ok: boolean; valor?: string; erro?: string }) => void>();
let seq = 0;

function ligarRetorno() {
  if (window.__sunmiRetorno) return;
  window.__sunmiRetorno = (id: string, json: string) => {
    const cb = pendentes.get(id);
    if (!cb) return;
    pendentes.delete(id);
    try { cb(JSON.parse(json)); } catch { cb({ ok: false, erro: "Resposta inválida do aparelho" }); }
  };
}

function chamar(fn: (id: string) => void, timeoutMs: number): Promise<{ ok: boolean; valor?: string; erro?: string }> {
  ligarRetorno();
  const id = `r${Date.now().toString(36)}_${++seq}`;
  return new Promise((resolve) => {
    const t = window.setTimeout(() => { pendentes.delete(id); resolve({ ok: false, erro: "O aparelho não respondeu a tempo" }); }, timeoutMs);
    pendentes.set(id, (r) => { window.clearTimeout(t); resolve(r); });
    try { fn(id); } catch (e) { window.clearTimeout(t); pendentes.delete(id); resolve({ ok: false, erro: String(e) }); }
  });
}

export function noAppSunmi(): boolean {
  return typeof window !== "undefined" && !!window.SunmiBridge;
}

/** Pede ao app da maquininha pra checar/instalar atualização. false = não dá (app antigo). */
export function verificarAtualizacaoApp(): boolean {
  if (!window.SunmiBridge?.verificarAtualizacao) return false;
  try { window.SunmiBridge.verificarAtualizacao(); return true; } catch { return false; }
}

/** Roda dentro do app do caixa (Electron) com a ponte de etiqueta local? */
export function noAppEtiqueta(): boolean {
  return typeof window !== "undefined" && !!window.etiquetaBridge;
}
/** Nomes das impressoras do PC (via ponte do caixa). [] fora do app. */
export async function listarImpressoras(): Promise<string[]> {
  try { return (await window.etiquetaBridge?.listarImpressoras()) || []; } catch { return []; }
}
const CHAVE_IMPRESSORA = "etiq_impressora";
export function impressoraSalva(): string { try { return localStorage.getItem(CHAVE_IMPRESSORA) || ""; } catch { return ""; } }
export function salvarImpressora(nome: string) { try { localStorage.setItem(CHAVE_IMPRESSORA, nome); } catch { /* sem storage */ } }

export function statusSunmi(): StatusSunmi | null {
  if (!window.SunmiBridge) return null;
  try { return JSON.parse(window.SunmiBridge.status()) as StatusSunmi; }
  catch (e) { return { conectada: false, erro: String(e) }; }
}

/** Texto curto para mostrar ao operador quando a impressora não está pronta. */
export function avisoStatus(s: StatusSunmi | null): string | null {
  if (!s) return null;
  if (!s.conectada) return s.erro || "Impressora interna não conectada.";
  // estado (updatePrinterState): 1 normal, 2 preparando, 3 falha de comunicação,
  // 4 sem papel, 5 superaquecida, 6 tampa aberta, 9 etiqueta não detectada, 505 sem impressora
  if (s.estado === 4) return "Sem etiqueta na impressora.";
  if (s.estado === 6) return "Tampa da impressora aberta.";
  if (s.estado === 5) return "Impressora superaquecida. Aguarde.";
  if (s.estado === 9) return "Etiqueta não detectada. Confira o rolo e o modo etiqueta.";
  if (s.estado === 3 || s.estado === 505) return "Impressora interna não responde.";
  // modo (getPrinterMode): 0 = cupom, 1 = marca preta, 2 = etiqueta
  if (s.modo != null && s.modo !== 2) return "A impressora está em modo cupom. Ative o modo etiqueta em Configurações > Impressora.";
  return null;
}

// ── Destinos ────────────────────────────────────────────────────────────────
// "sunmi": impressora interna da maquininha (só dentro do app android-v2s).
// "navegador": abre a janela de impressão do sistema, onde o operador escolhe a
// impressora (o Chrome lembra a última usada). Etiqueta sai no tamanho da bobina.
// "etiqueta-local": impressora USB do PC, impressão SILENCIOSA pela ponte do app
// do caixa (Electron) — sem o diálogo do navegador.
export type Destino = "sunmi" | "navegador" | "etiqueta-local";
export const DESTINO_LABEL: Record<Destino, string> = {
  sunmi: "Maquininha (impressora interna)",
  navegador: "Impressora do computador (escolher na janela de impressão)",
  "etiqueta-local": "Impressora de etiqueta do caixa (direto, sem janela)",
};

export function destinosDisponiveis(): Destino[] {
  // No WebView da maquininha a janela de impressão do navegador não existe.
  if (noAppSunmi()) return ["sunmi"];
  // No app do caixa (Electron): impressão direta na USB + o diálogo como alternativa.
  if (noAppEtiqueta()) return ["etiqueta-local", "navegador"];
  return ["navegador"];
}

const CHAVE_DESTINO = "etiq_destino";
export function destinoSalvo(): Destino {
  const disp = destinosDisponiveis();
  try { const d = localStorage.getItem(CHAVE_DESTINO) as Destino | null; if (d && disp.includes(d)) return d; } catch { /* sem storage */ }
  return disp[0];
}
export function salvarDestino(d: Destino) { try { localStorage.setItem(CHAVE_DESTINO, d); } catch { /* sem storage */ } }

/** Mesma imagem repetida N vezes (etiqueta fixa, testes). */
export async function imprimirEtiqueta(canvas: HTMLCanvasElement, copias = 1, bobina: Bobina = BOBINA_PADRAO, destino: Destino = destinoSalvo()): Promise<ResultadoImpressao> {
  const n = Math.max(1, Math.min(50, Math.round(copias)));
  return imprimirEtiquetas(Array.from({ length: n }, () => canvas), bobina, destino);
}

/** Uma imagem por etiqueta física (cada cópia com o seu QR), na ordem. */
export async function imprimirEtiquetas(canvases: HTMLCanvasElement[], bobina: Bobina = BOBINA_PADRAO, destino: Destino = destinoSalvo()): Promise<ResultadoImpressao> {
  if (!canvases.length) return { ok: true, via: destino };
  if (destino === "sunmi") {
    if (!window.SunmiBridge) return { ok: false, via: "sunmi", erro: "Maquininha não detectada. Abra pelo app da maquininha." };
    for (let i = 0; i < canvases.length; i++) {
      const png = canvasParaBase64(canvases[i]);
      const r = await chamar((id) => window.SunmiBridge!.imprimirEtiqueta(id, png, 1), 20000);
      if (!r.ok) return { ok: false, via: "sunmi", erro: `Etiqueta ${i + 1} de ${canvases.length}: ${r.erro || "falhou"}` };
    }
    return { ok: true, via: "sunmi" };
  }
  if (destino === "etiqueta-local") {
    if (!window.etiquetaBridge) return { ok: false, via: "etiqueta-local", erro: "Ponte de etiqueta não detectada. Abra pelo app do caixa." };
    const deviceName = impressoraSalva() || undefined;
    for (let i = 0; i < canvases.length; i++) {
      const png = canvasParaBase64(canvases[i]);
      const r = await window.etiquetaBridge.imprimir(png, { larguraMm: bobina.larguraMm, alturaMm: bobina.alturaMm, larguraImgMm: canvases[i].width / 8, deviceName, copias: 1 });
      if (!r?.ok) return { ok: false, via: "etiqueta-local", erro: `Etiqueta ${i + 1} de ${canvases.length}: ${r?.erro || "falhou"}` };
    }
    return { ok: true, via: "etiqueta-local" };
  }
  return imprimirNoNavegador(canvases, bobina);
}

// Iframe oculto em vez de window.open: não é barrado pelo bloqueador de pop-ups
// mesmo quando a impressão sai depois de gravar no banco (fora do clique).
function imprimirNoNavegador(canvases: HTMLCanvasElement[], bobina: Bobina): ResultadoImpressao {
  const larguraImgMm = canvases[0].width / 8; // desenhadas a 8 pontos/mm
  const paginas = canvases.map((c) => `<div class="pg"><img src="${c.toDataURL("image/png")}"/></div>`).join("");
  const html = `<!doctype html><html><head><title>Etiquetas</title><style>
    @page { size: ${bobina.larguraMm}mm ${bobina.alturaMm}mm; margin: 0 }
    html, body { margin: 0; padding: 0 }
    .pg { width: ${bobina.larguraMm}mm; height: ${bobina.alturaMm}mm; display: flex; align-items: center; justify-content: center; break-after: page; overflow: hidden }
    .pg:last-child { break-after: auto }
    img { width: ${larguraImgMm}mm; image-rendering: pixelated }
  </style></head><body>${paginas}</body></html>`;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const w = frame.contentWindow;
  if (!w) { frame.remove(); return { ok: false, via: "navegador", erro: "Não consegui preparar a impressão." }; }
  w.document.open(); w.document.write(html); w.document.close();
  const imprimir = () => {
    try { w.focus(); w.print(); } finally { window.setTimeout(() => frame.remove(), 60000); }
  };
  // Espera as imagens carregarem antes de chamar a impressão.
  const imgs = Array.from(w.document.images);
  Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = () => r(null); })))).then(imprimir);
  return { ok: true, via: "navegador" };
}

/** Leitura de QR pelo leitor nativo da Sunmi. null = cancelado ou indisponível. */
export async function lerQrNativo(): Promise<string | null> {
  if (!window.SunmiBridge?.lerQr) return null;
  const r = await chamar((id) => window.SunmiBridge!.lerQr(id), 120000);
  return r.ok && r.valor ? r.valor : null;
}

// ── Botão físico de leitura (maquininha) ──────────────────────────────────────
// O app Android chama window.__sunmiTeclaScan() quando o operador aperta o botão
// físico lateral da maquininha. A tela ativa registra aqui o que fazer (abrir o
// leitor e rotear o código lido) — só o último registrado (a tela visível) é
// chamado. Retorna uma função pra desarmar (usar no cleanup do useEffect).
const ouvintesTecla: Array<() => void> = [];
export function armarTeclaScan(fn: () => void): () => void {
  if (typeof window === "undefined") return () => { /* ssr */ };
  ouvintesTecla.push(fn);
  if (!window.__sunmiTeclaScan) {
    window.__sunmiTeclaScan = () => {
      const ult = ouvintesTecla[ouvintesTecla.length - 1];
      if (ult) { try { ult(); } catch { /* ignora erro da tela */ } }
    };
  }
  return () => {
    const i = ouvintesTecla.lastIndexOf(fn);
    if (i >= 0) ouvintesTecla.splice(i, 1);
  };
}
