import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Input } from "../../core/ui/Input";
import type { Reserva } from "../../core/types";
import { validarEmail } from "../eventos/validacoes";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "../eventos/paises";
import { useSiteConfigPublic, explicarNotFound } from "./shared/useSiteConfigPublic";
import { SiteFormShell, SiteFormScreen, botaoPrimarioStyle } from "./shared/SiteFormShell";

// Página pública: cliente solicita reserva de mesa.
// Rota: /reservas/:rid (sem auth). Cria doc em /reservas com origem=publico
// e status=pendente — admin valida/confirma no módulo Reservas + CRM.
export function ReservasPublicaPage() {
  const { rid } = useParams<{ rid: string }>();
  const { siteConfig, loading, erro: erroCarregar, notFoundMotivo } = useSiteConfigPublic(rid, {
    requireFeature: "hasReservas",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [erro, setErro] = useState("");

  // Data mínima = hoje (formato YYYY-MM-DD pra input type="date")
  const hojeISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [form, setForm] = useState({
    nome: "",
    paisIso: PAIS_BR.iso,
    ddiManual: "",
    whatsapp: "",
    email: "",
    data: "",
    horario: "",
    pessoas: "2",
    ocasiao: "",
    observacoes: "",
  });

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  // Pega o horário de funcionamento do dia da semana selecionado pra mostrar
  // uma dica/aviso ao cliente (não bloqueia, só orienta).
  const horarioDoDia = useMemo(() => {
    if (!form.data || !siteConfig?.horarios) return null;
    const dow = new Date(form.data + "T12:00:00").getDay(); // 0=dom, 6=sab
    const h = siteConfig.horarios.find(x => x.dia === dow);
    if (!h || h.fechado) return { fechado: true as const, turnos: [] as { abre: string; fecha: string }[] };
    return { fechado: false as const, turnos: h.turnos || [] };
  }, [form.data, siteConfig]);

  async function submit() {
    setErro("");
    if (!form.nome.trim()) return setErro("Preenche seu nome.");

    const pais = getPaisByIso(form.paisIso);
    if (pais.iso === "OUTROS") {
      if (!validarDDIManual(form.ddiManual)) return setErro("DDI inválido.");
      if (form.whatsapp.replace(/\D/g, "").length < 4) return setErro("Digite seu WhatsApp.");
    } else if (!validarNumeroLocal(form.whatsapp, pais)) {
      return setErro("WhatsApp inválido. Confere DDD + número.");
    }
    if (form.email.trim() && !validarEmail(form.email)) return setErro("Email inválido.");
    if (!form.data) return setErro("Escolhe a data da reserva.");
    if (form.data < hojeISO) return setErro("A data não pode ser no passado.");
    if (!form.horario) return setErro("Escolhe o horário.");
    const pessoasNum = parseInt(form.pessoas, 10);
    if (!pessoasNum || pessoasNum < 1) return setErro("Quantas pessoas? Mínimo 1.");
    if (pessoasNum > 50) return setErro("Pra grupos acima de 50, fala com a gente pelo WhatsApp.");

    setSubmitting(true);
    try {
      if (!rid) throw new Error("URL inválida");
      const id = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();

      const reserva: Reserva = {
        id,
        restaurantId: rid,
        data: form.data,
        horario: form.horario,
        clienteId: null,
        clienteNomeSnapshot: form.nome.trim(),
        clienteTelefoneSnapshot: montarE164(
          pais.iso === "OUTROS" ? form.ddiManual : pais.ddi,
          form.whatsapp,
        ),
        clienteEmailSnapshot: form.email.trim() || undefined,
        pessoas: pessoasNum,
        mesaId: null,
        observacoes: form.observacoes.trim() || undefined,
        ocasiao: form.ocasiao.trim() || undefined,
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
    } finally {
      setSubmitting(false);
    }
  }

  // ───────────── Estados de carga / erro / sucesso ─────────────
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
  if (submitted) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="✓"
        titulo="Reserva enviada!"
        mensagem="A gente confere a disponibilidade e confirma pelo WhatsApp em breve."
      />
    );
  }

  // ───────────── Form ─────────────
  return (
    <SiteFormShell
      siteConfig={siteConfig}
      titulo="Reservar mesa"
      subtitulo="Preenche aí e a gente confirma pelo WhatsApp."
    >
      <div className="space-y-4">
        <Input
          label="Seu nome *"
          value={form.nome}
          onChange={(e) => update("nome", e.target.value)}
        />

        {/* WhatsApp com seletor de DDI — reusa componente dos Eventos */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
            WhatsApp *
          </label>
          {form.paisIso === "OUTROS" ? (
            <div className="mt-1 grid grid-cols-[110px_70px_1fr] gap-1.5">
              <select
                value={form.paisIso}
                onChange={(e) => { update("paisIso", e.target.value); update("whatsapp", ""); update("ddiManual", ""); }}
                className="px-2 py-2 rounded-lg border border-gray-300 bg-white text-sm"
              >
                {PAISES.map(p => (
                  <option key={p.iso} value={p.iso}>{p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}</option>
                ))}
              </select>
              <input
                type="tel" inputMode="numeric"
                value={form.ddiManual}
                onChange={(e) => update("ddiManual", e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="DDI"
                className="px-2 py-2 rounded-lg border border-gray-300 bg-white text-sm tabular-nums"
              />
              <input
                type="tel" inputMode="numeric"
                value={form.whatsapp}
                onChange={(e) => update("whatsapp", e.target.value)}
                placeholder="Número"
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
              />
            </div>
          ) : (
            <div className="mt-1 grid grid-cols-[110px_1fr] gap-1.5">
              <select
                value={form.paisIso}
                onChange={(e) => { update("paisIso", e.target.value); update("whatsapp", ""); }}
                className="px-2 py-2 rounded-lg border border-gray-300 bg-white text-sm"
              >
                {PAISES.map(p => (
                  <option key={p.iso} value={p.iso}>{p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}</option>
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
                className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
              />
            </div>
          )}
        </div>

        <Input
          label="Email (opcional)"
          type="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="seu@email.com"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Data *
            </label>
            <input
              type="date"
              value={form.data}
              min={hojeISO}
              onChange={(e) => update("data", e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              Horário *
            </label>
            <input
              type="time"
              value={form.horario}
              onChange={(e) => update("horario", e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
            />
          </div>
        </div>

        {/* Aviso suave se restaurante fechado no dia selecionado */}
        {horarioDoDia?.fechado && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Atenção: a casa está fechada nesse dia da semana. Você pode enviar
            mesmo assim — a gente entra em contato pra ajustar.
          </div>
        )}
        {horarioDoDia && !horarioDoDia.fechado && horarioDoDia.turnos.length > 0 && (
          <div className="text-xs text-gray-500">
            Horário do dia: {horarioDoDia.turnos.map(f => `${f.abre}–${f.fecha}`).join(" / ")}
          </div>
        )}

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
            Pessoas *
          </label>
          <input
            type="number" inputMode="numeric"
            min={1} max={50}
            value={form.pessoas}
            onChange={(e) => update("pessoas", e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
          />
        </div>

        <Input
          label="Ocasião (opcional)"
          value={form.ocasiao}
          onChange={(e) => update("ocasiao", e.target.value)}
          placeholder="ex: Aniversário, almoço de negócios"
        />

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
            Observações (opcional)
          </label>
          <textarea
            value={form.observacoes}
            onChange={(e) => update("observacoes", e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
            rows={3}
            placeholder="Restrições alimentares, mesa preferida, etc."
          />
        </div>

        {erro && <div className="text-sm text-rose-600">{erro}</div>}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          style={{ ...botaoPrimarioStyle(siteConfig), opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? "Enviando..." : "Solicitar reserva"}
        </button>
      </div>
    </SiteFormShell>
  );
}
