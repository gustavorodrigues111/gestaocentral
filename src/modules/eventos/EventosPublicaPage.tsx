import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type {
  EscopoPacote, EspacoEvento, LeadEvento, ModeloEvento,
  OcasiaoEvento, PacoteEvento,
} from "../../core/types";
import {
  buscarCNPJ, duracaoHoras, ESCOPO_PACOTE_LABEL, limparCNPJ,
  OCASIAO_LABEL, slotDoHorario, validarCNPJ, validarEmail,
} from "./validacoes";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "./paises";

// Página pública: cliente registra interesse num evento.
// Rota: /eventos/:rid (sem auth).
export function EventosPublicaPage() {
  const { rid } = useParams<{ rid: string }>();
  const [espacos, setEspacos] = useState<EspacoEvento[]>([]);
  const [pacotes, setPacotes] = useState<PacoteEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [erroGeral, setErroGeral] = useState("");
  const [naoEncontrado, setNaoEncontrado] = useState(false);

  // CNPJ — busca automática
  const [buscandoCNPJ, setBuscandoCNPJ] = useState(false);
  const [cnpjNaoEncontrado, setCnpjNaoEncontrado] = useState(false);

  // Form state
  const [form, setForm] = useState({
    nome: "",
    paisIso: PAIS_BR.iso,
    ddiManual: "",      // só preenchido quando paisIso === "OUTROS"
    whatsapp: "",
    email: "",
    tipoPessoa: "PF" as "PF" | "PJ",
    cnpj: "",
    razaoSocial: "",
    dataDesejada: "",
    dataAlternativa: "",
    horaInicio: "",
    horaFim: "",
    numConvidados: "",
    ocasiao: "" as OcasiaoEvento | "",
    ocasiaoOutros: "",
    modeloEvento: "" as ModeloEvento | "",
    escopoPacote: "" as EscopoPacote | "",
    escopoPacoteOutro: "",
    musicaAoVivo: false,
    decoracao: false,
    pacoteSugeridoId: "",
    observacoesCliente: "",
  });

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
        setErroGeral("Erro ao carregar página. Tenta de novo em alguns minutos.");
      } finally {
        setLoading(false);
      }
    })();
  }, [rid]);

  const espaco = useMemo(() => espacos[0] || null, [espacos]);

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  // Quando CNPJ tem 14 dígitos, busca automaticamente
  async function onCnpjBlur() {
    if (form.tipoPessoa !== "PJ") return;
    const limpo = limparCNPJ(form.cnpj);
    if (limpo.length !== 14) return;
    if (!validarCNPJ(form.cnpj)) {
      setCnpjNaoEncontrado(false);
      return;
    }
    setBuscandoCNPJ(true);
    setCnpjNaoEncontrado(false);
    try {
      const info = await buscarCNPJ(form.cnpj);
      if (info && info.razaoSocial) {
        setForm(f => ({
          ...f,
          razaoSocial: info.razaoSocial,
          // Pré-preenche email se vier da BrasilAPI e cliente ainda não preencheu
          email: f.email || info.email || "",
        }));
      } else {
        setCnpjNaoEncontrado(true);
      }
    } catch {
      setCnpjNaoEncontrado(true);
    } finally {
      setBuscandoCNPJ(false);
    }
  }

  async function submit() {
    setErroGeral("");

    // Validações
    if (!form.nome.trim()) return setErroGeral("Preenche seu nome.");
    const pais = getPaisByIso(form.paisIso);
    if (pais.iso === "OUTROS") {
      if (!validarDDIManual(form.ddiManual)) {
        return setErroGeral("DDI inválido. Digite só os números (ex: 351 pra Portugal).");
      }
      if (form.whatsapp.replace(/\D/g, "").length < 4) {
        return setErroGeral("Digite o número de WhatsApp.");
      }
    } else if (!validarNumeroLocal(form.whatsapp, pais)) {
      const exemploLen = pais.minLen === pais.maxLen ? `${pais.minLen}` : `${pais.minLen}-${pais.maxLen}`;
      return setErroGeral(
        pais.iso === "BR"
          ? "WhatsApp inválido. Use DDD + número (11 99999-9999)."
          : `WhatsApp inválido. ${pais.nome} pede ${exemploLen} dígitos.`
      );
    }
    if (!validarEmail(form.email)) {
      return setErroGeral("Email inválido.");
    }
    if (form.tipoPessoa === "PJ") {
      if (!validarCNPJ(form.cnpj)) return setErroGeral("CNPJ inválido.");
      if (!form.razaoSocial.trim()) return setErroGeral("Preencha a razão social.");
    }
    if (!form.dataDesejada) return setErroGeral("Escolhe a data desejada.");
    if (!form.horaInicio || !form.horaFim) return setErroGeral("Preenche horário de início e fim.");
    const dur = duracaoHoras(form.horaInicio, form.horaFim);
    if (dur <= 0) return setErroGeral("Horário de fim precisa ser depois do início.");
    if (!form.numConvidados) return setErroGeral("Quantos convidados?");
    const num = parseInt(form.numConvidados, 10);
    if (!num || num < 1) return setErroGeral("Número de convidados inválido.");
    if (!form.ocasiao) return setErroGeral("Escolhe a ocasião.");
    if (form.ocasiao === "outros" && !form.ocasiaoOutros.trim()) {
      return setErroGeral("Descreve a ocasião (campo \"outros\").");
    }
    if (!form.modeloEvento) return setErroGeral("Escolhe o modelo do evento.");
    if (form.modeloEvento === "pacote_por_pessoa") {
      if (!form.escopoPacote) return setErroGeral("Escolhe o escopo do pacote.");
      if (form.escopoPacote === "outro" && !form.escopoPacoteOutro.trim()) {
        return setErroGeral("Descreve o escopo (campo \"outro\").");
      }
    }

    setSubmitting(true);
    try {
      if (!rid) throw new Error("URL inválida");
      const id = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const lead: LeadEvento = {
        id,
        restaurantId: rid,
        status: "novo",
        cliente: {
          nome: form.nome.trim(),
          whatsapp: montarE164(
            pais.iso === "OUTROS" ? form.ddiManual : pais.ddi,
            form.whatsapp,
          ),
          email: form.email.trim(),
          tipoPessoa: form.tipoPessoa,
          ...(form.tipoPessoa === "PJ"
            ? { cnpj: limparCNPJ(form.cnpj), razaoSocial: form.razaoSocial.trim() }
            : {}),
        },
        dataDesejada: form.dataDesejada,
        dataAlternativa: form.dataAlternativa || undefined,
        slot: slotDoHorario(form.horaInicio, form.horaFim),
        horaInicio: form.horaInicio,
        horaFim: form.horaFim,
        duracaoEstimadaHoras: dur,
        numConvidados: num,
        ocasiao: form.ocasiao as OcasiaoEvento,
        ocasiaoOutros: form.ocasiao === "outros" ? form.ocasiaoOutros.trim() : undefined,
        modeloEvento: form.modeloEvento as ModeloEvento,
        escopoPacote: form.modeloEvento === "pacote_por_pessoa" ? (form.escopoPacote as EscopoPacote) : undefined,
        escopoPacoteOutro:
          form.modeloEvento === "pacote_por_pessoa" && form.escopoPacote === "outro"
            ? form.escopoPacoteOutro.trim()
            : undefined,
        musicaAoVivo: form.musicaAoVivo,
        decoracao: form.decoracao,
        pacoteSugeridoId: form.pacoteSugeridoId || undefined,
        observacoesCliente: form.observacoesCliente.trim() || undefined,
        origem: "publico",
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(doc(db, "leadsEvento", id), sanitizeForFirestore(lead));
      setSubmitted(true);
    } catch (e) {
      console.error(e);
      setErroGeral(e instanceof Error ? e.message : "Erro ao enviar — tenta novamente");
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
              Conta pra gente sobre seu evento — retornaremos em breve via WhatsApp.
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
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  WhatsApp *
                </label>
                {form.paisIso === "OUTROS" ? (
                  // Modo livre: cliente digita DDI + número, sem validação por país
                  <div className="mt-1 grid grid-cols-[110px_70px_1fr] gap-1.5">
                    <select
                      value={form.paisIso}
                      onChange={(e) => {
                        update("paisIso", e.target.value);
                        update("whatsapp", "");
                        update("ddiManual", "");
                      }}
                      className="px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    >
                      {PAISES.map(p => (
                        <option key={p.iso} value={p.iso}>
                          {p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={form.ddiManual}
                      onChange={(e) => update("ddiManual", e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="DDI"
                      className="px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm tabular-nums"
                    />
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={form.whatsapp}
                      onChange={(e) => update("whatsapp", e.target.value)}
                      placeholder="Número"
                      className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    />
                  </div>
                ) : (
                  <div className="mt-1 grid grid-cols-[110px_1fr] gap-1.5">
                    <select
                      value={form.paisIso}
                      onChange={(e) => {
                        update("paisIso", e.target.value);
                        update("whatsapp", "");
                      }}
                      className="px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    >
                      {PAISES.map(p => (
                        <option key={p.iso} value={p.iso}>
                          {p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={form.whatsapp}
                      onChange={(e) => {
                        const pais = getPaisByIso(form.paisIso);
                        update("whatsapp", formatarNumeroLocal(e.target.value, pais));
                      }}
                      placeholder={
                        form.paisIso === "BR"
                          ? "(11) 99999-9999"
                          : `${getPaisByIso(form.paisIso).minLen} dígitos`
                      }
                      className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    />
                  </div>
                )}
              </div>
              <Input
                label="Email *"
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="seunome@email.com"
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
                  className={pillBtn(form.tipoPessoa === "PF")}
                >
                  Pessoa física
                </button>
                <button
                  type="button"
                  onClick={() => update("tipoPessoa", "PJ")}
                  className={pillBtn(form.tipoPessoa === "PJ")}
                >
                  Empresa
                </button>
              </div>
              {form.tipoPessoa === "PJ" && (
                <div className="mt-3 space-y-3">
                  <div>
                    <Input
                      label="CNPJ *"
                      value={form.cnpj}
                      onChange={(e) => update("cnpj", e.target.value)}
                      onBlur={onCnpjBlur}
                      placeholder="00.000.000/0000-00"
                      inputMode="numeric"
                    />
                    {buscandoCNPJ && (
                      <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1">
                        🔎 buscando razão social...
                      </p>
                    )}
                    {cnpjNaoEncontrado && !buscandoCNPJ && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        Não consegui buscar — preencha a razão social manualmente.
                      </p>
                    )}
                  </div>
                  <Input
                    label="Razão social *"
                    value={form.razaoSocial}
                    onChange={(e) => update("razaoSocial", e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Data + alternativa */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Data desejada *"
                type="date"
                value={form.dataDesejada}
                onChange={(e) => update("dataDesejada", e.target.value)}
              />
              <Input
                label="Alternativa (opcional)"
                type="date"
                value={form.dataAlternativa}
                onChange={(e) => update("dataAlternativa", e.target.value)}
              />
            </div>

            {/* Horários início + fim */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Início *"
                type="time"
                value={form.horaInicio}
                onChange={(e) => update("horaInicio", e.target.value)}
              />
              <Input
                label="Término *"
                type="time"
                value={form.horaFim}
                onChange={(e) => update("horaFim", e.target.value)}
              />
            </div>

            {/* Pax + Ocasião */}
            <Input
              label="Quantos convidados? *"
              type="number"
              value={form.numConvidados}
              onChange={(e) => update("numConvidados", e.target.value)}
              placeholder="ex: 30"
            />

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Ocasião *
              </label>
              <select
                value={form.ocasiao}
                onChange={(e) => update("ocasiao", e.target.value as OcasiaoEvento | "")}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                <option value="">— selecione —</option>
                <option value="aniversario">{OCASIAO_LABEL.aniversario}</option>
                <option value="corporativo">{OCASIAO_LABEL.corporativo}</option>
                <option value="encontro_amigos">{OCASIAO_LABEL.encontro_amigos}</option>
                <option value="outros">{OCASIAO_LABEL.outros}</option>
              </select>
              {form.ocasiao === "outros" && (
                <Input
                  label=""
                  value={form.ocasiaoOutros}
                  onChange={(e) => update("ocasiaoOutros", e.target.value)}
                  placeholder="Descreve a ocasião"
                  className="mt-2"
                />
              )}
            </div>

            {/* Modelo do evento */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Modelo de evento *
              </label>
              <div className="mt-1 grid grid-cols-1 gap-1.5">
                <button
                  type="button"
                  onClick={() => update("modeloEvento", "locacao_consumo_livre")}
                  className={optionBtn(form.modeloEvento === "locacao_consumo_livre")}
                >
                  <strong>Locação do espaço</strong>
                  <span className="block text-xs mt-0.5 opacity-80">
                    Comanda individual, consumo livre — cada convidado paga o que consumir.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => update("modeloEvento", "pacote_por_pessoa")}
                  className={optionBtn(form.modeloEvento === "pacote_por_pessoa")}
                >
                  <strong>Pacote por pessoa</strong>
                  <span className="block text-xs mt-0.5 opacity-80">
                    Valor fixo por convidado com comidas e/ou bebidas inclusas.
                  </span>
                </button>
              </div>
              {form.modeloEvento === "pacote_por_pessoa" && (
                <div className="mt-3">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    O pacote inclui:
                  </label>
                  <div className="mt-1 grid grid-cols-1 gap-1.5">
                    {(["somente_comidas", "comidas_bebidas_nao_alcoolicas", "comidas_bebidas_alcoolicas", "outro"] as EscopoPacote[]).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => update("escopoPacote", opt)}
                        className={optionBtn(form.escopoPacote === opt)}
                      >
                        {ESCOPO_PACOTE_LABEL[opt]}
                      </button>
                    ))}
                  </div>
                  {form.escopoPacote === "outro" && (
                    <Input
                      label=""
                      value={form.escopoPacoteOutro}
                      onChange={(e) => update("escopoPacoteOutro", e.target.value)}
                      placeholder="Descreve o que quer no pacote"
                      className="mt-2"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Música / decoração */}
            <div className="grid grid-cols-1 gap-2">
              <CheckboxRow
                checked={form.musicaAoVivo}
                onChange={(v) => update("musicaAoVivo", v)}
                label="Pretende levar música ao vivo?"
              />
              <CheckboxRow
                checked={form.decoracao}
                onChange={(v) => update("decoracao", v)}
                label="Pretende decorar o espaço?"
              />
            </div>

            {/* Pacote sugerido (do restaurante) */}
            {pacotes.length > 0 && (
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Tem algum pacote nosso em mente? (opcional)
                </label>
                <div className="mt-1 grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={() => update("pacoteSugeridoId", "")}
                    className={optionBtn(form.pacoteSugeridoId === "")}
                  >
                    <span className="font-medium">Não sei ainda</span>
                  </button>
                  {pacotes.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => update("pacoteSugeridoId", p.id)}
                      className={optionBtn(form.pacoteSugeridoId === p.id)}
                    >
                      <span className="font-medium">{p.nome}</span>
                      {p.descricao && (
                        <span className="block text-xs opacity-70 mt-0.5">{p.descricao}</span>
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
                placeholder="restrições alimentares, expectativa de orçamento, dúvidas..."
              />
            </div>

            {erroGeral && <div className="text-sm text-rose-600 dark:text-rose-400">{erroGeral}</div>}

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

function CheckboxRow({ checked, onChange, label }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-indigo-600"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function pillBtn(active: boolean): string {
  return `px-3 py-2 rounded-lg text-sm font-medium border ${
    active
      ? "bg-indigo-100 border-indigo-300 text-indigo-800 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300"
      : "bg-white border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
  }`;
}

function optionBtn(active: boolean): string {
  return `px-3 py-2 rounded-lg text-sm text-left border ${
    active
      ? "bg-indigo-50 border-indigo-300 dark:bg-indigo-900/20 dark:border-indigo-700"
      : "bg-white border-gray-300 dark:bg-gray-900 dark:border-gray-700"
  }`;
}
