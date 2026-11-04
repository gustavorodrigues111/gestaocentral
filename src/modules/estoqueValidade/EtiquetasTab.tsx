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

type Props = {
  rid: string; produtos: ProdutoEtiqueta[]; config: EstoqueConfig; ativas: EtiquetaEmitida[]; locais: LocalEstoque[];
  empresa: string; cnpj?: string | null; responsavel: string; responsavelUid?: string | null; podeOperar: boolean;
  podeEditar?: boolean; onGerenciarProdutos?: (local: LocalEstoque) => void;
};

export function EtiquetasTab(props: Props) {
  const { rid, produtos, config, ativas, locais, empresa, cnpj, responsavel, responsavelUid, podeOperar, podeEditar, onGerenciarProdutos } = props;
  const [passo, setPasso] = useState<Passo>("inicio");
  const [ambienteId, setAmbienteId] = useState<string>("");   // "" = sem ambiente
  const [local, setLocal] = useState<LocalEstoque | null>(null);
  const [produto, setProduto] = useState<ProdutoEtiqueta | null>(null);
  const [copias, setCopias] = useState(1);
  const [busca, setBusca] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const [previa, setPrevia] = useState<{ chave: string; url: string } | null>(null);
  const [ajustes, setAjustes] = useState(false);

  // Impressora e bobina (lembradas por aparelho)
  const [destino, setDestino] = useState<Destino>(() => destinoSalvo());
  const [bobinaId, setBobinaId] = useState(() => lerLS("etiq_bobina") || "58x40");
  const destinos = destinosDisponiveis();
  const naSunmi = destino === "sunmi";
  const opcoesBobina = naSunmi ? BOBINAS.filter((x) => x.b.larguraMm <= 58) : BOBINAS;
  const bobinaAtual = opcoesBobina.find((x) => x.id === bobinaId) || opcoesBobina[0];
  const bobina = bobinaAtual.b;
  const largura = larguraPx(bobina, naSunmi);
  const aviso = naSunmi ? avisoStatus(statusSunmi()) : null;
  // Impressora local (app do caixa): lista as impressoras do PC e lembra a escolhida.
  const [impressoras, setImpressoras] = useState<string[]>([]);
  const [impressora, setImpressora] = useState(() => impressoraSalva());
  useEffect(() => { if (destino !== "etiqueta-local") return; let v = true; void listarImpressoras().then((l) => { if (v) setImpressoras(l); }); return () => { v = false; }; }, [destino]);

  const metodoLabel = (id?: string | null) => config.metodos.find((m) => m.id === id)?.label || "";
  // Ambientes com os equipamentos que emitem etiqueta (têm conservação definida).
  const grupos = useMemo(() => agruparPorAmbiente(locais)
    .map((g) => ({ ...g, equipamentos: g.equipamentos.filter((l) => !!l.metodoConservacao) }))
    .filter((g) => g.equipamentos.length > 0), [locais]);
  const equipamentos = useMemo(() => grupos.flatMap((g) => g.equipamentos), [grupos]);
  const grupoAtual = grupos.find((g) => (g.ambiente?.id || "") === ambienteId) || null;
  const nomeAmbiente = grupoAtual?.ambiente?.nome || (grupos.length > 1 ? "Sem ambiente" : "");
  const produtosLocal = useMemo(() => (local ? produtosDoLocal(produtos, local).sort((a, b) => a.nome.localeCompare(b.nome)) : []), [produtos, local]);
  const dias = produto && local ? diasNoLocal(produto, local) : null;

  const hoje = hojeSP();
  const urgentes = ativas.filter((e) => diasAteValidade(e.validade, hoje) <= 0).length;

  // Prévia com lote/QR de exemplo (os definitivos nascem no clique)
  const chavePrevia = produto && local ? `${produto.id}|${local.id}|${bobinaAtual.id}|${largura}` : "";
  const metodoDoLocal = metodoLabel(local?.metodoConservacao);
  useEffect(() => {
    if (passo !== "confirmar" || !produto || !local || dias == null) return;
    let vivo = true;
    const agora = new Date();
    desenharEtiqueta(blocosValidade({
      produto: produto.nome, metodo: metodoDoLocal, dias, manipulacao: agora, validade: validadeDe(agora, dias),
      responsavel, lote: novoCodigoLote(agora), empresa, cnpj, qr: "https://planejamento.app/e/previa",
    }), bobina, largura).then((c) => { if (vivo) setPrevia({ chave: chavePrevia, url: c.toDataURL("image/png") }); });
    return () => { vivo = false; };
  }, [passo, produto, local, dias, metodoDoLocal, responsavel, empresa, cnpj, bobina, largura, chavePrevia]);

  if (!podeOperar) return <div className="p-6 text-sm text-gray-500">Você não tem permissão para etiquetas.</div>;

  const ir = (p: Passo) => { setPasso(p); setMsg(null); setBusca(""); };
  const voltar = () => {
    if (passo === "confirmar") ir("produto");
    else if (passo === "produto") { setLocal(null); ir("local"); }
    else if (passo === "local" && grupos.length > 1) ir("ambiente");
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
        via: naSunmi ? "sunmi" : "navegador",
      });
      // Não trava a cozinha esperando a rede: até 5 s; depois imprime e o registro sobe sozinho.
      const r0 = await Promise.race([
        confirmacao.then(() => "ok" as const, () => "erro" as const),
        new Promise<"lento">((res) => window.setTimeout(() => res("lento"), 5000)),
      ]);
      const canvases = await Promise.all(docs.map((d) => desenharEtiqueta(blocosValidade({
        produto: produto.nome, metodo, dias, manipulacao: agora, validade, responsavel, lote, empresa, cnpj, qr: urlEtiqueta(d.qrToken),
      }), bobina, largura)));
      const r = await imprimirEtiquetas(canvases, bobina, destino);
      if (!r.ok) { setMsg({ ok: false, texto: r.erro || "Falha ao imprimir." }); return; }
      const extra = r0 === "erro" ? " Não consegui registrar no sistema: a baixa por QR não vai funcionar para estas."
        : r0 === "lento" ? " O registro sobe quando a internet voltar." : "";
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
  const btnGrande = "w-full text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-5 active:bg-gray-50 dark:active:bg-gray-800 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors shadow-sm";

  // ── INÍCIO ──
  if (passo === "inicio") {
    const avencer = ativas.filter((e) => diasAteValidade(e.validade, hoje) === 1).length; // vence amanhã
    return (
      <div className="max-w-md mx-auto space-y-4 py-2">
        <button type="button" onClick={comecarEmissao}
          className="w-full rounded-3xl bg-indigo-600 text-white px-6 py-8 flex flex-col items-center text-center active:bg-indigo-700 shadow-sm">
          <Printer size={34} className="mb-3 opacity-90" />
          <div className="text-2xl font-bold">Emitir etiqueta</div>
          <div className="text-sm opacity-80 mt-1">Ambiente, equipamento e produto</div>
        </button>
        <button type="button" onClick={() => ir("baixa")}
          className={`w-full rounded-3xl px-6 py-8 flex flex-col items-center text-center shadow-sm border-2 ${urgentes > 0 ? "bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 active:bg-rose-100 dark:active:bg-rose-950/50" : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 active:bg-gray-50"}`}>
          <ClipboardCheck size={34} className={`mb-3 ${urgentes > 0 ? "text-rose-600 dark:text-rose-400" : "text-gray-700 dark:text-gray-200"}`} />
          <div className={`text-2xl font-bold ${urgentes > 0 ? "text-rose-700 dark:text-rose-300" : "text-gray-900 dark:text-gray-100"}`}>Dar baixa</div>
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap justify-center">
            {urgentes > 0 && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-rose-600 text-white">{urgentes} vencida{urgentes > 1 ? "s" : ""} / hoje</span>}
            {avencer > 0 && <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{avencer} vence amanhã</span>}
            <span className="text-xs text-gray-500 px-1">{ativas.length} ativa{ativas.length === 1 ? "" : "s"}</span>
          </div>
        </button>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {grupos.map((g) => (
            <button key={g.ambiente?.id || "sem"} type="button" onClick={() => { setAmbienteId(g.ambiente?.id || ""); ir("local"); }} className={btnGrande}>
              <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{g.ambiente?.nome || "Sem ambiente"}</div>
              <div className="text-sm text-gray-500">{g.equipamentos.length} equipamento{g.equipamentos.length > 1 ? "s" : ""}</div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {lista.map((l) => {
              const n = produtosDoLocal(produtos, l).length;
              return (
                <button key={l.id} type="button" disabled={n === 0 && !podeEditar} onClick={() => { setLocal(l); ir("produto"); }}
                  className={`${btnGrande} disabled:opacity-40`}>
                  <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{l.nome}</div>
                  <div className="text-sm text-gray-500">{metodoLabel(l.metodoConservacao)} · {n === 0 ? "sem produtos" : `${n} produto${n > 1 ? "s" : ""}`}</div>
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
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {lista.map((p) => (
            <button key={p.id} type="button" onClick={() => { setProduto(p); setCopias(1); ir("confirmar"); }}
              className="w-full flex items-center justify-between gap-3 py-4 text-left active:bg-gray-50 dark:active:bg-gray-800/50">
              <span className="text-base text-gray-900 dark:text-gray-100 truncate">{p.nome}</span>
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
        {aviso && <div className="mb-3 text-sm text-amber-700 dark:text-amber-300">{aviso}</div>}

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
            <img src={previa.url} alt="Prévia da etiqueta" className="bg-white rounded shadow-sm ring-1 ring-gray-200 dark:ring-gray-700" style={{ width: Math.min(280, largura * 0.62), imageRendering: "pixelated" }} />
          </div>
        )}

        <button type="button" onClick={() => void imprimir()} disabled={imprimindo}
          className="w-full h-16 rounded-2xl bg-indigo-600 text-white text-lg font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 active:bg-indigo-700">
          <Printer size={20} /> {imprimindo ? "Imprimindo…" : copias > 1 ? `Imprimir ${copias} etiquetas` : "Imprimir etiqueta"}
        </button>

        <button type="button" onClick={() => setAjustes(!ajustes)} className="mt-4 w-full text-xs text-gray-400 inline-flex items-center justify-center gap-1.5">
          <Settings2 size={13} /> {DESTINO_LABEL[destino].split(" (")[0]} · {bobinaAtual.label}
        </button>
        {ajustes && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {destinos.length > 1 && (
              <select value={destino} onChange={(e) => { const d = e.target.value as Destino; setDestino(d); salvarDestino(d); }}
                className="h-10 px-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                {destinos.map((d) => <option key={d} value={d}>{DESTINO_LABEL[d]}</option>)}
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
