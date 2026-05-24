import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { EspacoEvento, LeadEvento, PacoteEvento, SlotEvento } from "../../core/types";

// Página pública pra cliente registrar interesse num evento.
// Rota: /eventos/:rid (pública, sem auth)
// Cria um LeadEvento com origem="publico".
//
// IMPORTANTE: pra que a leitura de restaurants/espacosEvento/pacotesEvento
// funcione sem auth, é preciso ter regras Firestore que permitam read público
// pra essas coleções. (Já fizemos isso pra Admissão — pode reusar o padrão.)
export function EventosPublicaPage() {
  const { rid } = useParams<{ rid: string }>();
  const [espacos, setEspacos] = useState<EspacoEvento[]>([]);
  const [pacotes, setPacotes] = useState<PacoteEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState("");
  const [naoEncontrado, setNaoEncontrado] = useState(false);

  // Form state
  const [form, setForm] = useState({
    nome: "",
    whatsapp: "",
    email: "",
    tipoPessoa: "PF" as "PF" | "PJ",
    cnpj: "",
    razaoSocial: "",
    dataDesejada: "",
    dataAlt1: "",
    dataAlt2: "",
    slot: "jantar" as SlotEvento,
    horaInicio: "",
    numConvidados: "",
    tipoEventoLivre: "",
    pacoteSugeridoId: "",
    observacoesCliente: "",
    inspiracoes: "",
  });

  // Carrega espaços + pacotes ativos do restaurante.
  // Não precisa do doc /restaurants — usa o nome do espaço como header.
  useEffect(() => {
    if (!rid) return;
    (async () => {
      try {
        const [espSnap, pacSnap] = await Promise.all([
          getDocs(query(collection(db, "espacosEvento"), where("restaurantId", "==", rid))),
          getDocs(query(collection(db, "pacotesEvento"), where("restaurantId", "==", rid))),
        ]);
        const espacosAtivos = espSnap.docs
          .map(d => ({ id: d.id, ...d.data() }) as EspacoEvento)
          .filter(e => e.ativo);
        if (espacosAtivos.length === 0) {
          setNaoEncontrado(true);
          return;
        }
        setEspacos(espacosAtivos);
        const pacs = pacSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PacoteEvento).filter(p => p.ativo);
        pacs.sort((a, b) => a.ordem - b.ordem);
        setPacotes(pacs);
      } catch (e) {
        console.error(e);
        setErr("Erro ao carregar página. Tenta de novo em alguns minutos.");
      } finally {
        setLoading(false);
      }
    })();
  }, [rid]);

  const espaco = useMemo(() => espacos[0] || null, [espacos]);

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function submit() {
    setErr("");
    if (!form.nome.trim() || !form.whatsapp.trim() || !form.dataDesejada || !form.numConvidados) {
      setErr("Preenche pelo menos: nome, WhatsApp, data desejada e número de convidados.");
      return;
    }
    const num = parseInt(form.numConvidados, 10);
    if (!num || num < 1) {
      setErr("Número de convidados inválido.");
      return;
    }
    if (form.tipoPessoa === "PJ" && !form.razaoSocial.trim()) {
      setErr("Pra PJ, preencha a razão social.");
      return;
    }
    setSubmitting(true);
    try {
      if (!rid) throw new Error("URL inválida");
      const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const datasAlt = [form.dataAlt1, form.dataAlt2].filter(d => !!d);
      const inspiracoes = form.inspiracoes
        .split(/[\n,]/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      const lead: LeadEvento = {
        id,
        restaurantId: rid,
        status: "novo",
        cliente: {
          nome: form.nome.trim(),
          whatsapp: form.whatsapp.trim(),
          email: form.email.trim() || undefined,
          tipoPessoa: form.tipoPessoa,
          cnpj: form.tipoPessoa === "PJ" ? form.cnpj.trim() || undefined : undefined,
          razaoSocial: form.tipoPessoa === "PJ" ? form.razaoSocial.trim() || undefined : undefined,
        },
        dataDesejada: form.dataDesejada,
        datasAlternativas: datasAlt.length > 0 ? datasAlt : undefined,
        slot: form.slot,
        horaInicio: form.horaInicio || undefined,
        numConvidados: num,
        tipoEventoLivre: form.tipoEventoLivre.trim() || undefined,
        pacoteSugeridoId: form.pacoteSugeridoId || undefined,
        observacoesCliente: form.observacoesCliente.trim() || undefined,
        inspiracoesUrls: inspiracoes.length > 0 ? inspiracoes : undefined,
        origem: "publico",
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(doc(db, "leadsEvento", id), sanitizeForFirestore(lead));
      setSubmitted(true);
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro ao enviar — tenta novamente");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
        Carregando...
      </div>
    );
  }

  if (naoEncontrado || !espaco) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-3">❌</div>
          <p className="text-gray-800 dark:text-gray-200 font-medium">Página não encontrada</p>
          <p className="text-sm text-gray-500 mt-2">
            Confere o link ou contata o restaurante. Talvez ainda não tenha
            espaço de eventos cadastrado por aqui.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8 max-w-lg text-center">
          <div className="text-5xl mb-4">✓</div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Recebemos sua mensagem!
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Vamos retornar via WhatsApp em até 24h pra detalhar sua proposta.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4">
      <div className="max-w-xl mx-auto">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {espaco.nome}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Eventos privados {espaco.capacidadeMax ? `· até ${espaco.capacidadeMax} pessoas` : ""}
            </p>
            {espaco.descricao && (
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-2 max-w-md mx-auto">
                {espaco.descricao}
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-3">
              Conta pra gente sobre seu evento — a gente retorna em até 24h via WhatsApp.
            </p>
          </div>

          <div className="space-y-4">
            {/* Contato */}
            <div className="grid grid-cols-1 gap-3">
              <Input
                label="Seu nome *"
                value={form.nome}
                onChange={(e) => update("nome", e.target.value)}
                placeholder="João da Silva"
              />
              <Input
                label="WhatsApp *"
                value={form.whatsapp}
                onChange={(e) => update("whatsapp", e.target.value)}
                placeholder="(11) 99999-9999"
              />
              <Input
                label="Email (opcional)"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>

            {/* PF / PJ */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Tipo
              </label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => update("tipoPessoa", "PF")}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    form.tipoPessoa === "PF"
                      ? "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
                      : "bg-white border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
                  }`}
                >
                  Pessoa física
                </button>
                <button
                  type="button"
                  onClick={() => update("tipoPessoa", "PJ")}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    form.tipoPessoa === "PJ"
                      ? "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
                      : "bg-white border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
                  }`}
                >
                  Empresa
                </button>
              </div>
              {form.tipoPessoa === "PJ" && (
                <div className="mt-3 space-y-3">
                  <Input
                    label="Razão social *"
                    value={form.razaoSocial}
                    onChange={(e) => update("razaoSocial", e.target.value)}
                  />
                  <Input
                    label="CNPJ"
                    value={form.cnpj}
                    onChange={(e) => update("cnpj", e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Data + slot */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Data desejada *"
                type="date"
                value={form.dataDesejada}
                onChange={(e) => update("dataDesejada", e.target.value)}
              />
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Horário
                </label>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => update("slot", "almoco")}
                    className={`px-2 py-2 rounded text-xs font-medium border ${
                      form.slot === "almoco"
                        ? "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
                        : "bg-white border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700"
                    }`}
                  >
                    🌞 Almoço
                  </button>
                  <button
                    type="button"
                    onClick={() => update("slot", "jantar")}
                    className={`px-2 py-2 rounded text-xs font-medium border ${
                      form.slot === "jantar"
                        ? "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
                        : "bg-white border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700"
                    }`}
                  >
                    🌙 Jantar
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Alternativa 1 (opcional)"
                type="date"
                value={form.dataAlt1}
                onChange={(e) => update("dataAlt1", e.target.value)}
              />
              <Input
                label="Alternativa 2 (opcional)"
                type="date"
                value={form.dataAlt2}
                onChange={(e) => update("dataAlt2", e.target.value)}
              />
            </div>

            {/* Pax + tipo */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Quantos convidados? *"
                type="number"
                value={form.numConvidados}
                onChange={(e) => update("numConvidados", e.target.value)}
                placeholder="ex: 30"
              />
              <Input
                label="Tipo de evento"
                value={form.tipoEventoLivre}
                onChange={(e) => update("tipoEventoLivre", e.target.value)}
                placeholder="aniversário, corporativo..."
              />
            </div>

            {/* Pacote sugerido */}
            {pacotes.length > 0 && (
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Tem algum pacote em mente? (opcional)
                </label>
                <div className="mt-1 grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => update("pacoteSugeridoId", "")}
                    className={`px-3 py-2 rounded-lg text-sm text-left border ${
                      form.pacoteSugeridoId === ""
                        ? "bg-indigo-50 border-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-700"
                        : "bg-white border-gray-300 dark:bg-gray-900 dark:border-gray-700"
                    }`}
                  >
                    <span className="font-medium">Não sei ainda</span>
                    <span className="block text-xs text-gray-500 mt-0.5">Quero que vocês me ajudem a escolher</span>
                  </button>
                  {pacotes.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => update("pacoteSugeridoId", p.id)}
                      className={`px-3 py-2 rounded-lg text-sm text-left border ${
                        form.pacoteSugeridoId === p.id
                          ? "bg-indigo-50 border-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-700"
                          : "bg-white border-gray-300 dark:bg-gray-900 dark:border-gray-700"
                      }`}
                    >
                      <span className="font-medium">{p.nome}</span>
                      {p.descricao && (
                        <span className="block text-xs text-gray-500 mt-0.5">{p.descricao}</span>
                      )}
                      {p.precoPorPessoa > 0 && (
                        <span className="block text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                          R$ {p.precoPorPessoa.toFixed(2)} / pessoa · {p.duracaoHoras}h
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Observações */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Conta mais (opcional)
              </label>
              <textarea
                value={form.observacoesCliente}
                onChange={(e) => update("observacoesCliente", e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                rows={3}
                placeholder="restrições alimentares, ideias específicas, dúvidas..."
              />
            </div>

            {/* Inspirações */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Inspirações (opcional)
              </label>
              <textarea
                value={form.inspiracoes}
                onChange={(e) => update("inspiracoes", e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                rows={2}
                placeholder="links de Pinterest, Instagram (um por linha)"
              />
            </div>

            {err && <div className="text-sm text-rose-600 dark:text-rose-400">{err}</div>}

            <Button
              onClick={submit}
              disabled={submitting}
              className="w-full"
            >
              {submitting ? "Enviando..." : "Enviar interesse"}
            </Button>
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-500 dark:text-gray-500 mt-4">
          Powered by Planejamento.app
        </p>
      </div>
    </div>
  );
}
