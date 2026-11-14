// ════════════════════════════════════════════════════════════════════════════
//  Gestão de Estoques e Validades
//
//  Loop de estoque por LOTE com giro PVPS/PEPS:
//   • Cadastro → Locais (geladeiras/câmaras/…) + Produtos (matriz de conservação)
//   • Entrada → cria lote (qtd + validade + local) e diz onde arrumar (PVPS/PEPS)
//   • Baixa   → escolhe produto, o sistema aponta o lote certo (giro) e baixa a qtd
//   • Painel  → saldo + o que vence (FEFO)
//  Fluxos manuais primeiro; QR (baixa por scan) e OCR da NF entram como evolução.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BarChart3, PackageMinus, PackagePlus, FolderOpen, MapPin, Tag, Settings, Package, TriangleAlert, Camera, Inbox, Printer, Ruler, Snowflake, Circle, Pencil, Trash2, Hand, Menu, RefreshCw, Home, ChevronRight, ChevronDown, Smartphone, User, LogOut } from "lucide-react";
import { isComandasKioskHost, isEtiquetasKioskHost } from "../../core/restaurant/subdomain";
import { APP_VERSION_LABEL } from "../../core/version";
import { destinosDisponiveis, destinoSalvo, salvarDestino, DESTINO_LABEL, listarImpressoras, impressoraSalva, salvarImpressora, type Destino } from "../../core/impressao/impressora";

const BOBINAS_ETIQ: [string, string][] = [["58x40", "58 × 40 mm"], ["55x55", "55 × 55 mm"], ["58x60", "58 × 60 mm"], ["60x40", "60 × 40 mm"], ["60x60", "60 × 60 mm"], ["100x50", "100 × 50 mm"], ["100x100", "100 × 100 mm"]];

// Config da impressora de etiqueta no cabeçalho (igual ao "Imprimir aqui" do
// Comandas). Grava em localStorage e avisa a EtiquetasTab (evento etiq-impressora).
function PrinterCfgModal({ onClose }: { onClose: () => void }) {
  const [destino, setDestino] = useState<Destino>(() => destinoSalvo());
  const [impressora, setImpressora] = useState(() => impressoraSalva());
  const [bobina, setBobina] = useState(() => { try { return localStorage.getItem("etiq_bobina") || "58x40"; } catch { return "58x40"; } });
  const [impressoras, setImpressoras] = useState<string[]>([]);
  const destinos = destinosDisponiveis();
  useEffect(() => { if (destino !== "etiqueta-local") return; let v = true; void listarImpressoras().then((l) => { if (v) setImpressoras(l); }); return () => { v = false; }; }, [destino]);
  const avisar = () => { try { window.dispatchEvent(new Event("etiq-impressora")); } catch { /* */ } };
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-sm w-full p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1"><Printer size={18} className="text-emerald-600" /><div className="font-bold text-lg">Impressora de etiqueta</div></div>
        <p className="text-xs text-gray-500 mb-3">Deste computador. A escolha fica salva aqui.</p>
        <div className="flex flex-col gap-2.5">
          {destinos.length > 1 && (<div><label className="text-[11px] text-gray-500">Destino</label><select value={destino} onChange={(e) => { const d = e.target.value as Destino; setDestino(d); salvarDestino(d); avisar(); }} className="w-full h-10 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">{destinos.map((d) => <option key={d} value={d}>{DESTINO_LABEL[d]}</option>)}</select></div>)}
          {destino === "etiqueta-local" && (<div><label className="text-[11px] text-gray-500">Impressora</label><select value={impressora} onChange={(e) => { setImpressora(e.target.value); salvarImpressora(e.target.value); avisar(); }} className="w-full h-10 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"><option value="">Impressora padrão do PC</option>{impressoras.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>)}
          <div><label className="text-[11px] text-gray-500">Tamanho da etiqueta</label><select value={bobina} onChange={(e) => { setBobina(e.target.value); try { localStorage.setItem("etiq_bobina", e.target.value); } catch { /* */ } avisar(); }} className="w-full h-10 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">{BOBINAS_ETIQ.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></div>
          {destino === "navegador" && <p className="text-[11px] text-gray-500">Na janela de impressão, escolha a impressora de etiquetas e margens "nenhuma".</p>}
        </div>
        <button onClick={onClose} className="mt-4 w-full h-10 rounded-xl bg-indigo-600 text-white font-semibold text-sm">Pronto</button>
      </div>
    </div>
  );
}
import { useParams, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { provisionarAcesso, gerarSenhaInicial } from "../../core/auth/provisionar";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Modal } from "../../core/ui/Modal";
import { type LocalEstoque, type LocalEstoqueTipo, LOCAL_ESTOQUE_TIPO_LABEL } from "../../core/types";
import { type EntradaPendente } from "./entradasPendentes";
import { PageContainer } from "../../core/ui/PageContainer";
import { useTabPersistida } from "../../core/hooks/useTabPersistida";
import { EtiquetasTab } from "./EtiquetasTab";
import { BaixaEtiquetaModal, ResumoEtiquetas } from "./EtiquetasEmitidas";
import { ScannerModal } from "./ScannerModal";
import { buscarPorToken, tokenDoQr, etiquetaPorNumero, diasAteValidade, hojeSP, type EtiquetaEmitida } from "./etiquetasRepo";
import { VinculosModal } from "./VinculosModal";
import { mesmoNome, parecidos } from "./similaridade";
import { METODO_POR_TIPO, agruparPorAmbiente, compativel, ehAmbiente, limparVinculos, nomeCompleto } from "./compatibilidade";
import { noAppSunmi, lerQrNativo, imprimirEtiqueta, armarTeclaScan, armarCodigoScan, verificarAtualizacaoApp } from "../../core/impressao/impressora";
import { desenharEtiqueta } from "../../core/impressao/etiquetaTermica";

// ── Tipos locais do módulo (promover pra types/index.ts quando estabilizar) ──
// Conservação = validade APÓS ABERTO por método (dias). NÃO é a validade do
// estoque fechado (essa vem da NF/fabricante, informada na entrada).
type Conservacao = Record<string, number>;                // metodoId → dias após aberto
type MetodoConservacao = { id: string; label: string };
export type ProdutoEtiqueta = {
  id: string; restaurantId: string; nome: string; categorias?: string[];
  conservacao: Conservacao; unidade: string;
  estoqueMinimo?: number | null; marcaFornecedor?: string | null; sif?: string | null;
  precoCusto?: number | null; qrTokenEstoque: string; ativo: boolean; criadoEm: string;
  locais?: string[];  // locais onde o produto fica (só os compatíveis com a matriz)
};
// Máquina de etiqueta (maquininha/estação): config remota, editada no admin e
// lida ao vivo pelo aparelho. Define quais AMBIENTES aparecem nela (catálogo por
// localização), o tamanho do rolo e, no modo produção, quais restaurantes ela
// pode etiquetar.
// Operador da máquina: identifica quem está emitindo/baixando (atribuição).
// Troca rápida com PIN de 4 dígitos (trava fraca, guardada com hash — não dá
// acesso além do que a conta do aparelho já tem).
export type Operador = { id: string; nome: string; pinHash: string };
export type Maquina = {
  id: string; nome: string; ambienteIds: string[];
  bobinaId?: string; modoProducao?: boolean; restaurantesAlvo?: string[]; operadores?: Operador[];
  deviceId?: string | null;   // aparelho que já vinculou esta máquina (some da lista de associar)
  loginEmail?: string | null; // conta dedicada da máquina (login no aparelho)
};

// Id persistente deste aparelho (pra saber qual máquina ele já vinculou).
function deviceIdLocal(): string {
  try {
    let id = localStorage.getItem("etiq_device_id");
    if (!id) { id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; localStorage.setItem("etiq_device_id", id); }
    return id;
  } catch { return "dev_tmp"; }
}

/** Hash do PIN (SHA-256 com o id do operador como sal). Evita PIN em texto puro. */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Perfil de acesso dedicado da máquina de etiquetas: só enxerga o módulo
// Etiquetas, mas com gestão completa dele (ver + operar + editar) — pra o
// próprio aparelho cadastrar locais/produtos/bases. Id fixo pra ser
// idempotente — uma máquina em qualquer restaurante usa o mesmo perfil.
const PERFIL_MAQUINA_ID = "_maq_etiquetas";
async function garantirPerfilMaquina(): Promise<string> {
  const ref = doc(db, "accessProfiles", PERFIL_MAQUINA_ID);
  await setDoc(ref, sanitizeForFirestore({
    id: PERFIL_MAQUINA_ID,
    nome: "Maquininha (Etiquetas)",
    descricao: "Conta de aparelho — gerencia só o módulo Etiquetas (emite, dá baixa e cadastra locais/produtos). Não enxerga mais nada do sistema.",
    builtin: false,
    maquinaEtiquetas: true,
    restaurantId: null,
    criadoEm: new Date().toISOString(),
    permissions: { estoqueValidade: { ver: true, operar: true, editar: true } },
  }), { merge: true });
  return PERFIL_MAQUINA_ID;
}

type ResultadoLoginMaquina =
  | { ok: true; email: string; senha: string }
  | { ok: false; erro: string };

// Cria (ou recria) a conta dedicada da máquina: perfil + conta no Firebase Auth
// + pessoa escopada aos restaurantes marcados na máquina. Devolve email/senha
// pra digitar no aparelho no 1º acesso.
async function criarLoginMaquina(m: Maquina, rid: string): Promise<ResultadoLoginMaquina> {
  const alvos = Array.from(new Set(
    (m.modoProducao && m.restaurantesAlvo?.length ? m.restaurantesAlvo : [rid]).filter(Boolean),
  ));
  if (alvos.length === 0) return { ok: false, erro: "A máquina precisa de pelo menos um restaurante." };
  const perfilId = await garantirPerfilMaquina();
  const slug = (m.nome || "maquina").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 16) || "maquina";
  const rand = Math.random().toString(36).slice(2, 6);
  const email = `maq-${slug}-${rand}@maquina.planejamento.app`;
  const senha = gerarSenhaInicial();
  const prov = await provisionarAcesso(email, senha);
  if (!prov.ok) return { ok: false, erro: prov.motivo === "email_em_uso" ? "Já existe login pra essa máquina. Clique em 'Refazer login' pra gerar outro." : ("Não deu pra criar o acesso: " + (prov.detalhe || prov.motivo)) };
  const now = new Date().toISOString();
  const profileIds: Record<string, string> = {};
  const permissions: Record<string, Record<string, unknown>> = {};
  for (const r of alvos) { profileIds[r] = perfilId; permissions[r] = { estoqueValidade: { ver: true, operar: true } }; }
  try {
    await addDoc(collection(db, "pessoas"), sanitizeForFirestore({
      email, nome: `Maquininha · ${m.nome}`, cpf: null, cadastroIncompleto: false,
      isMaster: false, temLogin: true, ehMaquina: true, maquinaId: m.id,
      restaurantIds: alvos, profileIds, permissions, vinculos: {},
      mustTrocarSenha: false, ativa: true, createdAt: now, acessoProvisionadoEm: now,
    }));
  } catch (e) {
    return { ok: false, erro: "Conta criada, mas falhou ao gravar a pessoa: " + (e instanceof Error ? e.message : String(e)) };
  }
  return { ok: true, email, senha };
}

export type EstoqueConfig = { unidades: string[]; categorias: string[]; metodos: MetodoConservacao[]; maquinas?: Maquina[] };
export type LoteEstoque = {
  id: string; restaurantId: string; produtoId: string; produtoNome: string;
  localId?: string | null; qtdInicial: number; qtdRestante: number; unidade: string;
  entradaData: string; validade: string; fornecedor?: string | null; precoUnit?: number | null;
  status: "ativo" | "esgotado" | "descartado"; criadoEm: string; criadoPor?: string | null;
};

const UNIDADES_PADRAO = ["KG", "LT", "UND"];
const METODOS_PADRAO: MetodoConservacao[] = [
  { id: "refrigerado", label: "Refrigerado" }, { id: "congelado", label: "Congelado" },
  { id: "ambiente", label: "Ambiente" }, { id: "seco", label: "Seco" }, { id: "quente", label: "Quente" },
];
const CONFIG_PADRAO: EstoqueConfig = { unidades: UNIDADES_PADRAO, categorias: [], metodos: METODOS_PADRAO };
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `m_${Date.now().toString(36)}`;
const TIPOS = Object.keys(LOCAL_ESTOQUE_TIPO_LABEL) as LocalEstoqueTipo[];
const inp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";

// ── Datas (Brasília) ──
const hojeYmd = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const fmtBR = (ymd?: string) => (ymd ? ymd.split("-").reverse().join("/") : "—");
const brToYmd = (br: string) => { const [d, m, a] = (br || "").split("/"); return d && m && a ? `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : ""; };
const diasAte = (ymd: string) => Math.round((new Date(ymd + "T12:00:00Z").getTime() - new Date(hojeYmd() + "T12:00:00Z").getTime()) / 86400000);
const novoToken = () => "qr_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
// Giro FIXO (PVPS+PEPS complementares): prioridade quem VENCE antes; se empatar a
// validade, desempata por quem ENTROU antes. Não é configurável.
const giroCmp = (a: LoteEstoque, b: LoteEstoque) =>
  a.validade.localeCompare(b.validade) || a.entradaData.localeCompare(b.entradaData);

// Campo de busca padrão do módulo — alto, com lupa e botão de limpar.
function SearchInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="relative w-full">
      <svg viewBox="0 0 24 24" className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400 pointer-events-none">
        <path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        className="w-full h-11 pl-11 pr-9 text-[15px] rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-900 dark:text-gray-100 outline-none focus:bg-white dark:focus:bg-gray-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/40 transition-colors" />
      {value && <button type="button" onClick={() => onChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-700 flex items-center justify-center text-sm">✕</button>}
    </div>
  );
}

export function EstoqueValidadePage() {
  const { pessoa: me, signOut } = useAuth();
  const { restaurants, setActiveId } = useRestaurant();
  const nav = useNavigate();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurante = restaurants.find((r) => r.id === rid) || null;
  const { can, loading: permLoading } = useCanAcao(rid);
  const podeVer = can("estoqueValidade", "ver");
  const podeOperar = can("estoqueValidade", "operar") || can("estoqueValidade", "editar");
  const podeEditar = can("estoqueValidade", "editar");

  const [aba, setAba] = useTabPersistida<"home" | "painel" | "etiquetas" | "baixa" | "entrada" | "cadastro">("estoqueValidade", "painel");
  const [subCad, setSubCad] = useState<"locais" | "produtos" | "bases" | "maquinas">("locais");
  // No app do caixa (kiosk), a navegação vira um MENU (como o Comandas) e abre
  // direto nas Etiquetas (emitir/dar baixa), em vez da barra de abas do admin.
  const naKiosk = isComandasKioskHost() || isEtiquetasKioskHost();
  // Na maquininha (app Sunmi): tela inicial com botões grandes, navegação por
  // "Início" (sem menu nem "imprimir aqui" — só imprime nela mesma).
  const naMaquininha = noAppSunmi();
  const [menuAberto, setMenuAberto] = useState(false);
  const [printerCfg, setPrinterCfg] = useState(false);
  const [trocaRest, setTrocaRest] = useState(false);
  const trocarRestaurante = (id: string) => { try { localStorage.setItem("etiq_kiosk_rid", id); } catch { /* sem storage */ } window.dispatchEvent(new Event("etiq-kiosk-rid")); setActiveId(id); setTrocaRest(false); setAba("home"); nav(`/r/${id}/estoqueValidade`, { replace: true }); };
  useEffect(() => { if (naMaquininha) setAba("home"); else if (naKiosk) setAba("etiquetas"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [locais, setLocais] = useState<LocalEstoque[]>([]);
  const [produtos, setProdutos] = useState<ProdutoEtiqueta[]>([]);
  const [lotes, setLotes] = useState<LoteEstoque[]>([]);
  const [pendentes, setPendentes] = useState<EntradaPendente[]>([]);
  const [etiquetasAtivas, setEtiquetasAtivas] = useState<EtiquetaEmitida[]>([]);
  const homeResumo = useMemo(() => {
    let vencidas = 0, hoje = 0;
    for (const e of etiquetasAtivas) { const d = diasAte(e.validade); if (d < 0) vencidas++; else if (d === 0) hoje++; }
    return { vencidas, hoje, ativas: etiquetasAtivas.length };
  }, [etiquetasAtivas]);
  const [config, setConfig] = useState<EstoqueConfig>(CONFIG_PADRAO);
  const [configLoaded, setConfigLoaded] = useState(false);
  // Máquina pareada neste aparelho (só a maquininha). A config dela (ambientes,
  // tamanho, modo produção) vem de config.maquinas, lida ao vivo do servidor.
  const [machineId, setMachineId] = useState<string>(() => { try { return localStorage.getItem("etiq_machine_id") || ""; } catch { return ""; } });
  const maquina = naMaquininha ? (config.maquinas || []).find((m) => m.id === machineId) || null : null;
  const deviceId = useMemo(() => deviceIdLocal(), []);
  // Máquinas livres pra este aparelho associar: sem dono ou já deste aparelho.
  const maquinasDisponiveis = (config.maquinas || []).filter((m) => !m.deviceId || m.deviceId === deviceId);
  const parearMaquina = (id: string) => {
    try { localStorage.setItem("etiq_machine_id", id); } catch { /* sem storage */ }
    setMachineId(id);
    // Marca a máquina como vinculada a este aparelho (e solta qualquer outra que fosse deste aparelho).
    const novas = (config.maquinas || []).map((m) => (m.id === id ? { ...m, deviceId } : (m.deviceId === deviceId ? { ...m, deviceId: null } : m)));
    void salvarConfig({ maquinas: novas });
  };
  const desvincularMaquina = () => {
    const novas = (config.maquinas || []).map((m) => (m.id === machineId ? { ...m, deviceId: null } : m));
    void salvarConfig({ maquinas: novas });
    try { localStorage.removeItem("etiq_machine_id"); } catch { /* sem storage */ }
    setMachineId("");
  };
  // Com uma só máquina DISPONÍVEL, vincula sozinho (não precisa escolher no aparelho).
  useEffect(() => { if (naMaquininha && !maquina && maquinasDisponiveis.length === 1) parearMaquina(maquinasDisponiveis[0].id); }, [naMaquininha, maquina, maquinasDisponiveis.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (maquina?.bobinaId) { try { localStorage.setItem("etiq_bobina", maquina.bobinaId); } catch { /* sem storage */ } window.dispatchEvent(new Event("etiq-impressora")); }
  }, [maquina?.bobinaId]);
  // Operador ativo (atribuição): quando a máquina tem operadores, cada um
  // destrava com PIN e vira o responsável das etiquetas e das baixas.
  const [operadorId, setOperadorId] = useState<string>(() => { try { return localStorage.getItem("etiq_operador") || ""; } catch { return ""; } });
  const operadorAtivo = maquina?.operadores?.find((o) => o.id === operadorId) || null;
  const temOperadores = !!(maquina?.operadores && maquina.operadores.length);
  const [operadorMenu, setOperadorMenu] = useState(false);
  const acessarOperador = (id: string) => { try { localStorage.setItem("etiq_operador", id); } catch { /* sem storage */ } setOperadorId(id); };
  const sairOperador = () => { try { localStorage.removeItem("etiq_operador"); } catch { /* sem storage */ } setOperadorId(""); setOperadorMenu(false); };
  const respNome = operadorAtivo ? operadorAtivo.nome : (me?.nome || "");
  const respUid = operadorAtivo ? operadorAtivo.id : (me?.id || null);
  // Na maquininha, limita a troca de restaurante aos restaurantes da máquina
  // (os marcados no modo produção), mesmo que a conta logada enxergue mais.
  const restaurantesVisiveis = naMaquininha && maquina?.restaurantesAlvo?.length
    ? restaurants.filter((r) => maquina.restaurantesAlvo!.includes(r.id))
    : restaurants;
  const [localModal, setLocalModal] = useState<{ local: LocalEstoque | null } | null>(null);
  const [prodModal, setProdModal] = useState<{ produto: ProdutoEtiqueta | null; nomeInicial?: string; localInicial?: string } | null>(null);
  const [vinculosLocal, setVinculosLocal] = useState<LocalEstoque | null>(null);
  const [etiqModal, setEtiqModal] = useState<ProdutoEtiqueta | null>(null);

  useEffect(() => {
    if (!rid) return;
    const subs = [
      onSnapshot(query(collection(db, "locaisEstoque"), where("restaurantId", "==", rid)), (s) => setLocais(s.docs.map((d) => ({ id: d.id, ...d.data() }) as LocalEstoque)), () => setLocais([])),
      onSnapshot(query(collection(db, "produtosEtiqueta"), where("restaurantId", "==", rid)), (s) => setProdutos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as ProdutoEtiqueta)), () => setProdutos([])),
      onSnapshot(query(collection(db, "lotesEstoque"), where("restaurantId", "==", rid)), (s) => setLotes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as LoteEstoque)), () => setLotes([])),
      onSnapshot(query(collection(db, "entradasPendentes"), where("restaurantId", "==", rid)), (s) => setPendentes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as EntradaPendente).filter((p) => p.status === "pendente")), () => setPendentes([])),
      onSnapshot(query(collection(db, "etiquetas"), where("restaurantId", "==", rid), where("status", "==", "ativa")), (s) => setEtiquetasAtivas(s.docs.map((d) => ({ id: d.id, ...d.data() }) as EtiquetaEmitida)), () => setEtiquetasAtivas([])),
      onSnapshot(doc(db, "estoqueConfig", rid), (s) => {
        const d = (s.data() || {}) as Partial<EstoqueConfig>;
        setConfig({ unidades: d.unidades?.length ? d.unidades : UNIDADES_PADRAO, categorias: d.categorias || [], metodos: d.metodos?.length ? d.metodos : METODOS_PADRAO, maquinas: d.maquinas || [] });
        setConfigLoaded(true);
      }, () => { setConfig(CONFIG_PADRAO); setConfigLoaded(true); }),
    ];
    return () => subs.forEach((u) => u());
  }, [rid]);

  const localNome = (id?: string | null) => nomeCompleto(locais.find((l) => l.id === id), locais);
  const lotesAtivosDoProduto = (produtoId: string) => lotes.filter((l) => l.produtoId === produtoId && l.status === "ativo" && l.qtdRestante > 0);

  // Na maquininha, só aparecem os ambientes LIBERADOS pra esta máquina
  // (allow-list estrita: não-marcado = não aparece). Equipamento segue o
  // ambiente pai. Fora da maquininha (admin), mostra tudo.
  const locaisVisiveis = useMemo(() => {
    if (!naMaquininha) return locais;
    // Enquanto a config da máquina não chegou do Firestore, NÃO mostra tudo
    // (senão pisca a lista inteira por alguns segundos até o filtro aplicar).
    if (!maquina) return [];
    const allow = new Set(maquina.ambienteIds || []);
    return locais.filter((l) => (ehAmbiente(l) ? allow.has(l.id) : !!l.paiId && allow.has(l.paiId)));
  }, [naMaquininha, maquina, locais]);

  // Produtos visíveis na maquininha = só os vinculados a um local liberado dela.
  // Cada máquina vê só os seus produtos (sem config nova). Fora da maquininha,
  // mostra todos.
  const produtosVisiveis = useMemo(() => {
    if (!naMaquininha) return produtos;
    const ids = new Set(locaisVisiveis.map((l) => l.id));
    return produtos.filter((p) => (p.locais || []).some((id) => ids.has(id)));
  }, [naMaquininha, produtos, locaisVisiveis]);

  // ── Locais ──
  async function salvarLocal(l: Omit<LocalEstoque, "id" | "criadoEm"> & { id?: string }) {
    if (l.id) await updateDoc(doc(db, "locaisEstoque", l.id), { nome: l.nome, tipo: l.tipo, paiId: l.paiId ?? null, metodoConservacao: l.metodoConservacao ?? null, ativo: l.ativo });
    else {
      const ref = await addDoc(collection(db, "locaisEstoque"), { restaurantId: rid, nome: l.nome, tipo: l.tipo, paiId: l.paiId ?? null, metodoConservacao: l.metodoConservacao ?? null, ativo: l.ativo, ordem: locais.length, criadoEm: new Date().toISOString(), criadoPor: me?.id || null });
      // Ambiente novo criado NA maquininha já entra liberado pra esta máquina
      // (e fica disponível pra marcar nas outras pelo planejamento.app).
      if (naMaquininha && maquina && ehAmbiente(l)) {
        const novas = (config.maquinas || []).map((m) => (m.id === maquina.id ? { ...m, ambienteIds: Array.from(new Set([...(m.ambienteIds || []), ref.id])) } : m));
        await salvarConfig({ maquinas: novas });
      }
    }
    setLocalModal(null);
  }
  async function excluirLocal(l: LocalEstoque) { if (confirm(`Excluir o local "${l.nome}"?`)) await deleteDoc(doc(db, "locaisEstoque", l.id)); }

  // ── Produtos ──
  async function salvarConfig(patch: Partial<EstoqueConfig>) {
    await setDoc(doc(db, "estoqueConfig", rid), { ...config, ...patch, atualizadoEm: new Date().toISOString() }, { merge: true });
  }
  async function salvarProduto(p: Partial<ProdutoEtiqueta> & { id?: string }) {
    const dados = {
      nome: p.nome, categorias: p.categorias || [], conservacao: p.conservacao || {}, unidade: p.unidade || (config.unidades[0] || "UND"),
      estoqueMinimo: p.estoqueMinimo ?? null, marcaFornecedor: p.marcaFornecedor || null,
      sif: p.sif || null, precoCusto: p.precoCusto ?? null, ativo: p.ativo ?? true,
      locais: limparVinculos(p.locais || [], p.conservacao || {}, locais),
    };
    if (p.id) await updateDoc(doc(db, "produtosEtiqueta", p.id), dados);
    else await addDoc(collection(db, "produtosEtiqueta"), { restaurantId: rid, ...dados, qrTokenEstoque: novoToken(), criadoEm: new Date().toISOString() });
    setProdModal(null);
  }
  async function excluirProduto(p: ProdutoEtiqueta) { if (confirm(`Excluir o produto "${p.nome}"?`)) await deleteDoc(doc(db, "produtosEtiqueta", p.id)); }

  // ── Entrada (cria lote) ──
  async function darEntrada(v: { produto: ProdutoEtiqueta; qtd: number; validade: string; localId: string; fornecedor?: string }) {
    const nowIso = new Date().toISOString();
    const ref = await addDoc(collection(db, "lotesEstoque"), {
      restaurantId: rid, produtoId: v.produto.id, produtoNome: v.produto.nome, localId: v.localId || null,
      qtdInicial: v.qtd, qtdRestante: v.qtd, unidade: v.produto.unidade, entradaData: hojeYmd(), validade: v.validade,
      fornecedor: v.fornecedor || null, precoUnit: v.produto.precoCusto ?? null, status: "ativo", criadoEm: nowIso, criadoPor: me?.id || null,
    });
    await addDoc(collection(db, "movimentosEstoque"), { restaurantId: rid, loteId: ref.id, produtoId: v.produto.id, tipo: "entrada", qtd: v.qtd, saldoDepois: v.qtd, usuarioUid: me?.id || null, usuarioNome: me?.nome || null, ts: nowIso });
    return ref.id;
  }
  async function resolverPendente(id: string, loteId: string | null, status: "confirmada" | "descartada") {
    await updateDoc(doc(db, "entradasPendentes", id), { status, loteId: loteId ?? null, resolvidoEm: new Date().toISOString(), resolvidoPor: me?.id || null });
  }

  // ── Baixa (consome dos lotes na ordem do giro) ──
  async function darBaixa(produto: ProdutoEtiqueta, qtd: number): Promise<number> {
    const ordered = lotesAtivosDoProduto(produto.id).sort(giroCmp);
    let rest = qtd; const nowIso = new Date().toISOString();
    for (const lote of ordered) {
      if (rest <= 0) break;
      const tira = Math.min(rest, lote.qtdRestante);
      const novoSaldo = Math.round((lote.qtdRestante - tira) * 1000) / 1000;
      await updateDoc(doc(db, "lotesEstoque", lote.id), { qtdRestante: novoSaldo, status: novoSaldo <= 0 ? "esgotado" : "ativo" });
      await addDoc(collection(db, "movimentosEstoque"), { restaurantId: rid, loteId: lote.id, produtoId: produto.id, tipo: "baixa", qtd: tira, saldoDepois: novoSaldo, usuarioUid: me?.id || null, usuarioNome: me?.nome || null, ts: nowIso });
      rest = Math.round((rest - tira) * 1000) / 1000;
    }
    return rest; // > 0 = faltou estoque
  }

  if (permLoading) return null;
  if (!podeVer) return <div className="p-6 text-sm text-gray-500">Você não tem acesso à Gestão de Estoques e Validades.</div>;

  // Na maquininha, espera a config da máquina CHEGAR antes de montar a tela —
  // senão pisca (lista completa, operador do topo some/volta) enquanto o
  // Firestore resolve. Uma espera só mata todas as corridas de carregamento.
  if (naMaquininha && !configLoaded) {
    return <PageContainer><div className="py-16 text-center text-sm text-gray-400"><RefreshCw size={22} className="mx-auto mb-2 animate-spin opacity-60" /> Carregando a máquina…</div></PageContainer>;
  }

  // Maquininha ainda não vinculada a uma máquina configurada (e há máquinas no
  // restaurante): pede pra escolher qual máquina é esta. Depois fica remoto.
  if (naMaquininha && (config.maquinas || []).length > 0 && !maquina) {
    return (
      <PageContainer>
        <div className="max-w-sm mx-auto py-8 text-center">
          <div className="flex justify-center mb-2 text-indigo-500"><Settings size={34} /></div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Qual máquina é esta?</h2>
          <p className="text-sm text-gray-500 mt-1 mb-4">{restaurante?.nome || ""} · escolha uma vez; depois é tudo pelo sistema.</p>
          {maquinasDisponiveis.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-sm text-gray-500">Todas as máquinas já estão vinculadas a outro aparelho. Libere uma no admin (Cadastro › Máquinas) pra associar aqui.</div>
          ) : (
            <div className="space-y-2">
              {maquinasDisponiveis.map((m) => (
                <button key={m.id} type="button" onClick={() => parearMaquina(m.id)}
                  className="w-full h-14 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 font-semibold text-gray-900 dark:text-gray-100 active:scale-[.99]">{m.nome}</button>
              ))}
            </div>
          )}
        </div>
      </PageContainer>
    );
  }

  // Máquina com operadores e ninguém acessado: tela de bloqueio (nome + PIN).
  if (naMaquininha && temOperadores && !operadorAtivo) {
    return <OperadorLock operadores={maquina!.operadores!} onAcessar={acessarOperador} restauranteNome={restaurante?.nome} />;
  }

  const ABAS = [["painel", "Painel", BarChart3], ["etiquetas", "Etiquetas", Printer], ["baixa", "Baixa", PackageMinus], ["entrada", "Entrada", PackagePlus], ["cadastro", "Cadastro", FolderOpen]] as const;

  return (
    <PageContainer>
      {naMaquininha ? (
        aba === "home" ? (
          <div className="relative flex items-center justify-between gap-2 mb-4">
            <Tag size={24} className="text-indigo-500 shrink-0" />
            <div className="flex items-center gap-1.5 min-w-0">
              <button type="button" onClick={() => { if (restaurantesVisiveis.length > 1) setTrocaRest((v) => !v); }}
                className="h-10 min-w-0 px-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 inline-flex items-center gap-1.5 active:scale-95">
                <span className="truncate">{restaurante?.nome || "Restaurante"}</span>
                {restaurantesVisiveis.length > 1 && <ChevronDown size={15} className="shrink-0 text-gray-400" />}
              </button>
              {operadorAtivo && (
                <button type="button" onClick={() => setOperadorMenu((v) => !v)}
                  className="h-10 shrink-0 px-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 inline-flex items-center gap-1.5 active:scale-95">
                  <User size={15} className="shrink-0 text-gray-400" /><span className="truncate max-w-[72px]">{operadorAtivo.nome.split(" ")[0]}</span><ChevronDown size={14} className="shrink-0 text-gray-400" />
                </button>
              )}
            </div>
            {trocaRest && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setTrocaRest(false)} />
                <div className="absolute right-0 top-14 z-50 w-56 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1.5">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400">Trocar restaurante</div>
                  {restaurantesVisiveis.map((r) => (
                    <button key={r.id} type="button" onClick={() => trocarRestaurante(r.id)} className={`w-full text-left px-3 py-2 text-sm ${r.id === rid ? "text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50/60 dark:bg-indigo-950/20" : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>{r.nome}</button>
                  ))}
                </div>
              </>
            )}
            {operadorMenu && operadorAtivo && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOperadorMenu(false)} />
                <div className="absolute right-0 top-14 z-50 w-48 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1.5">
                  <div className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{operadorAtivo.nome}</div>
                  <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                  <button type="button" onClick={sairOperador} className="w-full text-left px-3 py-2 text-sm text-rose-600 dark:text-rose-400 inline-flex items-center gap-2"><LogOut size={15} /> Sair</button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button type="button" onClick={() => setAba("home")}
            className="w-full mb-3 h-12 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200 font-semibold inline-flex items-center justify-center gap-2 active:scale-[.99]"><Home size={18} /> Retornar ao início</button>
        )
      ) : naKiosk ? (
        <div className="flex items-start justify-between gap-2 flex-wrap mb-4">
          <div>
            <h1 className="text-lg font-extrabold text-gray-900 dark:text-gray-100 inline-flex items-center gap-2"><Tag size={20} className="text-indigo-500" /> Etiquetas</h1>
            <p className="text-[12px] text-gray-500">{restaurante?.nome || ""}</p>
            <p className="text-[10px] text-gray-400">planejamento.app · {APP_VERSION_LABEL}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPrinterCfg(true)} title="Impressora de etiqueta deste computador"
              className="h-9 px-2.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 text-sm font-semibold inline-flex items-center gap-1.5">
              <Printer size={15} /> Imprimir aqui <span className="text-[10px] font-bold px-1 py-0.5 rounded bg-emerald-600 text-white max-w-[110px] truncate">{impressoraSalva() || "padrão"}</span>
            </button>
            <div className="relative">
              <button type="button" onClick={() => setMenuAberto((v) => !v)} className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm inline-flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/50" title="Menu"><Menu size={17} /> Menu</button>
              {menuAberto && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuAberto(false)} />
                  <div className="absolute right-0 mt-1.5 w-56 z-50 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1.5">
                    {ABAS.map(([k, l, Ico]) => (
                      <button key={k} type="button" onClick={() => { setAba(k); setMenuAberto(false); }} className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left ${aba === k ? "text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50/60 dark:bg-indigo-950/20" : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
                        <Ico size={16} /> {l}
                      </button>
                    ))}
                    <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                    <button type="button" onClick={() => { setMenuAberto(false); setPrinterCfg(true); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"><Printer size={16} /> Impressora de etiqueta</button>
                    {noAppSunmi() && (
                      <button type="button" onClick={() => { setMenuAberto(false); if (!verificarAtualizacaoApp()) alert("Atualização automática só no app novo. Reinstale uma vez pra habilitar."); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"><RefreshCw size={16} /> Buscar atualização</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
          {ABAS.map(([k, l, Ico]) => (
            <button key={k} type="button" onClick={() => setAba(k)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium -mb-px border-b-2 whitespace-nowrap ${aba === k ? "border-indigo-500 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>
              <Ico size={15} /> {l}
            </button>
          ))}
        </div>
      )}

      {naMaquininha && aba === "home" && (
        <div className="space-y-3 max-w-md mx-auto">
          <button type="button" onClick={() => setAba("painel")}
            className="w-full flex items-center justify-between gap-2 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 px-4 py-3 active:scale-[.99]">
            <span className="text-sm text-gray-600 dark:text-gray-300 inline-flex items-center gap-2">
              <BarChart3 size={18} className="text-indigo-500" />
              <span><b className="text-rose-600 dark:text-rose-400">{homeResumo.vencidas}</b> vencidas · <b className="text-amber-600 dark:text-amber-400">{homeResumo.hoje}</b> hoje · <b className="text-gray-800 dark:text-gray-100">{homeResumo.ativas}</b> ativas</span>
            </span>
            <ChevronRight size={18} className="text-gray-400" />
          </button>
          <div className="grid grid-cols-1 gap-3">
            <button type="button" onClick={() => setAba("etiquetas")} className="h-24 rounded-2xl bg-indigo-600 text-white flex flex-col items-center justify-center gap-1.5 active:scale-[.98] shadow-sm"><Tag size={28} /><span className="text-lg font-semibold">Emitir etiqueta</span></button>
            <button type="button" onClick={() => setAba("baixa")} className="h-24 rounded-2xl bg-rose-600 text-white flex flex-col items-center justify-center gap-1.5 active:scale-[.98] shadow-sm"><PackageMinus size={28} /><span className="text-lg font-semibold">Dar baixa</span></button>
            <button type="button" onClick={() => setAba("cadastro")} className="h-24 rounded-2xl bg-amber-500 text-white flex flex-col items-center justify-center gap-1.5 active:scale-[.98] shadow-sm"><FolderOpen size={28} /><span className="text-lg font-semibold">Cadastro</span></button>
          </div>
        </div>
      )}
      {aba === "painel" && (naMaquininha
        ? <PainelMaquininha etiquetas={etiquetasAtivas} usuario={{ uid: respUid, nome: respNome }} />
        : <PainelTab produtos={produtos} lotes={lotes} localNome={localNome} etiquetas={etiquetasAtivas} onAbrirEtiquetas={() => { try { localStorage.setItem("etiq_visao", "emitidas"); } catch { /* sem storage */ } setAba("etiquetas"); }} />)}
      {aba === "etiquetas" && <EtiquetasTab rid={rid} produtos={produtosVisiveis} config={config} empresa={restaurante?.razaoSocial || restaurante?.nome || ""} cnpj={restaurante?.cnpj || null} responsavel={respNome} responsavelUid={respUid} podeOperar={podeOperar} ativas={etiquetasAtivas} locais={locaisVisiveis} podeEditar={podeEditar} onGerenciarProdutos={(l) => setVinculosLocal(l)} pularInicio={naMaquininha} onSair={() => setAba("home")}
        ambienteIds={maquina?.ambienteIds} modoProducao={!!maquina?.modoProducao} restaurantesAlvo={maquina?.restaurantesAlvo || []} restaurantes={restaurants.map((r) => ({ id: r.id, nome: r.nome, razaoSocial: r.razaoSocial ?? null, cnpj: r.cnpj ?? null }))} />}
      {aba === "baixa" && (naMaquininha
        ? <BaixaMaquininha rid={rid} etiquetas={etiquetasAtivas} usuario={{ uid: respUid, nome: respNome }} podeOperar={podeOperar} />
        : <BaixaTab rid={rid} usuario={{ uid: me?.id || null, nome: me?.nome || null }} etiquetas={etiquetasAtivas} produtos={produtos} lotesAtivos={lotesAtivosDoProduto} localNome={localNome} podeOperar={podeOperar} onBaixa={darBaixa} />)}
      {aba === "entrada" && <EntradaTab produtos={produtosVisiveis} locais={locaisVisiveis} lotesAtivos={lotesAtivosDoProduto} podeOperar={podeOperar} onEntrada={darEntrada} pendentes={pendentes} onResolver={resolverPendente} />}
      {aba === "cadastro" && (
        <div>
          <div className={naMaquininha ? "grid grid-cols-3 gap-2 mb-4" : "flex gap-1.5 mb-4 border-b border-gray-200 dark:border-gray-800 pb-2"}>
            {(([["locais", <span className="inline-flex items-center gap-1.5"><MapPin size={naMaquininha ? 18 : 14} /> Locais</span>], ["produtos", <span className="inline-flex items-center gap-1.5"><Tag size={naMaquininha ? 18 : 14} /> Produtos</span>], ["bases", <span className="inline-flex items-center gap-1.5"><Settings size={naMaquininha ? 18 : 14} /> Bases</span>], ...(naMaquininha ? [] : [["maquinas", <span className="inline-flex items-center gap-1.5"><Smartphone size={14} /> Máquinas</span>]])]) as ["locais" | "produtos" | "bases" | "maquinas", ReactNode][]).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSubCad(k)}
                className={naMaquininha
                  ? `h-16 rounded-xl text-sm font-semibold flex items-center justify-center ${subCad === k ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"}`
                  : `px-3 py-1.5 text-sm font-medium rounded-lg ${subCad === k ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{l}</button>
            ))}
          </div>
          {subCad === "locais"
            ? <LocaisTab locais={locaisVisiveis} contarProdutos={(id) => produtos.filter((p) => (p.locais || []).includes(id)).length} onProdutos={(l) => setVinculosLocal(l)} metodoLabel={(id) => config.metodos.find((m) => m.id === id)?.label || null} restauranteNome={restaurante?.nome} podeEditar={podeEditar} onNovo={() => setLocalModal({ local: null })} onEditar={(l) => setLocalModal({ local: l })} onExcluir={excluirLocal} naMaquininha={naMaquininha} carregando={naMaquininha && (!configLoaded || !maquina)} />
            : subCad === "bases"
            ? <BasesTab config={config} podeEditar={podeEditar} onSalvar={salvarConfig} />
            : subCad === "maquinas"
            ? <MaquinasTab maquinas={config.maquinas || []} ambientes={agruparPorAmbiente(locais).map((g) => g.ambiente).filter((a): a is LocalEstoque => !!a).map((a) => ({ id: a.id, nome: a.nome }))} bobinas={BOBINAS_ETIQ} restaurantes={restaurants.map((r) => ({ id: r.id, nome: r.nome }))} rid={rid} podeEditar={podeEditar} onSalvar={(ms) => void salvarConfig({ maquinas: ms })} />
            : <ProdutosTab produtos={produtosVisiveis} config={config} podeEditar={podeEditar} onNovo={() => setProdModal({ produto: null })} onEditar={(p) => setProdModal({ produto: p })} onExcluir={excluirProduto} onEtiqueta={(p) => setEtiqModal(p)} naMaquininha={naMaquininha} />}
          {naMaquininha && (
            <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800 text-center space-y-3">
              {maquina && (
                <div className="text-xs text-gray-400">Esta máquina: <b className="text-gray-600 dark:text-gray-300">{maquina.nome}</b> · <button type="button" onClick={() => { if (confirm("Trocar esta máquina por outra? Ela fica liberada e você escolhe de novo.")) desvincularMaquina(); }} className="text-indigo-600 dark:text-indigo-400">trocar</button></div>
              )}
              <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 active:scale-95"><RefreshCw size={16} /> Atualizar telas</button>
              <div className="flex items-center justify-center gap-4 pt-1">
                <button type="button" onClick={() => { if (!verificarAtualizacaoApp()) alert("Atualização automática só no app novo. Reinstale uma vez pra habilitar."); }} className="inline-flex items-center gap-1.5 text-xs text-gray-400"><Smartphone size={13} /> Atualizar o app</button>
                <button type="button" onClick={() => { if (confirm("Sair da conta do aparelho? Você vai precisar entrar de novo (ex.: com a conta da maquininha).")) void signOut(); }} className="inline-flex items-center gap-1.5 text-xs text-rose-500"><LogOut size={13} /> Sair do app (trocar conta)</button>
              </div>
              <div className="text-[10px] text-gray-400 pt-1">Conta: {me?.nome || "—"}</div>
            </div>
          )}
        </div>
      )}

      {localModal && <LocalModal local={localModal.local} locais={locaisVisiveis} config={config} onClose={() => setLocalModal(null)} onSalvar={salvarLocal} />}
      {prodModal && <ProdutoModal key={prodModal.produto?.id || "novo"} produto={prodModal.produto} nomeInicial={prodModal.nomeInicial} localInicial={prodModal.localInicial} produtos={produtos} config={config} locais={locaisVisiveis} onClose={() => setProdModal(null)} onSalvar={salvarProduto}
        onUsarExistente={(p) => setProdModal({ produto: p, localInicial: prodModal.localInicial })} />}
      {vinculosLocal && <VinculosModal local={vinculosLocal} locais={locaisVisiveis} produtos={produtos} metodoLabel={config.metodos.find((m) => m.id === vinculosLocal.metodoConservacao)?.label || ""}
        onClose={() => setVinculosLocal(null)} onNovoProduto={(nome) => { setProdModal({ produto: null, nomeInicial: nome, localInicial: vinculosLocal.id }); setVinculosLocal(null); }} />}
      {etiqModal && <EtiquetaFixaModal produto={etiqModal} onClose={() => setEtiqModal(null)} />}
      {printerCfg && <PrinterCfgModal onClose={() => setPrinterCfg(false)} />}
    </PageContainer>
  );
}

// ═══ PAINEL (saldo + FEFO) ═══════════════════════════════════════════════════
function PainelTab({ produtos, lotes, localNome, etiquetas, onAbrirEtiquetas }: { produtos: ProdutoEtiqueta[]; lotes: LoteEstoque[]; localNome: (id?: string | null) => string; etiquetas: EtiquetaEmitida[]; onAbrirEtiquetas: () => void }) {
  const ativos = lotes.filter((l) => l.status === "ativo" && l.qtdRestante > 0);
  const grupos = useMemo(() => {
    const g = { vencido: [] as LoteEstoque[], hoje: [] as LoteEstoque[], amanha: [] as LoteEstoque[], semana: [] as LoteEstoque[] };
    for (const l of ativos) {
      const d = diasAte(l.validade);
      if (d < 0) g.vencido.push(l); else if (d === 0) g.hoje.push(l); else if (d === 1) g.amanha.push(l); else if (d <= 7) g.semana.push(l);
    }
    for (const k of Object.keys(g) as (keyof typeof g)[]) g[k].sort((a, b) => a.validade.localeCompare(b.validade));
    return g;
  }, [ativos]);
  const nomeProd = (id: string) => produtos.find((p) => p.id === id)?.nome || "—";

  const cards: Array<[string, LoteEstoque[], string]> = [
    ["Vencidos", grupos.vencido, "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300"],
    ["Vence hoje", grupos.hoje, "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300"],
    ["Amanhã", grupos.amanha, "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900 text-orange-700 dark:text-orange-300"],
    ["Nesta semana", grupos.semana, "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300"],
  ];

  return (
    <div className="space-y-4">
      <ResumoEtiquetas ativas={etiquetas} onAbrir={onAbrirEtiquetas} />
      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Estoque por lote</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cards.map(([label, arr, cls]) => (
          <div key={label} className={`rounded-xl border p-3 ${cls}`}>
            <div className="text-2xl font-bold">{arr.length}</div>
            <div className="text-xs font-medium">{label}</div>
          </div>
        ))}
      </div>

      {([["vencido", <span className="inline-flex items-center gap-1.5"><Circle size={10} className="fill-rose-500 text-rose-500" /> Vencidos</span>, grupos.vencido], ["hoje", <span className="inline-flex items-center gap-1.5"><Circle size={10} className="fill-amber-500 text-amber-500" /> Vence hoje / amanhã</span>, [...grupos.hoje, ...grupos.amanha]], ["semana", <span className="inline-flex items-center gap-1.5"><Circle size={10} className="fill-emerald-500 text-emerald-500" /> Nesta semana</span>, grupos.semana]] as [string, ReactNode, LoteEstoque[]][]).map(([gkey, titulo, arr]) => (arr as LoteEstoque[]).length > 0 && (
        <div key={gkey}>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{titulo}</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
            {(arr as LoteEstoque[]).map((l) => {
              const d = diasAte(l.validade);
              return (
                <div key={l.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2.5 flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{nomeProd(l.produtoId)}</span>
                    <span className="text-gray-400"> · {l.qtdRestante} {l.unidade}</span>
                    {l.localId && <span className="text-gray-400"> · {localNome(l.localId)}</span>}
                  </div>
                  <span className={`text-xs whitespace-nowrap ${d < 0 ? "text-rose-600" : d <= 1 ? "text-amber-600" : "text-gray-500"}`}>{d < 0 ? `venceu ${fmtBR(l.validade)}` : `vence ${fmtBR(l.validade)}`}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {ativos.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">Sem estoque ativo. Dê entrada em produtos na aba <b>Entrada</b>.</div>}

      {/* Saldo por produto */}
      {produtos.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 mt-4 inline-flex items-center gap-1.5"><Package size={13} /> Saldo por produto</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {produtos.filter((p) => p.ativo).map((p) => {
              const saldo = ativos.filter((l) => l.produtoId === p.id).reduce((a, l) => a + l.qtdRestante, 0);
              const baixo = p.estoqueMinimo != null && saldo <= (p.estoqueMinimo || 0);
              return (
                <div key={p.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2.5 flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.nome}</span>
                  <span className={`tabular-nums whitespace-nowrap ${baixo ? "text-rose-600 font-semibold" : "text-gray-500"}`}>{saldo} {p.unidade}{baixo && <TriangleAlert size={11} className="inline align-[-1px] ml-0.5" />}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ BAIXA ═══════════════════════════════════════════════════════════════════
function BaixaTab({ rid, usuario, etiquetas, produtos, lotesAtivos, localNome, podeOperar, onBaixa }: {
  rid: string; usuario: { uid?: string | null; nome?: string | null }; etiquetas: EtiquetaEmitida[];
  produtos: ProdutoEtiqueta[]; lotesAtivos: (id: string) => LoteEstoque[]; localNome: (id?: string | null) => string;
  podeOperar: boolean; onBaixa: (p: ProdutoEtiqueta, qtd: number) => Promise<number>;
}) {
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<ProdutoEtiqueta | null>(null);
  const [qtd, setQtd] = useState("");
  const [msg, setMsg] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [scan, setScan] = useState(false);
  const [etiquetaLida, setEtiquetaLida] = useState<EtiquetaEmitida | null>(null);

  async function abrirLeitor() {
    if (noAppSunmi()) {
      const v = await lerQrNativo();
      if (v) { aoLerQr(v); return; }
    }
    setScan(true);
  }

  function aoLerQr(code: string) {
    setScan(false);
    // QR de etiqueta de validade (pote): abre a baixa da etiqueta.
    const token = tokenDoQr(code);
    if (token) {
      const e = etiquetas.find((x) => x.qrToken === token);
      if (e) { setEtiquetaLida(e); return; }
      void buscarPorToken(rid, token).then((x) => (x ? setEtiquetaLida(x) : setMsg("Etiqueta não encontrada nesta unidade.")), () => setMsg("Não consegui consultar a etiqueta."));
      return;
    }
    const p = produtos.find((x) => x.qrTokenEstoque === code && x.ativo);
    if (p) { setSel(p); setMsg(""); } else { setMsg("QR não reconhecido neste restaurante."); }
  }

  // Botão físico da maquininha abre o leitor por câmera (mesma ação do "Ler QR");
  // o leitor a laser (versão Scanner) manda o código já pronto, sem abrir câmera.
  const abrirLeitorRef = useRef(abrirLeitor);
  abrirLeitorRef.current = abrirLeitor;
  const aoLerQrRef = useRef(aoLerQr);
  aoLerQrRef.current = aoLerQr;
  useEffect(() => {
    if (!noAppSunmi()) return;
    const d1 = armarTeclaScan(() => void abrirLeitorRef.current());
    const d2 = armarCodigoScan((c) => aoLerQrRef.current(c));
    return () => { d1(); d2(); };
  }, []);

  const achados = busca.trim() ? produtos.filter((p) => p.ativo && p.nome.toLowerCase().includes(busca.toLowerCase())).slice(0, 8) : [];
  const fila = sel ? lotesAtivos(sel.id).slice().sort(giroCmp) : [];
  const proximo = fila[0] || null;
  const saldo = fila.reduce((a, l) => a + l.qtdRestante, 0);

  if (!podeOperar) return <div className="p-6 text-sm text-gray-500">Você não tem permissão pra dar baixa.</div>;

  async function confirmar() {
    if (!sel) return;
    const n = parseFloat((qtd || "").replace(",", "."));
    if (!n || n <= 0) { setMsg("Informe a quantidade."); return; }
    if (n > saldo) { setMsg(`Só há ${saldo} ${sel.unidade} em estoque.`); return; }
    setSalvando(true);
    try { await onBaixa(sel, n); setMsg(`✓ Baixa de ${n} ${sel.unidade} de ${sel.nome}.`); setSel(null); setQtd(""); setBusca(""); }
    finally { setSalvando(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Leia o QR do produto (ou busque): o sistema aponta de qual lote pegar pela regra de giro. Lendo o QR de uma etiqueta de validade, abre a baixa daquele pote.</p>
      {!sel ? (
        <div>
          <div className="flex gap-2 max-w-2xl">
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar produto pra dar baixa…" autoFocus />
            <button type="button" onClick={() => void abrirLeitor()} className="shrink-0 h-11 px-4 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-indigo-400 flex items-center gap-1.5"><Camera size={16} /> <span className="hidden sm:inline">Ler QR</span></button>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(busca.trim() ? achados : produtos.filter((p) => p.ativo).slice().sort((a, b) => a.nome.localeCompare(b.nome))).map((p) => {
              const s = lotesAtivos(p.id).reduce((a, l) => a + l.qtdRestante, 0);
              return (
                <button key={p.id} type="button" onClick={() => { setSel(p); setMsg(""); }} className="text-left rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 hover:border-indigo-300 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nome}</span>
                  <span className={`text-xs whitespace-nowrap ${s > 0 ? "text-gray-400" : "text-rose-400"}`}>{s} {p.unidade}</span>
                </button>
              );
            })}
          </div>
          {produtos.length === 0 && <p className="text-xs text-gray-400 mt-3">Nenhum produto ativo. Cadastre em <b>Cadastro › Produtos</b>.</p>}
        </div>
      ) : (
        <div className="max-w-xl rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">{sel.nome}</span>
            <button type="button" onClick={() => { setSel(null); setMsg(""); }} className="text-xs text-gray-400 hover:underline">trocar</button>
          </div>
          {!proximo ? (
            <div className="text-sm text-rose-600">Sem estoque ativo deste produto.</div>
          ) : (
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-900 p-3 text-sm">
              <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-1 inline-flex items-center gap-1.5"><Hand size={13} /> Pegue deste lote (vence antes):</div>
              <div className="text-gray-800 dark:text-gray-100">Validade <b>{fmtBR(proximo.validade)}</b> · {proximo.qtdRestante} {sel.unidade}{proximo.localId ? <> · em <b>{localNome(proximo.localId)}</b></> : null}</div>
              {fila.length > 1 && <div className="text-[11px] text-gray-500 mt-1">+{fila.length - 1} lote(s) depois deste. Saldo total: {saldo} {sel.unidade}.</div>}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Quantas unidades saíram?</label>
              <input value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder={`0 (${sel.unidade})`} inputMode="decimal" className={inp} autoFocus />
            </div>
            <Button onClick={() => void confirmar()} disabled={salvando || !proximo}>{salvando ? "…" : "Confirmar baixa"}</Button>
          </div>
        </div>
      )}
      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"}`}>{msg}</div>}
      {scan && <ScannerModal onDetect={aoLerQr} onClose={() => setScan(false)} />}
      {etiquetaLida && <BaixaEtiquetaModal etiqueta={etiquetaLida} usuario={usuario} onClose={() => setEtiquetaLida(null)} />}
    </div>
  );
}

// ═══ BLOQUEIO POR OPERADOR (nome + PIN de 4 dígitos) ═════════════════════════
function OperadorLock({ operadores, onAcessar, restauranteNome }: { operadores: Operador[]; onAcessar: (id: string) => void; restauranteNome?: string }) {
  const [sel, setSel] = useState<Operador | null>(null);
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState("");
  useEffect(() => {
    if (!sel || pin.length !== 4) return;
    let vivo = true;
    void (async () => { const h = await hashPin(pin, sel.id); if (!vivo) return; if (h === sel.pinHash) onAcessar(sel.id); else { setErro("PIN incorreto."); setPin(""); } })();
    return () => { vivo = false; };
  }, [pin, sel, onAcessar]);
  return (
    <PageContainer>
      <div className="max-w-sm mx-auto py-8">
        {!sel ? (
          <>
            <div className="flex justify-center mb-2 text-indigo-500"><Hand size={32} /></div>
            <h2 className="text-lg font-bold text-center text-gray-900 dark:text-gray-100">Quem vai operar?</h2>
            <p className="text-sm text-gray-500 text-center mb-4">{restauranteNome || ""}</p>
            <div className="space-y-2">
              {operadores.map((o) => (
                <button key={o.id} type="button" onClick={() => { setSel(o); setPin(""); setErro(""); }} className="w-full h-14 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 font-semibold text-gray-900 dark:text-gray-100 active:scale-[.99]">{o.nome}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button type="button" onClick={() => { setSel(null); setPin(""); setErro(""); }} className="text-sm text-gray-400 mb-3 inline-flex items-center gap-1"><ChevronRight size={14} className="rotate-180" /> trocar</button>
            <h2 className="text-lg font-bold text-center text-gray-900 dark:text-gray-100">{sel.nome}</h2>
            <p className="text-sm text-gray-500 text-center mb-4">Digite seu PIN</p>
            <input value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setErro(""); }} inputMode="numeric" type="password" autoFocus
              className="w-full h-16 text-4xl tracking-[0.5em] text-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" placeholder="••••" />
            {erro && <div className="text-sm text-rose-600 text-center mt-2">{erro}</div>}
          </>
        )}
      </div>
    </PageContainer>
  );
}

// ═══ PAINEL NA MAQUININHA (filtra por prazo + toca pra dar baixa) ════════════
function PainelMaquininha({ etiquetas, usuario }: { etiquetas: EtiquetaEmitida[]; usuario: { uid?: string | null; nome?: string | null } }) {
  const [filtro, setFiltro] = useState<"todas" | "vencida" | "hoje" | "amanha">("todas");
  const [aberta, setAberta] = useState<EtiquetaEmitida | null>(null);
  const hoje = hojeSP();
  const comDias = useMemo(() => etiquetas.map((e) => ({ e, d: diasAteValidade(e.validade, hoje) })).sort((a, b) => a.d - b.d), [etiquetas, hoje]);
  const n = { vencida: 0, hojeN: 0, amanha: 0 };
  for (const { d } of comDias) { if (d < 0) n.vencida++; else if (d === 0) n.hojeN++; else if (d === 1) n.amanha++; }
  const lista = comDias.filter(({ d }) => filtro === "todas" ? true : filtro === "vencida" ? d < 0 : filtro === "hoje" ? d === 0 : d === 1);
  const tiles: [typeof filtro, string, number, string][] = [
    ["vencida", "Vencidas", n.vencida, "text-rose-600 dark:text-rose-400"],
    ["hoje", "Vencem hoje", n.hojeN, "text-amber-600 dark:text-amber-400"],
    ["amanha", "Amanhã", n.amanha, "text-orange-600 dark:text-orange-400"],
    ["todas", "Ativas", etiquetas.length, "text-gray-900 dark:text-gray-100"],
  ];
  return (
    <div className="space-y-4 max-w-md mx-auto">
      <div className="grid grid-cols-4 gap-2">
        {tiles.map(([k, l, c, cor]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={`rounded-xl border p-2 text-center active:scale-95 ${filtro === k ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/20" : "border-gray-200 dark:border-gray-800"}`}>
            <div className={`text-2xl font-bold tabular-nums ${c > 0 || k === "todas" ? cor : "text-gray-300 dark:text-gray-600"}`}>{c}</div>
            <div className="text-[10px] text-gray-500 leading-tight">{l}</div>
          </button>
        ))}
      </div>
      <div className="text-xs text-gray-400 text-center">{lista.length === 0 ? "Nada aqui." : "Toque numa etiqueta pra dar baixa."}</div>
      <div className="space-y-1.5">
        {lista.map(({ e, d }) => {
          const cor = d < 0 ? "text-rose-600" : d === 0 ? "text-amber-600 dark:text-amber-400" : d === 1 ? "text-orange-600 dark:text-orange-400" : "text-gray-400";
          const txt = d < 0 ? `venceu ${fmtBR(e.validade)}` : d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence ${fmtBR(e.validade)}`;
          return (
            <button key={e.id} type="button" onClick={() => setAberta(e)} className="w-full flex items-center justify-between gap-3 px-3 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-left active:bg-gray-50 dark:active:bg-gray-800/50">
              <span className="truncate text-sm text-gray-900 dark:text-gray-100">{e.codigo && <b className="tabular-nums text-gray-400 mr-2">{e.codigo}</b>}{e.produtoNome}</span>
              <span className={`text-xs whitespace-nowrap ${cor}`}>{txt}</span>
            </button>
          );
        })}
      </div>
      {aberta && <BaixaEtiquetaModal etiqueta={aberta} usuario={usuario} onClose={() => setAberta(null)} />}
    </div>
  );
}

// ═══ BAIXA NA MAQUININHA (só etiquetas: Ler QR ou digitar o número) ══════════
function BaixaMaquininha({ rid, etiquetas, usuario, podeOperar }: {
  rid: string; etiquetas: EtiquetaEmitida[]; usuario: { uid?: string | null; nome?: string | null }; podeOperar: boolean;
}) {
  const [scan, setScan] = useState(false);
  const [aberta, setAberta] = useState<EtiquetaEmitida | null>(null);
  const [num, setNum] = useState("");
  const [msg, setMsg] = useState("");

  function aoLerQr(code: string) {
    setScan(false); setMsg("");
    const token = tokenDoQr(code);
    if (token) {
      const e = etiquetas.find((x) => x.qrToken === token);
      if (e) { setAberta(e); return; }
      void buscarPorToken(rid, token).then((x) => (x ? setAberta(x) : setMsg("Etiqueta não encontrada nesta unidade.")), () => setMsg("Não consegui consultar a etiqueta."));
      return;
    }
    setMsg("QR não reconhecido.");
  }
  async function abrirLeitor() { if (noAppSunmi()) { const v = await lerQrNativo(); if (v) { aoLerQr(v); return; } } setScan(true); }
  function buscarNumero() {
    const n = parseInt((num || "").replace(/\D/g, ""), 10);
    if (!n) { setMsg("Digite o número da etiqueta."); return; }
    const e = etiquetaPorNumero(etiquetas, n);
    if (e) { setAberta(e); setNum(""); setMsg(""); } else setMsg(`Nenhuma etiqueta ativa com o número ${String(n).padStart(5, "0")}.`);
  }
  const abrirRef = useRef(abrirLeitor); abrirRef.current = abrirLeitor;
  const aoLerRef = useRef(aoLerQr); aoLerRef.current = aoLerQr;
  useEffect(() => { if (!noAppSunmi()) return; const d1 = armarTeclaScan(() => void abrirRef.current()); const d2 = armarCodigoScan((c) => aoLerRef.current(c)); return () => { d1(); d2(); }; }, []);

  if (!podeOperar) return <div className="p-6 text-sm text-gray-500">Você não tem permissão pra dar baixa.</div>;
  const ordenadas = etiquetas.slice().sort((a, b) => a.validade.localeCompare(b.validade));
  const filtrando = num !== "";
  const lista = filtrando
    ? ordenadas.filter((e) => e.numero != null && String(e.numero).padStart(5, "0").endsWith(num))
    : ordenadas.slice(0, 15);
  return (
    <div className="space-y-4 max-w-md mx-auto">
      <button type="button" onClick={() => void abrirLeitor()} className="w-full h-16 rounded-2xl bg-indigo-600 text-white text-lg font-semibold inline-flex items-center justify-center gap-2 active:bg-indigo-700 shadow-sm"><Camera size={22} /> Ler QR da etiqueta</button>
      <div>
        <div className="text-xs text-gray-500 mb-1 text-center">ou digite o número que está grande na etiqueta</div>
        <div className="flex gap-2">
          <input value={num === "" ? "" : num.padStart(5, "0")} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); const n = parseInt(d.slice(-5) || "0", 10); setNum(n > 0 ? String(n) : ""); }} inputMode="numeric" placeholder="00000"
            className="flex-1 min-w-0 h-14 px-3 text-3xl tracking-[0.2em] text-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 tabular-nums" />
          <button type="button" onClick={buscarNumero} disabled={!num} className="shrink-0 px-5 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-semibold disabled:opacity-40">OK</button>
        </div>
      </div>
      {msg && <div className="text-sm text-rose-600 text-center">{msg}</div>}
      <div>
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">{filtrando ? `Etiquetas com final ${num}` : "Vencendo primeiro"}</div>
        {lista.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-4">{filtrando ? "Nenhuma etiqueta ativa com esse número." : "Nenhuma etiqueta ativa."}</div>
        ) : (
          <div className="space-y-1.5">
            {lista.map((e) => { const d = diasAteValidade(e.validade, hojeSP()); const cod = e.codigo || (e.numero != null ? String(e.numero).padStart(5, "0") : ""); return (
              <button key={e.id} type="button" onClick={() => setAberta(e)} className="w-full flex items-center justify-between gap-2 px-3 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-left active:bg-gray-50 dark:active:bg-gray-800/50">
                <span className="truncate text-sm text-gray-900 dark:text-gray-100">{cod && <b className="tabular-nums text-gray-500 dark:text-gray-300 mr-2">{cod}</b>}{e.produtoNome}</span>
                <span className={`text-xs whitespace-nowrap ${d < 0 ? "text-rose-600" : d === 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400"}`}>{d < 0 ? "vencida" : d === 0 ? "hoje" : d === 1 ? "amanhã" : `${d}d`}</span>
              </button>
            ); })}
          </div>
        )}
      </div>
      {scan && <ScannerModal titulo="Ler QR da etiqueta" onDetect={aoLerQr} onClose={() => setScan(false)} />}
      {aberta && <BaixaEtiquetaModal etiqueta={aberta} usuario={usuario} onClose={() => setAberta(null)} />}
    </div>
  );
}

// ═══ ENTRADA ═════════════════════════════════════════════════════════════════
function EntradaTab({ produtos, locais, lotesAtivos, podeOperar, onEntrada, pendentes, onResolver }: {
  produtos: ProdutoEtiqueta[]; locais: LocalEstoque[]; lotesAtivos: (id: string) => LoteEstoque[];
  podeOperar: boolean; onEntrada: (v: { produto: ProdutoEtiqueta; qtd: number; validade: string; localId: string; fornecedor?: string }) => Promise<string>;
  pendentes: EntradaPendente[]; onResolver: (id: string, loteId: string | null, status: "confirmada" | "descartada") => Promise<void>;
}) {
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<ProdutoEtiqueta | null>(null);
  const [qtd, setQtd] = useState("");
  const [validadeBr, setValidadeBr] = useState("");
  const [localId, setLocalId] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [msg, setMsg] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [pendenteAtivo, setPendenteAtivo] = useState<EntradaPendente | null>(null);

  const achados = busca.trim() ? produtos.filter((p) => p.ativo && p.nome.toLowerCase().includes(busca.toLowerCase())).slice(0, 8) : [];

  // "Lançar" um pendente do recebimento → pré-preenche pra o usuário casar o produto.
  function lancarPendente(p: EntradaPendente) {
    setPendenteAtivo(p); setBusca(p.descricaoNota); setMsg("");
    if (p.quantidade != null) setQtd(String(p.quantidade));
    if (p.fornecedor) setFornecedor(p.fornecedor);
  }

  // Validade do lote = da EMBALAGEM/NF (produto fechado). A conservação é só
  // pós-aberto — não entra aqui. Só selecionamos o produto.
  function escolher(p: ProdutoEtiqueta) { setSel(p); setMsg(""); }

  // Instrução PVPS/PEPS: onde colocar o lote novo em relação aos existentes.
  function instrucaoArrumacao(p: ProdutoEtiqueta, validadeYmd: string): string {
    const existentes = lotesAtivos(p.id);
    if (existentes.length === 0) return "Primeiro lote — pode guardar à frente.";
    // Regra fixa: sai antes quem vence antes; empate de validade → quem entrou antes.
    // Os lotes existentes entraram antes deste, então mesma validade conta como "antes".
    const antes = existentes.filter((l) => l.validade <= validadeYmd).length;
    const depois = existentes.filter((l) => l.validade > validadeYmd).length;
    if (depois === 0) return `Coloque ATRÁS dos ${antes} lote(s) que já estão aí (saem antes).`;
    if (antes === 0) return `Este vence primeiro — coloque À FRENTE de tudo.`;
    return `Coloque ATRÁS dos ${antes} que saem antes e À FRENTE dos ${depois} que saem depois.`;
  }

  if (!podeOperar) return <div className="p-6 text-sm text-gray-500">Você não tem permissão pra dar entrada.</div>;

  async function salvar() {
    if (!sel) return;
    const n = parseFloat((qtd || "").replace(",", "."));
    const validade = brToYmd(validadeBr);
    if (!n || n <= 0) { setMsg("Informe a quantidade."); return; }
    if (!validade) { setMsg("Informe a validade (dd/mm/aaaa)."); return; }
    setSalvando(true);
    try {
      const instr = instrucaoArrumacao(sel, validade);
      const loteId = await onEntrada({ produto: sel, qtd: n, validade, localId, fornecedor: fornecedor || undefined });
      if (pendenteAtivo) { await onResolver(pendenteAtivo.id, loteId, "confirmada"); setPendenteAtivo(null); }
      setMsg(`✓ Entrada de ${n} ${sel.unidade} de ${sel.nome} (vence ${fmtBR(validade)}). ${instr}`);
      setSel(null); setQtd(""); setValidadeBr(""); setLocalId(""); setFornecedor(""); setBusca("");
    } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Confirme os <b>pendentes do recebimento</b> (a NF vira rascunho aqui) ou dê entrada manual. Informe a validade — o sistema diz onde arrumar (PVPS/PEPS).</p>
      {!sel ? (
        <div>
          {pendentes.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-1.5 inline-flex items-center gap-1.5"><Inbox size={13} /> Pendentes do recebimento ({pendentes.length})</div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                {pendentes.map((p) => (
                  <div key={p.id} className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 p-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <div className="font-medium text-gray-800 dark:text-gray-100 truncate">{p.descricaoNota}</div>
                      <div className="text-[11px] text-gray-500">{p.quantidade != null ? `${p.quantidade} ${p.unidade || ""}` : "qtd —"}{p.fornecedor ? ` · ${p.fornecedor}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" onClick={() => lancarPendente(p)}>Lançar</Button>
                      <button type="button" onClick={() => void onResolver(p.id, null, "descartada")} className="text-xs px-2 py-1 text-gray-400 hover:text-rose-600" title="Descartar">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="max-w-2xl"><SearchInput value={busca} onChange={setBusca} placeholder="Buscar produto pra dar entrada…" /></div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(busca.trim() ? achados : produtos.filter((p) => p.ativo).slice().sort((a, b) => a.nome.localeCompare(b.nome))).map((p) => (
              <button key={p.id} type="button" onClick={() => escolher(p)} className="text-left rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 hover:border-indigo-300 text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.nome}</button>
            ))}
          </div>
          {produtos.length === 0 && <p className="text-xs text-gray-400 mt-2">Nenhum produto. Cadastre em <b>Cadastro › Produtos</b>.</p>}
        </div>
      ) : (
        <div className="max-w-2xl rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-gray-900 dark:text-gray-100">{sel.nome}</span>
            <button type="button" onClick={() => { setSel(null); setMsg(""); }} className="text-xs text-gray-400 hover:underline">trocar</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label className="text-xs text-gray-500 block mb-1">Quantidade ({sel.unidade})</label><input value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="0" inputMode="decimal" className={inp} /></div>
            <div><label className="text-xs text-gray-500 block mb-1">Validade <span className="text-gray-400">(da embalagem/NF)</span></label><input value={validadeBr} onChange={(e) => setValidadeBr(e.target.value)} placeholder="dd/mm/aaaa" className={inp} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label className="text-xs text-gray-500 block mb-1">Local <span className="text-gray-400">(opcional)</span></label>
              <select value={localId} onChange={(e) => setLocalId(e.target.value)} className={inp}><option value="">—</option>{locais.filter((l) => l.ativo && !ehAmbiente(l)).map((l) => <option key={l.id} value={l.id}>{nomeCompleto(l, locais)}</option>)}</select>
            </div>
            <div><label className="text-xs text-gray-500 block mb-1">Fornecedor <span className="text-gray-400">(opcional)</span></label><input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className={inp} /></div>
          </div>
          <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "…" : "Dar entrada"}</Button>
        </div>
      )}
      {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300"}`}>{msg}</div>}
    </div>
  );
}

// ═══ CADASTRO › LOCAIS ═══════════════════════════════════════════════════════
function LocaisTab({ locais, contarProdutos, onProdutos, metodoLabel, restauranteNome, podeEditar, onNovo, onEditar, onExcluir, naMaquininha, carregando }: {
  locais: LocalEstoque[]; contarProdutos: (localId: string) => number; onProdutos: (l: LocalEstoque) => void; metodoLabel: (id?: string | null) => string | null; restauranteNome?: string; podeEditar: boolean; onNovo: () => void; onEditar: (l: LocalEstoque) => void; onExcluir: (l: LocalEstoque) => void; naMaquininha?: boolean; carregando?: boolean;
}) {
  const grupos = useMemo(() => agruparPorAmbiente(locais, false), [locais]);
  const acoes = (l: LocalEstoque) => podeEditar && (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" onClick={() => onEditar(l)} className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Editar"><Pencil size={14} /></button>
      <button type="button" onClick={() => onExcluir(l)} className="text-xs px-2 py-1 rounded text-gray-300 hover:text-rose-600" title="Excluir"><Trash2 size={14} /></button>
    </div>
  );
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-xs text-gray-500 max-w-lg">Ambientes{restauranteNome ? ` do ${restauranteNome}` : ""} (cozinha de baixo, laje…) e, dentro de cada um, os equipamentos de estoque com a sua conservação.</p>
        {podeEditar && <Button size="sm" onClick={onNovo}>+ Novo ambiente ou equipamento</Button>}
      </div>
      {carregando ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center text-sm text-gray-400">Carregando…</div>
      ) : locais.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">{naMaquininha
          ? <>Nenhum ambiente liberado pra esta máquina. {podeEditar ? "Crie um aqui (já entra liberado) ou marque no planejamento.app, em Máquinas." : ""}</>
          : <>Nada cadastrado. {podeEditar ? "Comece pelos ambientes e depois os equipamentos de cada um." : ""}</>}</div>
      ) : (
        <div className="space-y-5">
          {grupos.map(({ ambiente, equipamentos }) => (
            <div key={ambiente?.id || "sem"}>
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-1.5 mb-1">
                <div className={`text-sm font-semibold ${ambiente && !ambiente.ativo ? "text-gray-400" : "text-gray-900 dark:text-gray-100"}`}>{ambiente ? ambiente.nome : "Sem ambiente"}{ambiente && !ambiente.ativo && <span className="font-normal"> · inativo</span>}</div>
                {ambiente && acoes(ambiente)}
              </div>
              {equipamentos.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">Nenhum equipamento neste ambiente.</p>
              ) : equipamentos.map((l) => (
                <div key={l.id} className={`flex items-center justify-between gap-2 py-2 ${l.ativo ? "" : "opacity-60"}`}>
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{l.nome} <span className="text-gray-400">· {LOCAL_ESTOQUE_TIPO_LABEL[l.tipo]?.label || l.tipo}</span></div>
                    <div className={`text-[11px] ${l.metodoConservacao ? "text-gray-500" : "text-amber-600"}`}>{metodoLabel(l.metodoConservacao) || "Sem conservação definida"}{!l.ativo && " · inativo"}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {podeEditar && l.metodoConservacao && (
                      <button type="button" onClick={() => onProdutos(l)} className="h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:border-indigo-300">
                        Produtos <span className="text-gray-400">{contarProdutos(l.id)}</span>
                      </button>
                    )}
                    {acoes(l)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ CADASTRO › PRODUTOS ═════════════════════════════════════════════════════
function ProdutosTab({ produtos, config, podeEditar, onNovo, onEditar, onExcluir, onEtiqueta, naMaquininha }: {
  produtos: ProdutoEtiqueta[]; config: EstoqueConfig; podeEditar: boolean; onNovo: () => void; onEditar: (p: ProdutoEtiqueta) => void; onExcluir: (p: ProdutoEtiqueta) => void; onEtiqueta: (p: ProdutoEtiqueta) => void; naMaquininha?: boolean;
}) {
  const [busca, setBusca] = useState("");
  const lista = produtos.filter((p) => !busca.trim() || p.nome.toLowerCase().includes(busca.toLowerCase())).sort((a, b) => a.nome.localeCompare(b.nome));
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-xs text-gray-500 max-w-lg">Um produto com <b>matriz de conservação</b> (método → dias). Cada um tem sua etiqueta fixa de estoque (QR). Nada de duplicar por método.</p>
        {podeEditar && <Button size="sm" onClick={onNovo}>+ Novo produto</Button>}
      </div>
      <div className="max-w-2xl mb-3"><SearchInput value={busca} onChange={setBusca} placeholder="Buscar produto…" /></div>
      {lista.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">{naMaquininha
          ? <>Nenhum produto nos locais desta máquina. {podeEditar ? "Cadastre um e vincule a um freezer/geladeira liberado." : ""}</>
          : <>Nenhum produto. {podeEditar ? "Cadastre o primeiro." : ""}</>}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
          {lista.map((p) => (
            <div key={p.id} className={`rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center justify-between gap-2 ${p.ativo ? "" : "opacity-60"}`}>
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.nome} <span className="text-xs font-normal text-gray-400">· {p.unidade}</span></div>
                <div className="text-[11px] text-gray-400 flex flex-wrap gap-1.5 mt-0.5">
                  {config.metodos.filter((m) => p.conservacao[m.id] != null).map((m) => <span key={m.id}>{m.label} {p.conservacao[m.id]}d</span>)}
                  {(p.categorias?.length ?? 0) > 0 && <span>· {p.categorias!.join(", ")}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => onEtiqueta(p)} className="text-xs px-2 py-1 rounded text-gray-400 hover:text-indigo-600" title="Etiqueta fixa (QR)"><Tag size={14} /></button>
                {podeEditar && <><button type="button" onClick={() => onEditar(p)} className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="Editar"><Pencil size={14} /></button><button type="button" onClick={() => onExcluir(p)} className="text-xs px-2 py-1 rounded text-gray-300 hover:text-rose-600" title="Excluir"><Trash2 size={14} /></button></>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ CADASTRO › BASES (unidades, categorias, métodos) ═══════════════════════
function BasesTab({ config, podeEditar, onSalvar }: { config: EstoqueConfig; podeEditar: boolean; onSalvar: (patch: Partial<EstoqueConfig>) => Promise<void> }) {
  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-xs text-gray-500">Listas base usadas no cadastro de produtos — nada de campo livre. Adicione o que precisar.</p>
      <ListaBase titulo={<span className="inline-flex items-center gap-1.5"><Ruler size={14} /> Unidades</span>} itens={config.unidades} podeEditar={podeEditar}
        onAdd={(v) => onSalvar({ unidades: [...config.unidades, v.toUpperCase()] })}
        onRemove={(v) => onSalvar({ unidades: config.unidades.filter((x) => x !== v) })} />
      <ListaBase titulo={<span className="inline-flex items-center gap-1.5"><Tag size={14} /> Categorias</span>} itens={config.categorias} podeEditar={podeEditar} vazio="Nenhuma categoria ainda."
        onAdd={(v) => onSalvar({ categorias: [...config.categorias, v] })}
        onRemove={(v) => onSalvar({ categorias: config.categorias.filter((x) => x !== v) })} />
      <ListaBase titulo={<span className="inline-flex items-center gap-1.5"><Snowflake size={14} /> Métodos de conservação (após aberto)</span>} itens={config.metodos.map((m) => m.label)} podeEditar={podeEditar}
        onAdd={(v) => onSalvar({ metodos: [...config.metodos, { id: slug(v), label: v }] })}
        onRemove={(v) => onSalvar({ metodos: config.metodos.filter((m) => m.label !== v) })} />
    </div>
  );
}

// Máquinas de etiqueta (maquininhas/estações). Config remota: o que você marca
// aqui aparece no aparelho sozinho (ambientes que ele mostra, tamanho, modo prod).
function MaquinasTab({ maquinas, ambientes, bobinas, restaurantes, rid, podeEditar, onSalvar }: {
  maquinas: Maquina[]; ambientes: { id: string; nome: string }[]; bobinas: [string, string][];
  restaurantes: { id: string; nome: string }[]; rid: string; podeEditar: boolean; onSalvar: (ms: Maquina[]) => void;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  // Mantém o perfil de acesso da máquina sempre atualizado (ex.: ganhou
  // permissão de editar/cadastrar depois que as contas já existiam). Idempotente.
  useEffect(() => { if (podeEditar) void garantirPerfilMaquina(); }, [podeEditar]);
  const upd = (id: string, patch: Partial<Maquina>) => onSalvar(maquinas.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const addNova = () => { const id = `maq_${Date.now().toString(36)}`; onSalvar([...maquinas, { id, nome: `Máquina ${maquinas.length + 1}`, ambienteIds: [] }]); setEditId(id); };
  const emEdicao = maquinas.find((m) => m.id === editId) || null;
  const ambNome = (id: string) => ambientes.find((a) => a.id === id)?.nome || "";
  return (
    <div className="space-y-3 max-w-2xl">
      <p className="text-xs text-gray-500">Cada máquina mostra só os ambientes marcados nela (catálogo por localização). Você edita por aqui e aparece no aparelho sozinho — sem tocar nele.</p>
      {maquinas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500">Nenhuma máquina cadastrada ainda.</div>
      ) : (
        <div className="space-y-2">
          {maquinas.map((m) => (
            <button key={m.id} type="button" onClick={() => setEditId(m.id)} className="w-full flex items-center justify-between gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 text-left hover:border-indigo-300 dark:hover:border-indigo-700 active:scale-[.99]">
              <div className="min-w-0">
                <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{m.nome}{m.deviceId ? <span className="ml-2 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">● vinculada</span> : null}</div>
                <div className="text-xs text-gray-400 truncate">
                  {(m.ambienteIds || []).length ? (m.ambienteIds || []).map(ambNome).filter(Boolean).join(", ") : "sem ambientes"}
                  {m.operadores?.length ? ` · ${m.operadores.length} operador${m.operadores.length > 1 ? "es" : ""}` : ""}
                  {m.modoProducao ? " · modo produção" : ""}
                </div>
              </div>
              <ChevronRight size={18} className="shrink-0 text-gray-300" />
            </button>
          ))}
        </div>
      )}
      {podeEditar && <Button size="sm" onClick={addNova}>+ Adicionar nova máquina</Button>}
      {emEdicao && (
        <MaquinaEditorModal maquina={emEdicao} ambientes={ambientes} bobinas={bobinas} restaurantes={restaurantes} rid={rid} podeEditar={podeEditar}
          onChange={(patch) => upd(emEdicao.id, patch)}
          onExcluir={() => { if (confirm(`Excluir a máquina "${emEdicao.nome}"?`)) { onSalvar(maquinas.filter((x) => x.id !== emEdicao.id)); setEditId(null); } }}
          onClose={() => setEditId(null)} />
      )}
    </div>
  );
}

function MaquinaEditorModal({ maquina: m, ambientes, bobinas, restaurantes, rid, podeEditar, onChange, onExcluir, onClose }: {
  maquina: Maquina; ambientes: { id: string; nome: string }[]; bobinas: [string, string][];
  restaurantes: { id: string; nome: string }[]; rid: string; podeEditar: boolean;
  onChange: (patch: Partial<Maquina>) => void; onExcluir: () => void; onClose: () => void;
}) {
  const [modo, setModo] = useState<"ver" | "editar">("ver");
  const [criandoLogin, setCriandoLogin] = useState(false);
  const [loginErro, setLoginErro] = useState("");
  const [loginNovo, setLoginNovo] = useState<{ email: string; senha: string } | null>(null);
  const criarLogin = async () => {
    setCriandoLogin(true); setLoginErro(""); setLoginNovo(null);
    const r = await criarLoginMaquina(m, rid);
    setCriandoLogin(false);
    if (r.ok) { setLoginNovo({ email: r.email, senha: r.senha }); onChange({ loginEmail: r.email }); }
    else setLoginErro(r.erro);
  };
  const toggleArr = (arr: string[] | undefined, v: string) => { const s = new Set(arr || []); if (s.has(v)) s.delete(v); else s.add(v); return [...s]; };
  const chip = (on: boolean, cor: string) => `px-2.5 py-1 rounded-full text-xs font-medium border ${on ? cor : "bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`;
  const ambNome = (id: string) => ambientes.find((a) => a.id === id)?.nome || id;
  const restNome = (id: string) => restaurantes.find((r) => r.id === id)?.nome || id;
  const bobinaLabel = bobinas.find(([id]) => id === m.bobinaId)?.[1] || "Padrão do aparelho";
  const Linha = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm border-b border-gray-100 dark:border-gray-800 last:border-0"><span className="text-gray-500 shrink-0">{label}</span><span className="text-right text-gray-900 dark:text-gray-100">{children}</span></div>
  );
  if (modo === "ver") {
    return (
      <Modal title={m.nome} onClose={onClose} maxWidth="max-w-md"
        headerAction={podeEditar ? <button type="button" onClick={() => setModo("editar")} className="text-sm font-medium text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 px-1"><Pencil size={14} /> Editar</button> : undefined}>
        <div>
          <Linha label="Ambientes">{(m.ambienteIds || []).length ? (m.ambienteIds || []).map(ambNome).join(", ") : "—"}</Linha>
          <Linha label="Tamanho da etiqueta">{bobinaLabel}</Linha>
          <Linha label="Modo produção">{m.modoProducao ? "Sim" : "Não"}</Linha>
          {m.modoProducao && <Linha label="Restaurantes">{(m.restaurantesAlvo || []).map(restNome).join(", ") || "—"}</Linha>}
          <Linha label="Operadores">{m.operadores?.length ? m.operadores.map((o) => o.nome).join(", ") : "nenhum"}</Linha>
          <Linha label="Vínculo">{m.deviceId ? "Vinculada a um aparelho" : "Não vinculada"}</Linha>
          <Linha label="Login do aparelho">{m.loginEmail ? <span className="font-mono text-[11px] break-all">{m.loginEmail}</span> : "não criado"}</Linha>

          {/* Conta dedicada da máquina — pra deslogar do seu login no aparelho */}
          {podeEditar && (
            <div className="mt-3 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-3">
              {loginNovo ? (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Login da máquina criado ✓</div>
                  <p className="text-xs text-gray-600 dark:text-gray-300">No aparelho, saia do seu login e entre com estes dados (só na 1ª vez — depois fica logado):</p>
                  <div className="rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-2.5 text-sm space-y-1">
                    <div><span className="text-gray-400 text-xs">E-mail</span><br /><span className="font-mono break-all">{loginNovo.email}</span></div>
                    <div><span className="text-gray-400 text-xs">Senha</span><br /><span className="font-mono text-lg tracking-wide">{loginNovo.senha}</span></div>
                  </div>
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">Anote a senha agora — ela não aparece de novo.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600 dark:text-gray-300">{m.loginEmail
                    ? "Essa máquina já tem um login. Você pode refazer (gera uma conta e senha novas) caso tenha perdido a senha."
                    : "Cria uma conta só desta máquina, limitada aos restaurantes marcados — pra logar no aparelho sem usar seu login pessoal."}</p>
                  <Button size="sm" onClick={() => void criarLogin()} disabled={criandoLogin}>{criandoLogin ? "Criando…" : m.loginEmail ? "Refazer login da máquina" : "Criar login da máquina"}</Button>
                </div>
              )}
              {loginErro && <div className="mt-2 text-xs text-rose-600 dark:text-rose-400">{loginErro}</div>}
            </div>
          )}

          {podeEditar && <div className="pt-4"><Button variant="secondary" onClick={() => setModo("editar")}><Pencil size={14} /> Editar configuração</Button></div>}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Editar — ${m.nome}`} onClose={() => setModo("ver")} maxWidth="max-w-md" headerAction={podeEditar ? <button type="button" onClick={onExcluir} className="text-gray-300 hover:text-rose-600 px-1" title="Excluir máquina"><Trash2 size={16} /></button> : undefined}>
      <div className="space-y-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">Nome</div>
          <input defaultValue={m.nome} disabled={!podeEditar} onBlur={(e) => e.target.value.trim() && onChange({ nome: e.target.value.trim() })} className={`${inp} font-semibold`} />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Ambientes que aparecem nesta máquina</div>
          <div className="flex flex-wrap gap-1.5">
            {ambientes.length === 0 && <span className="text-xs text-gray-400">Cadastre ambientes em Locais.</span>}
            {ambientes.map((a) => (
              <button key={a.id} type="button" disabled={!podeEditar} onClick={() => onChange({ ambienteIds: toggleArr(m.ambienteIds, a.id) })} className={chip((m.ambienteIds || []).includes(a.id), "bg-indigo-600 text-white border-indigo-600")}>{a.nome}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Tamanho da etiqueta</div>
          <select value={m.bobinaId || ""} disabled={!podeEditar} onChange={(e) => onChange({ bobinaId: e.target.value })} className={inp}>
            <option value="">Padrão do aparelho</option>
            {bobinas.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="checkbox" disabled={!podeEditar} checked={!!m.modoProducao} onChange={(e) => onChange({ modoProducao: e.target.checked })} /> Modo produção (vários restaurantes)</label>
        {m.modoProducao && (
          <div>
            <div className="text-xs text-gray-500 mb-1">Restaurantes que esta máquina pode etiquetar</div>
            <div className="flex flex-wrap gap-1.5">
              {restaurantes.map((r) => (
                <button key={r.id} type="button" disabled={!podeEditar} onClick={() => onChange({ restaurantesAlvo: toggleArr(m.restaurantesAlvo, r.id) })} className={chip((m.restaurantesAlvo || []).includes(r.id), "bg-emerald-600 text-white border-emerald-600")}>{r.nome}</button>
              ))}
            </div>
          </div>
        )}
        <MaquinaOperadores operadores={m.operadores || []} podeEditar={podeEditar} onChange={(ops) => onChange({ operadores: ops })} />
        {m.deviceId && podeEditar && (
          <div className="pt-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400">Vinculada a um aparelho. <button type="button" onClick={() => onChange({ deviceId: null })} className="text-indigo-600 dark:text-indigo-400">Liberar</button> pra poder associar em outro.</div>
        )}
        <div className="flex justify-end pt-1"><Button onClick={() => setModo("ver")}>Concluir</Button></div>
      </div>
    </Modal>
  );
}

// Operadores de uma máquina (nome + PIN de 4 dígitos, guardado com hash).
function MaquinaOperadores({ operadores, podeEditar, onChange }: { operadores: Operador[]; podeEditar: boolean; onChange: (ops: Operador[]) => void }) {
  const [nome, setNome] = useState("");
  const [pin, setPin] = useState("");
  const [salvando, setSalvando] = useState(false);
  async function add() {
    const nm = nome.trim(); const p = pin.replace(/\D/g, "");
    if (!nm || p.length !== 4) return;
    setSalvando(true);
    const id = `op_${Date.now().toString(36)}`;
    const pinHash = await hashPin(p, id);
    onChange([...operadores, { id, nome: nm, pinHash }]);
    setNome(""); setPin(""); setSalvando(false);
  }
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">Operadores (nome + PIN de 4 dígitos)</div>
      <div className="space-y-1.5 mb-2">
        {operadores.length === 0 && <div className="text-xs text-gray-400">Sem operadores: a máquina usa a conta logada como responsável.</div>}
        {operadores.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm">
            <span className="text-gray-800 dark:text-gray-100">{o.nome}</span>
            {podeEditar && <button type="button" onClick={() => onChange(operadores.filter((x) => x.id !== o.id))} className="text-rose-500"><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>
      {podeEditar && (
        <div className="flex gap-2">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do operador" className="flex-1 min-w-0 h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="PIN" className="w-24 shrink-0 h-9 px-2.5 text-sm text-center tracking-[0.3em] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          <button type="button" onClick={() => void add()} disabled={salvando || !nome.trim() || pin.length !== 4} className="shrink-0 px-4 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-semibold disabled:opacity-40">Add</button>
        </div>
      )}
    </div>
  );
}
function ListaBase({ titulo, itens, podeEditar, vazio, onAdd, onRemove }: { titulo: ReactNode; itens: string[]; podeEditar: boolean; vazio?: string; onAdd: (v: string) => void; onRemove: (v: string) => void }) {
  const [novo, setNovo] = useState("");
  function add() { const v = novo.trim(); if (!v || itens.some((x) => x.toLowerCase() === v.toLowerCase())) { setNovo(""); return; } onAdd(v); setNovo(""); }
  return (
    <div>
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">{titulo}</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {itens.length === 0 && <span className="text-xs text-gray-400">{vazio || "Vazio."}</span>}
        {itens.map((it) => (
          <span key={it} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200">
            {it}
            {podeEditar && <button type="button" onClick={() => onRemove(it)} className="text-gray-300 hover:text-rose-600 text-xs" title="Remover">✕</button>}
          </span>
        ))}
      </div>
      {podeEditar && (
        <div className="flex gap-2 max-w-sm">
          <input value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Adicionar…" className={inp} />
          <Button size="sm" variant="secondary" onClick={add} disabled={!novo.trim()}>+ Add</Button>
        </div>
      )}
    </div>
  );
}

// ═══ MODAIS ══════════════════════════════════════════════════════════════════
function LocalModal({ local, locais, config, onClose, onSalvar }: {
  local: LocalEstoque | null; locais: LocalEstoque[]; config: EstoqueConfig; onClose: () => void; onSalvar: (l: Omit<LocalEstoque, "id" | "criadoEm"> & { id?: string }) => Promise<void>;
}) {
  const [nome, setNome] = useState(local?.nome || "");
  // Sem nenhum ambiente ainda, o primeiro cadastro sugerido é um ambiente.
  const [tipo, setTipo] = useState<LocalEstoqueTipo>(local?.tipo || (locais.some(ehAmbiente) ? "geladeira" : "ambiente"));
  const [paiId, setPaiId] = useState<string>(local?.paiId || "");
  const [metodo, setMetodo] = useState<string>(local?.metodoConservacao || METODO_POR_TIPO[tipo] || "");
  const [metodoTocado, setMetodoTocado] = useState(!!local?.metodoConservacao);
  const [ativo, setAtivo] = useState<boolean>(local?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const ambientes = locais.filter((l) => l.id !== local?.id && ehAmbiente(l));
  const ehAmb = tipo === "ambiente";
  async function salvar() { if (!nome.trim()) return; setSalvando(true); try { await onSalvar({ id: local?.id, restaurantId: local?.restaurantId || "", nome: nome.trim(), tipo, paiId: ehAmb ? null : (paiId || null), metodoConservacao: ehAmb ? null : (metodo || null), ativo }); } finally { setSalvando(false); } }
  return (
    <Modal title={local ? (ehAmb ? "Editar ambiente" : "Editar equipamento") : (ehAmb ? "Novo ambiente" : "Novo equipamento")} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-3">
        <div><label className="text-xs text-gray-500 block mb-1">Nome</label><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={ehAmb ? "Ex.: Cozinha de baixo, Laje" : "Ex.: Geladeira 1, Freezer horizontal"} className={inp} autoFocus /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div><label className="text-xs text-gray-500 block mb-1">Tipo</label><select value={tipo} onChange={(e) => { const t = e.target.value as LocalEstoqueTipo; setTipo(t); if (!metodoTocado) setMetodo(METODO_POR_TIPO[t] || ""); }} className={inp}>{TIPOS.map((t) => <option key={t} value={t}>{LOCAL_ESTOQUE_TIPO_LABEL[t].icon} {LOCAL_ESTOQUE_TIPO_LABEL[t].label}</option>)}</select></div>
          {!ehAmb && <div><label className="text-xs text-gray-500 block mb-1">Ambiente</label><select value={paiId} onChange={(e) => setPaiId(e.target.value)} className={inp}><option value="">Sem ambiente</option>{ambientes.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}</select></div>}
        </div>
        {!ehAmb && <div>
          <label className="text-xs text-gray-500 block mb-1">Conservação deste equipamento</label>
          <select value={metodo} onChange={(e) => { setMetodo(e.target.value); setMetodoTocado(true); }} className={inp}>
            <option value="">Nenhuma (não emite etiqueta)</option>
            {config.metodos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Define a validade das etiquetas dos produtos guardados aqui.</p>
        </div>}
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo</label>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void salvar()} disabled={salvando || !nome.trim()}>{salvando ? "Salvando…" : local ? "Salvar" : "Criar"}</Button></div>
      </div>
    </Modal>
  );
}

function ProdutoModal({ produto, nomeInicial, localInicial, produtos, config, locais, onClose, onSalvar, onUsarExistente }: {
  produto: ProdutoEtiqueta | null; nomeInicial?: string; localInicial?: string; produtos: ProdutoEtiqueta[];
  onUsarExistente: (p: ProdutoEtiqueta) => void; config: EstoqueConfig; locais: LocalEstoque[]; onClose: () => void; onSalvar: (p: Partial<ProdutoEtiqueta> & { id?: string }) => Promise<void>;
}) {
  const [nome, setNome] = useState(produto?.nome || nomeInicial || "");
  const [cats, setCats] = useState<string[]>(produto?.categorias || []);
  const [unidade, setUnidade] = useState(produto?.unidade || config.unidades[0] || "UND");
  const [cons, setCons] = useState<Conservacao>(produto?.conservacao || {});
  const [estoqueMinimo, setEstoqueMinimo] = useState(produto?.estoqueMinimo != null ? String(produto.estoqueMinimo) : "");
  const [marca, setMarca] = useState(produto?.marcaFornecedor || "");
  const [sif, setSif] = useState(produto?.sif || "");
  const [precoCusto, setPrecoCusto] = useState(produto?.precoCusto != null ? String(produto.precoCusto) : "");
  const [ativo, setAtivo] = useState<boolean>(produto?.ativo ?? true);
  // Vindo da tela do equipamento, ele já vem marcado (vale depois de preencher o prazo).
  const [locaisSel, setLocaisSel] = useState<string[]>(() => Array.from(new Set([...(produto?.locais || []), ...(localInicial ? [localInicial] : [])])));
  const similares = produto ? [] : parecidos(nome, produtos);
  const [salvando, setSalvando] = useState(false);
  const locaisAtivos = locais.filter((l) => l.ativo && !ehAmbiente(l)).sort((a, b) => nomeCompleto(a, locais).localeCompare(nomeCompleto(b, locais)));
  const toggleLocal = (id: string) => setLocaisSel((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const temMetodo = config.metodos.some((m) => cons[m.id] != null);
  function setDias(id: string, v: string) {
    const n = parseInt(v.replace(/\D/g, ""), 10);
    setCons((prev) => { const c = { ...prev }; if (v === "" || isNaN(n)) delete c[id]; else c[id] = n; return c; });
  }
  function toggleCat(c: string) { setCats((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]); }
  async function salvar() {
    if (!nome.trim() || !temMetodo) return;
    const igual = produtos.find((p) => p.id !== produto?.id && mesmoNome(p.nome, nome));
    if (igual && !confirm(`Já existe o produto "${igual.nome}". Cadastrar outro com o mesmo nome?`)) return;
    setSalvando(true);
    try {
      await onSalvar({ id: produto?.id, nome: nome.trim(), categorias: cats, unidade, conservacao: cons, locais: locaisSel, estoqueMinimo: estoqueMinimo ? parseFloat(estoqueMinimo.replace(",", ".")) : null, marcaFornecedor: marca.trim() || null, sif: sif.trim() || null, precoCusto: precoCusto ? parseFloat(precoCusto.replace(",", ".")) : null, ativo });
    } finally { setSalvando(false); }
  }
  return (
    <Modal title={produto ? "Editar produto" : "Novo produto"} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Nome</label><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Farinha de trigo" className={inp} autoFocus />
          {similares.length > 0 && (
            <div className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <div className="text-xs text-amber-800 dark:text-amber-300 mb-1">Já existe algo parecido. Se for o mesmo produto, use o cadastro existente:</div>
              {similares.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-1">
                  <div className="min-w-0 text-sm text-gray-900 dark:text-gray-100 truncate">{p.nome}
                    <span className="text-xs text-gray-500"> · {(p.locais || []).length ? (p.locais || []).map((id) => nomeCompleto(locais.find((l) => l.id === id), locais)).filter(Boolean).join(", ") : "sem local"}</span>
                  </div>
                  <button type="button" onClick={() => onUsarExistente(p)} className="shrink-0 h-8 px-3 rounded-lg bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-800 text-xs font-medium text-amber-800 dark:text-amber-300">É este</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Unidade</label>
            <select value={unidade} onChange={(e) => setUnidade(e.target.value)} className={inp}>{config.unidades.map((u) => <option key={u} value={u}>{u}</option>)}</select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Categoria(s) <span className="text-gray-400">(uma ou mais)</span></label>
            {config.categorias.length === 0 ? (
              <p className="text-[11px] text-gray-400 pt-2">Nenhuma. Cadastre em <b>Bases</b>.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {config.categorias.map((c) => (
                  <button key={c} type="button" onClick={() => toggleCat(c)} className={`px-3 py-1.5 text-xs font-medium rounded-full border ${cats.includes(c) ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-500"}`}>{c}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Conservação — validade <b>após aberto</b>, por método (dias) <span className="text-rose-500">*</span></label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {config.metodos.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 px-2.5 py-1.5">
                <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">{m.label}</span>
                <input value={cons[m.id] != null ? String(cons[m.id]) : ""} onChange={(e) => setDias(m.id, e.target.value)} placeholder="—" inputMode="numeric" className="w-16 h-8 px-2 text-sm text-right rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                <span className="text-xs text-gray-400">dias</span>
              </div>
            ))}
          </div>
          {!temMetodo && <p className="text-[11px] text-gray-400 mt-1">Preencha ao menos um método (validade após aberto).</p>}
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Onde fica <span className="text-gray-400">(só aparecem para etiquetar nesses locais)</span></label>
          {locaisAtivos.length === 0 ? (
            <p className="text-[11px] text-gray-400">Nenhum local cadastrado. Cadastre em <b>Locais</b>.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {locaisAtivos.map((l) => {
                const ok = compativel({ conservacao: cons }, l);
                const m = config.metodos.find((x) => x.id === l.metodoConservacao)?.label;
                const on = ok && locaisSel.includes(l.id);
                return (
                  <button key={l.id} type="button" disabled={!ok} onClick={() => toggleLocal(l.id)}
                    title={ok ? "" : m ? `Preencha o prazo de ${m} para vincular` : "Local sem conservação definida"}
                    className={`px-3 py-1.5 text-xs rounded-full border ${on ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : ok ? "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300" : "border-dashed border-gray-200 dark:border-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed"}`}>
                    {nomeCompleto(l, locais)}{m ? <span className="opacity-60"> · {m}</span> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div><label className="text-xs text-gray-500 block mb-1">Estoque mínimo</label><input value={estoqueMinimo} onChange={(e) => setEstoqueMinimo(e.target.value)} placeholder="—" inputMode="decimal" className={inp} /></div>
          <div><label className="text-xs text-gray-500 block mb-1">Preço custo (R$/{unidade})</label><input value={precoCusto} onChange={(e) => setPrecoCusto(e.target.value)} placeholder="—" inputMode="decimal" className={inp} /></div>
          <div><label className="text-xs text-gray-500 block mb-1">SIF/Registro</label><input value={sif} onChange={(e) => setSif(e.target.value)} className={inp} /></div>
        </div>
        <div><label className="text-xs text-gray-500 block mb-1">Marca / Fornecedor <span className="text-gray-400">(opc.)</span></label><input value={marca} onChange={(e) => setMarca(e.target.value)} className={inp} /></div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo</label>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void salvar()} disabled={salvando || !nome.trim() || !temMetodo}>{salvando ? "Salvando…" : produto ? "Salvar" : "Criar"}</Button></div>
      </div>
    </Modal>
  );
}

// Etiqueta FIXA de estoque (1 por produto) com QR — imprime e cola no local.
function EtiquetaFixaModal({ produto, onClose }: { produto: ProdutoEtiqueta; onClose: () => void }) {
  const [qr, setQr] = useState("");
  useEffect(() => { QRCode.toDataURL(produto.qrTokenEstoque, { width: 320, margin: 1 }).then(setQr).catch(() => setQr("")); }, [produto.qrTokenEstoque]);
  async function imprimir() {
    if (noAppSunmi()) {
      let bob = { larguraMm: 58, alturaMm: 40 };
      try { const b = localStorage.getItem("etiq_bobina"); if (b) { const [l, a] = b.split("x").map(Number); if (l && a) bob = { larguraMm: l, alturaMm: a }; } } catch { /* sem storage */ }
      const canvas = await desenharEtiqueta([
        { tipo: "rotulo", texto: "Estoque", direita: produto.unidade },
        { tipo: "titulo", texto: produto.nome },
        { tipo: "rodapeQr", qr: produto.qrTokenEstoque, linhas: ["Etiqueta fixa", "Leia o QR no app para dar baixa"] },
      ], bob);
      const r = await imprimirEtiqueta(canvas, 1, bob);
      if (!r.ok) alert(r.erro || "Falha ao imprimir.");
      return;
    }
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    const nomeSafe = produto.nome.replace(/[<>&]/g, "");
    w.document.write(`<!doctype html><html><head><title>Etiqueta ${nomeSafe}</title><style>*{font-family:system-ui,Arial,sans-serif}body{margin:0;padding:16px;text-align:center}.box{border:2px solid #111;border-radius:10px;padding:16px;display:inline-block;width:280px}.nome{font-size:20px;font-weight:800;margin:4px 0 2px}.tag{font-size:11px;letter-spacing:2px;color:#555}img{width:200px;height:200px}.hint{font-size:11px;color:#555;margin-top:6px}</style></head><body onload="window.print()"><div class="box"><div class="tag">ESTOQUE</div><div class="nome">${nomeSafe}</div><img src="${qr}"/><div class="hint">Leia este QR no app pra dar baixa</div></div></body></html>`);
    w.document.close();
  }
  return (
    <Modal title="Etiqueta fixa de estoque" onClose={onClose} maxWidth="max-w-sm">
      <div className="text-center space-y-3">
        <div className="inline-block border-2 border-gray-900 dark:border-gray-100 rounded-xl p-4">
          <div className="text-[10px] tracking-widest text-gray-500">ESTOQUE</div>
          <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{produto.nome}</div>
          {qr ? <img src={qr} alt="QR" className="w-40 h-40 mx-auto" /> : <div className="w-40 h-40 mx-auto flex items-center justify-center text-xs text-gray-400">gerando…</div>}
          <div className="text-[11px] text-gray-500">Leia este QR no app pra dar baixa</div>
        </div>
        <p className="text-xs text-gray-500">Cole no local do estoque. Uma etiqueta fixa por produto — os lotes ficam no sistema.</p>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800"><Button variant="secondary" onClick={onClose}>Fechar</Button><Button onClick={() => void imprimir()} disabled={!qr}><span className="inline-flex items-center gap-1.5"><Printer size={15} /> Imprimir</span></Button></div>
      </div>
    </Modal>
  );
}

