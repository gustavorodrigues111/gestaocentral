import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { CandidaturaTrabalhe, SiteConfig } from "../../core/types";
import { validarEmail } from "../eventos/validacoes";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "../eventos/paises";

// Página pública: candidato envia candidatura pra trabalhar no restaurante.
// Rota: /trabalhe/:rid (sem auth). Cria doc em /candidaturasTrabalhe.
export function TrabalhePublicaPage() {
  const { rid } = useParams<{ rid: string }>();
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [erro, setErro] = useState("");
  const [naoEncontrado, setNaoEncontrado] = useState(false);

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
        if (!data.publicado || !data.features?.hasTrabalheConosco) {
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
          <h1 className="text-xl font-bold mb-2">Candidatura recebida!</h1>
          <p className="text-sm text-gray-600">
            A gente vai analisar e entra em contato em breve se fizer sentido.
          </p>
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
        <div className="bg-white rounded-2xl shadow-xl border p-6 sm:p-8">
          <div className="text-center mb-6">
            <h1
              className="text-2xl font-bold"
              style={{ color: tema?.corPrimaria, fontFamily: tema?.fonteHeading || undefined }}
            >
              Trabalhe com a gente
            </h1>
            <p className="text-sm text-gray-600 mt-2">
              Conta um pouco sobre você e em que área tem interesse de trabalhar.
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

            <Button
              onClick={submit}
              disabled={submitting}
              className="w-full"
              style={tema?.corPrimaria ? { backgroundColor: tema.corPrimaria } : undefined}
            >
              {submitting ? "Enviando..." : "Enviar candidatura"}
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
