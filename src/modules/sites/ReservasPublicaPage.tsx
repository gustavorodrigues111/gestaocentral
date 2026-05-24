import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useParams } from "react-router-dom";
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  ConfiguracaoReservas, Reserva, Salao,
} from "../../core/types";
import { validarEmail } from "../eventos/validacoes";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "../eventos/paises";
import { useSiteConfigPublic, explicarNotFound } from "./shared/useSiteConfigPublic";
import { SiteFormShell, SiteFormScreen, botaoPrimarioStyle } from "./shared/SiteFormShell";
import { FormField, fieldInputCls } from "./shared/FormField";

// Página pública: cliente solicita reserva de mesa.
// Rota: /reservas/:rid (sem auth).
//
// Fluxo wizard em 3 passos:
//   1. WhatsApp → lookup em /reservas pra ver se é cliente recorrente
//      (pré-preenche nome/email/observações com base no último registro)
//   2. Detalhes → nome (se novo), data, pessoas, ocasião, observações
//   3. Slot → mostra horários disponíveis do dia (das janelas configuradas)
//      com qtd de vagas por salão (calculada em tempo real). Cliente
//      escolhe slot+salão.
//
// Cria doc em /reservas com origem=publico e status=pendente — admin
// confirma no módulo Reservas + CRM.

type Step = "phone" | "details" | "slot" | "submitting";

export function ReservasPublicaPage() {
  const { rid } = useParams<{ rid: string }>();
  const { siteConfig, loading: loadingSite, erro: erroCarregar, notFoundMotivo } = useSiteConfigPublic(rid, {
    requireFeature: "hasReservas",
  });

  // Salões + configuração de janelas
  const [saloes, setSaloes] = useState<Salao[]>([]);
  const [config, setConfig] = useState<ConfiguracaoReservas | null>(null);
  const [loadingDados, setLoadingDados] = useState(true);

  // Reservas do dia escolhido (pra calcular disponibilidade)
  const [reservasDoDia, setReservasDoDia] = useState<Reserva[]>([]);

  // Step do wizard
  const [step, setStep] = useState<Step>("phone");
  const [submitted, setSubmitted] = useState(false);
  const [erro, setErro] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Cliente reconhecido (se WhatsApp já apareceu antes)
  const [clienteReconhecido, setClienteReconhecido] = useState<{
    nome: string; email?: string; ultimaData?: string; totalReservas: number;
  } | null>(null);

  // Form state
  const [paisIso, setPaisIso] = useState(PAIS_BR.iso);
  const [ddiManual, setDdiManual] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [data, setData] = useState("");
  const [pessoas, setPessoas] = useState("2");
  const [ocasiao, setOcasiao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  // Slot selecionado
  const [slotHorario, setSlotHorario] = useState("");
  const [salaoId, setSalaoId] = useState("");

  // Data mínima = hoje
  const hojeISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // ──────────────── Carrega salões + config ────────────────
  useEffect(() => {
    if (!rid) return;
    let cancelado = false;
    (async () => {
      try {
        const [salSnap, cfgSnap] = await Promise.all([
          getDocs(query(collection(db, "saloes"), where("restaurantId", "==", rid))),
          getDoc(doc(db, "configReservas", rid)),
        ]);
        if (cancelado) return;
        const list = salSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Salao)
          .filter(s => s.ativo)
          .sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));
        setSaloes(list);
        setConfig(cfgSnap.exists() ? ({ id: cfgSnap.id, ...cfgSnap.data() } as ConfiguracaoReservas) : null);
      } catch (e) {
        console.error("[reservas] erro carregando saloes/config:", e);
      } finally {
        setLoadingDados(false);
      }
    })();
    return () => { cancelado = true; };
  }, [rid]);

  // ──────────────── Listener: reservas do dia selecionado ────────────────
  // Reativo — atualiza quando outras pessoas reservam no mesmo dia.
  useEffect(() => {
    if (!rid || !data) { setReservasDoDia([]); return; }
    const q = query(
      collection(db, "reservas"),
      where("restaurantId", "==", rid),
      where("data", "==", data),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Reserva);
      setReservasDoDia(list);
    });
    return () => unsub();
  }, [rid, data]);

  // ──────────────── Validações por step ────────────────
  function validatePhone(): string | null {
    const pais = getPaisByIso(paisIso);
    if (pais.iso === "OUTROS") {
      if (!validarDDIManual(ddiManual)) return "DDI inválido.";
      if (whatsapp.replace(/\D/g, "").length < 4) return "Digite seu WhatsApp.";
    } else if (!validarNumeroLocal(whatsapp, pais)) {
      return "WhatsApp inválido. Confere DDD + número.";
    }
    return null;
  }

  // Avança pro step "details" e busca cliente recorrente
  async function avancarPhone() {
    setErro("");
    const v = validatePhone();
    if (v) return setErro(v);

    // Busca reservas anteriores com esse telefone (montagem E.164)
    const pais = getPaisByIso(paisIso);
    const e164 = montarE164(pais.iso === "OUTROS" ? ddiManual : pais.ddi, whatsapp);
    try {
      const q = query(
        collection(db, "reservas"),
        where("restaurantId", "==", rid),
        where("clienteTelefoneSnapshot", "==", e164),
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        // Pega a mais recente (maior registradoEm) pra usar como template
        const docs = snap.docs.map(d => d.data() as Reserva)
          .sort((a, b) => (b.registradoEm || "").localeCompare(a.registradoEm || ""));
        const ultima = docs[0]!;
        setClienteReconhecido({
          nome: ultima.clienteNomeSnapshot,
          email: ultima.clienteEmailSnapshot,
          ultimaData: ultima.data,
          totalReservas: docs.length,
        });
        setNome(ultima.clienteNomeSnapshot);
        if (ultima.clienteEmailSnapshot) setEmail(ultima.clienteEmailSnapshot);
      } else {
        setClienteReconhecido(null);
      }
    } catch (e) {
      // Falha de lookup não bloqueia — só vai pro próximo step
      console.warn("[reservas] lookup cliente recorrente falhou:", e);
    }
    setStep("details");
  }

  function validateDetails(): string | null {
    if (!nome.trim()) return "Preenche seu nome.";
    if (email.trim() && !validarEmail(email)) return "Email inválido.";
    if (!data) return "Escolhe a data da reserva.";
    if (data < hojeISO) return "A data não pode ser no passado.";
    const n = parseInt(pessoas, 10);
    if (!n || n < 1) return "Quantas pessoas? Mínimo 1.";
    if (n > 50) return "Pra grupos acima de 50, fala com a gente pelo WhatsApp.";
    return null;
  }

  function avancarDetails() {
    setErro("");
    const v = validateDetails();
    if (v) return setErro(v);
    setStep("slot");
  }

  // ──────────────── Slots disponíveis do dia ────────────────
  // Regra de precedência:
  //  1. Se há exceção pra essa data no SiteConfig:
  //     - exc.fechado === true  → sem reservas (casa fechada)
  //     - exc.slotsReservaCustom === [] → sem reservas (sem aceitar reservas)
  //     - exc.slotsReservaCustom = [...] → usa esses slots customizados
  //     - exc.slotsReservaCustom undefined → herda janela semanal
  //  2. Senão, usa janela do dia da semana padrão.
  const slotsDisponiveis = useMemo(() => {
    if (!data || !config) return [];
    const pax = parseInt(pessoas, 10) || 0;

    // Procura exceção pra essa data específica
    const excecao = siteConfig?.excecoes?.find(e => e.data === data);
    let slotsBase: { horario: string; salaoIds: string[] }[];
    if (excecao) {
      if (excecao.fechado) return [];
      if (excecao.slotsReservaCustom !== undefined) {
        if (excecao.slotsReservaCustom.length === 0) return [];
        slotsBase = excecao.slotsReservaCustom;
      } else {
        // Sem custom — herda janela semanal
        const dow = new Date(data + "T12:00:00").getDay();
        const janela = config.janelas?.find(j => j.dia === dow);
        if (!janela || janela.slots.length === 0) return [];
        slotsBase = janela.slots;
      }
    } else {
      // Dia normal — usa janela do dia da semana
      const dow = new Date(data + "T12:00:00").getDay();
      const janela = config.janelas?.find(j => j.dia === dow);
      if (!janela || janela.slots.length === 0) return [];
      slotsBase = janela.slots;
    }

    return slotsBase.map(slot => {
      // Pra cada salão habilitado nesse slot, computa vagas
      const salaoStatus = slot.salaoIds.map(sId => {
        const sal = saloes.find(s => s.id === sId);
        if (!sal) return null;
        // Reservas existentes nesse slot+salão (excluindo cancelada/no_show)
        const existentes = reservasDoDia.filter(r =>
          r.salaoId === sId
          && r.horario === slot.horario
          && r.status !== "cancelada"
          && r.status !== "no_show"
        );
        // Cliente não vê contagem de vagas (info interna). Só mostra
        // mensagem quando NÃO está disponível — explicando o porquê
        // (ex: "aceita mesas de 4 a 6 pax").
        if (sal.modeloCapacidade === "por_capacidade") {
          const usados = existentes.reduce((s, r) => s + (r.pessoas || 0), 0);
          const cap = sal.capacidadeMaxPax || 0;
          const livres = Math.max(0, cap - usados);
          const minMesa = sal.paxMinPorMesaCap || 1;
          const maxMesa = sal.paxMaxPorMesaCap || cap;
          const paxOk = pax >= minMesa && pax <= maxMesa;
          const disponivel = paxOk && pax <= livres;
          return {
            salao: sal,
            disponivel,
            descricao: disponivel
              ? ""
              : !paxOk
                ? `aceita mesas de ${minMesa} a ${maxMesa} pax`
                : "sem vagas neste horário",
          };
        } else {
          const usadas = existentes.length;
          const total = sal.numMesas || 0;
          const livres = Math.max(0, total - usadas);
          const minMesa = sal.paxMinPorMesa || 1;
          const maxMesa = sal.paxMaxPorMesa || minMesa;
          const paxOk = pax >= minMesa && pax <= maxMesa;
          const disponivel = paxOk && livres > 0;
          return {
            salao: sal,
            disponivel,
            descricao: disponivel
              ? ""
              : !paxOk
                ? `mesas de ${minMesa}–${maxMesa} pax`
                : "sem mesas neste horário",
          };
        }
      }).filter((x): x is NonNullable<typeof x> => !!x);

      const algumDisponivel = salaoStatus.some(s => s.disponivel);
      return { horario: slot.horario, salaoStatus, algumDisponivel };
    });
  }, [data, config, saloes, reservasDoDia, pessoas, siteConfig?.excecoes]);

  // ──────────────── Submit ────────────────
  async function submit() {
    setErro("");
    if (!slotHorario || !salaoId) {
      return setErro("Escolhe horário e salão.");
    }
    setSubmitting(true);
    setStep("submitting");
    try {
      if (!rid) throw new Error("URL inválida");
      const pais = getPaisByIso(paisIso);
      const id = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const sal = saloes.find(s => s.id === salaoId);

      const reserva: Reserva = {
        id,
        restaurantId: rid,
        data,
        horario: slotHorario,
        clienteId: null,
        clienteNomeSnapshot: nome.trim(),
        clienteTelefoneSnapshot: montarE164(
          pais.iso === "OUTROS" ? ddiManual : pais.ddi,
          whatsapp,
        ),
        clienteEmailSnapshot: email.trim() || undefined,
        pessoas: parseInt(pessoas, 10),
        salaoId,
        salaoNomeSnapshot: sal?.nome,
        mesaId: null,
        observacoes: observacoes.trim() || undefined,
        ocasiao: ocasiao.trim() || undefined,
        status: "pendente",
        origem: "publico",
        registradoEm: now,
        registradoPor: "publico",
        atualizadoEm: now,
      };
      await setDoc(doc(db, "reservas", id), sanitizeForFirestore(reserva));
      setSubmitted(true);
    } catch (e) {
      console.error(e);
      setErro(e instanceof Error ? e.message : "Erro ao enviar — tenta novamente");
      setStep("slot");
    } finally {
      setSubmitting(false);
    }
  }

  // ──────────────── Estados de carga/erro/sucesso ────────────────
  const loading = loadingSite || loadingDados;
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 14 }}>
        Carregando...
      </div>
    );
  }
  if (erroCarregar) {
    return <SiteFormScreen siteConfig={siteConfig} icone="⚠️" titulo="Erro ao carregar" mensagem={erroCarregar} />;
  }
  if (notFoundMotivo) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="❌"
        titulo="Página não encontrada"
        mensagem={explicarNotFound(notFoundMotivo, "reservas online")}
      />
    );
  }
  // Sem salões cadastrados → instrução
  if (saloes.length === 0) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="🏛️"
        titulo="Reservas em configuração"
        mensagem="O restaurante ainda não cadastrou os salões. Tenta de novo em algumas horas."
      />
    );
  }
  // Sem janelas configuradas → instrução
  if (!config || config.janelas.every(j => j.slots.length === 0)) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="🕒"
        titulo="Reservas em configuração"
        mensagem="O restaurante ainda não definiu horários de reserva. Tenta de novo em algumas horas."
      />
    );
  }
  if (submitted) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="✓"
        titulo="Reserva enviada!"
        mensagem={
          <>
            A gente confere a disponibilidade e confirma pelo WhatsApp em breve.
            <br />
            <strong>{data && formatarDataBR(data)} · {slotHorario}</strong>
            {saloes.find(s => s.id === salaoId)?.nome && (
              <> · {saloes.find(s => s.id === salaoId)?.nome}</>
            )}
          </>
        }
      />
    );
  }

  // ──────────────── Render ────────────────
  const corPrimaria = siteConfig?.tema?.corPrimaria || "#1a5c2a";

  return (
    <SiteFormShell
      siteConfig={siteConfig}
      titulo="Reservar mesa"
      subtitulo={
        step === "phone"
          ? "Pra começar, qual seu WhatsApp?"
          : step === "details"
            ? "Conta um pouco sobre você e o dia."
            : "Escolhe horário e salão."
      }
    >
      {/* Barra de progresso visual */}
      <StepIndicator step={step} corPrimaria={corPrimaria} />

      {/* STEP 1: WhatsApp */}
      {step === "phone" && (
        <div className="space-y-4">
          <FormField label="WhatsApp *">
            {paisIso === "OUTROS" ? (
              <div className="grid grid-cols-[110px_70px_1fr] gap-1.5">
                <select
                  value={paisIso}
                  onChange={(e) => { setPaisIso(e.target.value); setWhatsapp(""); setDdiManual(""); }}
                  className={fieldInputCls}
                >
                  {PAISES.map(p => (
                    <option key={p.iso} value={p.iso}>{p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}</option>
                  ))}
                </select>
                <input
                  type="tel" inputMode="numeric"
                  value={ddiManual}
                  onChange={(e) => setDdiManual(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="DDI"
                  className={fieldInputCls + " tabular-nums"}
                />
                <input
                  type="tel" inputMode="numeric"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="Número"
                  className={fieldInputCls}
                />
              </div>
            ) : (
              <div className="grid grid-cols-[110px_1fr] gap-1.5">
                <select
                  value={paisIso}
                  onChange={(e) => { setPaisIso(e.target.value); setWhatsapp(""); }}
                  className={fieldInputCls}
                >
                  {PAISES.map(p => (
                    <option key={p.iso} value={p.iso}>{p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}</option>
                  ))}
                </select>
                <input
                  type="tel" inputMode="numeric"
                  value={whatsapp}
                  onChange={(e) => {
                    const pais = getPaisByIso(paisIso);
                    setWhatsapp(formatarNumeroLocal(e.target.value, pais));
                  }}
                  placeholder={paisIso === "BR" ? "(11) 99999-9999" : `${getPaisByIso(paisIso).minLen} dígitos`}
                  className={fieldInputCls}
                />
              </div>
            )}
          </FormField>
          {erro && <div className="text-sm text-rose-600">{erro}</div>}
          <button
            type="button"
            onClick={avancarPhone}
            style={botaoPrimarioStyle(siteConfig)}
          >
            Continuar
          </button>
        </div>
      )}

      {/* STEP 2: Detalhes */}
      {step === "details" && (
        <div className="space-y-4">
          {clienteReconhecido && (
            <div className="text-sm rounded-lg p-3" style={{
              backgroundColor: `${corPrimaria}10`,
              border: `1px solid ${corPrimaria}40`,
              color: corPrimaria,
            }}>
              👋 Bom te ver de volta, <strong>{clienteReconhecido.nome.split(" ")[0]}</strong>!
              {clienteReconhecido.totalReservas > 1 && (
                <> {clienteReconhecido.totalReservas}ª reserva com a gente.</>
              )}
            </div>
          )}

          <FormField label="Seu nome *">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className={fieldInputCls}
            />
          </FormField>

          <FormField label="Email (opcional)">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className={fieldInputCls}
            />
          </FormField>

          <FormField label="Data *">
            <input
              type="date"
              value={data}
              min={hojeISO}
              onChange={(e) => { setData(e.target.value); setSlotHorario(""); setSalaoId(""); }}
              className={fieldInputCls}
            />
          </FormField>

          <FormField label="Pessoas *">
            <input
              type="number" inputMode="numeric"
              min={1} max={50}
              value={pessoas}
              onChange={(e) => { setPessoas(e.target.value); setSlotHorario(""); setSalaoId(""); }}
              className={fieldInputCls}
            />
          </FormField>

          <FormField label="Ocasião (opcional)">
            <input
              value={ocasiao}
              onChange={(e) => setOcasiao(e.target.value)}
              placeholder="ex: Aniversário, almoço de negócios"
              className={fieldInputCls}
            />
          </FormField>

          <FormField label="Observações (opcional)">
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={3}
              placeholder="Restrições alimentares, mesa preferida, etc."
              className={fieldInputCls + " resize-y"}
            />
          </FormField>

          {erro && <div className="text-sm text-rose-600">{erro}</div>}

          <button
            type="button"
            onClick={avancarDetails}
            style={botaoPrimarioStyle(siteConfig)}
          >
            Ver horários
          </button>
          <button
            type="button"
            onClick={() => { setErro(""); setStep("phone"); }}
            style={voltarLinkStyle}
          >
            ← Voltar
          </button>
        </div>
      )}

      {/* STEP 3: Slot picker */}
      {(step === "slot" || step === "submitting") && (
        <div className="space-y-4">
          {/* Resumo do que já foi escolhido */}
          <div className="text-xs rounded-lg p-3 bg-gray-50 border border-gray-200">
            <div>📅 {formatarDataBR(data)} · 👥 {pessoas} pessoa(s)</div>
            <div className="mt-0.5 text-gray-500">{nome}</div>
          </div>

          {slotsDisponiveis.length === 0 ? (
            <div className="text-sm rounded-lg p-4 bg-amber-50 border border-amber-200 text-amber-800">
              Sem horários disponíveis pra esse dia. Tenta outra data ou fala
              com a gente pelo WhatsApp.
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Escolhe um horário
              </label>
              {slotsDisponiveis.map(slot => {
                const ativo = slotHorario === slot.horario;
                return (
                  <div key={slot.horario} style={{
                    borderRadius: 12,
                    border: `1px solid ${ativo ? `${corPrimaria}60` : "#d1d5db"}`,
                    backgroundColor: ativo ? `${corPrimaria}08` : "#fff",
                    padding: 12,
                    opacity: slot.algumDisponivel ? 1 : 0.5,
                  }}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-lg font-semibold" style={{ color: corPrimaria }}>
                        🕒 {slot.horario}
                      </div>
                      {!slot.algumDisponivel && (
                        <span className="text-xs text-gray-500">sem vagas</span>
                      )}
                    </div>
                    {slot.algumDisponivel && (
                      <div className="mt-2 grid grid-cols-1 gap-1.5">
                        {slot.salaoStatus.map(({ salao: sal, disponivel, descricao }) => {
                          const salSel = ativo && salaoId === sal.id;
                          return (
                            <button
                              key={sal.id}
                              type="button"
                              disabled={!disponivel}
                              onClick={() => { setSlotHorario(slot.horario); setSalaoId(sal.id); setErro(""); }}
                              style={salaoOptionStyle(salSel, disponivel, corPrimaria)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="font-semibold">{sal.nome}</div>
                                  {sal.descricao && (
                                    <div className="text-xs opacity-70 mt-0.5">{sal.descricao}</div>
                                  )}
                                </div>
                                {!disponivel && descricao && (
                                  <div className="text-xs whitespace-nowrap" style={{ opacity: 0.7 }}>
                                    {descricao}
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {erro && <div className="text-sm text-rose-600">{erro}</div>}

          <button
            type="button"
            onClick={submit}
            disabled={submitting || !slotHorario || !salaoId}
            style={{ ...botaoPrimarioStyle(siteConfig), opacity: (submitting || !slotHorario || !salaoId) ? 0.6 : 1 }}
          >
            {submitting ? "Enviando..." : "Confirmar reserva"}
          </button>
          <button
            type="button"
            onClick={() => { setErro(""); setStep("details"); }}
            disabled={submitting}
            style={voltarLinkStyle}
          >
            ← Voltar
          </button>
        </div>
      )}
    </SiteFormShell>
  );
}

// "Voltar" como link discreto — usado depois do botão primário em cada step
const voltarLinkStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  fontSize: 13,
  padding: "8px 0",
  cursor: "pointer",
  display: "block",
  margin: "0 auto",
  textDecoration: "underline",
  textDecorationStyle: "dotted",
  textUnderlineOffset: 3,
};

// ─── Helpers visuais ────────────────────────────────────────────────

function StepIndicator({ step, corPrimaria }: { step: Step; corPrimaria: string }) {
  const i = step === "phone" ? 0 : step === "details" ? 1 : 2;
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 20 }}>
      {[0, 1, 2].map(idx => (
        <div key={idx} style={{
          width: idx <= i ? 28 : 16,
          height: 6,
          borderRadius: 3,
          backgroundColor: idx <= i ? corPrimaria : "#d1d5db",
          transition: "all 0.2s",
        }} />
      ))}
    </div>
  );
}

function salaoOptionStyle(selecionado: boolean, disponivel: boolean, corPrimaria: string): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    fontSize: 14,
    textAlign: "left",
    cursor: disponivel ? "pointer" : "not-allowed",
    border: `1px solid ${selecionado ? corPrimaria : disponivel ? "#d1d5db" : "#e5e7eb"}`,
    backgroundColor: selecionado ? `${corPrimaria}15` : "#fff",
    color: disponivel ? "#1a1a1a" : "#999",
    transition: "background-color 0.15s, border-color 0.15s",
    width: "100%",
  };
}

function formatarDataBR(iso: string): ReactNode {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}
