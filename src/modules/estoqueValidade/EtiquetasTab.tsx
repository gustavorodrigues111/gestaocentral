// ════════════════════════════════════════════════════════════════════════════
//  Etiquetas de validade: wizard de cozinha
//
//  Início: dois botões grandes, Emitir ou Dar baixa.
//   • Emitir → ambiente → equipamento → produto vinculado → confirmar.
//     O local define a conservação; a validade sai da matriz do produto para
//     aquele método. Nada de escolher método na hora.
//   • Dar baixa → etiquetas ativas das vencidas para as próximas datas, com
//     filtro por local e leitura do QR do pote.
//  Imprime na Sunmi V2s Label (app android-v2s) ou na impressora escolhida no
//  navegador, com a mesma imagem.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { Printer, Minus, Plus, ChevronLeft, ClipboardCheck, Settings2 } from "lucide-react";
import { desenharEtiqueta, larguraPx, type Bobina } from "../../core/impressao/etiquetaTermica";
import { imprimirEtiquetas, statusSunmi, avisoStatus, destinosDisponiveis, destinoSalvo, salvarDestino, DESTINO_LABEL, listarImpressoras, impressoraSalva, salvarImpressora, type Destino } from "../../core/impressao/impressora";
import type { LocalEstoque } from "../../core/types";
import { blocosValidade, dataBR, diaSemana, novoCodigoLote, validadeDe, ymd } from "./etiquetaValidade";
import { diasAteValidade, gravarEmissao, hojeSP, urlEtiqueta, type EtiquetaEmitida } from "./etiquetasRepo";
import { agruparPorAmbiente, diasNoLocal, nomeCompleto, produtosDoLocal } from "./compatibilidade";
import { EtiquetasEmitidas } from "./EtiquetasEmitidas";
import { enfileirarEtiqueta } from "./filaImpressao";
import type { ProdutoEtiqueta, EstoqueConfig } from "./EstoqueValidadePage";

// Medidas comuns. Na maquininha só cabem as de até 58 mm de largura.
const BOBINAS: { id: string; label: string; b: Bobina }[] = [
  { id: "58x40", label: "58 × 40 mm", b: { larguraMm: 58, alturaMm: 40 } },
  { id: "55x55", label: "55 × 55 mm", b: { larguraMm: 55, alturaMm: 55 } },
  { id: "58x60", label: "58 × 60 mm", b: { larguraMm: 58, alturaMm: 60 } },
  { id: "60x40", label: "60 × 40 mm", b: { larguraMm: 60, alturaMm: 40 } },
  { id: "60x60", label: "60 × 60 mm", b: { larguraMm: 60, alturaMm: 60 } },
  { id: "100x50", label: "100 × 50 mm", b: { larguraMm: 100, alturaMm: 50 } },
  { id: "100x100", label: "100 × 100 mm", b: { larguraMm: 100, alturaMm: 100 } },
];

const lerLS = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravarLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };

type Passo = "inicio" | "ambiente" | "local" | "produto" | "confirmar" | "baixa";

// Cores dos botões de equipamento por método de conservação (congelado, etc.).
const CORES_METODO: Record<string, string> = {
  congelado: "bg-sky-50 dark:bg-sky-950/30 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-100",
  refrigerado: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100",
  ambiente: "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100",
  seco: "bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-800 text-orange-900 dark:text-orange-100",
  quente: "bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-100",
};
const corMetodo = (id?: string | null) => CORES_METODO[id || ""] || "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100";
const btnQuadrado = "rounded-2xl border-2 p-4 min-h-[116px] flex flex-col items-center justify-center text-center gap-1 active:scale-[.98] shadow-sm transition-colors";

// Começo direto do fluxo de emissão (sem a tela "início"): ambiente se houver
// vários; senão cai direto nos equipamentos do único ambiente.
function calcStartEmissao(locais: LocalEstoque[]): { passo: Passo; ambienteId: string } {
  const gs = agruparPorAmbiente(locais)
    .map((g) => ({ ...g, equipamentos: g.equipamentos.filter((l) => !!l.metodoConservacao) }))
    .filter((g) => g.equipamentos.length > 0);
  if (gs.length > 1) return { passo: "ambiente", ambienteId: "" };
  return { passo: "local", ambienteId: gs[0]?.ambiente?.id || "" };
}

type Props = {
  rid: string; produtos: ProdutoEtiqueta[]; config: EstoqueConfig; ativas: EtiquetaEmitida[]; locais: LocalEstoque[];
  empresa: string; cnpj?: string | null; responsavel: string; responsavelUid?: string | null; podeOperar: boolean;
  podeEditar?: boolean; onGerenciarProdutos?: (local: LocalEstoque) => void;
  // Maquininha: a home já tem Emitir/Baixa/Painel, então o wizard começa DIRETO
  // na emissão (sem a tela "início") e o voltar do topo sai pra home (onSair).
  pularInicio?: boolean; onSair?: () => void;
  // Config da máquina: ambientes visíveis (catálogo por localização) e modo
  // produção (etiqueta pode sair com a empresa de outro restaurante).
  ambienteIds?: string[]; modoProducao?: boolean; restaurantesAlvo?: string[];
  restaurantes?: Array<{ id: string; nome: string; razaoSocial?: string | null; cnpj?: string | null }>;
};

export function EtiquetasTab(props: Props) {
  const { rid, produtos, config, ativas, locais, empresa, cnpj, responsavel, responsavelUid, podeOperar, podeEditar, onGerenciarProdutos, pularInicio, onSair, ambienteIds, modoProducao, restaurantesAlvo, restaurantes } = props;
  const [passo, setPasso] = useState<Passo>(() => (pularInicio ? calcStartEmissao(locais).passo : "inicio"));
  const [ambienteId, setAmbienteId] = useState<string>(() => (pularInicio ? calcStartEmissao(locais).ambienteId : ""));   // "" = sem ambiente
  const [local, setLocal] = useState<LocalEstoque | null>(null);
  const [produto, setProduto] = useState<ProdutoEtiqueta | null>(null);
  const [copias, setCopias] = useState(1);
  const [busca, setBusca] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const [previa, setPrevia] = useState<{ chave: string; url: string } | null>(null);
  const [ajustes, setAjustes] = useState(false);

  // Destino da impressão. No caixa (Electron) imprime direto na USB; na
  // maquininha vai pra interna; em QUALQUER OUTRO dispositivo o padrão é a FILA
  // do caixa — a etiqueta sai na impressora do CAIXA, não neste aparelho (igual
  // ao Comandas). "navegador" fica como alternativa.
  type DestinoTab = Destino | "fila-caixa";
  const destinosReais = destinosDisponiveis();
  const noCaixa = destinosReais.includes("etiqueta-local");
  const naMaquininha = destinosReais.includes("sunmi");
  const opcoesDestino: DestinoTab[] = naMaquininha ? ["sunmi"] : noCaixa ? destinosReais : ["fila-caixa", "navegador"];
  const LABEL_TAB: Record<DestinoTab, string> = { ...DESTINO_LABEL, "fila-caixa": "Impressora do caixa (sai no caixa)" };
  const [destino, setDestino] = useState<DestinoTab>(() => {
    if (naMaquininha) return "sunmi";
    if (noCaixa) return destinoSalvo();
    const d = lerLS("etiq_destino_tab");
    return d === "navegador" || d === "fila-caixa" ? d : "fila-caixa";
  });
  const escolherDestino = (d: DestinoTab) => { setDestino(d); if (noCaixa && d !== "fila-caixa") salvarDestino(d as Destino); else gravarLS("etiq_destino_tab", d); };
  const [bobinaId, setBobinaId] = useState(() => lerLS("etiq_bobina") || "58x40");
  const naSunmi = destino === "sunmi";
  const naFila = destino === "fila-caixa";
  const opcoesBobina = naSunmi ? BOBINAS.filter((x) => x.b.larguraMm <= 58) : BOBINAS;
  const bobinaAtual = opcoesBobina.find((x) => x.id === bobinaId) || opcoesBobina[0];
  const bobina = bobinaAtual.b;
  const largura = larguraPx(bobina, naSunmi);
  const aviso = naSunmi ? avisoStatus(statusSunmi()) : null;
  // Impressora local (app do caixa): lista as impressoras do PC e lembra a escolhida.
  const [impressoras, setImpressoras] = useState<string[]>([]);
  const [impressora, setImpressora] = useState(() => impressoraSalva());
  useEffect(() => { if (destino !== "etiqueta-local") return; let v = true; void listarImpressoras().then((l) => { if (v) setImpressoras(l); }); return () => { v = false; }; }, [destino]);
  // O cabeçalho (Imprimir aqui) também muda a impressora/tamanho — re-lê quando avisa.
  // Só faz sentido no caixa (é lá que esse cabeçalho existe).
  useEffect(() => {
    const h = () => { if (destinosDisponiveis().includes("etiqueta-local")) setDestino(destinoSalvo()); setBobinaId(lerLS("etiq_bobina") || "58x40"); setImpressora(impressoraSalva()); };
    window.addEventListener("etiq-impressora", h);
    return () => window.removeEventListener("etiq-impressora", h);
  }, []);

  const metodoLabel = (id?: string | null) => config.metodos.find((m) => m.id === id)?.label || "";
  // Ambientes com os equipamentos que emitem etiqueta (têm conservação definida).
  const grupos = useMemo(() => {
    let gs = agruparPorAmbiente(locais)
      .map((g) => ({ ...g, equipamentos: g.equipamentos.filter((l) => !!l.metodoConservacao) }))
      .filter((g) => g.equipamentos.length > 0);
    // Catálogo por localização: a máquina só mostra os ambientes atribuídos a ela.
    if (ambienteIds && ambienteIds.length) gs = gs.filter((g) => ambienteIds.includes(g.ambiente?.id || ""));
    return gs;
  }, [locais, ambienteIds]);
  // Modo produção: restaurante-alvo da etiqueta (empresa/CNPJ que vão impressos).
  const opcoesAlvo = useMemo(() => (restaurantes || []).filter((r) => (restaurantesAlvo || []).includes(r.id)), [restaurantes, restaurantesAlvo]);
  const [alvoId, setAlvoId] = useState("");
  useEffect(() => {
    if (modoProducao && opcoesAlvo.length && !opcoesAlvo.some((r) => r.id === alvoId)) {
      setAlvoId(opcoesAlvo.some((r) => r.id === rid) ? rid : opcoesAlvo[0].id);
    }
  }, [modoProducao, opcoesAlvo, alvoId, rid]);
  const alvo = opcoesAlvo.find((r) => r.id === alvoId) || null;
  const empresaLabel = modoProducao && alvo ? (alvo.razaoSocial || alvo.nome) : empresa;
  const cnpjLabel = modoProducao && alvo ? (alvo.cnpj ?? null) : cnpj;
  const equipamentos = useMemo(() => grupos.flatMap((g) => g.equipamentos), [grupos]);
  const grupoAtual = grupos.find((g) => (g.ambiente?.id || "") === ambienteId) || null;
  const nomeAmbiente = grupoAtual?.ambiente?.nome || (grupos.length > 1 ? "Sem ambiente" : "");
  const produtosLocal = useMemo(() => (local ? produtosDoLocal(produtos, local).sort((a, b) => a.nome.localeCompare(b.nome)) : []), [produtos, local]);
  const dias = produto && local ? diasNoLocal(produto, local) : null;

  const hoje = hojeSP();
  const urgentes = ativas.filter((e) => diasAteValidade(e.validade, hoje) <= 0).length;

  // Prévia com lote/QR de exemplo (os definitivos nascem no clique)
  const chavePrevia = produto && local ? `${produto.id}|${local.id}|${bobinaAtual.id}|${largura}|${alvoId}` : "";
  const metodoDoLocal = metodoLabel(local?.metodoConservacao);
  useEffect(() => {
    if (passo !== "confirmar" || !produto || !local || dias == null) return;
    let vivo = true;
    const agora = new Date();
    desenharEtiqueta(blocosValidade({
      produto: produto.nome, metodo: metodoDoLocal, dias, manipulacao: agora, validade: validadeDe(agora, dias),
      responsavel, lote: novoCodigoLote(agora), empresa: empresaLabel, cnpj: cnpjLabel, qr: "https://planejamento.app/e/previa",
    }), bobina, largura).then((c) => { if (vivo) setPrevia({ chave: chavePrevia, url: c.toDataURL("image/png") }); });
    return () => { vivo = false; };
  }, [passo, produto, local, dias, metodoDoLocal, responsavel, empresaLabel, cnpjLabel, bobina, largura, chavePrevia]);

  if (!podeOperar) return <div className="p-6 text-sm text-gray-500">Você não tem permissão para etiquetas.</div>;

  const ir = (p: Passo) => { setPasso(p); setMsg(null); setBusca(""); };
  const voltar = () => {
    if (passo === "confirmar") ir("produto");
    else if (passo === "produto") { setLocal(null); ir("local"); }
    else if (passo === "local" && grupos.length > 1) ir("ambiente");
    else if (onSair) onSair();
    else ir("inicio");
  };
  // Com um só ambiente (ou nenhum), pula direto para os equipamentos.
  const comecarEmissao = () => {
    if (grupos.length === 1) { setAmbienteId(grupos[0].ambiente?.id || ""); ir("local"); }
    else ir(grupos.length === 0 ? "local" : "ambiente");
  };

  async function imprimir() {
    if (!produto || !local || dias == null) return;
    setImprimindo(true); setMsg(null);
    try {
      const agora = new Date();
      const validade = validadeDe(agora, dias);
      const lote = novoCodigoLote(agora);
      const metodo = metodoLabel(local.metodoConservacao);
      // 1 registro por etiqueta física (mesmo lote, QR próprio): a baixa é pote a pote.
      const { docs, confirmacao } = gravarEmissao({
        tipo: "producao", restaurantId: rid, produtoId: produto.id, produtoNome: produto.nome,
        conservacao: local.metodoConservacao || "", conservacaoLabel: metodo, diasValidade: dias,
        localId: local.id, localNome: nomeCompleto(local, locais),
        manipuladorUid: responsavelUid || null, manipuladorNome: responsavel,
        impressaoTs: agora.toISOString(), validade: ymd(validade), lote, totalCopias: copias,
        via: naSunmi ? "sunmi" : naFila ? "fila-caixa" : "navegador",
      });
      // Não trava a cozinha esperando a rede: até 5 s; depois imprime e o registro sobe sozinho.
      const r0 = await Promise.race([
        confirmacao.then(() => "ok" as const, () => "erro" as const),
        new Promise<"lento">((res) => window.setTimeout(() => res("lento"), 5000)),
      ]);
      const extra = r0 === "erro" ? " Não consegui registrar no sistema: a baixa por QR não vai funcionar para estas."
        : r0 === "lento" ? " O registro sobe quando a internet voltar." : "";

      // Fila central: não imprime aqui — manda o pedido pro caixa imprimir.
      if (naFila) {
        try {
          await enfileirarEtiqueta({
            restaurantId: rid, produtoNome: produto.nome, metodoLabel: metodo, dias,
            manipulacaoIso: agora.toISOString(), validadeYmd: ymd(validade), responsavel,
            lote, empresa: empresaLabel, cnpj: cnpjLabel ?? null, qrTokens: docs.map((d) => d.qrToken),
            criadoPorUid: responsavelUid ?? null, criadoPorNome: responsavel,
          });
        } catch { setMsg({ ok: false, texto: "Não consegui enviar pra impressora do caixa. Verifique a internet e tente de novo." }); return; }
        setProduto(null); setCopias(1); setPasso("produto"); setBusca("");
        setMsg({ ok: r0 !== "erro", texto: `${copias > 1 ? `${copias} etiquetas` : "Etiqueta"} de ${produto.nome} enviada${copias > 1 ? "s" : ""} pra impressora do caixa.${extra}` });
        return;
      }

      const canvases = await Promise.all(docs.map((d) => desenharEtiqueta(blocosValidade({
        produto: produto.nome, metodo, dias, manipulacao: agora, validade, responsavel, lote, empresa: empresaLabel, cnpj: cnpjLabel, qr: urlEtiqueta(d.qrToken),
      }), bobina, largura)));
      const r = await imprimirEtiquetas(canvases, bobina, destino as Destino);
      if (!r.ok) { setMsg({ ok: false, texto: r.erro || "Falha ao imprimir." }); return; }
      // Volta para a lista do mesmo local: o normal é etiquetar vários itens seguidos.
      setProduto(null); setCopias(1); setPasso("produto"); setBusca("");
      setMsg({ ok: r0 !== "erro", texto: `${copias > 1 ? `${copias} etiquetas` : "Etiqueta"} de ${produto.nome} impressa${copias > 1 ? "s" : ""}. Validade ${dataBR(validade)}.${extra}` });
    } finally { setImprimindo(false); }
  }

  // ── Componentes visuais do wizard ──
  const cabecalho = (titulo: string, sub?: string) => (
    <div className="flex items-start gap-2 mb-4">
      <button type="button" onClick={voltar} className="h-10 w-10 -ml-2 shrink-0 rounded-full inline-flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Voltar"><ChevronLeft size={22} /></button>
      <div className="min-w-0 pt-1.5">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 leading-tight truncate">{titulo}</div>
        {sub && <div className="text-sm text-gray-500 truncate">{sub}</div>}
      </div>
    </div>
  );
  const avisoMsg = msg && <div className={`mb-3 text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}`}>{msg.texto}</div>;

  // ── INÍCIO ──
  if (passo === "inicio") {
    const vencidas = ativas.filter((e) => diasAteValidade(e.validade, hoje) < 0).length;
    const venceHoje = ativas.filter((e) => diasAteValidade(e.validade, hoje) === 0).length;
    const avencer = ativas.filter((e) => diasAteValidade(e.validade, hoje) === 1).length; // vence amanhã
    const stats: [string, number, string][] = [
      ["Vencidas", vencidas, "text-rose-600 dark:text-rose-400"],
      ["Vencem hoje", venceHoje, "text-amber-600 dark:text-amber-400"],
      ["Amanhã", avencer, "text-orange-600 dark:text-orange-400"],
      ["Ativas", ativas.length, "text-gray-900 dark:text-gray-100"],
    ];
    // Lista curta do que precisa de atenção (vencidas e vencendo) — a cozinha
    // vê de relance o que dar baixa antes de escolher uma ação.
    const atencao = ativas
      .map((e) => ({ e, d: diasAteValidade(e.validade, hoje) }))
      .filter((x) => x.d <= 1)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    return (
      <div className="max-w-3xl mx-auto space-y-5 py-2">
        {/* Painel: informações das etiquetas em cima */}
        <button type="button" onClick={() => ir("baixa")}
          className="w-full text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Etiquetas da cozinha</span>
            <span className="text-xs text-indigo-600 dark:text-indigo-400">Ver e dar baixa →</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {stats.map(([l, n, cls]) => (
              <div key={l}>
                <div className={`text-3xl font-bold tabular-nums ${n > 0 ? cls : "text-gray-300 dark:text-gray-600"}`}>{n}</div>
                <div className="text-[11px] text-gray-500">{l}</div>
              </div>
            ))}
          </div>
          {atencao.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-1.5">
              {atencao.map(({ e, d }) => (
                <span key={e.id} className={`text-[11px] px-2 py-0.5 rounded-full ${d < 0 ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" : d === 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" : "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"}`}>
                  {e.produtoNome} · {d < 0 ? "vencida" : d === 0 ? "hoje" : "amanhã"}
                </span>
              ))}
            </div>
          )}
        </button>

        {/* Ações: emitir e dar baixa lado a lado */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button type="button" onClick={comecarEmissao}
            className="rounded-3xl bg-indigo-600 text-white px-6 py-8 flex flex-col items-center text-center active:bg-indigo-700 shadow-sm">
            <Printer size={34} className="mb-3 opacity-90" />
            <div className="text-2xl font-bold">Emitir etiqueta</div>
            <div className="text-sm opacity-80 mt-1">Ambiente, equipamento e produto</div>
          </button>
          <button type="button" onClick={() => ir("baixa")}
            className={`rounded-3xl px-6 py-8 flex flex-col items-center text-center shadow-sm border-2 ${urgentes > 0 ? "bg-rose-100 dark:bg-rose-950/40 border-rose-400 dark:border-rose-700 active:bg-rose-200 dark:active:bg-rose-950/60" : "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900 active:bg-rose-100 dark:active:bg-rose-950/40"}`}>
            <ClipboardCheck size={34} className="mb-3 text-rose-600 dark:text-rose-400" />
            <div className="text-2xl font-bold text-rose-700 dark:text-rose-300">Dar baixa</div>
            <div className="flex items-center gap-1.5 mt-2.5 flex-wrap justify-center">
              {urgentes > 0 ? (
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-rose-600 text-white">{urgentes} vencida{urgentes > 1 ? "s" : ""} / hoje</span>
              ) : (
                <span className="text-sm text-rose-600/80 dark:text-rose-400/80">Baixa por QR ou da lista</span>
              )}
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ── DAR BAIXA ──
  if (passo === "baixa") {
    return (
      <div className="max-w-2xl mx-auto">
        {cabecalho("Dar baixa")}
        <EtiquetasEmitidas rid={rid} ativas={ativas} locais={equipamentos.map((l) => ({ id: l.id, nome: nomeCompleto(l, locais) }))} usuario={{ uid: responsavelUid, nome: responsavel }} podeOperar={podeOperar} />
      </div>
    );
  }

  // ── EMITIR 1: AMBIENTE ──
  if (passo === "ambiente") {
    return (
      <div className="max-w-2xl mx-auto">
        {cabecalho("Onde vai guardar?", "Escolha o ambiente")}
        {avisoMsg}
        <div className="grid grid-cols-2 gap-3">
          {grupos.map((g) => (
            <button key={g.ambiente?.id || "sem"} type="button" onClick={() => { setAmbienteId(g.ambiente?.id || ""); ir("local"); }}
              className={`${btnQuadrado} bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-100`}>
              <div className="text-lg font-bold leading-tight">{g.ambiente?.nome || "Sem ambiente"}</div>
              <div className="text-xs opacity-70">{g.equipamentos.length} equipamento{g.equipamentos.length > 1 ? "s" : ""}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── EMITIR 2: EQUIPAMENTO ──
  if (passo === "local") {
    const lista = grupoAtual?.equipamentos || [];
    return (
      <div className="max-w-2xl mx-auto">
        {cabecalho(nomeAmbiente || "Onde vai guardar?", "Escolha o equipamento")}
        {avisoMsg}
        {lista.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">Nenhum equipamento com conservação definida. Cadastre em Cadastro &gt; Locais.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {lista.map((l) => {
              const n = produtosDoLocal(produtos, l).length;
              return (
                <button key={l.id} type="button" disabled={n === 0 && !podeEditar} onClick={() => { setLocal(l); ir("produto"); }}
                  className={`${btnQuadrado} ${corMetodo(l.metodoConservacao)} disabled:opacity-40`}>
                  <div className="text-base font-bold leading-tight">{l.nome}</div>
                  <div className="text-xs font-semibold opacity-80">{metodoLabel(l.metodoConservacao)}</div>
                  <div className="text-[11px] opacity-70">{n === 0 ? "sem produtos" : `${n} produto${n > 1 ? "s" : ""}`}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── EMITIR 3: PRODUTO ──
  if (passo === "produto" && local) {
    const termo = busca.trim().toLowerCase();
    const lista = termo ? produtosLocal.filter((p) => p.nome.toLowerCase().includes(termo)) : produtosLocal;
    return (
      <div className="max-w-2xl mx-auto">
        {cabecalho(local.nome, [nomeAmbiente, metodoLabel(local.metodoConservacao)].filter(Boolean).join(" · "))}
        {avisoMsg}
        {produtosLocal.length > 8 && (
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto"
            className="w-full h-12 px-3 mb-3 text-base rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
        )}
        <div className="space-y-2">
          {lista.map((p) => (
            <button key={p.id} type="button" onClick={() => { setProduto(p); setCopias(1); ir("confirmar"); }}
              className="w-full flex items-center justify-between gap-3 px-4 py-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-left shadow-sm active:bg-gray-50 dark:active:bg-gray-800/50 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
              <span className="text-base font-medium text-gray-900 dark:text-gray-100 truncate">{p.nome}</span>
              <span className="text-sm text-gray-400 whitespace-nowrap">{diasNoLocal(p, local)} {diasNoLocal(p, local) === 1 ? "dia" : "dias"}</span>
            </button>
          ))}
        </div>
        {lista.length === 0 && <p className="py-8 text-center text-sm text-gray-400">Nenhum produto neste equipamento.</p>}
        {podeEditar && onGerenciarProdutos && (
          <button type="button" onClick={() => onGerenciarProdutos(local)} className="mt-4 w-full text-center text-sm text-indigo-600 dark:text-indigo-400">
            Produto não está na lista?
          </button>
        )}
      </div>
    );
  }

  // ── EMITIR 4: CONFIRMAR ──
  if (passo === "confirmar" && local && produto && dias != null) {
    const validade = validadeDe(new Date(), dias);
    return (
      <div className="max-w-2xl mx-auto">
        {cabecalho(produto.nome, `${nomeCompleto(local, locais)} · ${metodoLabel(local.metodoConservacao)}`)}
        {avisoMsg}
        {aviso && <div className="mb-3 inline-block text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-2.5 py-1.5 rounded-lg">{aviso}</div>}

        {modoProducao && opcoesAlvo.length > 1 && (
          <div className="mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Etiqueta para</div>
            <div className="grid grid-cols-2 gap-2">
              {opcoesAlvo.map((r) => (
                <button key={r.id} type="button" onClick={() => setAlvoId(r.id)}
                  className={`h-12 rounded-xl border text-sm font-semibold ${alvoId === r.id ? "bg-indigo-600 text-white border-indigo-600" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"}`}>{r.nome}</button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Validade</div>
            <div className="text-4xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{dataBR(validade).slice(0, 5)}</div>
            <div className="text-sm text-gray-500">{diaSemana(validade)} · {dias} {dias === 1 ? "dia" : "dias"}</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setCopias((c) => Math.max(1, c - 1))} className="h-12 w-12 rounded-full border border-gray-300 dark:border-gray-700 flex items-center justify-center" aria-label="Menos"><Minus size={18} /></button>
            <div className="w-10 text-center"><div className="text-2xl font-semibold tabular-nums">{copias}</div><div className="text-[10px] text-gray-400 -mt-1">{copias === 1 ? "etiqueta" : "etiquetas"}</div></div>
            <button type="button" onClick={() => setCopias((c) => Math.min(20, c + 1))} className="h-12 w-12 rounded-full border border-gray-300 dark:border-gray-700 flex items-center justify-center" aria-label="Mais"><Plus size={18} /></button>
          </div>
        </div>

        {previa && previa.chave === chavePrevia && (
          <div className="mb-5 flex justify-center">
            <img src={previa.url} alt="Prévia da etiqueta" className="bg-white rounded shadow-sm ring-1 ring-gray-200 dark:ring-gray-700" style={{ width: Math.min(360, largura * 0.85), imageRendering: "pixelated" }} />
          </div>
        )}

        {naFila && (
          <p className="mb-3 text-center text-xs text-gray-500">Vai imprimir na <b>impressora do caixa</b> (não neste aparelho), no tamanho configurado lá.</p>
        )}
        <button type="button" onClick={() => void imprimir()} disabled={imprimindo}
          className="w-full h-16 rounded-2xl bg-indigo-600 text-white text-lg font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 active:bg-indigo-700">
          <Printer size={20} /> {imprimindo ? (naFila ? "Enviando…" : "Imprimindo…") : naFila ? (copias > 1 ? `Enviar ${copias} pro caixa` : "Enviar pro caixa") : copias > 1 ? `Imprimir ${copias} etiquetas` : "Imprimir etiqueta"}
        </button>

        <button type="button" onClick={() => setAjustes(!ajustes)} className="mt-4 w-full text-xs text-gray-400 inline-flex items-center justify-center gap-1.5">
          <Settings2 size={13} /> {LABEL_TAB[destino].split(" (")[0]} · {bobinaAtual.label}
        </button>
        {ajustes && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {opcoesDestino.length > 1 && (
              <select value={destino} onChange={(e) => escolherDestino(e.target.value as DestinoTab)}
                className="h-10 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                {opcoesDestino.map((d) => <option key={d} value={d}>{LABEL_TAB[d]}</option>)}
              </select>
            )}
            <select value={bobinaAtual.id} onChange={(e) => { setBobinaId(e.target.value); gravarLS("etiq_bobina", e.target.value); }}
              className="h-10 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              {opcoesBobina.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
            {destino === "etiqueta-local" && (
              <select value={impressora} onChange={(e) => { setImpressora(e.target.value); salvarImpressora(e.target.value); }}
                className="sm:col-span-2 h-10 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                <option value="">Impressora padrão do PC</option>
                {impressoras.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            {naFila && <p className="sm:col-span-2 text-xs text-gray-500">A etiqueta é enviada pro app do caixa, que imprime sozinho na impressora de etiqueta dele. O tamanho acima é só da prévia — quem manda é o tamanho configurado no caixa.</p>}
            {destino === "navegador" && <p className="sm:col-span-2 text-xs text-gray-500">Na janela de impressão escolha a impressora de etiquetas, papel {bobina.larguraMm} × {bobina.alturaMm} mm e margens "nenhuma".</p>}
            {destino === "etiqueta-local" && <p className="sm:col-span-2 text-xs text-gray-500">Imprime direto na impressora escolhida, sem janela. Deixe no tamanho certo da etiqueta ({bobina.larguraMm} × {bobina.alturaMm} mm).</p>}
          </div>
        )}
      </div>
    );
  }

  // Estado inconsistente (ex.: produto desvinculado enquanto a tela estava aberta)
  return (
    <div className="max-w-2xl mx-auto">
      <button type="button" onClick={() => { setLocal(null); setProduto(null); ir("inicio"); }} className="text-sm text-indigo-600">Voltar ao início</button>
    </div>
  );
}
