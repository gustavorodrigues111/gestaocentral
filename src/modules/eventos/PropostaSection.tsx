import { useEffect, useMemo, useState } from "react";
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

type Props = {
  lead: LeadEvento;
  pacotes: PacoteEvento[];
  podeEditar: boolean;
  meId: string;
  meNome: string;
  onAvancarStatus?: () => Promise<void>;
};

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
  const restauranteNome = restaurants.find((r) => r.id === lead.restaurantId)?.nome || "";

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
    const numero = lead.cliente.whatsapp.replace(/\D/g, "");
    const restaurantNome = espaco?.nome || "nosso espaço";
    const texto = montarMensagemProposta(p, lead.cliente.nome, restaurantNome);
    const url = `https://api.whatsapp.com/send?phone=${encodeURIComponent(numero)}&text=${encodeURIComponent(texto)}`;
    await updateDoc(doc(db, "propostasEvento", p.id), sanitizeForFirestore({
      enviadaEm: new Date().toISOString(),
      enviadaPor: meId,
      enviadaPorNome: meNome,
    }));
    // Registra no log de tratativas (auto).
    await registrarTratativa({
      restaurantId: lead.restaurantId, leadId: lead.id,
      texto: `Proposta v${p.versao} enviada — R$ ${p.precoTotal.toFixed(2)}`,
      canal: "whatsapp", porId: meId, porNome: meNome,
      manual: false, templateKey: "envio_proposta",
    }).catch(() => { /* log não bloqueia o envio */ });
    if (lead.status === "novo" || lead.status === "qualificado") {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
        status: "proposta_enviada",
        updatedAt: new Date().toISOString(),
      }));
    }
    window.open(url, "_blank");
  }

  // Gera o PDF do orçamento (visual do Lobozó) a partir da proposta e salva a URL.
  async function gerarPdf(p: PropostaEvento) {
    if (gerandoPdf) return;
    setGerandoPdf(p.id);
    try {
      const fmt = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
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

      const dataEv = new Date(p.dataEvento + "T12:00:00");
      const dataBR = `${String(dataEv.getDate()).padStart(2, "0")}/${String(dataEv.getMonth() + 1).padStart(2, "0")}/${dataEv.getFullYear()}`;
      const dados = {
        restauranteNome,
        clienteNome: lead.cliente.nome,
        dataEvento: `${dataBR} · ${p.slot === "almoco" ? "almoço" : "jantar"}`,
        horario: p.horaInicio ? `${p.horaInicio} · ${p.duracaoHoras}h` : `${p.duracaoHoras}h`,
        numConvidados: p.numConvidados,
        espaco: espaco?.nome || undefined,
        formato: lead.modeloEvento === "locacao_consumo_livre" ? "Locação (consumo em comanda)" : "Pacote por pessoa",
        linhas: itens,
        total: fmt(p.precoTotal),
        precoPorPessoa: p.precoPorPessoa > 0 ? `${fmt(p.precoPorPessoa)} por pessoa` : undefined,
        condicoes,
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

      {/* Propostas existentes */}
      {propostas.length > 0 && (
        <div className="space-y-3 mb-3">
          {propostaAtual && (
            <PropostaCard
              proposta={propostaAtual} destaque podeEditar={podeEditar}
              onEnviar={() => enviarWhatsApp(propostaAtual)}
              onGerarPdf={() => gerarPdf(propostaAtual)}
              gerandoPdf={gerandoPdf === propostaAtual.id}
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
                type="number" min={1} value={pax}
                onChange={(e) => setPax(parseInt(e.target.value, 10) || 0)}
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          </div>

          {baseDoPacote > 0 && (
            <div className="text-xs text-gray-600 dark:text-gray-400">
              Base do pacote: <strong className="tabular-nums">R$ {baseDoPacote.toFixed(2)}</strong>
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
                      <input
                        type="number" step="0.01" min={0} value={l.valor || ""}
                        onChange={(e) => setLinha(l.id, { valor: parseFloat(e.target.value) || 0 })}
                        placeholder="0,00"
                        className="w-24 px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right"
                      />
                    </span>
                    {l.tipo === "por_pessoa" && (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-xs text-gray-400">×</span>
                        <input
                          type="number" min={0} value={l.numPessoas ?? pax}
                          onChange={(e) => setLinha(l.id, { numPessoas: parseInt(e.target.value, 10) || 0 })}
                          className="w-16 px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right"
                        />
                        <span className="text-xs text-gray-400">pessoas</span>
                      </span>
                    )}
                    <span className="ml-auto text-sm font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      = R$ {tot.toFixed(2)}
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
          </div>

          {/* Arredondamento */}
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-2.5 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="text-gray-500">Subtotal:</span>
              <span className="tabular-nums">R$ {totalPreview.toFixed(2)}</span>
              <span className="text-gray-400 mx-1">·</span>
              <span className="text-gray-500">Arredondar:</span>
              <span className="inline-flex items-center gap-1">
                <span className="text-xs text-gray-400">R$</span>
                <input type="number" step="0.01" value={arredondamento || ""} onChange={(e) => setArredondamento(parseFloat(e.target.value) || 0)}
                  placeholder="0,00" className="w-24 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right" />
              </span>
              <button type="button" onClick={() => setArredondamento(Math.round((Math.ceil(totalPreview / 10) * 10 - totalPreview) * 100) / 100)}
                className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">↑ dezena</button>
              <button type="button" onClick={() => setArredondamento(Math.round((Math.ceil(totalPreview / 100) * 100 - totalPreview) * 100) / 100)}
                className="text-[11px] px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">↑ centena</button>
              {arredondamento !== 0 && <button type="button" onClick={() => setArredondamento(0)} className="text-[11px] text-rose-500 hover:underline">zerar</button>}
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Total final: </span>
              <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">R$ {totalFinal.toFixed(2)}</strong>
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
                      <input type="number" step="0.01" value={pc.valor || ""} onChange={(e) => setParcelasEdit(prev => prev.map((x, j) => j === i ? { ...x, valor: parseFloat(e.target.value) || 0 } : x))}
                        className="w-24 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right" /></span>
                    <input type="date" value={pc.vencimentoEm || ""} onChange={(e) => setParcelasEdit(prev => prev.map((x, j) => j === i ? { ...x, vencimentoEm: e.target.value || undefined } : x))}
                      className="px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
                    <button type="button" onClick={() => setParcelasEdit(prev => prev.filter((_, j) => j !== i))} className="text-rose-500 hover:text-rose-700 text-sm">✕</button>
                  </div>
                ))}
                {(() => {
                  const soma = Math.round(parcelasEdit.reduce((s, p) => s + (p.valor || 0), 0) * 100) / 100;
                  return Math.abs(soma - totalFinal) > 0.01 ? (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400">⚠ Soma das parcelas R$ {soma.toFixed(2)} ≠ total R$ {totalFinal.toFixed(2)}</div>
                  ) : <div className="text-[11px] text-emerald-600 dark:text-emerald-400">✓ soma bate com o total</div>;
                })()}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-800">
            <div className="text-sm">
              <span className="text-gray-500">Total: </span>
              <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">R$ {totalFinal.toFixed(2)}</strong>
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
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{parcela.descricao} — <strong>R$ {parcela.valor.toFixed(2)}</strong></p>
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
  proposta, destaque, podeEditar, onEnviar, onGerarPdf, gerandoPdf, onRegistrarPagamento, onDesmarcarPagamento,
}: {
  proposta: PropostaEvento;
  destaque: boolean;
  podeEditar: boolean;
  onEnviar: () => void;
  onGerarPdf: () => void;
  gerandoPdf: boolean;
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
            R$ {proposta.precoTotal.toFixed(2)}
          </div>
          <div className="text-[11px] text-gray-500">
            {proposta.precoPorPessoa > 0
              ? `R$ ${proposta.precoPorPessoa.toFixed(2)} × ${proposta.numConvidados} pax`
              : `${proposta.numConvidados} pax`}
          </div>
        </div>
      </div>
      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
        {dataBR} · {proposta.slot === "almoco" ? "almoço" : "jantar"} · {proposta.duracaoHoras}h
      </div>

      {/* Composição em linhas */}
      {proposta.linhas && proposta.linhas.length > 0 && (
        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
          {proposta.linhas.map(l => (
            <div key={l.id} className="flex items-center justify-between gap-2">
              <span>
                {l.descricao}
                {l.tipo === "por_pessoa" && <span className="text-gray-400"> · R$ {l.valor.toFixed(2)}/p × {l.numPessoas || 0}</span>}
              </span>
              <span className="tabular-nums">R$ {linhaPropostaTotal(l).toFixed(2)}</span>
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
              <div className="font-bold tabular-nums shrink-0">R$ {p.valor.toFixed(2)}</div>
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
