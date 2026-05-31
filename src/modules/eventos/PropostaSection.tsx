import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import type {
  EspacoEvento, LeadEvento, PacoteEvento, ParcelaProposta, PropostaEvento,
} from "../../core/types";
import { pacotePrecoLabel, pacoteValorTotal } from "../../core/types";
import {
  criarProposta, montarMensagemProposta,
} from "./propostaHelpers";

type Props = {
  lead: LeadEvento;
  pacotes: PacoteEvento[];
  podeEditar: boolean;
  meId: string;
  meNome: string;
  onAvancarStatus?: () => Promise<void>;
};

export function PropostaSection({ lead, pacotes, podeEditar, meId, meNome, onAvancarStatus }: Props) {
  const [propostas, setPropostas] = useState<PropostaEvento[]>([]);
  const [espaco, setEspaco] = useState<EspacoEvento | null>(null);
  const [criando, setCriando] = useState(false);
  const [pacoteSelecionado, setPacoteSelecionado] = useState<string>(lead.pacoteSugeridoId || "");
  const [paxOverride, setPaxOverride] = useState<string>("");
  const [precoPaxOverride, setPrecoPaxOverride] = useState<string>("");

  useEffect(() => {
    const q = query(collection(db, "propostasEvento"), where("leadId", "==", lead.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as PropostaEvento);
      list.sort((a, b) => b.versao - a.versao);
      setPropostas(list);
    });
    return () => unsub();
  }, [lead.id]);

  // Carrega espaço (1º ativo) — pra usar a política de cancelamento
  useEffect(() => {
    (async () => {
      const q = query(collection(db, "espacosEvento"), where("restaurantId", "==", lead.restaurantId));
      const snap = await getDoc(doc(db, "espacosEvento", "_dummy_")).catch(() => null);
      // Workaround: usa getDocs simples — onSnapshot ficaria pesado pra uma só leitura
      const { getDocs } = await import("firebase/firestore");
      const r = await getDocs(q);
      const ativos = r.docs.map(d => ({ id: d.id, ...d.data() }) as EspacoEvento).filter(e => e.ativo);
      setEspaco(ativos[0] || null);
      void snap;
    })();
  }, [lead.restaurantId]);

  const propostaAtual = propostas[0] || null; // mais recente
  const pacoteAtual = useMemo(
    () => pacoteSelecionado ? pacotes.find(p => p.id === pacoteSelecionado) : null,
    [pacoteSelecionado, pacotes],
  );
  const pacotesAtivos = useMemo(() => pacotes.filter(p => p.ativo), [pacotes]);

  async function gerarProposta() {
    if (!podeEditar) return;
    const pacote = pacoteSelecionado ? pacotes.find(p => p.id === pacoteSelecionado) : null;
    const pax = parseInt(paxOverride, 10) || lead.numConvidados;
    const precoPax = precoPaxOverride
      ? parseFloat(precoPaxOverride.replace(",", "."))
      : undefined;
    setCriando(true);
    try {
      await criarProposta({
        lead,
        pacote: pacote || null,
        espaco,
        numConvidados: pax,
        precoPorPessoaOverride: precoPax,
        ajustes: [],
        criadoPorId: meId,
      });
      setPaxOverride("");
      setPrecoPaxOverride("");
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
    // Marca proposta como enviada
    await updateDoc(doc(db, "propostasEvento", p.id), sanitizeForFirestore({
      enviadaEm: new Date().toISOString(),
      enviadaPor: meId,
      enviadaPorNome: meNome,
    }));
    // Se lead ainda não tá em "proposta_enviada", avança
    if (lead.status === "novo" || lead.status === "qualificado") {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
        status: "proposta_enviada",
        updatedAt: new Date().toISOString(),
      }));
    }
    window.open(url, "_blank");
  }

  async function registrarPagamento(p: PropostaEvento, parcelaIdx: number) {
    if (!podeEditar) return;
    const parcela = p.parcelas[parcelaIdx];
    if (!parcela || parcela.pagaEm) return;
    const ok = confirm(
      `Confirmar recebimento de R$ ${parcela.valor.toFixed(2)} (${parcela.descricao})?`
    );
    if (!ok) return;
    const now = new Date().toISOString();
    const novasParcelas: ParcelaProposta[] = p.parcelas.map((par, i) =>
      i === parcelaIdx
        ? { ...par, pagaEm: now, pagaPor: meId, pagaPorNome: meNome }
        : par
    );
    await updateDoc(doc(db, "propostasEvento", p.id), sanitizeForFirestore({
      parcelas: novasParcelas,
    }));

    // Auto-avança o status do lead
    const todasPagas = novasParcelas.every(par => !!par.pagaEm);
    const algumaPaga = novasParcelas.some(par => !!par.pagaEm);
    if (todasPagas && lead.status !== "confirmado" && lead.status !== "realizado") {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
        status: "confirmado",
        updatedAt: now,
      }));
    } else if (algumaPaga && lead.status === "proposta_enviada") {
      await updateDoc(doc(db, "leadsEvento", lead.id), sanitizeForFirestore({
        status: "sinal_recebido",
        updatedAt: now,
      }));
    }
    void onAvancarStatus;
  }

  async function desmarcarPagamento(p: PropostaEvento, parcelaIdx: number) {
    if (!podeEditar) return;
    const ok = confirm("Desmarcar este pagamento? (não muda status do lead automaticamente)");
    if (!ok) return;
    const novasParcelas: ParcelaProposta[] = p.parcelas.map((par, i) =>
      i === parcelaIdx
        ? { ...par, pagaEm: undefined, pagaPor: undefined, pagaPorNome: undefined }
        : par
    );
    await updateDoc(doc(db, "propostasEvento", p.id), sanitizeForFirestore({
      parcelas: novasParcelas,
    }));
  }

  // Preview do total que a proposta nova vai ter (antes de gerar).
  // Se vendedor digitou override de R$/pax, ele manda; senão usa o modo
  // do pacote (por_pessoa, total_fixo ou personalizado=0).
  const totalPreview = useMemo(() => {
    const pax = parseInt(paxOverride, 10) || lead.numConvidados;
    if (precoPaxOverride) {
      const v = parseFloat(precoPaxOverride.replace(",", ".")) || 0;
      return Math.round(v * pax * 100) / 100;
    }
    return pacoteAtual ? pacoteValorTotal(pacoteAtual, pax) : 0;
  }, [paxOverride, precoPaxOverride, pacoteAtual, lead.numConvidados]);

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
        💼 Proposta
      </div>

      {propostas.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Ainda não há proposta gerada. Escolhe um pacote (ou deixa em branco
            pra montar do zero) e ajusta pax/preço se quiser.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-3">
              <label className="text-[11px] uppercase font-bold text-gray-500">Pacote-base</label>
              <select
                value={pacoteSelecionado}
                onChange={(e) => setPacoteSelecionado(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                <option value="">— sem pacote (proposta livre) —</option>
                {pacotesAtivos.map(p => (
                  <option key={p.id} value={p.id}>{p.nome} · {pacotePrecoLabel(p)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase font-bold text-gray-500">Pax</label>
              <input
                type="number"
                value={paxOverride}
                onChange={(e) => setPaxOverride(e.target.value)}
                placeholder={String(lead.numConvidados)}
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase font-bold text-gray-500">Preço/pax R$</label>
              <input
                type="number"
                step="0.01"
                value={precoPaxOverride}
                onChange={(e) => setPrecoPaxOverride(e.target.value)}
                placeholder={pacoteAtual?.precoPorPessoa.toFixed(2) || "0.00"}
                className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div className="flex items-end">
              <div className="text-sm">
                <span className="text-gray-500">Total preview: </span>
                <strong className="text-emerald-700 dark:text-emerald-400">
                  R$ {totalPreview.toFixed(2)}
                </strong>
              </div>
            </div>
          </div>
          {podeEditar && (
            <Button onClick={gerarProposta} disabled={criando}>
              {criando ? "Gerando..." : "💼 Gerar proposta v1"}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Proposta mais recente em destaque */}
          {propostaAtual && (
            <PropostaCard
              proposta={propostaAtual}
              destaque
              podeEditar={podeEditar}
              onEnviar={() => enviarWhatsApp(propostaAtual)}
              onRegistrarPagamento={(i) => registrarPagamento(propostaAtual, i)}
              onDesmarcarPagamento={(i) => desmarcarPagamento(propostaAtual, i)}
            />
          )}

          {/* Versões anteriores */}
          {propostas.length > 1 && (
            <details className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <summary className="cursor-pointer text-xs text-gray-500 dark:text-gray-400">
                Versões anteriores ({propostas.length - 1})
              </summary>
              <div className="mt-2 space-y-2">
                {propostas.slice(1).map(p => (
                  <PropostaCard
                    key={p.id}
                    proposta={p}
                    destaque={false}
                    podeEditar={false}
                    onEnviar={() => enviarWhatsApp(p)}
                    onRegistrarPagamento={() => { /* só na atual */ }}
                    onDesmarcarPagamento={() => { /* só na atual */ }}
                  />
                ))}
              </div>
            </details>
          )}

          {/* Botão pra nova versão */}
          {podeEditar && (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-3 space-y-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Cliente pediu ajuste? Gera uma nova versão a partir do pacote / preço atual.
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-500">Pacote</label>
                  <select
                    value={pacoteSelecionado}
                    onChange={(e) => setPacoteSelecionado(e.target.value)}
                    className="block mt-0.5 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  >
                    <option value="">— sem pacote —</option>
                    {pacotesAtivos.map(p => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-500">Pax</label>
                  <input
                    type="number"
                    value={paxOverride}
                    onChange={(e) => setPaxOverride(e.target.value)}
                    placeholder={String(lead.numConvidados)}
                    className="block mt-0.5 w-20 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-500">R$/pax</label>
                  <input
                    type="number"
                    step="0.01"
                    value={precoPaxOverride}
                    onChange={(e) => setPrecoPaxOverride(e.target.value)}
                    placeholder={pacoteAtual?.precoPorPessoa.toFixed(2) || ""}
                    className="block mt-0.5 w-24 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  />
                </div>
                <Button size="sm" variant="secondary" onClick={gerarProposta} disabled={criando}>
                  + Nova versão
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PropostaCard({
  proposta, destaque, podeEditar, onEnviar, onRegistrarPagamento, onDesmarcarPagamento,
}: {
  proposta: PropostaEvento;
  destaque: boolean;
  podeEditar: boolean;
  onEnviar: () => void;
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
          <span className="font-bold text-gray-900 dark:text-gray-100">
            Proposta v{proposta.versao}
          </span>
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
              : `${proposta.numConvidados} pax · valor fechado`}
          </div>
        </div>
      </div>
      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
        {dataBR} · {proposta.slot === "almoco" ? "almoço" : "jantar"} · {proposta.duracaoHoras}h
        {proposta.cardapio.length > 0 && ` · ${proposta.cardapio.length} item(ns) de cardápio`}
      </div>

      {/* Parcelas */}
      <div className="mt-3 space-y-1.5">
        {proposta.parcelas.map((p, i) => {
          const paga = !!p.pagaEm;
          return (
            <div key={i} className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-sm ${
              paga
                ? "bg-emerald-100 dark:bg-emerald-900/30"
                : "bg-gray-50 dark:bg-gray-800/50"
            }`}>
              <div className="flex-1 min-w-0">
                <div className={paga ? "line-through text-gray-500" : ""}>{p.descricao}</div>
                {paga && p.pagaEm && (
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                    ✓ paga em {new Date(p.pagaEm).toLocaleDateString("pt-BR")}
                    {p.pagaPorNome && ` por ${p.pagaPorNome}`}
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
                  <button onClick={() => onDesmarcarPagamento(i)} className="text-xs text-rose-600 hover:underline shrink-0">
                    desmarcar
                  </button>
                ) : (
                  <button onClick={() => onRegistrarPagamento(i)} className="text-xs text-indigo-600 hover:underline shrink-0">
                    registrar
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Ações */}
      {destaque && (
        <div className="mt-3 flex gap-2 flex-wrap">
          <Button size="sm" onClick={onEnviar}>
            💬 {proposta.enviadaEm ? "Reenviar" : "Enviar"} via WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
}
