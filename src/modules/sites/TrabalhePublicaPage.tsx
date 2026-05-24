import { useState } from "react";
import { useParams } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Input } from "../../core/ui/Input";
import type { CandidaturaTrabalhe } from "../../core/types";
import { validarEmail } from "../eventos/validacoes";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "../eventos/paises";
import { useSiteConfigPublic, explicarNotFound } from "./shared/useSiteConfigPublic";
import { SiteFormShell, SiteFormScreen, botaoPrimarioStyle } from "./shared/SiteFormShell";

// Página pública: candidato envia candidatura pra trabalhar no restaurante.
// Rota: /trabalhe/:rid (sem auth). Cria doc em /candidaturasTrabalhe.
export function TrabalhePublicaPage() {
  const { rid } = useParams<{ rid: string }>();
  const { siteConfig, loading, erro: erroCarregar, notFoundMotivo } = useSiteConfigPublic(rid, {
    requireFeature: "hasTrabalheConosco",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [erro, setErro] = useState("");

  const [form, setForm] = useState({
    nome: "",
    paisIso: PAIS_BR.iso,
    ddiManual: "",
    whatsapp: "",
    email: "",
    areaInteresse: "",
    experiencia: "",
    disponibilidade: "",
  });
  const [curriculo, setCurriculo] = useState<File | null>(null);

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

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
    if (!validarEmail(form.email)) return setErro("Email inválido.");
    if (!form.areaInteresse.trim()) return setErro("Conta qual vaga ou área te interessa.");

    setSubmitting(true);
    try {
      if (!rid) throw new Error("URL inválida");
      const id = `cand_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();

      // Upload de currículo (opcional)
      let curriculoUrl: string | undefined;
      if (curriculo) {
        const ext = curriculo.name.split(".").pop()?.toLowerCase() || "pdf";
        const path = `candidaturas/${rid}/${id}.${ext}`;
        const r = storageRef(storage, path);
        const snap = await uploadBytes(r, curriculo, { contentType: curriculo.type });
        curriculoUrl = await getDownloadURL(snap.ref);
      }

      const candidatura: CandidaturaTrabalhe = {
        id,
        restaurantId: rid,
        status: "nova",
        nome: form.nome.trim(),
        whatsapp: montarE164(
          pais.iso === "OUTROS" ? form.ddiManual : pais.ddi,
          form.whatsapp,
        ),
        email: form.email.trim(),
        areaInteresse: form.areaInteresse.trim(),
        experiencia: form.experiencia.trim() || undefined,
        disponibilidade: form.disponibilidade.trim() || undefined,
        curriculoUrl,
        origem: "publico",
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(doc(db, "candidaturasTrabalhe", id), sanitizeForFirestore(candidatura));
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
        mensagem={explicarNotFound(notFoundMotivo, "Trabalhe Conosco")}
      />
    );
  }
  if (submitted) {
    return (
      <SiteFormScreen
        siteConfig={siteConfig}
        icone="✓"
        titulo="Candidatura recebida!"
        mensagem="A gente vai analisar e entra em contato em breve se fizer sentido."
      />
    );
  }

  // ───────────── Form ─────────────
  return (
    <SiteFormShell
      siteConfig={siteConfig}
      titulo="Trabalhe com a gente"
      subtitulo="Conta um pouco sobre você e em que área tem interesse de trabalhar."
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
          label="Email *"
          type="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
        />

        <Input
          label="Área / vaga de interesse *"
          value={form.areaInteresse}
          onChange={(e) => update("areaInteresse", e.target.value)}
          placeholder="ex: garçom, cozinha, bar, caixa, gerência"
        />

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
            Experiência (opcional)
          </label>
          <textarea
            value={form.experiencia}
            onChange={(e) => update("experiencia", e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
            rows={3}
            placeholder="Onde trabalhou antes, há quanto tempo, etc."
          />
        </div>

        <Input
          label="Disponibilidade (opcional)"
          value={form.disponibilidade}
          onChange={(e) => update("disponibilidade", e.target.value)}
          placeholder="ex: imediata, em 30 dias, finais de semana"
        />

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
            Currículo (PDF ou imagem, opcional, máx 10MB)
          </label>
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => setCurriculo(e.target.files?.[0] || null)}
            className="mt-1 block w-full text-sm"
          />
        </div>

        {erro && <div className="text-sm text-rose-600">{erro}</div>}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          style={{ ...botaoPrimarioStyle(siteConfig), opacity: submitting ? 0.6 : 1 }}
        >
          {submitting ? "Enviando..." : "Enviar candidatura"}
        </button>
      </div>
    </SiteFormShell>
  );
}
