import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  EscopoPacote, EspacoEvento, LeadEvento, ModeloEvento,
  OcasiaoEvento, PacoteEvento,
} from "../../core/types";
import { pacotePrecoLabel } from "../../core/types";
import {
  buscarCNPJ, duracaoHoras, ESCOPO_PACOTE_LABEL, limparCNPJ,
  OCASIAO_LABEL, slotDoHorario, validarCNPJ, validarEmail,
} from "./validacoes";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "./paises";
import { useSiteConfigPublic } from "../sites/shared/useSiteConfigPublic";
import { SiteFormShell, SiteFormScreen, botaoPrimarioStyle } from "../sites/shared/SiteFormShell";
import { FormField, fieldInputCls } from "../sites/shared/FormField";

// Página pública: cliente registra interesse num evento.
// Rota: /eventos/:rid (sem auth). Visual segue o tema do site do
// restaurante (mesmo shell de Reservas/Trabalhe), com header + voltar
// pro site + cores/fontes do SiteConfig.
export function EventosPublicaPage() {
  const { rid } = useParams<{ rid: string }>();
  // SiteConfig pra tema + voltar pro site (sem requireFeature aqui — o
  // gate de eventos é "ter espaços ativos", não a flag hasEventos).
  const { siteConfig, loading: loadingSite } = useSiteConfigPublic(rid);

  // Carregamento próprio: espacosEvento + pacotesEvento (gate da página).
  const [espacos, setEspacos] = useState<EspacoEvento[]>([]);
  const [pacotes, setPacotes] = useState<PacoteEvento[]>([]);
  const [loadingEventos, setLoadingEventos] = useState(true);
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
    if (!rid) { setLoadingEventos(false); setNaoEncontrado(true); return; }
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
        const pacs = pacSnap.docs.map(d => ({ id: d.id, ...d.data() }) as PacoteEvento).filter(p => p.ativo && !p.interno);
        pacs.sort((a, b) => a.ordem - b.ordem);
        setPacotes(pacs);
      } catch (e) {
        console.error(e);
        setErroGeral("Erro ao carregar página. Tenta de novo em alguns minutos.");
      } finally {
        setLoadingEventos(false);
      }
    })();
  }, [rid]);

  const espaco = useMemo(() => espacos[0] || null, [espacos]);
  const corPrimaria = siteConfig?.tema?.corPrimaria || "#1a5c2a";

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
        classificacaoPrevia: "inbound", // cliente procurou = inbound (passiva)
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(doc(db, "leadsEvento", id), sanitizeForFirestore(lead));
      // Avisa a casa no WhatsApp (fire-and-forget — não bloqueia o sucesso).
      fetch("/api/evento-lead-notificar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: id, rid }),
      }).catch(() => { /* aviso é best-effort */ });
      setSubmitted(true);
    } catch (e) {
      console.error(e);
      setErroGeral(e instanceof Error ? e.message : "Erro ao enviar — tenta novamente");
    } finally {
      setSubmitting(false);
    }
  }

  // ───────────── Estados de carga / erro / sucesso ─────────────
  const loading = loadingEventos || loadingSite;
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 14 }}>
        Carregando...
      </div>
    );
  }
  if (naoEncontrado || !espaco) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="❌"
        titulo="Página não encontrada"
        mensagem="Confere o link ou contata o restaurante. Talvez ainda não tenha espaço de eventos cadastrado por aqui."
      />
    );
  }
  if (submitted) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="✓"
        titulo="Recebemos sua mensagem!"
        mensagem="Vamos retornar em breve via WhatsApp pra detalhar sua proposta."
      />
    );
  }

  // ───────────── Form ─────────────
  return (
    <SiteFormShell
      siteConfig={siteConfig}
      titulo={espaco.nome}
      maxWidth={640}
      subtitulo={
        <>
          Eventos privados {espaco.capacidadeMax ? `· até ${espaco.capacidadeMax} pessoas` : ""}
          {espaco.descricao && (
            <span style={{ display: "block", marginTop: 6, fontSize: 13, color: "#888" }}>
              {espaco.descricao}
            </span>
          )}
          <span style={{ display: "block", marginTop: 10, fontSize: 13, color: "#888" }}>
            Conta pra gente sobre seu evento — retornaremos em breve via WhatsApp.
          </span>
        </>
      }
    >
      <div className="space-y-4">
        {/* Contato */}
        <FormField label="Seu nome *">
          <input
            value={form.nome}
            onChange={(e) => update("nome", e.target.value)}
            placeholder="João da Silva"
            className={fieldInputCls}
          />
        </FormField>

        <FormField label="WhatsApp *">
          {form.paisIso === "OUTROS" ? (
            <div className="grid grid-cols-[110px_70px_1fr] gap-1.5">
              <select
                value={form.paisIso}
                onChange={(e) => { update("paisIso", e.target.value); update("whatsapp", ""); update("ddiManual", ""); }}
                className={fieldInputCls}
              >
                {PAISES.map(p => (
                  <option key={p.iso} value={p.iso}>
                    {p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}
                  </option>
                ))}
              </select>
              <input
                type="tel" inputMode="numeric"
                value={form.ddiManual}
                onChange={(e) => update("ddiManual", e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="DDI"
                className={fieldInputCls + " tabular-nums"}
              />
              <input
                type="tel" inputMode="numeric"
                value={form.whatsapp}
                onChange={(e) => update("whatsapp", e.target.value)}
                placeholder="Número"
                className={fieldInputCls}
              />
            </div>
          ) : (
            <div className="grid grid-cols-[110px_1fr] gap-1.5">
              <select
                value={form.paisIso}
                onChange={(e) => { update("paisIso", e.target.value); update("whatsapp", ""); }}
                className={fieldInputCls}
              >
                {PAISES.map(p => (
                  <option key={p.iso} value={p.iso}>
                    {p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}
                  </option>
                ))}
              </select>
              <input
                type="tel" inputMode="numeric"
                value={form.whatsapp}
                onChange={(e) => {
                  const pais = getPaisByIso(form.paisIso);
                  update("whatsapp", formatarNumeroLocal(e.target.value, pais));
                }}
                placeholder={form.paisIso === "BR" ? "(11) 99999-9999" : `${getPaisByIso(form.paisIso).minLen} dígitos`}
                className={fieldInputCls}
              />
            </div>
          )}
        </FormField>

        <FormField label="Email *">
          <input
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="seunome@email.com"
            className={fieldInputCls}
          />
        </FormField>

        {/* PF / PJ */}
        <div>
          <FormField label="Tipo">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => update("tipoPessoa", "PF")}
                style={pillStyle(form.tipoPessoa === "PF", corPrimaria)}
              >
                Pessoa física
              </button>
              <button
                type="button"
                onClick={() => update("tipoPessoa", "PJ")}
                style={pillStyle(form.tipoPessoa === "PJ", corPrimaria)}
              >
                Empresa
              </button>
            </div>
          </FormField>
          {form.tipoPessoa === "PJ" && (
            <div className="mt-3 space-y-3">
              <FormField label="CNPJ *">
                <input
                  value={form.cnpj}
                  onChange={(e) => update("cnpj", e.target.value)}
                  onBlur={onCnpjBlur}
                  placeholder="00.000.000/0000-00"
                  inputMode="numeric"
                  className={fieldInputCls}
                />
                {buscandoCNPJ && (
                  <p className="text-[11px] mt-1" style={{ color: corPrimaria }}>
                    🔎 buscando razão social...
                  </p>
                )}
                {cnpjNaoEncontrado && !buscandoCNPJ && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    Não consegui buscar — preencha a razão social manualmente.
                  </p>
                )}
              </FormField>
              <FormField label="Razão social *">
                <input
                  value={form.razaoSocial}
                  onChange={(e) => update("razaoSocial", e.target.value)}
                  className={fieldInputCls}
                />
              </FormField>
            </div>
          )}
        </div>

        {/* Data + alternativa */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Data desejada *">
            <input
              type="date"
              value={form.dataDesejada}
              onChange={(e) => update("dataDesejada", e.target.value)}
              className={fieldInputCls}
            />
          </FormField>
          <FormField label="Alternativa (opcional)">
            <input
              type="date"
              value={form.dataAlternativa}
              onChange={(e) => update("dataAlternativa", e.target.value)}
              className={fieldInputCls}
            />
          </FormField>
        </div>

        {/* Horários início + fim */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Início *">
            <input
              type="time"
              value={form.horaInicio}
              onChange={(e) => update("horaInicio", e.target.value)}
              className={fieldInputCls}
            />
          </FormField>
          <FormField label="Término *">
            <input
              type="time"
              value={form.horaFim}
              onChange={(e) => update("horaFim", e.target.value)}
              className={fieldInputCls}
            />
          </FormField>
        </div>

        <FormField label="Quantos convidados? *">
          <input
            type="number"
            value={form.numConvidados}
            onChange={(e) => update("numConvidados", e.target.value)}
            placeholder="ex: 30"
            className={fieldInputCls}
          />
        </FormField>

        <FormField label="Ocasião *">
          <select
            value={form.ocasiao}
            onChange={(e) => update("ocasiao", e.target.value as OcasiaoEvento | "")}
            className={fieldInputCls}
          >
            <option value="">— selecione —</option>
            <option value="aniversario">{OCASIAO_LABEL.aniversario}</option>
            <option value="corporativo">{OCASIAO_LABEL.corporativo}</option>
            <option value="encontro_amigos">{OCASIAO_LABEL.encontro_amigos}</option>
            <option value="outros">{OCASIAO_LABEL.outros}</option>
          </select>
          {form.ocasiao === "outros" && (
            <input
              value={form.ocasiaoOutros}
              onChange={(e) => update("ocasiaoOutros", e.target.value)}
              placeholder="Descreve a ocasião"
              className={fieldInputCls + " mt-2"}
            />
          )}
        </FormField>

        {/* Modelo do evento */}
        <FormField label="Modelo de evento *">
          <div className="mt-1 grid grid-cols-1 gap-1.5">
            <button
              type="button"
              onClick={() => update("modeloEvento", "locacao_consumo_livre")}
              style={optionStyle(form.modeloEvento === "locacao_consumo_livre", corPrimaria)}
            >
              <strong>Locação do espaço</strong>
              <span className="block text-xs mt-0.5 opacity-80">
                Comanda individual, consumo livre — cada convidado paga o que consumir.
              </span>
            </button>
            <button
              type="button"
              onClick={() => update("modeloEvento", "pacote_por_pessoa")}
              style={optionStyle(form.modeloEvento === "pacote_por_pessoa", corPrimaria)}
            >
              <strong>Pacote por pessoa</strong>
              <span className="block text-xs mt-0.5 opacity-80">
                Valor fixo por convidado com comidas e/ou bebidas inclusas.
              </span>
            </button>
          </div>
        </FormField>

        {form.modeloEvento === "pacote_por_pessoa" && (
          <FormField label="O pacote inclui *">
            <div className="grid grid-cols-1 gap-1.5">
              {(["somente_comidas", "comidas_bebidas_nao_alcoolicas", "comidas_bebidas_alcoolicas", "outro"] as EscopoPacote[]).map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => update("escopoPacote", opt)}
                  style={optionStyle(form.escopoPacote === opt, corPrimaria)}
                >
                  {ESCOPO_PACOTE_LABEL[opt]}
                </button>
              ))}
            </div>
            {form.escopoPacote === "outro" && (
              <input
                value={form.escopoPacoteOutro}
                onChange={(e) => update("escopoPacoteOutro", e.target.value)}
                placeholder="Descreve o que quer no pacote"
                className={fieldInputCls + " mt-2"}
              />
            )}
          </FormField>
        )}

        {/* Música / decoração */}
        <div className="grid grid-cols-1 gap-2">
          <CheckboxRow
            checked={form.musicaAoVivo}
            onChange={(v) => update("musicaAoVivo", v)}
            label="Pretende levar música ao vivo?"
            corPrimaria={corPrimaria}
          />
          <CheckboxRow
            checked={form.decoracao}
            onChange={(v) => update("decoracao", v)}
            label="Pretende decorar o espaço?"
            corPrimaria={corPrimaria}
          />
        </div>

        {/* Pacote sugerido (do restaurante) */}
        {pacotes.length > 0 && (
          <FormField label="Tem algum pacote nosso em mente? (opcional)">
            <div className="grid grid-cols-1 gap-1.5">
              <button
                type="button"
                onClick={() => update("pacoteSugeridoId", "")}
                style={optionStyle(form.pacoteSugeridoId === "", corPrimaria)}
              >
                <span className="font-medium">Não sei ainda</span>
              </button>
              {pacotes.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => update("pacoteSugeridoId", p.id)}
                  style={optionStyle(form.pacoteSugeridoId === p.id, corPrimaria)}
                >
                  <span className="font-medium">{p.nome}</span>
                  {p.descricao && (
                    <span className="block text-xs opacity-70 mt-0.5">{p.descricao}</span>
                  )}
                  {((p.precoModo || "por_pessoa") !== "personalizado") && (
                    <span className="block text-xs mt-0.5" style={{ color: corPrimaria, opacity: 0.85 }}>
                      {pacotePrecoLabel(p)} · {p.duracaoHoras}h
                    </span>
                  )}
                </button>
              ))}
            </div>
          </FormField>
        )}

        <FormField label="Conta mais (opcional)">
          <textarea
            value={form.observacoesCliente}
            onChange={(e) => update("observacoesCliente", e.target.value)}
            rows={3}
            placeholder="restrições alimentares, expectativa de orçamento, dúvidas..."
            className={fieldInputCls + " resize-y"}
          />
        </FormField>

        {erroGeral && <div className="text-sm text-rose-600">{erroGeral}</div>}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          style={{ ...botaoPrimarioStyle(siteConfig), opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? "Enviando..." : "Enviar interesse"}
        </button>
      </div>
    </SiteFormShell>
  );
}

// ─── Helpers visuais ─────────────────────────────────────────────

function CheckboxRow({ checked, onChange, label, corPrimaria }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  corPrimaria: string;
}) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 8,
      cursor: "pointer",
      padding: "10px 14px",
      borderRadius: 10,
      border: `1px solid ${checked ? `${corPrimaria}60` : "#d1d5db"}`,
      backgroundColor: checked ? `${corPrimaria}10` : "#fff",
      transition: "background-color 0.15s, border-color 0.15s",
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: corPrimaria }}
      />
      <span style={{ fontSize: 14 }}>{label}</span>
    </label>
  );
}

// Estilos inline pros botões pill (PF/PJ) — usa cor primária do tema do site
function pillStyle(active: boolean, corPrimaria: string): CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 10,
    fontSize: 14, fontWeight: 500,
    cursor: "pointer",
    border: `1px solid ${active ? `${corPrimaria}80` : "#d1d5db"}`,
    backgroundColor: active ? `${corPrimaria}15` : "#fff",
    color: active ? corPrimaria : "#374151",
    transition: "background-color 0.15s, border-color 0.15s",
  };
}

// Estilos inline pros botões de opção (modelo de evento, escopo, pacote)
function optionStyle(active: boolean, corPrimaria: string): CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 10,
    fontSize: 14,
    textAlign: "left",
    cursor: "pointer",
    border: `1px solid ${active ? `${corPrimaria}80` : "#d1d5db"}`,
    backgroundColor: active ? `${corPrimaria}10` : "#fff",
    color: "#1a1a1a",
    transition: "background-color 0.15s, border-color 0.15s",
    width: "100%",
  };
}

