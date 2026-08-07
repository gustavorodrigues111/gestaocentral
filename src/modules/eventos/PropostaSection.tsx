import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where, getDocs } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import type {
  EspacoEvento, LeadEvento, LinhaProposta, PacoteEvento, ParcelaProposta, PropostaEvento,
} from "../../core/types";
import { linhaPropostaTotal, pacotePrecoLabel, pacoteValorTotal } from "../../core/types";
import { criarProposta, montarMensagemProposta, parcelasDefaultPF, parcelasDefaultPJ } from "./propostaHelpers";
import { registrarTratativa } from "./tratativas";
import { pickDriveFile } from "../../core/google/drivePicker";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useAbrirWhatsapp } from "../../core/whatsapp/roteios";
import { PACOTES_LOBOZO_PP, LOCACAO_LOBOZO, janelaLobozo, menuLobozoPorChave, BEBIDAS_LOBOZO } from "./VitrineLobozo";

type Props = {
  lead: LeadEvento;
  pacotes: PacoteEvento[];
  podeEditar: boolean;
  meId: string;
  meNome: string;
  onAvancarStatus?: () => Promise<void>;
};

// ── Dinheiro: formatação BR (R$ 1.234,56) + máscara "centavos da direita" ──
const fmtBRL = (n: number) => (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function maskMoney(raw: string): string {
  const neg = /^\s*-/.test(raw);
  const d = raw.replace(/\D/g, "");
  if (!d) return neg ? "-" : "";
  return (neg ? "-" : "") + (parseInt(d, 10) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseMoney(masked: string): number {
  const neg = /^\s*-/.test(masked);
  const d = (masked || "").replace(/\D/g, "");
  const v = d ? parseInt(d, 10) / 100 : 0;
  return neg ? -v : v;
}
// Input de dinheiro: texto (sem setinha), máscara, R$ à esquerda opcional.
function MoneyInput({ value, onChange, className, permiteNegativo, autoFocus }: {
  value: number; onChange: (n: number) => void; className?: string; permiteNegativo?: boolean; autoFocus?: boolean;
}) {
  const fmt = (n: number) => n ? (permiteNegativo && n < 0 ? "-" : "") + Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  const [txt, setTxt] = useState(fmt(value));
  useEffect(() => { setTxt((prev) => (parseMoney(prev) === value ? prev : fmt(value))); /* eslint-disable-next-line */ }, [value]);
  return (
    <input type="text" inputMode="numeric" value={txt} autoFocus={autoFocus}
      onChange={(e) => { let raw = e.target.value; if (!permiteNegativo) raw = raw.replace(/-/g, ""); const m = maskMoney(raw); setTxt(m); onChange(parseMoney(m)); }}
      placeholder="0,00" className={className} />
  );
}

const novaLinha = (parcial?: Partial<LinhaProposta>): LinhaProposta => ({
  id: `ln_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  descricao: parcial?.descricao ?? "",
  tipo: parcial?.tipo ?? "por_pessoa",
  valor: parcial?.valor ?? 0,
  numPessoas: parcial?.numPessoas,
});

export function PropostaSection({ lead, pacotes, podeEditar, meId, meNome, onAvancarStatus }: Props) {
  const [propostas, setPropostas] = useState<PropostaEvento[]>([]);
  const [espaco, setEspaco] = useState<EspacoEvento | null>(null);
  const [criando, setCriando] = useState(false);
  const [pacoteSelecionado, setPacoteSelecionado] = useState<string>(lead.pacoteSugeridoId || "");
  const [pax, setPax] = useState<number>(lead.numConvidados);
  const [linhas, setLinhas] = useState<LinhaProposta[]>([]);
  const [arredondamento, setArredondamento] = useState(0);
  const [parcelasEdit, setParcelasEdit] = useState<ParcelaProposta[]>([]); // vazio = 50/50 padrão
  const [montando, setMontando] = useState(false); // editor aberto pra nova versão
  const [pagando, setPagando] = useState<{ p: PropostaEvento; idx: number } | null>(null);
  const [gerandoPdf, setGerandoPdf] = useState<string>(""); // id da proposta gerando
  const { restaurants } = useRestaurant();
  const abrirWhatsapp = useAbrirWhatsapp();
  const restauranteNome = restaurants.find((r) => r.id === lead.restaurantId)?.nome || "";
  const ehLobozoProp = restauranteNome.toLowerCase().includes("lobo");
  const janelaLob = janelaLobozo(lead.dataDesejada);
  // Data/período/horário do evento SEMPRE do lead atual (fatos do evento) —
  // pra card e PDF refletirem edições feitas depois da proposta.
  const eventoLinha = (() => {
    if (!lead.dataDesejada) return "";
    const d = new Date(lead.dataDesejada + "T12:00:00");
    const dataBR = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    const dur = lead.duracaoEstimadaHoras || 0;
    const durTxt = dur ? (Number.isInteger(dur) ? `${dur}h` : `${Math.floor(dur)}h${String(Math.round((dur % 1) * 60)).padStart(2, "0")}`) : "";
    const hora = lead.horaInicio ? `${lead.horaInicio}${lead.horaFim ? `–${lead.horaFim}` : ""}` : "";
    return [dataBR, lead.slot === "almoco" ? "almoço" : "jantar", hora, durTxt].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    const q = query(collection(db, "propostasEvento"), where("leadId", "==", lead.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as PropostaEvento);
      list.sort((a, b) => b.versao - a.versao);
      setPropostas(list);
    });
    return () => unsub();
  }, [lead.id]);

  useEffect(() => {
    (async () => {
      const q = query(collection(db, "espacosEvento"), where("restaurantId", "==", lead.restaurantId));
      const r = await getDocs(q);
      const ativos = r.docs.map(d => ({ id: d.id, ...d.data() }) as EspacoEvento).filter(e => e.ativo);
      setEspaco(ativos[0] || null);
    })();
  }, [lead.restaurantId]);

  const propostaAtual = propostas[0] || null;
  const pacoteAtual = useMemo(
    () => pacoteSelecionado ? pacotes.find(p => p.id === pacoteSelecionado) : null,
    [pacoteSelecionado, pacotes],
  );
  const pacotesAtivos = useMemo(() => pacotes.filter(p => p.ativo), [pacotes]);

  const baseDoPacote = useMemo(
    () => (pacoteAtual ? pacoteValorTotal(pacoteAtual, pax) : 0),
    [pacoteAtual, pax],
  );
  const totalLinhas = useMemo(
    () => linhas.reduce((s, l) => s + linhaPropostaTotal(l), 0),
    [linhas],
  );
  const totalPreview = Math.round((baseDoPacote + totalLinhas) * 100) / 100;
  const totalFinal = Math.round((totalPreview + arredondamento) * 100) / 100;

  const parcelasDefault = (total: number): ParcelaProposta[] =>
    lead.cliente.tipoPessoa === "PJ" ? parcelasDefaultPJ(total) : parcelasDefaultPF(total, lead.dataDesejada);

  // Orçamento PRÉ-MONTADO a partir do que o cliente pediu no site (Lobozó):
  // pacote por pessoa (menu+bebidas no preço da data) + locação do espaço.
  function linhasDoLobozo(): LinhaProposta[] {
    const lob = lead.lobozo;
    if (!lob) return [];
    const out: LinhaProposta[] = [];
    if (lead.modeloEvento === "pacote_por_pessoa" && lob.menu && lob.bebidas) {
      const preco = PACOTES_LOBOZO_PP[janelaLob][lob.menu][lob.bebidas];
      out.push(novaLinha({ descricao: `Pacote ${lob.menu === "sequencia" ? "Sequência" : "Aberto"} · ${lob.bebidas === "alcohol" ? "c/ álcool" : "s/ álcool"}`, tipo: "por_pessoa", valor: preco, numPessoas: lead.numConvidados }));
    }
    if (lob.espaco) {
      const valorLoc = lob.espaco === "laje" ? 1500 : (lead.slot === "almoco" || janelaLob === "sex-sab" ? 3500 : 1500);
      out.push(novaLinha({ descricao: `Locação ${lob.espaco === "laje" ? "Laje" : "Salão"}`, tipo: "fixo", valor: valorLoc }));
    }
    return out;
  }
  // Aplica o pré-montado uma vez, quando o lead ainda não tem proposta.
  const preMontadoRef = useRef(false);
  const temPreMontagem = ehLobozoProp && !!lead.lobozo && (!!lead.lobozo.espaco || (!!lead.lobozo.menu && !!lead.lobozo.bebidas));
  useEffect(() => {
    if (preMontadoRef.current) return;
    if (propostas.length > 0) return;
    if (!temPreMontagem) return;
    const ls = linhasDoLobozo();
    if (ls.length) { setLinhas(ls); preMontadoRef.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propostas.length, temPreMontagem]);

  // Abre o editor pré-preenchido a partir da proposta atual (pra fazer a v2).
  function iniciarNovaVersao() {
    const p = propostaAtual;
    setPacoteSelecionado(p?.pacoteBaseId || "");
    setPax(p?.numConvidados || lead.numConvidados);
    setLinhas((p?.linhas || []).map(l => ({ ...l, id: novaLinha().id })));
    setArredondamento(p?.arredondamento || 0);
    setParcelasEdit((p?.parcelas || []).map(pc => ({
      ordem: pc.ordem, descricao: pc.descricao, valor: pc.valor, vencimentoEm: pc.vencimentoEm,
    })));
    setMontando(true);
  }

  function setLinha(id: string, patch: Partial<LinhaProposta>) {
    setLinhas(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
  }
  function addLinha(preset?: Partial<LinhaProposta>) {
    setLinhas(prev => [...prev, novaLinha(preset)]);
  }
  function delLinha(id: string) {
    setLinhas(prev => prev.filter(l => l.id !== id));
  }

  async function gerarProposta() {
    if (!podeEditar) return;
    const pacote = pacoteSelecionado ? pacotes.find(p => p.id === pacoteSelecionado) : null;
    // Normaliza numPessoas das linhas por_pessoa (default = pax).
    const linhasFinais = linhas
      .filter(l => l.descricao.trim() || l.valor)
      .map(l => l.tipo === "por_pessoa" ? { ...l, numPessoas: l.numPessoas ?? pax } : { ...l, numPessoas: undefined });
    setCriando(true);
    try {
      await criarProposta({
        lead,
        pacote: pacote || null,
        espaco,
        numConvidados: pax,
        linhas: linhasFinais,
        arredondamento,
        parcelas: parcelasEdit.length > 0 ? parcelasEdit : undefined,
        criadoPorId: meId,
      });
      setLinhas([]);
      setArredondamento(0);
      setParcelasEdit([]);
      setMontando(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao gerar proposta");
    } finally {
      setCriando(false);
    }
  }

  async function enviarWhatsApp(p: PropostaEvento) {
    const restaurantNome = espaco?.nome || "nosso espaço";
    const texto = montarMensagemProposta(p, lead.cliente.nome, restaurantNome);
    // Abre o WhatsApp INTERNO no número de "Eventos" com a proposta pronta.
    const ok = await abrirWhatsapp(lead.restaurantId, "eventos", lead.cliente.whatsapp, lead.cliente.nome, texto);
    if (!ok) return;
    await updateDoc(doc(db, "propostasEvento", p.id), sanitizeForFirestore({
      enviadaEm: new Date().toISOString(),
      enviadaPor: meId,
      enviadaPorNome: meNome,
    }));
    // Registra no log de tratativas (auto).
    await registrarTratativa({
      restaurantId: lead.restaurantId, leadId: lead.id,
      texto: `Proposta v${p.versao} enviada — ${fmtBRL(p.precoTotal)}`,
      canal: "whatsapp", porId: meId, porNome: meNome,
      manual: false, templateKey: "envio_proposta",
    }).catch(() => { /* log não bloqueia o envio */ });
    if (lead.status === "novo" || lead.status === "qualificado") {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
        status: "proposta_enviada",
        updatedAt: new Date().toISOString(),
      }));
    }
  }

  // Gera o PDF do orçamento (visual do Lobozó) a partir da proposta e salva a URL.
  async function gerarPdf(p: PropostaEvento) {
    if (gerandoPdf) return;
    setGerandoPdf(p.id);
    try {
      const fmt = (n: number) => fmtBRL(n);
      const somaLinhas = (p.linhas || []).reduce((s, l) => s + linhaPropostaTotal(l), 0);
      const base = Math.round((p.precoTotal - somaLinhas - (p.arredondamento || 0)) * 100) / 100;
      const itens: { descricao: string; valor: string }[] = [];
      if (base > 0.005) itens.push({ descricao: "Pacote base", valor: fmt(base) });
      for (const l of p.linhas || []) {
        const desc = l.tipo === "por_pessoa"
          ? `${l.descricao} (${fmt(l.valor)}/pessoa × ${l.numPessoas || p.numConvidados})`
          : l.descricao;
        itens.push({ descricao: desc, valor: fmt(linhaPropostaTotal(l)) });
      }
      const arr = p.arredondamento || 0;
      if (arr !== 0) {
        itens.push({ descricao: arr < 0 ? "Desconto" : "Ajuste", valor: `${arr < 0 ? "− " : "+ "}${fmt(Math.abs(arr))}` });
      }
      const condicoes: string[] = [];
      if (p.parcelas?.length) condicoes.push("Pagamento: " + p.parcelas.map((pc) => `${pc.descricao} ${fmt(pc.valor)}`).join(" · "));
      if (p.politicaCancelamentoTexto) condicoes.push(p.politicaCancelamentoTexto);
      condicoes.push("Orçamento sujeito à confirmação de disponibilidade.");

      // Data/período/horário são FATOS do evento → vêm do LEAD atual (não do
      // snapshot congelado da proposta), pra refletir edições feitas depois.
      const dataYmd = lead.dataDesejada || p.dataEvento;
      const dataEv = new Date(dataYmd + "T12:00:00");
      const dataBR = `${String(dataEv.getDate()).padStart(2, "0")}/${String(dataEv.getMonth() + 1).padStart(2, "0")}/${dataEv.getFullYear()}`;
      const slotEv = lead.slot || p.slot;
      const horaIni = lead.horaInicio || p.horaInicio;
      const horaFimEv = lead.horaFim || "";
      const duracaoEv = lead.duracaoEstimadaHoras || p.duracaoHoras;
      const duracaoTxt = duracaoEv ? (Number.isInteger(duracaoEv) ? `${duracaoEv}h` : `${Math.floor(duracaoEv)}h${String(Math.round((duracaoEv % 1) * 60)).padStart(2, "0")}`) : "";
      // Detalhamento do pacote do site (Lobozó): cardápio do menu + bebidas.
      // Menu/bebidas vêm do lead.lobozo; se faltar (lead antigo/manual), detecta
      // pela linha "Pacote Sequência/Aberto · c/ álcool" da própria proposta.
      let menuKey: "sequencia" | "aberto" | undefined = ehLobozoProp ? lead.lobozo?.menu : undefined;
      let bebKey: "soft" | "alcohol" | undefined = ehLobozoProp ? lead.lobozo?.bebidas : undefined;
      if (ehLobozoProp && !menuKey) {
        const lp = (p.linhas || []).find((l) => /pacote/i.test(l.descricao) && /(sequ|aberto)/i.test(l.descricao));
        if (lp) {
          menuKey = /sequ/i.test(lp.descricao) ? "sequencia" : "aberto";
          bebKey = /(c\/\s*álcool|com\s*álcool|alco)/i.test(lp.descricao) ? "alcohol" : "soft";
        }
      }
      const menu = menuKey ? menuLobozoPorChave(menuKey) : null;
      const cardapio = menu ? { titulo: menu.nome, tagline: menu.tagline, blocos: menu.blocos.map((b) => ({ label: b.label, itens: b.itens })) } : undefined;
      const bebidas = menu && bebKey ? {
        soft: { title: BEBIDAS_LOBOZO.soft.title, items: BEBIDAS_LOBOZO.soft.items },
        ...(bebKey === "alcohol" ? { alcohol: BEBIDAS_LOBOZO.alcohol } : {}),
        note: BEBIDAS_LOBOZO.note,
      } : undefined;
      const dados = {
        restauranteNome,
        clienteNome: lead.cliente.nome,
        dataEvento: `${dataBR} · ${slotEv === "almoco" ? "almoço" : "jantar"}`,
        horario: horaIni ? `${horaIni}${horaFimEv ? `–${horaFimEv}` : ""}${duracaoTxt ? ` · ${duracaoTxt}` : ""}` : duracaoTxt,
        numConvidados: p.numConvidados,
        espaco: espaco?.nome || undefined,
        formato: lead.modeloEvento === "locacao_consumo_livre" ? "Locação (consumo em comanda)" : "Pacote por pessoa",
        linhas: itens,
        total: fmt(p.precoTotal),
        precoPorPessoa: p.precoPorPessoa > 0 ? `${fmt(p.precoPorPessoa)} por pessoa` : undefined,
        condicoes,
        cardapio,
        bebidas,
        inclusos: p.inclusos && p.inclusos.length ? p.inclusos : undefined,
        observacoes: p.observacoes || undefined,
        geradoEm: new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
      };
      const resp = await fetch("/api/orcamento-pdf", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ rid: lead.restaurantId, dados }),
      });
      const j = (await resp.json()) as { pdfUrl?: string; error?: string };
      if (!resp.ok || !j.pdfUrl) throw new Error(j.error || `HTTP ${resp.status}`);
      await updateDoc(doc(db, "propostasEvento", p.id), sanitizeForFirestore({ pdfUrl: j.pdfUrl })).catch(() => {});
      window.open(j.pdfUrl, "_blank");
    } catch (e) {
      alert("Não consegui gerar o PDF: " + (e instanceof Error ? e.message : ""));
    } finally {
      setGerandoPdf("");
    }
  }

  function registrarPagamento(p: PropostaEvento, parcelaIdx: number) {
    if (!podeEditar) return;
    const parcela = p.parcelas[parcelaIdx];
    if (!parcela || parcela.pagaEm) return;
    setPagando({ p, idx: parcelaIdx });
  }

  async function confirmarPagamento(p: PropostaEvento, parcelaIdx: number, comprovanteUrl?: string) {
    if (!podeEditar) return;
    const now = new Date().toISOString();
    const novasParcelas: ParcelaProposta[] = p.parcelas.map((par, i) =>
      i === parcelaIdx ? { ...par, pagaEm: now, pagaPor: meId, pagaPorNome: meNome, comprovanteUrl: comprovanteUrl || par.comprovanteUrl } : par);
    await updateDoc(doc(db, "propostasEvento", p.id), sanitizeForFirestore({ parcelas: novasParcelas }));
    setPagando(null);

    const todasPagas = novasParcelas.every(par => !!par.pagaEm);
    const algumaPaga = novasParcelas.some(par => !!par.pagaEm);
    if (todasPagas && lead.status !== "confirmado" && lead.status !== "realizado") {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({ status: "confirmado", updatedAt: now }));
    } else if (algumaPaga && lead.status === "proposta_enviada") {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({ status: "sinal_recebido", updatedAt: now }));
    }
    void onAvancarStatus;
  }

  async function desmarcarPagamento(p: PropostaEvento, parcelaIdx: number) {
    if (!podeEditar) return;
    const ok = confirm("Desmarcar este pagamento? (não muda status do lead automaticamente)");
    if (!ok) return;
    const novasParcelas: ParcelaProposta[] = p.parcelas.map((par, i) =>
      i === parcelaIdx ? { ...par, pagaEm: undefined, pagaPor: undefined, pagaPorNome: undefined } : par);
    await updateDoc(doc(db, "propostasEvento", p.id), sanitizeForFirestore({ parcelas: novasParcelas }));
  }

  const editorAberto = propostas.length === 0 || montando;

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">💼 Proposta</div>

      {temPreMontagem && propostas.length === 0 && (
        <div className="mb-2 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-900/15 px-2.5 py-1.5 text-[12px] text-emerald-800 dark:text-emerald-300">
          ✨ Orçamento <strong>pré-montado</strong> com o que o cliente pediu no site. Revise (desconto, taxa, valores) e clique em <strong>Gerar proposta</strong>.
        </div>
      )}

      {/* Propostas existentes */}
      {propostas.length > 0 && (
        <div className="space-y-3 mb-3">
          {propostaAtual && (
            <PropostaCard
              proposta={propostaAtual} destaque podeEditar={podeEditar}
              onEnviar={() => enviarWhatsApp(propostaAtual)}
              onGerarPdf={() => gerarPdf(propostaAtual)}
              gerandoPdf={gerandoPdf === propostaAtual.id}
              eventoLinha={eventoLinha}
              onRegistrarPagamento={(i) => registrarPagamento(propostaAtual, i)}
              onDesmarcarPagamento={(i) => desmarcarPagamento(propostaAtual, i)}
            />
          )}
          {propostas.length > 1 && (
            <details className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-400">
                Versões anteriores ({propostas.length - 1})
              </summary>
              <div className="mt-2 space-y-2">
                {propostas.slice(1).map(p => (
                  <PropostaCard
                    key={p.id} proposta={p} destaque={false} podeEditar={false}
                    onEnviar={() => enviarWhatsApp(p)}
                    onGerarPdf={() => gerarPdf(p)}
                    gerandoPdf={gerandoPdf === p.id}
                    eventoLinha={eventoLinha}
                    onRegistrarPagamento={() => { /* só na atual */ }}
                    onDesmarcarPagamento={() => { /* só na atual */ }}
                  />
                ))}
              </div>
            </details>
          )}
          {podeEditar && !montando && (
            <button
              type="button"
              onClick={iniciarNovaVersao}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              + Nova versão da proposta (edita a atual)
            </button>
          )}
        </div>
      )}

      {/* Editor de proposta (v1 ou nova versão) */}
      {podeEditar && editorAberto && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
          {propostas.length === 0 && (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Monte a proposta por linhas — locação fixa, comidas e bebidas por pessoa, etc.
              Um pacote-base é opcional (traz cardápios e um valor de partida).
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <label className="text-[11px] uppercase font-bold text-gray-500">Pacote-base (opcional)</label>
              <select
                value={pacoteSelecionado}
                onChange={(e) => setPacoteSelecionado(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                <option value="">— Personalizado (proposta livre) —</option>
                {pacotesAtivos.map(p => (
                  <option key={p.id} value={p.id}>{p.nome} · {pacotePrecoLabel(p)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase font-bold text-gray-500">Nº convidados</label>
              <input
                type="text" inputMode="numeric" value={pax || ""}
                onChange={(e) => setPax(parseInt(e.target.value.replace(/\D/g, ""), 10) || 0)}
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          </div>

          {baseDoPacote > 0 && (
            <div className="text-xs text-gray-600 dark:text-gray-400">
              Base do pacote: <strong className="tabular-nums">{fmtBRL(baseDoPacote)}</strong>
              <span className="text-gray-400"> (as linhas abaixo somam a isto)</span>
            </div>
          )}

          {/* Editor de linhas */}
          <div className="space-y-2">
            <div className="text-[11px] uppercase font-bold text-gray-500">Linhas da proposta</div>
            {linhas.length === 0 && (
              <p className="text-xs text-gray-500 italic">Nenhuma linha ainda. Adicione abaixo.</p>
            )}
            {linhas.map(l => {
              const tot = linhaPropostaTotal(l);
              return (
                <div key={l.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      value={l.descricao}
                      onChange={(e) => setLinha(l.id, { descricao: e.target.value })}
                      placeholder="Descrição (ex: Locação, Comidas, Bebidas alcoólicas)"
                      className="flex-1 px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                    />
                    <button onClick={() => delLinha(l.id)} className="text-rose-500 hover:text-rose-700 text-sm px-1" title="Remover linha">✕</button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={l.tipo}
                      onChange={(e) => setLinha(l.id, { tipo: e.target.value as LinhaProposta["tipo"] })}
                      className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
                    >
                      <option value="fixo">Valor fixo</option>
                      <option value="por_pessoa">Por pessoa</option>
                    </select>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-xs text-gray-400">R$</span>
                      <MoneyInput value={l.valor} onChange={(v) => setLinha(l.id, { valor: v })}
                        className="w-28 px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right tabular-nums" />
                    </span>
                    {l.tipo === "por_pessoa" && (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-xs text-gray-400">×</span>
                        <input
                          type="text" inputMode="numeric" value={l.numPessoas ?? pax}
                          onChange={(e) => setLinha(l.id, { numPessoas: parseInt(e.target.value.replace(/\D/g, ""), 10) || 0 })}
                          className="w-16 px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right"
                        />
                        <span className="text-xs text-gray-400">pessoas</span>
                      </span>
                    )}
                    <span className="ml-auto text-sm font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      = {fmtBRL(tot)}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => addLinha({ descricao: "Locação", tipo: "fixo" })} className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">+ Locação (fixo)</button>
              <button onClick={() => addLinha({ descricao: "Comidas", tipo: "por_pessoa", numPessoas: pax })} className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">+ Comidas (por pessoa)</button>
              <button onClick={() => addLinha({ descricao: "Bebidas", tipo: "por_pessoa", numPessoas: pax })} className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">+ Bebidas (por pessoa)</button>
              <button onClick={() => addLinha()} className="text-xs px-2 py-1 rounded-md border border-dashed border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">+ Linha livre</button>
            </div>

            {/* Presets do cardápio de eventos do site (Lobozó) — mesma fonte da vitrine */}
            {ehLobozoProp && (
              <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 p-2">
                <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300 mb-1.5">
                  🍽️ Puxar do cardápio de eventos do site · {janelaLob === "sex-sab" ? "Sexta/Sábado" : "Domingo a Quinta"}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(["sequencia", "aberto"] as const).flatMap((menu) => (["soft", "alcohol"] as const).map((dr) => {
                    const preco = PACOTES_LOBOZO_PP[janelaLob][menu][dr];
                    const label = `${menu === "sequencia" ? "Sequência" : "Aberto"} · ${dr === "alcohol" ? "c/ álcool" : "s/ álcool"}`;
                    return (
                      <button key={menu + dr} onClick={() => addLinha({ descricao: `Pacote ${label}`, tipo: "por_pessoa", valor: preco, numPessoas: pax })}
                        className="text-xs px-2 py-1 rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                        + {label} <span className="text-amber-700 dark:text-amber-400 font-semibold">R$ {preco.toLocaleString("pt-BR")}/p</span>
                      </button>
                    );
                  }))}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {LOCACAO_LOBOZO.map((l) => (
                    <button key={l.nome} onClick={() => addLinha({ descricao: l.nome, tipo: "fixo", valor: l.valor })}
                      className="text-xs px-2 py-1 rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                      + {l.nome} <span className="text-amber-700 dark:text-amber-400 font-semibold">R$ {l.valor.toLocaleString("pt-BR")}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Arredondamento */}
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-2.5 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="text-gray-500">Subtotal:</span>
              <span className="tabular-nums">{fmtBRL(totalPreview)}</span>
              <span className="text-gray-400 mx-1">·</span>
              <span className="text-gray-500">Ajuste/desconto:</span>
              <span className="inline-flex items-center gap-1">
                <span className="text-xs text-gray-400">R$</span>
                <MoneyInput value={arredondamento} onChange={(v) => setArredondamento(v)} permiteNegativo
                  className="w-28 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right tabular-nums" />
              </span>
              <button type="button" onClick={() => setArredondamento(Math.round((Math.ceil(totalPreview / 10) * 10 - totalPreview) * 100) / 100)}
                className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">↑ dezena</button>
              <button type="button" onClick={() => setArredondamento(Math.round((Math.ceil(totalPreview / 100) * 100 - totalPreview) * 100) / 100)}
                className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">↑ centena</button>
              {arredondamento !== 0 && <button type="button" onClick={() => setArredondamento(0)} className="text-[11px] text-rose-500 hover:underline">zerar</button>}
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Total final: </span>
              <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">{fmtBRL(totalFinal)}</strong>
            </div>
          </div>

          {/* Pagamento (sinal/saldo editável) */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase font-bold text-gray-500">Pagamento · <span className="normal-case font-normal text-gray-400">valor e data de cada parcela são livres</span></span>
              {parcelasEdit.length === 0 ? (
                <button type="button" onClick={() => setParcelasEdit(parcelasDefault(totalFinal))} className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">✏️ Editar valores e datas</button>
              ) : (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setParcelasEdit(parcelasDefault(totalFinal))} className="text-[11px] text-gray-500 hover:underline" title="Recalcula em 50% sinal + 50% saldo">↻ 50/50</button>
                  <button type="button" onClick={() => setParcelasEdit(prev => [...prev, { ordem: prev.length + 1, descricao: "", valor: 0 }])} className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">+ parcela</button>
                </div>
              )}
            </div>
            {parcelasEdit.length === 0 ? (
              <button type="button" onClick={() => setParcelasEdit(parcelasDefault(totalFinal))} className="w-full text-left text-xs text-gray-500 mt-1 hover:text-indigo-600 dark:hover:text-indigo-400">
                {lead.cliente.tipoPessoa === "PJ" ? "Faturamento (contrato + NF) — parcela única. Toque pra editar." : "Começa em 50% sinal + 50% saldo (1 dia antes). Toque pra ajustar valores e datas de cada parcela →"}
              </button>
            ) : (
              <div className="mt-2 space-y-1.5">
                {parcelasEdit.map((pc, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <input value={pc.descricao} onChange={(e) => setParcelasEdit(prev => prev.map((x, j) => j === i ? { ...x, descricao: e.target.value } : x))}
                      placeholder="Descrição (ex: Sinal 40%)" className="flex-1 min-w-[140px] px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                    <span className="inline-flex items-center gap-1"><span className="text-xs text-gray-400">R$</span>
                      <MoneyInput value={pc.valor} onChange={(v) => setParcelasEdit(prev => prev.map((x, j) => j === i ? { ...x, valor: v } : x))}
                        className="w-28 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right tabular-nums" /></span>
                    <input type="date" value={pc.vencimentoEm || ""} onChange={(e) => setParcelasEdit(prev => prev.map((x, j) => j === i ? { ...x, vencimentoEm: e.target.value || undefined } : x))}
                      className="px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                    <button type="button" onClick={() => setParcelasEdit(prev => prev.filter((_, j) => j !== i))} className="text-rose-500 hover:text-rose-700 text-sm">✕</button>
                  </div>
                ))}
                {(() => {
                  const soma = Math.round(parcelasEdit.reduce((s, p) => s + (p.valor || 0), 0) * 100) / 100;
                  return Math.abs(soma - totalFinal) > 0.01 ? (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400">⚠ Soma das parcelas {fmtBRL(soma)} ≠ total {fmtBRL(totalFinal)}</div>
                  ) : <div className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ soma bate com o total</div>;
                })()}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-800">
            <div className="text-sm">
              <span className="text-gray-500">Total: </span>
              <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">{fmtBRL(totalFinal)}</strong>
            </div>
            <div className="flex gap-2">
              {montando && (
                <Button size="sm" variant="secondary" onClick={() => { setMontando(false); setLinhas([]); setArredondamento(0); setParcelasEdit([]); }}>Cancelar</Button>
              )}
              <Button onClick={gerarProposta} disabled={criando || totalFinal <= 0}>
                {criando ? "Gerando…" : propostas.length === 0 ? "💼 Gerar proposta v1" : "💼 Gerar nova versão"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pagando && (
        <RegistrarPagamentoModal
          parcela={pagando.p.parcelas[pagando.idx]}
          onClose={() => setPagando(null)}
          onConfirmar={(comprovanteUrl) => confirmarPagamento(pagando.p, pagando.idx, comprovanteUrl)}
        />
      )}
    </div>
  );
}

function RegistrarPagamentoModal({ parcela, onClose, onConfirmar }: {
  parcela: ParcelaProposta;
  onClose: () => void;
  onConfirmar: (comprovanteUrl?: string) => void;
}) {
  const [comp, setComp] = useState<{ url: string; nome: string } | null>(
    parcela.comprovanteUrl ? { url: parcela.comprovanteUrl, nome: "comprovante atual" } : null,
  );
  const [salvando, setSalvando] = useState(false);
  async function escolher() {
    try {
      const f = await pickDriveFile("Selecione o comprovante");
      if (f) setComp({ url: `https://drive.google.com/open?id=${f.id}`, nome: f.name });
    } catch (e) { alert("Não foi possível abrir o Drive: " + String(e)); }
  }
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Registrar pagamento</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{parcela.descricao} — <strong>{fmtBRL(parcela.valor)}</strong></p>
        <div className="mt-3">
          <div className="text-xs text-gray-500 mb-1">Comprovante (opcional)</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="secondary" onClick={escolher}>📎 Anexar do Drive</Button>
            {comp && <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">✓ {comp.nome}</span>}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button disabled={salvando} onClick={() => { setSalvando(true); onConfirmar(comp?.url); }}>
            {salvando ? "Salvando…" : "Confirmar recebimento"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PropostaCard({
  proposta, destaque, podeEditar, onEnviar, onGerarPdf, gerandoPdf, eventoLinha, onRegistrarPagamento, onDesmarcarPagamento,
}: {
  proposta: PropostaEvento;
  destaque: boolean;
  podeEditar: boolean;
  onEnviar: () => void;
  onGerarPdf: () => void;
  gerandoPdf: boolean;
  eventoLinha?: string;
  onRegistrarPagamento: (idx: number) => void;
  onDesmarcarPagamento: (idx: number) => void;
}) {
  const dataEv = new Date(proposta.dataEvento + "T12:00:00");
  const dataBR = `${String(dataEv.getDate()).padStart(2, "0")}/${String(dataEv.getMonth() + 1).padStart(2, "0")}/${dataEv.getFullYear()}`;
  return (
    <div className={`rounded-lg p-3 ${
      destaque
        ? "border-2 border-emerald-300 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-900/10"
        : "border border-gray-200 dark:border-gray-700"
    }`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <span className="font-bold text-gray-900 dark:text-gray-100">Proposta v{proposta.versao}</span>
          {proposta.enviadaEm && (
            <span className="ml-2 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
              ✓ enviada
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
            {fmtBRL(proposta.precoTotal)}
          </div>
          <div className="text-[11px] text-gray-500">
            {proposta.precoPorPessoa > 0
              ? `${fmtBRL(proposta.precoPorPessoa)} × ${proposta.numConvidados} pax`
              : `${proposta.numConvidados} pax`}
          </div>
        </div>
      </div>
      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
        {eventoLinha || `${dataBR} · ${proposta.slot === "almoco" ? "almoço" : "jantar"} · ${proposta.duracaoHoras}h`}
      </div>

      {/* Composição em linhas */}
      {proposta.linhas && proposta.linhas.length > 0 && (
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
          {proposta.linhas.map(l => (
            <div key={l.id} className="flex items-center justify-between gap-2">
              <span>
                {l.descricao}
                {l.tipo === "por_pessoa" && <span className="text-gray-400"> · {fmtBRL(l.valor)}/p × {l.numPessoas || 0}</span>}
              </span>
              <span className="tabular-nums">{fmtBRL(linhaPropostaTotal(l))}</span>
            </div>
          ))}
        </div>
      )}

      {/* Cardápios PDF */}
      {(proposta.cardapios?.length || 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {proposta.cardapios.map(c => (
            <a key={c.id} href={c.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs hover:bg-indigo-100 dark:hover:bg-indigo-900/50">
              📄 {c.nome}
            </a>
          ))}
        </div>
      )}

      {/* Parcelas */}
      <div className="mt-3 space-y-1.5">
        {proposta.parcelas.map((p, i) => {
          const paga = !!p.pagaEm;
          return (
            <div key={i} className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-sm ${
              paga ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-gray-50 dark:bg-gray-800/50"
            }`}>
              <div className="flex-1 min-w-0">
                <div className={paga ? "line-through text-gray-500" : ""}>{p.descricao}</div>
                {paga && p.pagaEm && (
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                    ✓ paga em {new Date(p.pagaEm).toLocaleDateString("pt-BR")}
                    {p.pagaPorNome && ` por ${p.pagaPorNome}`}
                    {p.comprovanteUrl && <> · <a href={p.comprovanteUrl} target="_blank" rel="noreferrer" className="underline">📎 comprovante</a></>}
                  </div>
                )}
                {!paga && p.vencimentoEm && (
                  <div className="text-[10px] text-gray-500">
                    vence em {new Date(p.vencimentoEm + "T12:00:00").toLocaleDateString("pt-BR")}
                  </div>
                )}
              </div>
              <div className="font-bold tabular-nums shrink-0">{fmtBRL(p.valor)}</div>
              {podeEditar && (
                paga ? (
                  <button onClick={() => onDesmarcarPagamento(i)} className="text-xs text-rose-600 hover:underline shrink-0">desmarcar</button>
                ) : (
                  <button onClick={() => onRegistrarPagamento(i)} className="text-xs text-indigo-600 hover:underline shrink-0">registrar</button>
                )
              )}
            </div>
          );
        })}
      </div>

      {destaque && (
        <div className="mt-3 flex gap-2 flex-wrap items-center">
          <Button size="sm" onClick={onEnviar}>
            💬 {proposta.enviadaEm ? "Reenviar" : "Enviar"} via WhatsApp
          </Button>
          {podeEditar && (
            <Button size="sm" variant="secondary" onClick={onGerarPdf} disabled={gerandoPdf}>
              {gerandoPdf ? "Gerando PDF…" : proposta.pdfUrl ? "🧾 Regerar orçamento (PDF)" : "🧾 Gerar orçamento (PDF)"}
            </Button>
          )}
          {proposta.pdfUrl && (
            <a href={proposta.pdfUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">📄 abrir PDF</a>
          )}
        </div>
      )}
    </div>
  );
}
