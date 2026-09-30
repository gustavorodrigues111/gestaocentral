import { useEffect, useState } from "react";
import { TriangleAlert, Search } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { LinkDelivery, RedeSocial, SiteConfig } from "../../core/types";
import { defaultSiteConfig, useSiteConfig } from "./useSiteConfig";
import { UploadImagem } from "./UploadImagem";
import { defaultTextosByTemplate } from "./templates/textosDefaults";
import { normalizarOrdem, SECAO_LABEL, type SecaoId } from "./templates/ordemSecoes";
import { buscarCep, formatarCep, limparCep, validarCep } from "./cepHelper";
import {
  formatarNumeroLocal, getPaisByIso, montarE164, PAIS_BR, PAISES,
  validarDDIManual, validarNumeroLocal,
} from "../eventos/paises";

type Props = {
  rid: string;
  nomeRestaurante: string;
  podeEditar: boolean;
  // Capabilities granulares (sistema novo de perfis). Opcionais — se não
  // vierem, herdam de podeEditar (fallback pro modo legado).
  podeEditarTextos?: boolean;
  podeEditarContato?: boolean;
  podeEditarTema?: boolean;
  podeUploadAssets?: boolean;
  podePublicar?: boolean;
  // Quais seções renderizar. Se omitido, mostra todas (retrocompat). Ids:
  // imagens | textos | ordem | endereco | contato | redes | secoes | delivery | publicacao
  mostrar?: string[];
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

export function GeralTab({
  rid, nomeRestaurante, podeEditar,
  podeEditarTextos, podeEditarContato, podeEditarTema, podeUploadAssets, podePublicar,
  mostrar,
}: Props) {
  const show = (k: string) => !mostrar || mostrar.includes(k);
  // Resolve capabilities: granulares se vieram, senão herda podeEditar
  const canTextos  = podeEditarTextos  ?? podeEditar;
  const canContato = podeEditarContato ?? podeEditar;
  const canTema    = podeEditarTema    ?? podeEditar;
  const canAssets  = podeUploadAssets  ?? podeEditar;
  const canPubl    = podePublicar      ?? podeEditar;
  const { pessoa: me } = useAuth();
  const { config: cfgRemoto, existe, loading, erro, save } = useSiteConfig(rid, nomeRestaurante);
  const [form, setForm] = useState<SiteConfig | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Sync inicial com o snapshot remoto.
  // Pré-preenche textos vazios com os defaults do template — assim user
  // edita a partir do texto-padrão da marca, não a partir de campo vazio.
  useEffect(() => {
    if (cfgRemoto && !form) {
      const defaults = defaultTextosByTemplate(cfgRemoto.templateId);
      const textosAtuais = cfgRemoto.textos || {};
      const textosCompletos: typeof defaults = { ...defaults, ...textosAtuais };
      setForm({ ...cfgRemoto, textos: textosCompletos });
    }
  }, [cfgRemoto, form]);

  // Estado pra busca de CEP
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [cepNaoEncontrado, setCepNaoEncontrado] = useState(false);

  // Telefone separado em DDI + número (igual form de eventos)
  // Pra dar import/export simples, derivamos do form.telefone se ele tem
  // "+DDI..." salvo. Pra novo cadastro, começa BR.
  const [telPaisIso, setTelPaisIso] = useState<string>(() => {
    const tel = cfgRemoto?.telefone || "";
    if (!tel) return PAIS_BR.iso;
    // Tenta detectar país pelo prefixo (+55, +1, etc)
    const d = tel.replace(/[^\d+]/g, "");
    for (const p of PAISES) {
      if (p.ddi && d.startsWith(`+${p.ddi}`)) return p.iso;
    }
    return PAIS_BR.iso;
  });
  const [telDdiManual, setTelDdiManual] = useState("");
  const [telLocal, setTelLocal] = useState(() => {
    const tel = cfgRemoto?.telefone || "";
    const d = tel.replace(/[^\d+]/g, "");
    const pais = PAISES.find(p => p.ddi && d.startsWith(`+${p.ddi}`));
    if (pais) {
      const semDdi = d.slice(`+${pais.ddi}`.length);
      return formatarNumeroLocal(semDdi, pais);
    }
    return d;
  });

  if (loading || !form) return <div className="text-sm text-gray-500">Carregando...</div>;
  if (erro === "permission_denied") {
    return (
      <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-4 text-sm">
        <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1 inline-flex items-center gap-1.5"><TriangleAlert size={14} /> Regras Firestore não publicadas</p>
        <code className="block mt-2 text-[12px] bg-white dark:bg-gray-900 px-3 py-2 rounded border">
          firebase deploy --only firestore:rules --project gestaocentral
        </code>
      </div>
    );
  }
  if (erro) return <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800 flex items-center gap-1.5"><TriangleAlert size={14} className="shrink-0" /> {erro}</div>;

  function atualizar<K extends keyof SiteConfig>(k: K, v: SiteConfig[K]) {
    setForm(f => f ? { ...f, [k]: v } : f);
  }
  function atualizarEndereco<K extends keyof SiteConfig["endereco"]>(k: K, v: SiteConfig["endereco"][K]) {
    setForm(f => f ? { ...f, endereco: { ...f.endereco, [k]: v } } : f);
  }
  function atualizarFeature<K extends keyof SiteConfig["features"]>(k: K, v: boolean) {
    setForm(f => f ? { ...f, features: { ...f.features, [k]: v } } : f);
  }

  async function buscarCepAuto(cep: string) {
    if (!validarCep(cep)) {
      setCepNaoEncontrado(false);
      return;
    }
    setBuscandoCep(true);
    setCepNaoEncontrado(false);
    try {
      const dados = await buscarCep(cep);
      if (dados) {
        // Só preenche campos vazios — não sobrescreve o que o user já digitou
        setForm(f => {
          if (!f) return f;
          return {
            ...f,
            endereco: {
              ...f.endereco,
              cep: cep,
              rua: f.endereco.rua || dados.logradouro,
              bairro: f.endereco.bairro || dados.bairro,
              cidade: f.endereco.cidade || dados.cidade,
              uf: f.endereco.uf || dados.uf,
            },
          };
        });
      } else {
        setCepNaoEncontrado(true);
      }
    } catch {
      setCepNaoEncontrado(true);
    } finally {
      setBuscandoCep(false);
    }
  }

  function atualizarTelefone(novoLocal: string, novoPaisIso?: string, novoDdiManual?: string) {
    const isoFinal = novoPaisIso ?? telPaisIso;
    const ddiManualFinal = novoDdiManual ?? telDdiManual;
    const pais = getPaisByIso(isoFinal);
    setTelLocal(novoLocal);
    if (isoFinal !== telPaisIso) setTelPaisIso(isoFinal);
    if (ddiManualFinal !== telDdiManual) setTelDdiManual(ddiManualFinal);
    // Atualiza form.telefone só se tiver número válido
    const ddi = pais.iso === "OUTROS" ? ddiManualFinal : pais.ddi;
    const limpo = novoLocal.replace(/\D/g, "");
    if (ddi && limpo.length >= 4) {
      atualizar("telefone", montarE164(ddi, novoLocal));
    } else if (!novoLocal) {
      atualizar("telefone", "");
    }
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

  async function togglePublicado() {
    if (!me || !form) return;
    const novo = { ...form, publicado: !form.publicado };
    setForm(novo);
    setSalvando(true);
    try { await save(novo, me.id); setSavedAt(new Date().toLocaleTimeString("pt-BR")); }
    catch (e) { alert(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setSalvando(false); }
  }

  function resetar() {
    if (!confirm("Resetar tudo pros valores padrão? Você perde as edições não salvas.")) return;
    setForm(defaultSiteConfig(rid, nomeRestaurante));
  }

  // Disabled por seção — cada uma respeita sua própria capability.
  // Inputs "neutros" (endereço, contato, redes, features, delivery) usam
  // `inputDisabled` geral = !podeEditar. Refinamento granular dessas seções
  // específicas pode ser feito em rodada futura — por ora `canContato`
  // serve só pra calcular `podeEditar` no agregado do SitesPage.
  void canContato;
  const inputDisabled = !podeEditar;
  const textosDisabled  = !canTextos;
  const assetsDisabled  = !canAssets;
  const publicDisabled  = !canPubl;
  void canTema;

  const navItens: { id: string; label: string; k: string }[] = ([
    { id: "sec-imagens", label: "Imagens", k: "imagens" },
    { id: "sec-textos", label: "Textos", k: "textos" },
    { id: "sec-ordem", label: "Ordem", k: "ordem" },
    { id: "sec-endereco", label: "Endereço", k: "endereco" },
    { id: "sec-contato", label: "Contato", k: "contato" },
    { id: "sec-redes", label: "Redes", k: "redes" },
    { id: "sec-secoes", label: "Seções", k: "secoes" },
    ...(form.features.hasDelivery ? [{ id: "sec-delivery", label: "Delivery", k: "delivery" }] : []),
    { id: "sec-publicacao", label: "Publicação", k: "publicacao" },
  ]).filter((n) => show(n.k));
  const CARD = "scroll-mt-24 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-5 shadow-sm";

  return (
    <div className="space-y-5">
      {/* Índice — salta pra cada seção */}
      <nav className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-white/90 dark:bg-gray-950/90 backdrop-blur flex gap-1.5 overflow-x-auto">
        {navItens.map((n) => (
          <a key={n.id} href={`#${n.id}`} className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 whitespace-nowrap">{n.label}</a>
        ))}
      </nav>

      {!existe && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200">
          ⓘ Ainda não há configuração salva pra este restaurante — você está vendo valores padrão.
          Edita e clica em <strong>Salvar</strong> pra criar.
        </div>
      )}

      {/* IMAGENS */}
      {show("imagens") && (
      <section id="sec-imagens" className={CARD + " space-y-4"}>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">Imagens</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Logo, banner do topo (hero) e ícone da aba.</p>
        </div>
        <UploadImagem
          rid={rid}
          tipo="logo"
          label="Logo do restaurante"
          descricao="Aparece no header do site e no rodapé. Use PNG com fundo transparente pra melhor resultado."
          url={form.logoUrl || ""}
          onChange={(v) => atualizar("logoUrl", v)}
          disabled={assetsDisabled}
        />
        <UploadImagem
          rid={rid}
          tipo="hero"
          label="Imagem hero (banner topo)"
          descricao="Aparece como fundo do hero (com overlay escuro). Se não tiver, o hero usa só cor sólida da marca."
          url={form.heroImagemUrl || ""}
          onChange={(v) => atualizar("heroImagemUrl", v)}
          disabled={assetsDisabled}
        />
        <UploadImagem
          rid={rid}
          tipo="favicon"
          label="Favicon (ícone da aba do navegador)"
          descricao="Imagem pequena que aparece na aba do navegador e nos favoritos. Quadrada, idealmente 32×32 ou 64×64 pixels. Se vazio, o navegador usa um padrão."
          url={form.faviconUrl || ""}
          onChange={(v) => atualizar("faviconUrl", v)}
          disabled={assetsDisabled}
        />
      </section>
      )}

      {/* TEXTOS DAS SEÇÕES — slogan, história e todos os textos do site,
          em ordem de aparição. */}
      {show("textos") && (
      <div id="sec-textos" className={CARD}>
        <TextosSection form={form} setForm={setForm} disabled={textosDisabled} />
      </div>
      )}

      {/* ORDEM DAS SEÇÕES — reordena o site público */}
      {show("ordem") && (
      <div id="sec-ordem" className={CARD}>
        <OrdemSecoesSection form={form} setForm={setForm} disabled={inputDisabled} />
      </div>
      )}

      {/* ENDEREÇO */}
      {show("endereco") && (
      <section id="sec-endereco" className={CARD + " space-y-3"}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
          Endereço
        </h3>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Comece pelo CEP — o sistema busca rua, bairro, cidade e UF automaticamente.
        </p>
        {/* CEP no topo + auto-busca */}
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 items-start">
          <div>
            <Input
              label="CEP *"
              value={formatarCep(form.endereco.cep || "")}
              onChange={(e) => atualizarEndereco("cep", limparCep(e.target.value))}
              onBlur={(e) => buscarCepAuto(e.target.value)}
              placeholder="00000-000"
              disabled={inputDisabled}
              inputMode="numeric"
            />
            {buscandoCep && (
              <p className="text-[11px] text-indigo-600 mt-1 inline-flex items-center gap-1"><Search size={11} /> buscando endereço...</p>
            )}
            {cepNaoEncontrado && !buscandoCep && (
              <p className="text-[11px] text-amber-600 mt-1">
                CEP não encontrado — preencha manualmente.
              </p>
            )}
          </div>
        </div>
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
            label="URL Google Maps (compartilhamento)"
            value={form.endereco.googleMapsUrl || ""}
            onChange={(e) => atualizarEndereco("googleMapsUrl", e.target.value)}
            placeholder="https://maps.google.com/..."
            disabled={inputDisabled}
          />
          {/* URL do painel do Google Business — usado pelo banner sticky de
              "atualizar no Google" que aparece em Horários quando admin
              muda horário/feriado. Opcional; se vazio, banner abre painel
              genérico business.google.com onde admin escolhe location. */}
          <div>
            <Input
              label="URL do Google Business (edição)"
              value={form.googleBusinessUrl || ""}
              onChange={(e) => atualizar("googleBusinessUrl", e.target.value)}
              placeholder="https://business.google.com/edit/l/..."
              disabled={inputDisabled}
            />
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
              Link direto pro editor do seu Business Profile. Achar: business.google.com
              → seu negócio → "Editar perfil" → copiar URL. Usado no lembrete
              de "atualizar Google" depois de mudar horário ou feriado.
            </p>
          </div>
        </div>
      </section>
      )}

      {/* CONTATO */}
      {show("contato") && (
      <section id="sec-contato" className={CARD + " space-y-3"}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
          Contato
        </h3>
        {/* Telefone com seletor de DDI + validação por país */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Telefone / WhatsApp
          </label>
          {telPaisIso === "OUTROS" ? (
            <div className="mt-1 grid grid-cols-[110px_70px_1fr] gap-1.5">
              <select
                value={telPaisIso}
                onChange={(e) => atualizarTelefone("", e.target.value, "")}
                disabled={inputDisabled}
                className="px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                {PAISES.map(p => (
                  <option key={p.iso} value={p.iso}>
                    {p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}
                  </option>
                ))}
              </select>
              <input
                type="tel" inputMode="numeric"
                value={telDdiManual}
                onChange={(e) => atualizarTelefone(telLocal, telPaisIso, e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="DDI"
                disabled={inputDisabled}
                className="px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm tabular-nums"
              />
              <input
                type="tel" inputMode="numeric"
                value={telLocal}
                onChange={(e) => atualizarTelefone(e.target.value)}
                placeholder="Número"
                disabled={inputDisabled}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          ) : (
            <div className="mt-1 grid grid-cols-[110px_1fr] gap-1.5">
              <select
                value={telPaisIso}
                onChange={(e) => atualizarTelefone("", e.target.value)}
                disabled={inputDisabled}
                className="px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                {PAISES.map(p => (
                  <option key={p.iso} value={p.iso}>
                    {p.flag} {p.iso === "OUTROS" ? "Outro" : `+${p.ddi}`}
                  </option>
                ))}
              </select>
              <input
                type="tel" inputMode="numeric"
                value={telLocal}
                onChange={(e) => {
                  const pais = getPaisByIso(telPaisIso);
                  atualizarTelefone(formatarNumeroLocal(e.target.value, pais));
                }}
                placeholder={telPaisIso === "BR" ? "(11) 99999-9999" : `${getPaisByIso(telPaisIso).minLen} dígitos`}
                disabled={inputDisabled}
                className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          )}
          {telLocal && (() => {
            const pais = getPaisByIso(telPaisIso);
            const valido = pais.iso === "OUTROS"
              ? validarDDIManual(telDdiManual) && telLocal.replace(/\D/g, "").length >= 4
              : validarNumeroLocal(telLocal, pais);
            if (!valido) {
              return (
                <p className="text-[11px] text-amber-600 mt-1">
                  {pais.iso === "BR"
                    ? "Confira DDD + número (10 ou 11 dígitos)"
                    : `${pais.nome} pede ${pais.minLen === pais.maxLen ? pais.minLen : `${pais.minLen}-${pais.maxLen}`} dígitos`}
                </p>
              );
            }
            return null;
          })()}
        </div>
        <Input
          label="Email de contato"
          type="email"
          value={form.emailContato || ""}
          onChange={(e) => atualizar("emailContato", e.target.value)}
          disabled={inputDisabled}
        />
      </section>
      )}

      {/* REDES SOCIAIS */}
      {show("redes") && (
      <section id="sec-redes" className={CARD + " space-y-3"}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
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
      )}

      {/* FEATURES */}
      {show("secoes") && (
      <section id="sec-secoes" className={CARD + " space-y-3"}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
          Seções do site
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Liga/desliga seções no site público. Desativadas não aparecem.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <CheckRow label="Sobre (história)" checked={form.features.hasSobre !== false} onChange={(v) => atualizarFeature("hasSobre", v)} disabled={inputDisabled} />
          <CheckRow label="Cardápio" checked={form.features.hasCardapio !== false} onChange={(v) => atualizarFeature("hasCardapio", v)} disabled={inputDisabled} />
          <CheckRow label="Horário" checked={form.features.hasHorario !== false} onChange={(v) => atualizarFeature("hasHorario", v)} disabled={inputDisabled} />
          <CheckRow label="Contato" checked={form.features.hasContato !== false} onChange={(v) => atualizarFeature("hasContato", v)} disabled={inputDisabled} />
          <CheckRow label="Reservas (form/widget)" checked={form.features.hasReservas} onChange={(v) => atualizarFeature("hasReservas", v)} disabled={inputDisabled} />
          <CheckRow label="Eventos privados" checked={form.features.hasEventos} onChange={(v) => atualizarFeature("hasEventos", v)} disabled={inputDisabled} />
          <CheckRow label="Espaço Laje (rooftop)" checked={form.features.hasLaje} onChange={(v) => atualizarFeature("hasLaje", v)} disabled={inputDisabled} />
          <CheckRow label="Trabalhe conosco" checked={form.features.hasTrabalheConosco} onChange={(v) => atualizarFeature("hasTrabalheConosco", v)} disabled={inputDisabled} />
          <CheckRow label="Delivery" checked={form.features.hasDelivery} onChange={(v) => atualizarFeature("hasDelivery", v)} disabled={inputDisabled} />
          <CheckRow label="Galeria de fotos" checked={form.features.hasGaleria} onChange={(v) => atualizarFeature("hasGaleria", v)} disabled={inputDisabled} />
        </div>

        {/* Reservas: módulo interno × sistema externo (Get In) */}
        {form.features.hasReservas && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">Para onde o botão de reservas leva</div>
            <div className="flex flex-wrap gap-2">
              {([["interno", "Módulo interno do app"], ["externo", "Sistema externo (Get In)"]] as const).map(([modo, label]) => (
                <button key={modo} type="button" disabled={inputDisabled}
                  onClick={() => atualizar("reservasModo", modo)}
                  className={`text-[13px] px-3 py-1.5 rounded-lg border ${ (form.reservasModo || "interno") === modo ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
                  {label}
                </button>
              ))}
            </div>
            {(form.reservasModo || "interno") === "externo" ? (
              <label className="block text-xs text-gray-500 dark:text-gray-400">
                Link do Get In (o CTA "Faça sua reserva" abre este endereço em nova aba)
                <input type="url" value={form.reservasUrlExterna || ""} onChange={(e) => atualizar("reservasUrlExterna", e.target.value)}
                  placeholder="https://reservas.getinapp.com.br/..." disabled={inputDisabled}
                  className="mt-1 w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
              </label>
            ) : (
              <p className="text-[11px] text-gray-400">Os botões de reserva abrem o formulário interno do app (/reservas).</p>
            )}
          </div>
        )}
      </section>
      )}

      {/* DELIVERY links */}
      {show("delivery") && form.features.hasDelivery && (
        <section id="sec-delivery" className={CARD + " space-y-3"}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
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

      {/* Tema visual (cores/fontes) e ordenação vivem agora na aba "Editar (visual)". */}

      {/* TEMPLATE — só um layout hoje, cada restaurante customiza via
          cor/fonte/logo/textos. Mantido implícito (sem picker no admin)
          pra reduzir confusão. Pra adicionar novos layouts no futuro,
          basta restaurar essa seção e ajustar o SiteRenderer. */}

      {/* PUBLICAÇÃO */}
      {show("publicacao") && (
      <section id="sec-publicacao" className={CARD + " space-y-3"}>
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
          Publicação
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={"text-[12px] font-bold px-2.5 py-1 rounded-full " + (form.publicado ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800")}>
            {form.publicado ? "● No ar" : "○ Não publicado"}
          </span>
          {!publicDisabled && (
            form.publicado
              ? <button onClick={() => void togglePublicado()} disabled={salvando} className="h-9 px-4 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-sm font-bold disabled:opacity-50">{salvando ? "…" : "Despublicar"}</button>
              : <button onClick={() => void togglePublicado()} disabled={salvando} className="h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">{salvando ? "…" : "Publicar"}</button>
          )}
        </div>
        <Input
          label="Slug (URL temporária pré-DNS)"
          value={form.slug}
          onChange={(e) => atualizar("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          placeholder="lobozo"
          disabled={publicDisabled}
        />
        <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-2">
          URL preview: <code>/site/{form.slug}</code> {form.publicado && form.slug && (
            <a href={`/site/${form.slug}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline ml-1">
              abrir em nova aba ↗
            </a>
          )}
        </p>
      </section>
      )}

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
  function setTop<K extends "slogan" | "historia">(k: K, v: string) {
    setForm(f => f ? { ...f, [k]: v } : f);
  }
  function resetAll() {
    if (!confirm("Limpar todos os textos das seções? O template volta a usar os textos padrão. (Slogan e história ficam.)")) return;
    setForm(f => f ? { ...f, textos: {} } : f);
  }

  // Definição dos campos por grupo (ordem = ordem no site).
  //  - "fromTop"  = campo está em SiteConfig.slogan / .historia (não em .textos)
  //  - "acao"     = pra campos CTA, descreve o que o botão faz quando clicado
  //  - "rows"     = altura da textarea (default 2). Todos os campos são
  //                 multilinhas — case e \n são respeitados em qualquer um.
  //  - "condicao" = legenda quando a seção depende de uma feature
  type Campo = {
    chave?: keyof NonNullable<SiteConfig["textos"]>;
    fromTop?: "slogan" | "historia";
    label: string;
    placeholder: string;
    rows?: number;
    dica?: string;
    acao?: string;
  };
  const grupos: { titulo: string; campos: Campo[]; condicao?: string }[] = [
    {
      titulo: "Hero (topo da página)",
      campos: [
        { fromTop: "slogan",      label: "Slogan / tagline",
          placeholder: "ex: laboratório gastronômico",
          dica: "Aparece pequeno acima do título grande do hero.",
        },
        { chave: "heroTitulo",    label: "Título grande do hero",
          placeholder: "ex: Cozinha caipira,\nfeita com tempo.",
          rows: 3 },
        { chave: "heroSubtitulo", label: "Subtítulo do hero",
          placeholder: "Texto curto abaixo do título",
          rows: 3 },
        { chave: "heroCtaLabel",  label: "Botão de chamada (CTA) do hero",
          placeholder: "Faça sua reserva",
          acao: "→ abre /reservas/:rid (se a feature de reservas estiver ligada)" },
      ],
    },
    {
      titulo: "História",
      campos: [
        { chave: "historiaTitulo", label: "Título da seção", placeholder: "A nossa história" },
        { fromTop: "historia",     label: "Texto da história",
          placeholder: "Conta a história do restaurante.",
          rows: 8,
          dica: "Textos longos ganham um \"Ver mais\" automático no site.",
        },
      ],
    },
    {
      titulo: "Cardápio",
      campos: [
        { chave: "cardapioTitulo", label: "Título da seção", placeholder: "Cardápio" },
      ],
    },
    {
      titulo: "Horário",
      campos: [
        { chave: "horarioTitulo", label: "Título da seção", placeholder: "Horário de funcionamento" },
        { chave: "horarioProximosAvisosLabel", label: "Título dos avisos especiais",
          placeholder: "Próximos avisos",
          rows: 2,
          dica: "Aparece acima dos cards de feriados/exceções. Ex: \"Funcionaremos nos seguintes feriados:\"" },
      ],
    },
    {
      titulo: "Laje (rooftop)",
      condicao: "só aparece se features.hasLaje + hasEventos",
      campos: [
        { chave: "lajeTitulo",    label: "Título da seção", placeholder: "Eventos na Laje" },
        { chave: "lajeTexto",     label: "Texto", placeholder: "Descreva o espaço da laje", rows: 4 },
        { chave: "lajeCtaLabel",  label: "Botão da Laje",
          placeholder: "Solicitar proposta",
          acao: "→ abre /eventos/:rid" },
      ],
    },
    {
      titulo: "Eventos privados",
      condicao: "só aparece se features.hasEventos sem hasLaje",
      campos: [
        { chave: "eventosTitulo",   label: "Título da seção", placeholder: "Eventos privados" },
        { chave: "eventosTexto",    label: "Texto", placeholder: "Descreva sua oferta", rows: 4 },
        { chave: "eventosCtaLabel", label: "Botão de Eventos",
          placeholder: "Solicitar proposta",
          acao: "→ abre /eventos/:rid" },
      ],
    },
    {
      titulo: "Reservas",
      condicao: "só aparece se features.hasReservas",
      campos: [
        { chave: "reservasTitulo",   label: "Título da seção", placeholder: "Reservas" },
        { chave: "reservasTexto",    label: "Texto", placeholder: "Política de reserva", rows: 4 },
        { chave: "reservasCtaLabel", label: "Botão de Reservas",
          placeholder: "Reservar mesa",
          acao: "→ abre /reservas/:rid" },
      ],
    },
    {
      titulo: "Delivery",
      condicao: "só aparece se features.hasDelivery + links configurados",
      campos: [
        { chave: "deliveryTitulo", label: "Título da seção", placeholder: "Peça pra casa" },
        { chave: "deliveryTexto",  label: "Texto (opcional)",
          placeholder: "Ex: Não pode vir? A gente entrega.",
          rows: 3 },
      ],
    },
    {
      titulo: "Trabalhe Conosco",
      condicao: "só aparece se features.hasTrabalheConosco",
      campos: [
        { chave: "trabalheTitulo",   label: "Título da seção", placeholder: "Venha trabalhar com a gente" },
        { chave: "trabalheTexto",    label: "Texto", placeholder: "Conta sobre as oportunidades", rows: 4 },
        { chave: "trabalheCtaLabel", label: "Botão de Candidatura",
          placeholder: "Enviar candidatura",
          acao: "→ abre /trabalhe/:rid" },
      ],
    },
    {
      titulo: "Contato",
      campos: [
        { chave: "contatoTitulo", label: "Título da seção", placeholder: "Como chegar" },
      ],
    },
    {
      titulo: "Rodapé",
      campos: [
        { chave: "rodapeDireitos",
          label: "Texto após © e o ano",
          placeholder: "Lobozó Cozinha LTDA. Todos os direitos reservados.",
          rows: 2,
        },
      ],
    },
  ];

  const totalPreenchidos = Object.values(textos).filter(v => !!(v && v.trim())).length;

  function readValor(c: Campo): string {
    if (c.fromTop === "slogan") return form.slogan || "";
    if (c.fromTop === "historia") return form.historia || "";
    if (c.chave) return textos[c.chave] || "";
    return "";
  }
  function setValor(c: Campo, v: string) {
    if (c.fromTop) setTop(c.fromTop, v);
    else if (c.chave) setTexto(c.chave, v);
  }

  return (
    <section className="space-y-2">
      <details className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900" open>
        <summary className="cursor-pointer px-3 py-2 flex items-center justify-between gap-2 list-none">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Textos das seções
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Slogan, história e todos os textos do site, em ordem de aparição.
              Edite o que quiser — campos vazios voltam ao default do template.
              {totalPreenchidos > 0 && <strong className="ml-1 text-indigo-600">{totalPreenchidos} customizad{totalPreenchidos === 1 ? "o" : "os"}.</strong>}
            </p>
          </div>
          <span className="text-xs text-gray-400">▼ expandir / fechar</span>
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-4">
          {/* Dica universal — vale pra todos os campos */}
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-800 px-3 py-2 text-[11px] text-indigo-900 dark:text-indigo-200">
            Todos os campos respeitam maiúscula/minúscula como digitados e
            aceitam <strong>quebra de linha</strong> (Enter).
          </div>

          {grupos.map(g => (
            <div key={g.titulo}>
              <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {g.titulo}
                </div>
                {g.condicao && (
                  <div className="text-[10px] text-gray-400 italic">
                    {g.condicao}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {g.campos.map(c => {
                  const valor = readValor(c);
                  const key = c.chave || c.fromTop || c.label;
                  return (
                    <div key={key}>
                      <label className="text-[10px] uppercase font-bold tracking-wider text-gray-500 flex items-center gap-2 flex-wrap">
                        <span>{c.label}</span>
                        {c.acao && (
                          <span className="text-[10px] normal-case font-normal tracking-normal text-indigo-600 dark:text-indigo-400">
                            {c.acao}
                          </span>
                        )}
                      </label>
                      <textarea
                        value={valor}
                        onChange={(e) => setValor(c, e.target.value)}
                        placeholder={c.placeholder}
                        disabled={disabled}
                        rows={c.rows ?? 2}
                        className="mt-0.5 w-full px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm resize-y"
                      />
                      {c.dica && (
                        <p className="text-[10px] text-gray-400 mt-0.5">{c.dica}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {!disabled && totalPreenchidos > 0 && (
            <button
              onClick={resetAll}
              className="text-xs text-rose-600 hover:underline"
            >
              Limpar customizações dos textos das seções
            </button>
          )}
        </div>
      </details>
    </section>
  );
}

// TemplateCard removido junto com o picker de template — só 1 layout
// ativo hoje. Se voltar a ter múltiplos templates, restaura essa função
// e a seção em GeralTab.

// EscalasTextoControl — 4 sliders pra controlar tamanho de cada categoria
// tipográfica do site público de forma independente. Útil pra balancear
// quando uma fonte fica visualmente pequena/grande em uma categoria mas
// não em outras. Backward compat: se config tinha `escalaTexto` (campo
// antigo), aparece pré-preenchido em `escalaCorpo` (efeito antigo era
// nos textos de corpo).
// Matriz 5×2 de escalas tipográficas — cada categoria visual tem ajuste
// independente pra desktop e mobile. Layout: 5 linhas (categorias), 2
// colunas (devices). Em narrow viewport, as 2 colunas empilham.
//
// Backward compat: campos antigos sem device split (escalaHero, etc.)
// viram fallback simétrico pros dois novos campos (desktop + mobile),
// então ao migrar nada muda visualmente até o admin tocar o slider.
function OrdemSecoesSection({ form, setForm, disabled }: {
  form: SiteConfig;
  setForm: React.Dispatch<React.SetStateAction<SiteConfig | null>>;
  disabled: boolean;
}) {
  const ordem = normalizarOrdem(form.ordemSecoes);

  function mover(idx: number, delta: -1 | 1) {
    const novo = [...ordem];
    const target = idx + delta;
    if (target < 0 || target >= novo.length) return;
    [novo[idx], novo[target]] = [novo[target], novo[idx]];
    setForm(f => f ? { ...f, ordemSecoes: novo } : f);
  }
  function resetar() {
    if (!confirm("Voltar pra ordem padrão das seções?")) return;
    setForm(f => f ? { ...f, ordemSecoes: undefined } : f);
  }

  // Detecta se está em ordem custom
  const padrao = normalizarOrdem(undefined);
  const custom = ordem.some((s, i) => s !== padrao[i]);

  return (
    <section className="space-y-2">
      <details className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <summary className="cursor-pointer px-3 py-2 flex items-center justify-between gap-2 list-none">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Ordem das seções
            </h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Reorganize as seções do site usando as setas. Hero e Footer ficam fixos.
              {custom && <strong className="ml-1 text-indigo-600">Ordem customizada.</strong>}
            </p>
          </div>
          <span className="text-xs text-gray-400">▼ expandir</span>
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-2">
          {ordem.map((id, idx) => (
            <div key={id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/30">
              <span className="text-[10px] tabular-nums text-gray-400 w-5 text-right">
                {idx + 1}.
              </span>
              <span className="flex-1 text-sm">
                {SECAO_LABEL[id as SecaoId]}
              </span>
              {!disabled && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => mover(idx, -1)}
                    disabled={idx === 0}
                    className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-900 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => mover(idx, 1)}
                    disabled={idx === ordem.length - 1}
                    className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-900 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
              )}
            </div>
          ))}
          {!disabled && custom && (
            <button
              type="button"
              onClick={resetar}
              className="text-xs text-rose-600 hover:underline"
            >
              ↺ voltar pra ordem padrão
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
