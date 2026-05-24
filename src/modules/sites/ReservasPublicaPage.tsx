import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { Reserva, SiteConfig } from "../../core/types";
import { validarEmail } from "../eventos/validacoes";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "../eventos/paises";

// Página pública: cliente solicita reserva de mesa.
// Rota: /reservas/:rid (sem auth). Cria doc em /reservas com origem=publico
// e status=pendente — admin valida/confirma no módulo Reservas + CRM.
export function ReservasPublicaPage() {
  const { rid } = useParams<{ rid: string }>();
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [erro, setErro] = useState("");
  const [naoEncontrado, setNaoEncontrado] = useState(false);

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

  useEffect(() => {
    if (!rid) return;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "sitesConfig"), where("__name__", "==", rid)));
        const cfg = snap.docs[0];
        if (!cfg) {
          setNaoEncontrado(true);
          return;
        }
        const data = { id: cfg.id, ...cfg.data() } as SiteConfig;
        if (!data.publicado || !data.features?.hasReservas) {
          setNaoEncontrado(true);
          return;
        }
        setSiteConfig(data);
      } catch (e) {
        console.error(e);
        setErro("Erro ao carregar página. Tenta de novo em alguns minutos.");
      } finally {
        setLoading(false);
      }
    })();
  }, [rid]);

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

  const tema = useMemo(() => siteConfig?.tema, [siteConfig]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Carregando...</div>;
  if (naoEncontrado || !siteConfig) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-3">❌</div>
          <p className="text-gray-800 dark:text-gray-200 font-medium">Página não encontrada</p>
          <p className="text-sm text-gray-500 mt-2">
            Confere o link ou contata o restaurante.
          </p>
        </div>
      </div>
    );
  }
  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl border p-8 max-w-lg text-center">
          <div className="text-5xl mb-4">✓</div>
          <h1 className="text-xl font-bold mb-2">Reserva enviada!</h1>
          <p className="text-sm text-gray-600">
            A gente confere a disponibilidade e confirma pelo WhatsApp em breve.
          </p>
          {siteConfig.slug && siteConfig.publicado && (
            <a
              href={`/site/${siteConfig.slug}`}
              className="inline-block mt-6 text-sm text-indigo-600 hover:underline"
            >
              ← Voltar pro site
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen py-8 px-4"
      style={{
        backgroundColor: tema?.corFundo || "#f9fafb",
        color: tema?.corTexto || "#1a1a1a",
        fontFamily: tema?.fonteCorpo || undefined,
      }}
    >
      <div className="max-w-xl mx-auto">
        {siteConfig.slug && siteConfig.publicado && (
          <a
            href={`/site/${siteConfig.slug}`}
            className="inline-block mb-4 text-sm hover:underline"
            style={{ color: tema?.corPrimaria || "#666" }}
          >
            ← Voltar pro site
          </a>
        )}
        <div className="bg-white rounded-2xl shadow-xl border p-6 sm:p-8">
          <div className="text-center mb-6">
            <h1
              className="text-2xl font-bold"
              style={{ color: tema?.corPrimaria, fontFamily: tema?.fonteHeading || undefined }}
            >
              Reservar mesa
            </h1>
            <p className="text-sm text-gray-600 mt-2">
              Preenche aí e a gente confirma pelo WhatsApp.
            </p>
          </div>

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

            <Button
              onClick={submit}
              disabled={submitting}
              className="w-full"
              style={tema?.corPrimaria ? { backgroundColor: tema.corPrimaria } : undefined}
            >
              {submitting ? "Enviando..." : "Solicitar reserva"}
            </Button>
          </div>
        </div>

        <p className="text-center text-[11px] text-gray-500 mt-4">
          Powered by Planejamento.app
        </p>
      </div>
    </div>
  );
}
