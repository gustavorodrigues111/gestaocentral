import { useState } from "react";
import { useParams } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { SolicitacaoExclusao } from "../../core/types";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "../eventos/paises";
import { useSiteConfigPublic, explicarNotFound } from "./shared/useSiteConfigPublic";
import { SiteFormShell, SiteFormScreen, botaoPrimarioStyle } from "./shared/SiteFormShell";
import { FormField, fieldInputCls } from "./shared/FormField";

// Página pública: cliente solicita exclusão dos seus dados (LGPD Art. 18).
// Rota: /r/excluir-dados/:rid. Cria doc em /solicitacoesExclusao com
// status=pendente. Admin processa no módulo Reservas (ou via console).
export function ExcluirDadosPage() {
  const { rid } = useParams<{ rid: string }>();
  const { siteConfig, loading, erro: erroCarregar, notFoundMotivo } = useSiteConfigPublic(rid);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [erro, setErro] = useState("");

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [paisIso, setPaisIso] = useState(PAIS_BR.iso);
  const [ddiManual, setDdiManual] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [motivo, setMotivo] = useState("");

  async function submit() {
    setErro("");
    const pais = getPaisByIso(paisIso);
    if (pais.iso === "OUTROS") {
      if (!validarDDIManual(ddiManual)) return setErro("DDI inválido.");
      if (whatsapp.replace(/\D/g, "").length < 4) return setErro("Digite seu WhatsApp.");
    } else if (!validarNumeroLocal(whatsapp, pais)) {
      return setErro("WhatsApp inválido. Confere DDD + número.");
    }

    setSubmitting(true);
    try {
      if (!rid) throw new Error("URL inválida");
      const id = `excl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const telefoneE164 = montarE164(pais.iso === "OUTROS" ? ddiManual : pais.ddi, whatsapp);

      const solicitacao: SolicitacaoExclusao = {
        id,
        restaurantId: rid,
        telefone: telefoneE164,
        email: email.trim() || undefined,
        nome: nome.trim() || undefined,
        motivo: motivo.trim() || undefined,
        status: "pendente",
        criadoEm: now,
      };
      await setDoc(doc(db, "solicitacoesExclusao", id), sanitizeForFirestore(solicitacao));
      setSubmitted(true);
    } catch (e) {
      console.error(e);
      setErro(e instanceof Error ? e.message : "Erro ao enviar — tenta novamente");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Carregando...</div>;
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
        mensagem={explicarNotFound(notFoundMotivo)}
      />
    );
  }
  if (submitted) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="✓"
        titulo="Solicitação recebida"
        mensagem="Vamos processar em até 15 dias úteis (prazo legal LGPD) e te confirmar pelo WhatsApp ou email."
      />
    );
  }

  return (
    <SiteFormShell
      siteConfig={siteConfig}
      titulo="Solicitar exclusão de dados"
      subtitulo="Vamos apagar seus dados pessoais (nome, telefone, email, histórico de reservas) em até 15 dias úteis, conforme LGPD."
    >
      <div className="space-y-4">
        <FormField label="Seu nome (opcional)">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={fieldInputCls}
            placeholder="Pra confirmar sua identidade"
          />
        </FormField>

        <FormField label="WhatsApp *" dica="Usamos pra localizar seus dados">
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

        <FormField label="Email (opcional)">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Pra confirmar a exclusão"
            className={fieldInputCls}
          />
        </FormField>

        <FormField label="Motivo (opcional)">
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            placeholder="Conta pra gente por que está pedindo — não é obrigatório"
            className={fieldInputCls + " resize-y"}
          />
        </FormField>

        <div className="text-xs rounded-lg p-3 bg-amber-50 border border-amber-200 text-amber-900">
          ⚠️ A exclusão remove seu nome, telefone, email e observações pessoais.
          O histórico de reservas (data, hora, salão) é mantido de forma <strong>anonimizada</strong> pra estatísticas
          internas. Após a exclusão, você perderá vantagens de cliente recorrente (descontos, tags, etc).
        </div>

        {erro && <div className="text-sm text-rose-600">{erro}</div>}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          style={{ ...botaoPrimarioStyle(siteConfig), opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? "Enviando..." : "Solicitar exclusão"}
        </button>
      </div>
    </SiteFormShell>
  );
}
