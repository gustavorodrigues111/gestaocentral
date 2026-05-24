import { useEffect, useState } from "react";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { LinkDelivery, RedeSocial, SiteConfig, TemaSite } from "../../core/types";
import { defaultSiteConfig, useSiteConfig } from "./useSiteConfig";

type Props = {
  rid: string;
  nomeRestaurante: string;
  podeEditar: boolean;
};

const TIPO_REDE_OPCOES: RedeSocial["tipo"][] = ["instagram", "whatsapp", "facebook", "tiktok", "youtube", "outro"];
const TIPO_DELIVERY_OPCOES: LinkDelivery["plataforma"][] = ["ifood", "rappi", "uber", "proprio", "outro"];

const TIPO_REDE_LABEL: Record<RedeSocial["tipo"], string> = {
  instagram: "Instagram", whatsapp: "WhatsApp", facebook: "Facebook",
  tiktok: "TikTok", youtube: "YouTube", outro: "Outro",
};
const TIPO_DELIVERY_LABEL: Record<LinkDelivery["plataforma"], string> = {
  ifood: "iFood", rappi: "Rappi", uber: "Uber Eats", proprio: "Próprio", outro: "Outro",
};

export function GeralTab({ rid, nomeRestaurante, podeEditar }: Props) {
  const { pessoa: me } = useAuth();
  const { config: cfgRemoto, existe, loading, erro, save } = useSiteConfig(rid, nomeRestaurante);
  const [form, setForm] = useState<SiteConfig | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Sync inicial com o snapshot remoto
  useEffect(() => {
    if (cfgRemoto && !form) setForm(cfgRemoto);
  }, [cfgRemoto, form]);

  if (loading || !form) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">⚠ Regras Firestore não publicadas</p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (erro) return <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">⚠ {erro}</div>;

  function atualizar<K extends keyof SiteConfig>(k: K, v: SiteConfig[K]) {
    setForm(f => f ? { ...f, [k]: v } : f);
  }
  function atualizarEndereco<K extends keyof SiteConfig["endereco"]>(k: K, v: SiteConfig["endereco"][K]) {
    setForm(f => f ? { ...f, endereco: { ...f.endereco, [k]: v } } : f);
  }
  function atualizarTema<K extends keyof TemaSite>(k: K, v: TemaSite[K]) {
    setForm(f => f ? { ...f, tema: { ...f.tema, [k]: v } } : f);
  }
  function atualizarFeature<K extends keyof SiteConfig["features"]>(k: K, v: boolean) {
    setForm(f => f ? { ...f, features: { ...f.features, [k]: v } } : f);
  }

  function addRede() {
    setForm(f => f ? { ...f, redes: [...f.redes, { tipo: "instagram", url: "" }] } : f);
  }
  function setRede(idx: number, parcial: Partial<RedeSocial>) {
    setForm(f => f ? { ...f, redes: f.redes.map((r, i) => i === idx ? { ...r, ...parcial } : r) } : f);
  }
  function delRede(idx: number) {
    setForm(f => f ? { ...f, redes: f.redes.filter((_, i) => i !== idx) } : f);
  }

  function addDelivery() {
    setForm(f => f ? { ...f, delivery: [...(f.delivery || []), { plataforma: "ifood", url: "" }] } : f);
  }
  function setDelivery(idx: number, parcial: Partial<LinkDelivery>) {
    setForm(f => f ? { ...f, delivery: (f.delivery || []).map((d, i) => i === idx ? { ...d, ...parcial } : d) } : f);
  }
  function delDelivery(idx: number) {
    setForm(f => f ? { ...f, delivery: (f.delivery || []).filter((_, i) => i !== idx) } : f);
  }

  async function salvar() {
    if (!me || !form) return;
    setSalvando(true);
    try {
      await save(form, me.id);
      setSavedAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  function resetar() {
    if (!confirm("Resetar tudo pros valores padrão? Você perde as edições não salvas.")) return;
    setForm(defaultSiteConfig(rid, nomeRestaurante));
  }

  const inputDisabled = !podeEditar;

  return (
    <div className="space-y-6">
      {!existe && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200">
          ⓘ Ainda não há configuração salva pra este restaurante — você está vendo valores padrão.
          Edita e clica em <strong>Salvar</strong> pra criar.
        </div>
      )}

      {/* IDENTIDADE / HERO */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Identidade e abertura
        </h3>
        <Input
          label="Slogan / tagline"
          value={form.slogan || ""}
          onChange={(e) => atualizar("slogan", e.target.value)}
          placeholder="ex: laboratório gastronômico"
          disabled={inputDisabled}
        />
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            História do restaurante
          </label>
          <textarea
            value={form.historia}
            onChange={(e) => atualizar("historia", e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
            rows={6}
            placeholder="Conta a história do restaurante — vai pro topo do site público."
            disabled={inputDisabled}
          />
        </div>
        <Input
          label="URL do logo (Storage)"
          value={form.logoUrl || ""}
          onChange={(e) => atualizar("logoUrl", e.target.value)}
          placeholder="https://..."
          disabled={inputDisabled}
        />
        <Input
          label="URL da imagem hero (banner topo)"
          value={form.heroImagemUrl || ""}
          onChange={(e) => atualizar("heroImagemUrl", e.target.value)}
          placeholder="https://..."
          disabled={inputDisabled}
        />
        <p className="text-[11px] text-gray-500 -mt-2">
          (Upload direto no admin vai entrar na Fase 4. Por enquanto cole a URL.)
        </p>
      </section>

      {/* ENDEREÇO */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Endereço
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Rua"
            value={form.endereco.rua}
            onChange={(e) => atualizarEndereco("rua", e.target.value)}
            disabled={inputDisabled}
          />
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Input
              label="Número"
              value={form.endereco.numero || ""}
              onChange={(e) => atualizarEndereco("numero", e.target.value)}
              disabled={inputDisabled}
            />
            <Input
              label="Complemento"
              value={form.endereco.complemento || ""}
              onChange={(e) => atualizarEndereco("complemento", e.target.value)}
              disabled={inputDisabled}
            />
          </div>
          <Input
            label="Bairro"
            value={form.endereco.bairro || ""}
            onChange={(e) => atualizarEndereco("bairro", e.target.value)}
            disabled={inputDisabled}
          />
          <div className="grid grid-cols-[2fr_60px] gap-2">
            <Input
              label="Cidade"
              value={form.endereco.cidade}
              onChange={(e) => atualizarEndereco("cidade", e.target.value)}
              disabled={inputDisabled}
            />
            <Input
              label="UF"
              value={form.endereco.uf}
              onChange={(e) => atualizarEndereco("uf", e.target.value.toUpperCase().slice(0, 2))}
              disabled={inputDisabled}
            />
          </div>
          <Input
            label="CEP"
            value={form.endereco.cep || ""}
            onChange={(e) => atualizarEndereco("cep", e.target.value)}
            disabled={inputDisabled}
          />
          <Input
            label="URL Google Maps (compartilhamento)"
            value={form.endereco.googleMapsUrl || ""}
            onChange={(e) => atualizarEndereco("googleMapsUrl", e.target.value)}
            placeholder="https://maps.google.com/..."
            disabled={inputDisabled}
          />
        </div>
      </section>

      {/* CONTATO */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Contato
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Telefone"
            value={form.telefone || ""}
            onChange={(e) => atualizar("telefone", e.target.value)}
            placeholder="+55 11 99999-9999"
            disabled={inputDisabled}
          />
          <Input
            label="Email de contato"
            type="email"
            value={form.emailContato || ""}
            onChange={(e) => atualizar("emailContato", e.target.value)}
            disabled={inputDisabled}
          />
        </div>
      </section>

      {/* REDES SOCIAIS */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Redes sociais
          </h3>
          {podeEditar && <Button size="sm" variant="secondary" onClick={addRede}>+ adicionar</Button>}
        </div>
        {form.redes.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">Nenhuma rede ainda.</p>
        ) : (
          <div className="space-y-2">
            {form.redes.map((r, i) => (
              <div key={i} className="grid grid-cols-[120px_1fr_auto] gap-2 items-center">
                <select
                  value={r.tipo}
                  onChange={(e) => setRede(i, { tipo: e.target.value as RedeSocial["tipo"] })}
                  className="px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  disabled={inputDisabled}
                >
                  {TIPO_REDE_OPCOES.map(t => (
                    <option key={t} value={t}>{TIPO_REDE_LABEL[t]}</option>
                  ))}
                </select>
                <input
                  value={r.url}
                  onChange={(e) => setRede(i, { url: e.target.value })}
                  placeholder="URL"
                  className="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                  disabled={inputDisabled}
                />
                {podeEditar && (
                  <button onClick={() => delRede(i)} className="text-xs text-rose-600 hover:underline px-2">
                    apagar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* FEATURES */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Seções do site
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Liga/desliga seções no site público. Desativadas não aparecem.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <CheckRow label="Reservas (form/widget)" checked={form.features.hasReservas} onChange={(v) => atualizarFeature("hasReservas", v)} disabled={inputDisabled} />
          <CheckRow label="Eventos privados" checked={form.features.hasEventos} onChange={(v) => atualizarFeature("hasEventos", v)} disabled={inputDisabled} />
          <CheckRow label="Espaço Laje (rooftop)" checked={form.features.hasLaje} onChange={(v) => atualizarFeature("hasLaje", v)} disabled={inputDisabled} />
          <CheckRow label="Trabalhe conosco" checked={form.features.hasTrabalheConosco} onChange={(v) => atualizarFeature("hasTrabalheConosco", v)} disabled={inputDisabled} />
          <CheckRow label="Delivery" checked={form.features.hasDelivery} onChange={(v) => atualizarFeature("hasDelivery", v)} disabled={inputDisabled} />
          <CheckRow label="Galeria de fotos" checked={form.features.hasGaleria} onChange={(v) => atualizarFeature("hasGaleria", v)} disabled={inputDisabled} />
        </div>
      </section>

      {/* DELIVERY links */}
      {form.features.hasDelivery && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Links de delivery
            </h3>
            {podeEditar && <Button size="sm" variant="secondary" onClick={addDelivery}>+ adicionar</Button>}
          </div>
          {(form.delivery || []).length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">Nenhum link ainda.</p>
          ) : (
            <div className="space-y-2">
              {(form.delivery || []).map((d, i) => (
                <div key={i} className="grid grid-cols-[120px_1fr_auto] gap-2 items-center">
                  <select
                    value={d.plataforma}
                    onChange={(e) => setDelivery(i, { plataforma: e.target.value as LinkDelivery["plataforma"] })}
                    className="px-2 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    disabled={inputDisabled}
                  >
                    {TIPO_DELIVERY_OPCOES.map(t => (
                      <option key={t} value={t}>{TIPO_DELIVERY_LABEL[t]}</option>
                    ))}
                  </select>
                  <input
                    value={d.url}
                    onChange={(e) => setDelivery(i, { url: e.target.value })}
                    placeholder="URL"
                    className="px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                    disabled={inputDisabled}
                  />
                  {podeEditar && (
                    <button onClick={() => delDelivery(i)} className="text-xs text-rose-600 hover:underline px-2">
                      apagar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TEMA */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
            Tema visual
          </h3>
          {!inputDisabled && (
            <button
              type="button"
              onClick={() => {
                if (!confirm("Limpar todas as customizações do tema? O site volta ao visual padrão do template selecionado.")) return;
                setForm(f => f ? {
                  ...f,
                  tema: {
                    corPrimaria: "", corSecundaria: "", corFundo: "", corTexto: "",
                    fonteHeading: "", fonteCorpo: "", raioBorda: "",
                  },
                } : f);
              }}
              className="text-xs text-indigo-600 hover:underline"
            >
              ↺ usar padrão do template
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Sobrescreve as cores/fontes definidas pelo template. Campos vazios = template decide.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ColorInputComLimpar label="Cor primária" value={form.tema.corPrimaria} onChange={(v) => atualizarTema("corPrimaria", v)} disabled={inputDisabled} />
          <ColorInputComLimpar label="Cor secundária" value={form.tema.corSecundaria} onChange={(v) => atualizarTema("corSecundaria", v)} disabled={inputDisabled} />
          <ColorInputComLimpar label="Cor de fundo" value={form.tema.corFundo || ""} onChange={(v) => atualizarTema("corFundo", v)} disabled={inputDisabled} />
          <ColorInputComLimpar label="Cor de texto" value={form.tema.corTexto || ""} onChange={(v) => atualizarTema("corTexto", v)} disabled={inputDisabled} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Fonte heading (CSS font-family)"
            value={form.tema.fonteHeading || ""}
            onChange={(e) => atualizarTema("fonteHeading", e.target.value)}
            placeholder="(padrão do template)"
            disabled={inputDisabled}
          />
          <Input
            label="Fonte corpo (CSS font-family)"
            value={form.tema.fonteCorpo || ""}
            onChange={(e) => atualizarTema("fonteCorpo", e.target.value)}
            placeholder="(padrão do template)"
            disabled={inputDisabled}
          />
        </div>
      </section>

      {/* TEXTOS DAS SEÇÕES */}
      <TextosSection form={form} setForm={setForm} disabled={inputDisabled} />

      {/* TEMPLATE */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Template visual
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Cada template tem layout, tipografia e personalidade próprios.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <TemplateCard
            templateId="lobozo"
            label="🌿 Lobozó"
            descricao="Caipira refinado — verde + dourado, serif rústica"
            ativo={form.templateId === "lobozo"}
            onClick={() => atualizar("templateId", "lobozo")}
            disabled={inputDisabled}
          />
          <TemplateCard
            templateId="default"
            label="📄 Default"
            descricao="Genérico limpo — usa as cores do tema"
            ativo={form.templateId === "default"}
            onClick={() => atualizar("templateId", "default")}
            disabled={inputDisabled}
          />
          <TemplateCard
            templateId="sororoca"
            label="🌾 Sororoca"
            descricao="Em breve"
            ativo={false}
            onClick={() => {}}
            disabled
          />
          <TemplateCard
            templateId="puba"
            label="🌑 Puba"
            descricao="Em breve"
            ativo={false}
            onClick={() => {}}
            disabled
          />
        </div>
      </section>

      {/* PUBLICAÇÃO */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
          Publicação
        </h3>
        <div className="flex items-center gap-3">
          <CheckRow
            label="Site publicado (visível pro público)"
            checked={form.publicado}
            onChange={(v) => atualizar("publicado", v)}
            disabled={inputDisabled}
          />
        </div>
        <Input
          label="Slug (URL temporária pré-DNS)"
          value={form.slug}
          onChange={(e) => atualizar("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          placeholder="lobozo"
          disabled={inputDisabled}
        />
        <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-2">
          URL preview: <code>/site/{form.slug}</code> {form.publicado && form.slug && (
            <a href={`/site/${form.slug}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline ml-1">
              abrir em nova aba ↗
            </a>
          )}
        </p>
      </section>

      {/* AÇÕES */}
      {podeEditar && (
        <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2">
          <div className="text-xs text-gray-500">
            {savedAt && <span className="text-emerald-600">✓ salvo às {savedAt}</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={resetar} disabled={salvando}>Resetar pros padrões</Button>
            <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckRow({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 ${disabled ? "opacity-60" : "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="accent-indigo-600"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function TextosSection({ form, setForm, disabled }: {
  form: SiteConfig;
  setForm: React.Dispatch<React.SetStateAction<SiteConfig | null>>;
  disabled: boolean;
}) {
  const textos = form.textos || {};
  function setTexto(k: keyof NonNullable<SiteConfig["textos"]>, v: string) {
    setForm(f => f ? { ...f, textos: { ...(f.textos || {}), [k]: v } } : f);
  }
  function resetAll() {
    if (!confirm("Limpar todos os textos? O template volta a usar os textos padrão da marca.")) return;
    setForm(f => f ? { ...f, textos: {} } : f);
  }

  // Definição dos campos editáveis, agrupados por seção do site
  const grupos: { titulo: string; campos: {
    chave: keyof NonNullable<SiteConfig["textos"]>;
    label: string;
    placeholder: string;
    longo?: boolean;
    dica?: string;
  }[] }[] = [
    {
      titulo: "Hero (topo da página)",
      campos: [
        { chave: "heroTitulo",    label: "Título do hero", placeholder: "ex: Cozinha caipira,\\nfeita com tempo.", longo: true, dica: "Use \\n pra quebra de linha" },
        { chave: "heroSubtitulo", label: "Subtítulo", placeholder: "Texto curto abaixo do título", longo: true },
        { chave: "heroCtaLabel",  label: "Botão de CTA", placeholder: "Faça sua reserva" },
      ],
    },
    {
      titulo: "História",
      campos: [
        { chave: "historiaTitulo", label: "Título", placeholder: "A nossa história" },
      ],
    },
    {
      titulo: "Cardápio",
      campos: [
        { chave: "cardapioTitulo", label: "Título", placeholder: "Cardápio" },
      ],
    },
    {
      titulo: "Horário",
      campos: [
        { chave: "horarioTitulo",                 label: "Título", placeholder: "Horário de funcionamento" },
        { chave: "horarioProximosAvisosLabel",    label: "Label dos avisos", placeholder: "Próximos avisos" },
      ],
    },
    {
      titulo: "Eventos / Laje",
      campos: [
        { chave: "lajeTitulo",    label: "Título Laje", placeholder: "Eventos na Laje" },
        { chave: "lajeTexto",     label: "Texto Laje", placeholder: "Descreva o espaço da laje", longo: true },
        { chave: "lajeCtaLabel",  label: "Botão Laje", placeholder: "Solicitar proposta" },
        { chave: "eventosTitulo",   label: "Título Eventos (sem Laje)", placeholder: "Eventos privados" },
        { chave: "eventosTexto",    label: "Texto Eventos", placeholder: "Descreva sua oferta", longo: true },
        { chave: "eventosCtaLabel", label: "Botão Eventos", placeholder: "Solicitar proposta" },
      ],
    },
    {
      titulo: "Reservas",
      campos: [
        { chave: "reservasTitulo",   label: "Título", placeholder: "Reservas" },
        { chave: "reservasTexto",    label: "Texto", placeholder: "Política de reserva", longo: true },
        { chave: "reservasCtaLabel", label: "Botão CTA", placeholder: "💬 Reservar pelo WhatsApp" },
      ],
    },
    {
      titulo: "Delivery",
      campos: [
        { chave: "deliveryTitulo", label: "Título", placeholder: "Peça pra casa" },
      ],
    },
    {
      titulo: "Trabalhe Conosco",
      campos: [
        { chave: "trabalheTitulo",   label: "Título", placeholder: "Venha trabalhar com a gente" },
        { chave: "trabalheTexto",    label: "Texto", placeholder: "Conta sobre as oportunidades", longo: true },
        { chave: "trabalheCtaLabel", label: "Botão CTA", placeholder: "Enviar candidatura" },
      ],
    },
    {
      titulo: "Contato",
      campos: [
        { chave: "contatoTitulo", label: "Título", placeholder: "Como chegar" },
      ],
    },
  ];

  const totalPreenchidos = Object.values(textos).filter(v => !!(v && v.trim())).length;

  return (
    <section className="space-y-2">
      <details className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <summary className="cursor-pointer px-3 py-2 flex items-center justify-between gap-2 list-none">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Textos das seções
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Sobrescreve as frases padrão do template. Deixe em branco pra usar o default.
              {totalPreenchidos > 0 && <strong className="ml-1 text-indigo-600">{totalPreenchidos} customizad{totalPreenchidos === 1 ? "o" : "os"}.</strong>}
            </p>
          </div>
          <span className="text-xs text-gray-400">▼ expandir</span>
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-4">
          {grupos.map(g => (
            <div key={g.titulo}>
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                {g.titulo}
              </div>
              <div className="space-y-2">
                {g.campos.map(c => (
                  <div key={c.chave}>
                    <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500">
                      {c.label}
                    </label>
                    {c.longo ? (
                      <textarea
                        value={textos[c.chave] || ""}
                        onChange={(e) => setTexto(c.chave, e.target.value)}
                        placeholder={c.placeholder}
                        disabled={disabled}
                        rows={2}
                        className="mt-0.5 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                      />
                    ) : (
                      <input
                        value={textos[c.chave] || ""}
                        onChange={(e) => setTexto(c.chave, e.target.value)}
                        placeholder={c.placeholder}
                        disabled={disabled}
                        className="mt-0.5 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
                      />
                    )}
                    {c.dica && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{c.dica}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!disabled && totalPreenchidos > 0 && (
            <button
              onClick={resetAll}
              className="text-xs text-rose-600 hover:underline"
            >
              Limpar todos os textos customizados
            </button>
          )}
        </div>
      </details>
    </section>
  );
}

function TemplateCard({ label, descricao, ativo, onClick, disabled }: {
  templateId: string;
  label: string;
  descricao: string;
  ativo: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`text-left px-3 py-3 rounded-lg border-2 transition-colors ${
        ativo
          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
          : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div className="font-bold text-sm">{label}</div>
      <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{descricao}</div>
    </button>
  );
}

// ColorInput com suporte a valor vazio (usa "padrão do template")
// e botão pra limpar e voltar ao default.
function ColorInputComLimpar({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  const vazio = !value || !value.trim();
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="color"
          value={value || "#888888"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`w-9 h-9 rounded border border-gray-300 dark:border-gray-700 cursor-pointer disabled:opacity-50 ${vazio ? "opacity-40" : ""}`}
        />
        <input
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="(template)"
          disabled={disabled}
          className="flex-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-mono tabular-nums"
        />
        {!disabled && !vazio && (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Limpar (voltar pro padrão do template)"
            className="text-xs text-gray-400 hover:text-rose-600 px-1"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
