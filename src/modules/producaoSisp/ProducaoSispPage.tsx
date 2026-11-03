// Produção SISP (peixaria) — mobile-first. O módulo transita como ESTEIRA por
// status: recebimento → plano → produção (rendimento) → lote → saída.
// F1 entrega: esteira (painel de pendências) + wizard de recebimento + gerar plano
// + catálogo (espécies, cortes, fornecedores). Captura v1: foto (câmera do celular),
// peso e temperatura digitados. Leitores (balança/termômetro) plugam depois.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Fish, Plus, X, ChevronLeft, Trash2, Check, AlertTriangle, Package, ClipboardList, ArrowRight, Boxes, Scale, Truck, Printer, Store, QrCode } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PageContainer } from "../../core/ui/PageContainer";
import { useTabPersistida } from "../../core/hooks/useTabPersistida";
import { FotoUpload } from "../checklists/FotoUpload";
import type {
  ProducaoSispEspecie, ProducaoSispCorte, ProducaoSispFornecedor,
  ProducaoSispRecebimento, ProducaoSispRecebimentoItem, ProducaoSispPlano,
  ProducaoSispPlanoAlvo, ProducaoSispConservacao, ProducaoSispConfig,
  ProducaoSispLote, ProducaoSispPeca, ProducaoSispRomaneio, ProducaoSispRomaneioItem,
  ProducaoSispRomaneioTipo, ProducaoSispRomaneioDestino, Restaurant,
} from "../../core/types";
import * as repo from "./producaoSispRepo";
import { uid } from "./producaoSispRepo";
import { etiquetaSispPDF, etiquetaMasterPDF, etiquetaVarejoPDF, abrirPDF } from "./producaoSispEtiquetas";

const CONSERV: { v: ProducaoSispConservacao; label: string }[] = [
  { v: "ultracongelado", label: "Ultracongelado" },
  { v: "refrigerado", label: "Refrigerado" },
];
const fmtKg = (n: number) => `${(Number(n) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`;
const hojeISO = () => new Date().toISOString();
const dataBR = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

// Classe base dos inputs (altura única h-9, mobile-friendly).
const INPUT = "w-full h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm";
const BTN_PRIMARY = "inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium disabled:opacity-50";
const BTN_GHOST = "inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-600 text-sm";

export function ProducaoSispPage() {
  const { rid = "" } = useParams();
  const { pessoa } = useAuth();
  const { activeRestaurant, restaurants } = useRestaurant();
  const { can } = useCanAcao(rid);

  const [tab, setTab] = useTabPersistida("producaoSisp_tab", "operacao", ["operacao", "painel", "config"] as const);
  const [especies, setEspecies] = useState<ProducaoSispEspecie[]>([]);
  const [cortes, setCortes] = useState<ProducaoSispCorte[]>([]);
  const [fornecedores, setFornecedores] = useState<ProducaoSispFornecedor[]>([]);
  const [recebimentos, setRecebimentos] = useState<ProducaoSispRecebimento[]>([]);
  const [planos, setPlanos] = useState<ProducaoSispPlano[]>([]);
  const [lotes, setLotes] = useState<ProducaoSispLote[]>([]);
  const [pecas, setPecas] = useState<ProducaoSispPeca[]>([]);
  const [romaneios, setRomaneios] = useState<ProducaoSispRomaneio[]>([]);
  const [config, setConfig] = useState<ProducaoSispConfig | null>(null);

  const [novoReceb, setNovoReceb] = useState(false);
  const [planoDe, setPlanoDe] = useState<ProducaoSispRecebimento | null>(null);
  const [produzirPlano, setProduzirPlano] = useState<ProducaoSispPlano | null>(null);
  const [expedirLotes, setExpedirLotes] = useState(false);
  const [entradaDe, setEntradaDe] = useState<ProducaoSispRomaneio | null>(null);

  useEffect(() => {
    if (!rid) return;
    const subs = [
      repo.ouvirEspecies(rid, setEspecies),
      repo.ouvirCortes(rid, setCortes),
      repo.ouvirFornecedores(rid, setFornecedores),
      repo.ouvirRecebimentos(rid, setRecebimentos),
      repo.ouvirPlanos(rid, setPlanos),
      repo.ouvirLotes(rid, setLotes),
      repo.ouvirPecas(rid, setPecas),
      repo.ouvirRomaneios(rid, setRomaneios),
      repo.ouvirConfig(rid, setConfig),
    ];
    return () => subs.forEach((u) => u());
  }, [rid]);

  const podeVer = can("producaoSisp", "ver");
  const podeReceber = can("producaoSisp", "receber");
  const podePlanejar = can("producaoSisp", "planejar");
  const podeProduzir = can("producaoSisp", "produzir");
  const podeExpedir = can("producaoSisp", "expedir");
  const podeCatalogo = can("producaoSisp", "catalogo");

  const aguardandoPlano = useMemo(() => recebimentos.filter((r) => r.status === "aguardando_plano"), [recebimentos]);
  const aguardandoProducao = useMemo(() => planos.filter((p) => p.status === "aguardando_producao"), [planos]);
  const lotesDisponiveis = useMemo(() => lotes.filter((l) => l.local === "fabrica" && l.status === "disponivel" && l.saldoPacotes > 0), [lotes]);
  const emTransitoLoja = useMemo(() => romaneios.filter((r) => r.destinoTipo === "loja" && r.status === "em_transito"), [romaneios]);
  const estoqueLoja = useMemo(() => pecas.filter((p) => p.local === "loja" && p.status === "em_estoque"), [pecas]);

  if (!podeVer) {
    return (
      <PageContainer>
        <div className="py-16 text-center text-sm text-gray-500">Você não tem acesso à Produção SISP.</div>
      </PageContainer>
    );
  }

  const nomeEspecie = (id: string) => especies.find((e) => e.id === id)?.nome || "—";
  const nomeCorte = (id: string) => cortes.find((c) => c.id === id)?.nome || "—";

  async function imprimirSisp(l: ProducaoSispLote) {
    const esp = especies.find((e) => e.id === l.especieId);
    const doc = await etiquetaSispPDF({
      razaoSocial: config?.razaoSocial, registroSisp: config?.registroSisp, cnpj: config?.cnpj,
      produto: `${nomeEspecie(l.especieId)} — ${nomeCorte(l.corteId)}`,
      especieCientifico: esp?.nomeCientifico,
      codigoLote: l.codigo, fabricacaoISO: l.fabricacaoEm, validadeISO: l.validadeEm,
      conservacao: CONSERV.find((c) => c.v === l.conservacao)?.label || l.conservacao,
      qtd: l.nPacotes || l.saldoPacotes || 1,
    });
    abrirPDF(doc);
  }

  return (
    <PageContainer>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 flex items-center justify-center"><Fish size={18} /></div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">Produção SISP</h1>
          <p className="text-xs text-gray-500 truncate">{activeRestaurant?.nome || "Peixaria"}</p>
        </div>
      </div>

      {/* Áreas (permissões próprias via Perfis de Acesso) */}
      <div className="flex gap-2 my-3">
        <button onClick={() => setTab("operacao")} className={`h-9 px-4 rounded-full text-sm font-medium ${tab === "operacao" ? "bg-sky-600 text-white" : "border border-gray-300 dark:border-gray-600"}`}>Operação</button>
        <button onClick={() => setTab("painel")} className={`h-9 px-4 rounded-full text-sm font-medium ${tab === "painel" ? "bg-sky-600 text-white" : "border border-gray-300 dark:border-gray-600"}`}>Painel</button>
        <button onClick={() => setTab("config")} className={`h-9 px-4 rounded-full text-sm font-medium ${tab === "config" ? "bg-sky-600 text-white" : "border border-gray-300 dark:border-gray-600"}`}>Config</button>
      </div>

      {tab === "painel" && (
        <PainelTab recebimentos={recebimentos} lotes={lotes} especies={especies} />
      )}

      {tab === "operacao" && (
        <div className="space-y-5">
          {podeReceber && (
            <button className={`${BTN_PRIMARY} w-full`} onClick={() => setNovoReceb(true)}>
              <Plus size={18} /> Novo recebimento
            </button>
          )}

          <Fila titulo="Aguardando plano" icone={<Package size={15} />} vazio="Nenhum recebimento aguardando plano.">
            {aguardandoPlano.map((r) => {
              const peso = repo.pesoBrutoRecebimento(r);
              const semForn = !r.fornecedorId;
              return (
                <Card key={r.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{r.fornecedorNome || "Sem fornecedor"}</div>
                      <div className="text-xs text-gray-500">{dataBR(r.recebidoEm)} · {r.itens.length} leva(s) · {fmtKg(peso)}</div>
                      <div className="text-xs text-gray-500 truncate">{r.itens.map((it) => nomeEspecie(it.especieId)).join(", ")}</div>
                      {semForn && <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-600"><AlertTriangle size={12} /> sem fornecedor</div>}
                    </div>
                    {podePlanejar && (
                      <button className={BTN_GHOST} onClick={() => setPlanoDe(r)}>Gerar plano <ArrowRight size={14} /></button>
                    )}
                  </div>
                </Card>
              );
            })}
          </Fila>

          <Fila titulo="Aguardando produção" icone={<ClipboardList size={15} />} vazio="Nenhum plano aguardando produção.">
            {aguardandoProducao.map((p) => {
              const r = recebimentos.find((x) => x.id === p.recebimentoId);
              return (
                <Card key={p.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{r?.fornecedorNome || "Recebimento"} · {p.alvos.length} produto(s)</div>
                      <div className="text-xs text-gray-500 truncate">{p.alvos.map((a) => nomeEspecie(a.especieId) + " — " + nomeCorte(a.corteId)).join(" · ")}</div>
                    </div>
                    {podeProduzir && (
                      <button className={BTN_GHOST} onClick={() => setProduzirPlano(p)}>Lançar produção <ArrowRight size={14} /></button>
                    )}
                  </div>
                </Card>
              );
            })}
          </Fila>

          <Fila titulo="Disponível para saída" icone={<Boxes size={15} />} vazio="Nenhum lote em estoque na fábrica.">
            {lotesDisponiveis.map((l) => (
              <Card key={l.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{nomeEspecie(l.especieId)} — {nomeCorte(l.corteId)}</div>
                    <div className="text-xs text-gray-500">Lote {l.codigo} · {l.saldoPacotes} pac · {fmtKg(l.saldoKg)}</div>
                    <div className="text-[11px] text-gray-400">
                      {l.rendimentoPct != null ? `Rend. ${l.rendimentoPct}% · ` : ""}{CONSERV.find((c) => c.v === l.conservacao)?.label} · val. {dataBR(l.validadeEm)}
                    </div>
                  </div>
                  <button className="shrink-0 text-gray-400 hover:text-sky-600" title="Etiqueta SISP" onClick={() => void imprimirSisp(l)}><Printer size={16} /></button>
                </div>
              </Card>
            ))}
          </Fila>

          {podeExpedir && lotesDisponiveis.length > 0 && (
            <button className={`${BTN_GHOST} w-full`} onClick={() => setExpedirLotes(true)}><Truck size={16} /> Expedir / romaneio</button>
          )}

          <Fila titulo="Em trânsito p/ loja" icone={<Truck size={15} />} vazio="Nada a conferir na loja.">
            {emTransitoLoja.map((r) => {
              const tot = r.itens.reduce((s, it) => s + it.qtdPacotes, 0);
              const pk = r.itens.reduce((s, it) => s + it.pesoKg, 0);
              return (
                <Card key={r.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">→ {r.destinoNome || "Loja"}</div>
                      <div className="text-xs text-gray-500">{dataBR(r.expedidoEm)} · {tot} pac · {fmtKg(pk)}</div>
                    </div>
                    {podeExpedir && <button className={BTN_GHOST} onClick={() => setEntradaDe(r)}><Scale size={14} /> Conferir entrada</button>}
                  </div>
                </Card>
              );
            })}
          </Fila>

          {estoqueLoja.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 px-3 py-2 text-xs">
              <Store size={14} /> Estoque da loja: <b>{estoqueLoja.length}</b> peças · {fmtKg(estoqueLoja.reduce((s, p) => s + p.pesoKg, 0))}
            </div>
          )}
        </div>
      )}

      {tab === "config" && (
        <CatalogoTab
          rid={rid} especies={especies} cortes={cortes} fornecedores={fornecedores} config={config}
          podeEditar={podeCatalogo}
        />
      )}

      {novoReceb && (
        <RecebimentoWizard
          rid={rid} meNome={pessoa?.nome || null} meId={pessoa?.id || null}
          especies={especies} fornecedores={fornecedores} config={config}
          onClose={() => setNovoReceb(false)}
        />
      )}

      {planoDe && (
        <PlanoEditor
          rid={rid} meNome={pessoa?.nome || null} recebimento={planoDe}
          especies={especies} cortes={cortes}
          onClose={() => setPlanoDe(null)}
        />
      )}

      {produzirPlano && (
        <ProducaoEditor
          rid={rid} meNome={pessoa?.nome || null} plano={produzirPlano}
          recebimento={recebimentos.find((r) => r.id === produzirPlano.recebimentoId) || null}
          especies={especies} cortes={cortes} lotes={lotes} config={config}
          onDone={() => setProduzirPlano(null)}
        />
      )}

      {expedirLotes && (
        <RomaneioEditor
          rid={rid} meNome={pessoa?.nome || null}
          lotes={lotesDisponiveis} especies={especies} cortes={cortes}
          restaurants={restaurants} activeRestaurant={activeRestaurant}
          onClose={() => setExpedirLotes(false)}
        />
      )}

      {entradaDe && (
        <EntradaLojaEditor
          rid={rid} meNome={pessoa?.nome || null} romaneio={entradaDe}
          lotes={lotes} especies={especies} cortes={cortes} config={config}
          onClose={() => setEntradaDe(null)}
        />
      )}
    </PageContainer>
  );
}

// ── Painel: dashboards de recebimento (qualidade/volume) e produção (rendimento) ─
function PainelTab({ recebimentos, lotes, especies }: {
  recebimentos: ProducaoSispRecebimento[]; lotes: ProducaoSispLote[];
  especies: ProducaoSispEspecie[];
}) {
  const [sub, setSub] = useTabPersistida("producaoSisp_painel", "receb", ["receb", "prod"] as const);
  const [fReceForn, setFReceForn] = useState("");
  const [fReceReceb, setFReceReceb] = useState("");
  const [fProdEsp, setFProdEsp] = useState("");
  const [fProdForn, setFProdForn] = useState("");
  const nomeEsp = (id: string) => especies.find((e) => e.id === id)?.nome || "—";
  const fornDoReceb = useMemo(() => { const m: Record<string, string> = {}; recebimentos.forEach((r) => { m[r.id] = r.fornecedorNome || "Sem fornecedor"; }); return m; }, [recebimentos]);

  // Recebimento: 1 linha por leva
  const receRows = useMemo(() => recebimentos.flatMap((r) => (r.itens || []).map((it) => ({
    recebId: r.id, forn: r.fornecedorNome || "Sem fornecedor", especie: nomeEsp(it.especieId),
    kg: Number(it.pesoBrutoKg) || 0, caixas: Number(it.qtdCaixas) || 0,
    conforme: it.conforme !== false, temp: it.temperaturaC == null ? null : Number(it.temperaturaC),
  }))), [recebimentos, especies]);
  const receF = useMemo(() => receRows.filter((x) => (!fReceForn || x.forn === fReceForn) && (!fReceReceb || x.recebId === fReceReceb)), [receRows, fReceForn, fReceReceb]);
  const recKg = receF.reduce((s, x) => s + x.kg, 0);
  const recCargas = new Set(receF.map((x) => x.recebId)).size;
  const recCaixas = receF.reduce((s, x) => s + x.caixas, 0);
  const recConf = receF.filter((x) => x.conforme).length;
  const recNConf = receF.length - recConf;
  const recPctConf = receF.length ? Math.round(recConf / receF.length * 100) : 0;
  const recTemps = receF.filter((x) => x.temp != null).map((x) => x.temp as number);
  const recTemp = recTemps.length ? recTemps.reduce((s, t) => s + t, 0) / recTemps.length : null;
  const recPorForn = useMemo(() => { const m: Record<string, number> = {}; receF.forEach((x) => { m[x.forn] = (m[x.forn] || 0) + x.kg; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [receF]);
  const recMax = Math.max(1, ...recPorForn.map((e) => e[1]));

  // Produção: 1 linha por lote
  const prodRows = useMemo(() => lotes.map((l) => ({
    especie: nomeEsp(l.especieId), forn: fornDoReceb[l.recebimentoId] || "—",
    bruto: Number(l.pesoBrutoEntradaKg) || 0, benef: Number(l.pesoBeneficiadoKg) || 0,
  })), [lotes, especies, fornDoReceb]);
  const prodF = useMemo(() => prodRows.filter((x) => (!fProdEsp || x.especie === fProdEsp) && (!fProdForn || x.forn === fProdForn)), [prodRows, fProdEsp, fProdForn]);
  const pBruto = prodF.reduce((s, x) => s + x.bruto, 0);
  const pBenef = prodF.reduce((s, x) => s + x.benef, 0);
  const pRend = pBruto > 0 ? Math.round(pBenef / pBruto * 100) : 0;
  const pPerda = pBruto > 0 ? 100 - pRend : 0;
  const prodPorEsp = useMemo(() => { const m: Record<string, { b: number; be: number }> = {}; prodF.forEach((x) => { const a = m[x.especie] || { b: 0, be: 0 }; a.b += x.bruto; a.be += x.benef; m[x.especie] = a; }); return Object.entries(m).map(([k, v]) => [k, v.b > 0 ? Math.round(v.be / v.b * 100) : 0] as [string, number]).sort((a, b) => b[1] - a[1]); }, [prodF]);

  const sel = "h-9 px-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs w-full";
  const Kpi = ({ l, v, d, tone }: { l: string; v: string; d?: string; tone?: "up" | "dn" }) => (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{l}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{v}</div>
      {d && <div className={`text-[11px] font-semibold mt-0.5 ${tone === "up" ? "text-emerald-600" : tone === "dn" ? "text-rose-600" : "text-gray-500"}`}>{d}</div>}
    </div>
  );
  const Bar = ({ label, pct, bv, color }: { label: string; pct: number; bv: string; color?: string }) => (
    <div className="flex items-center gap-2">
      <span className="text-xs w-28 shrink-0 truncate">{label}</span>
      <span className="flex-1 h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"><i className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color || "#0284c7" }} /></span>
      <span className="text-xs font-semibold w-16 text-right tabular-nums">{bv}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 p-1 rounded-xl bg-gray-100 dark:bg-gray-800">
        <button onClick={() => setSub("receb")} className={`flex-1 h-9 rounded-lg text-sm font-semibold ${sub === "receb" ? "bg-white dark:bg-gray-900 text-sky-700 dark:text-sky-300 shadow-sm" : "text-gray-500"}`}>Recebimento</button>
        <button onClick={() => setSub("prod")} className={`flex-1 h-9 rounded-lg text-sm font-semibold ${sub === "prod" ? "bg-white dark:bg-gray-900 text-sky-700 dark:text-sky-300 shadow-sm" : "text-gray-500"}`}>Produção</button>
      </div>

      {sub === "receb" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select className={sel} value={fReceForn} onChange={(e) => setFReceForn(e.target.value)}>
              <option value="">Todos fornecedores</option>
              {[...new Set(receRows.map((x) => x.forn))].sort().map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select className={sel} value={fReceReceb} onChange={(e) => setFReceReceb(e.target.value)}>
              <option value="">Todos recebimentos</option>
              {recebimentos.map((r) => <option key={r.id} value={r.id}>{(r.fornecedorNome || "Sem forn.")} · {dataBR(r.recebidoEm)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Kpi l="Volume" v={fmtKg(recKg)} d={`${recCaixas} caixas`} />
            <Kpi l="Cargas" v={String(recCargas)} />
            <Kpi l="Conforme" v={`${recPctConf}%`} d={recNConf ? `${recNConf} não-conforme` : "tudo ok"} tone={recPctConf >= 90 ? "up" : "dn"} />
            <Kpi l="Temp. média" v={recTemp == null ? "—" : `${recTemp.toFixed(1)}°C`} />
          </div>
          {recNConf > 0 && <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 px-3 py-2 text-xs"><AlertTriangle size={14} /> {recNConf} leva(s) não-conforme no filtro.</div>}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Volume por fornecedor</div>
            {recPorForn.length ? recPorForn.map(([f, v]) => <Bar key={f} label={f} pct={v / recMax * 100} bv={fmtKg(v)} />) : <div className="text-xs text-gray-400">Sem dados.</div>}
          </div>
        </div>
      )}

      {sub === "prod" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select className={sel} value={fProdEsp} onChange={(e) => setFProdEsp(e.target.value)}>
              <option value="">Todas as espécies</option>
              {[...new Set(prodRows.map((x) => x.especie))].sort().map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <select className={sel} value={fProdForn} onChange={(e) => setFProdForn(e.target.value)}>
              <option value="">Todos fornecedores</option>
              {[...new Set(prodRows.map((x) => x.forn))].sort().map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Kpi l="Rendimento médio" v={`${pRend}%`} d={pRend >= 55 ? "na meta" : "abaixo da meta"} tone={pRend >= 55 ? "up" : "dn"} />
            <Kpi l="MP processada" v={fmtKg(pBruto)} />
            <Kpi l="Beneficiado" v={fmtKg(pBenef)} />
            <Kpi l="Perda / merma" v={`${pPerda}%`} d={fmtKg(pBruto - pBenef)} />
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Rendimento por espécie</div>
            {prodPorEsp.length ? prodPorEsp.map(([e, r]) => <Bar key={e} label={e} pct={r} bv={`${r}%`} color={r >= 55 ? "#16a34a" : "#d97706"} />) : <div className="text-xs text-gray-400">Sem dados.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Esteira: coluna de fila ────────────────────────────────────────────────────
function Fila({ titulo, icone, vazio, children }: { titulo: string; icone: React.ReactNode; vazio: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = !arr || (Array.isArray(arr) && arr.length === 0);
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{icone} {titulo}</div>
      {isEmpty ? <div className="text-xs text-gray-400 italic px-1">{vazio}</div> : <div className="space-y-2">{children}</div>}
    </section>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-3">{children}</div>;
}

// ── Overlay full-screen (mobile) ────────────────────────────────────────────────
function Overlay({ titulo, onClose, children, footer }: { titulo: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center">
      <div className="bg-white dark:bg-gray-900 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center gap-2 px-4 h-14 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <button onClick={onClose} className="p-1 -ml-1"><ChevronLeft size={22} /></button>
          <div className="font-semibold text-sm flex-1 truncate">{titulo}</div>
          <button onClick={onClose} className="p-1"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">{children}</div>
        {footer && <div className="p-4 border-t border-gray-200 dark:border-gray-700 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

// ── Wizard de recebimento ───────────────────────────────────────────────────────
// ── Novo recebimento: wizard tela-cheia, uma pergunta por vez (mão molhada) ──────
const PS_MOTIVOS = ["Temperatura", "Frescor/odor", "Cor/aspecto", "Embalagem", "Peso", "Outro"];
type PSStep = "forn" | "esp" | "qtd" | "peso" | "temp" | "conf" | "motivo" | "rev" | "opts" | "resumo";
type PSDraft = {
  especieId: string; qtd: number; brutoStr: string;
  conservacao: ProducaoSispConservacao; tempNeg: boolean; tempStr: string;
  conforme: boolean; motivo: string; motivoDesc: string; fotoUrl: string | null;
};
const psNovoDraft = (): PSDraft => ({ especieId: "", qtd: 1, brutoStr: "", conservacao: "ultracongelado", tempNeg: true, tempStr: "", conforme: true, motivo: "", motivoDesc: "", fotoUrl: null });
const psNum = (s: string) => parseFloat((s || "0").replace(",", ".")) || 0;
const psBR = (n: number) => n.toFixed(2).replace(".", ",");
function psRtl(val: string, k: string): string {
  let d = (String(val).match(/\d/g) || []).join("");
  if (k === "⌫") d = d.slice(0, -1);
  else if (/^\d$/.test(k)) { if (d.length >= 6) return val; d += k; }
  else return val;
  const n = parseInt(d || "0", 10);
  return `${Math.floor(n / 100)},${String(n % 100).padStart(2, "0")}`;
}
function psTemp(val: string, k: string): string {
  if (k === "⌫") return val.slice(0, -1);
  if (k === ",") return val.indexOf(",") >= 0 ? val : (val === "" ? "0," : val + ",");
  const dot = val.indexOf(","); if (dot >= 0 && val.length - dot - 1 >= 2) return val;
  return (val + k).replace(/^0(?=\d)/, "");
}
function PSKeypad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map((k) => (
        <button key={k} onClick={() => onKey(k)} className="h-14 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-2xl font-bold active:bg-sky-50 dark:active:bg-sky-900/30">{k}</button>
      ))}
    </div>
  );
}

function RecebimentoWizard({ rid, meNome, meId, especies, fornecedores, config, onClose }: {
  rid: string; meNome: string | null; meId: string | null;
  especies: ProducaoSispEspecie[]; fornecedores: ProducaoSispFornecedor[]; config: ProducaoSispConfig | null; onClose: () => void;
}) {
  const [step, setStep] = useState<PSStep>("forn");
  const [fornecedorId, setFornecedorId] = useState("");
  const [fornNome, setFornNome] = useState("");
  const [semForn, setSemForn] = useState(false);
  const [novoForn, setNovoForn] = useState(false);
  const [fNome, setFNome] = useState(""); const [fCnpj, setFCnpj] = useState(""); const [fWhats, setFWhats] = useState("");
  const [produtos, setProdutos] = useState<ProducaoSispRecebimentoItem[]>([]);
  const [p, setP] = useState<PSDraft>(psNovoDraft());
  const [nota, setNota] = useState(""); const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false); const [erro, setErro] = useState("");
  const upd = (patch: Partial<PSDraft>) => setP((prev) => ({ ...prev, ...patch }));

  const tara = (config?.taraTipos && config.taraTipos[0]?.taraKg != null) ? config.taraTipos[0].taraKg : 0.8;
  const tolRefrig = config?.tolTempRefrigC ?? 4;
  const tolCong = config?.tolTempCongeladoC ?? -12;
  const brutoKg = psNum(p.brutoStr);
  const liqKg = Math.max(0, brutoKg - p.qtd * tara);
  const tempVal = (p.tempNeg ? -1 : 1) * psNum(p.tempStr);
  const tolAtual = p.conservacao === "ultracongelado" ? tolCong : tolRefrig;
  const tempWarn = p.tempStr !== "" && tempVal > tolAtual;
  const consLabel = (c: ProducaoSispConservacao) => c === "ultracongelado" ? "Congelado" : "Refrigerado";
  const nomeEsp = (id: string) => especies.find((e) => e.id === id)?.nome || "—";
  const liqItem = (it: ProducaoSispRecebimentoItem) => Number(it.pesoBrutoKg) || 0;
  const totCaixas = produtos.reduce((s, it) => s + (it.qtdCaixas || 0), 0);
  const totLiq = produtos.reduce((s, it) => s + liqItem(it), 0);

  function setCons(c: ProducaoSispConservacao) { upd({ conservacao: c, tempNeg: c === "ultracongelado" }); }
  function confirmaProduto() {
    const it: ProducaoSispRecebimentoItem = {
      id: uid(), especieId: p.especieId, qtdCaixas: p.qtd, pesoModo: "total",
      pesoBrutoKg: liqKg, pesoComCaixaKg: brutoKg, taraKgUnit: tara,
      conservacao: p.conservacao, temperaturaC: p.tempStr ? Math.round(tempVal * 10) / 10 : null,
      conforme: p.conforme, motivoCategoria: p.conforme ? null : (p.motivo || null),
      motivoRejeicao: p.conforme ? null : (p.motivoDesc.trim() || null), fotoUrl: p.fotoUrl || null,
    };
    setProdutos((prev) => [...prev, it]); setStep("opts");
  }
  function novoProduto() { setP(psNovoDraft()); setStep("esp"); }

  async function salvarNovoFornecedor(): Promise<{ id: string; nome: string } | null> {
    if (!fNome.trim()) { setErro("Informe o nome do fornecedor."); return null; }
    const f: ProducaoSispFornecedor = { id: uid(), restaurantId: rid, nome: fNome.trim(), cnpj: fCnpj.trim() || null, whatsapp: fWhats.trim() || null, registroSanitario: null, ativo: true, criadoEm: hojeISO() };
    await repo.salvarFornecedor(f);
    setFornecedorId(f.id); setFornNome(f.nome); setNovoForn(false);
    return { id: f.id, nome: f.nome };
  }
  async function finalizar() {
    if (!produtos.length) { setErro("Adicione ao menos um produto."); return; }
    setSalvando(true); setErro("");
    try {
      const r: ProducaoSispRecebimento = {
        id: uid(), restaurantId: rid,
        fornecedorId: semForn ? null : (fornecedorId || null), fornecedorNome: semForn ? null : (fornNome || null),
        notaFornecedor: nota.trim() || null, obs: obs.trim() || null,
        itens: produtos, status: "aguardando_plano",
        recebidoEm: hojeISO(), recebidoPorId: meId, recebidoPorNome: meNome, criadoEm: hojeISO(),
      };
      await repo.salvarRecebimento(r); onClose();
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao salvar."); setSalvando(false); }
  }

  function back() {
    setErro("");
    if (step === "forn") return onClose();
    if (step === "esp") return setStep(produtos.length ? "opts" : "forn");
    if (step === "qtd") return setStep("esp");
    if (step === "peso") return setStep("qtd");
    if (step === "temp") return setStep("peso");
    if (step === "conf") return setStep("temp");
    if (step === "motivo") return setStep("conf");
    if (step === "rev") return setStep(p.conforme ? "conf" : "motivo");
    if (step === "opts") return setStep("rev");
    if (step === "resumo") return setStep("opts");
  }

  const bigBrand = "w-full h-14 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-40";
  const bigGhost = "w-full h-12 rounded-2xl border-2 border-gray-200 dark:border-gray-700 text-base font-semibold flex items-center justify-center gap-2";
  const pickRow = "w-full text-left rounded-2xl border-2 border-gray-200 dark:border-gray-700 px-4 py-4 text-base font-semibold flex items-center gap-3 active:border-sky-500 active:bg-sky-50 dark:active:bg-sky-900/20";
  const Q = ({ children }: { children: React.ReactNode }) => <div className="text-[26px] font-extrabold leading-tight tracking-tight mb-1">{children}</div>;
  const Sub = ({ children }: { children: React.ReactNode }) => <div className="text-sm text-gray-500 mb-4">{children}</div>;
  const motivoOk = !!p.motivo && p.motivoDesc.trim().length >= 3;

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-gray-950 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <button onClick={back} className="w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-center text-xl">‹</button>
        <div className="flex-1 font-bold">Novo recebimento</div>
        <button onClick={onClose} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4" style={{ WebkitOverflowScrolling: "touch" }}>
        {erro && <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2 mb-3">{erro}</div>}

        {step === "forn" && (
          <div>
            <Q>De quem chegou?</Q><Sub>Toque no fornecedor desta carga.</Sub>
            {!novoForn ? (
              <div className="space-y-2.5">
                {fornecedores.map((f) => (
                  <button key={f.id} className={pickRow} onClick={() => { setFornecedorId(f.id); setFornNome(f.nome); setSemForn(false); setStep("esp"); }}>🚚 {f.nome}</button>
                ))}
                <button className={`${pickRow} text-sky-600`} onClick={() => { setNovoForn(true); }}>＋ Novo fornecedor</button>
                <button className={`${pickRow} text-amber-600`} onClick={() => { setSemForn(true); setFornecedorId(""); setFornNome(""); setStep("esp"); }}>⚠ Receber sem fornecedor</button>
              </div>
            ) : (
              <div className="space-y-2">
                <input className={INPUT} placeholder="Nome / razão social *" value={fNome} onChange={(e) => setFNome(e.target.value)} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input className={INPUT} placeholder="CNPJ" value={fCnpj} onChange={(e) => setFCnpj(e.target.value)} />
                  <input className={INPUT} placeholder="WhatsApp" value={fWhats} onChange={(e) => setFWhats(e.target.value)} />
                </div>
                <button className={bigBrand} onClick={async () => { const r = await salvarNovoFornecedor(); if (r) setStep("esp"); }}><Check size={18} /> Salvar e continuar</button>
                <button className={bigGhost} onClick={() => setNovoForn(false)}>Cancelar</button>
              </div>
            )}
          </div>
        )}

        {step === "esp" && (
          <div>
            <Q>Qual espécie<br />deste produto?</Q><Sub>Produto {produtos.length + 1} do recebimento</Sub>
            {especies.length === 0 && <div className="text-sm text-amber-600 mb-3">Cadastre espécies na aba Config primeiro.</div>}
            <div className="grid grid-cols-2 gap-2.5">
              {especies.map((e) => (
                <button key={e.id} className="rounded-2xl border-2 border-gray-200 dark:border-gray-700 px-3 py-5 text-base font-bold active:border-sky-500 active:bg-sky-50 dark:active:bg-sky-900/20 min-h-[88px]" onClick={() => { upd({ especieId: e.id }); setStep("qtd"); }}>🐟<br />{e.nome}</button>
              ))}
            </div>
          </div>
        )}

        {step === "qtd" && (
          <div>
            <Q>Quantas caixas?</Q><Sub>{nomeEsp(p.especieId)} · caixa padrão (tara {psBR(tara)} kg)</Sub>
            <div className="flex items-center justify-center gap-5 my-3">
              <button className="w-16 h-16 rounded-2xl border-2 border-gray-200 dark:border-gray-700 text-3xl font-extrabold text-sky-600" onClick={() => upd({ qtd: Math.max(1, p.qtd - 1) })}>−</button>
              <div className="text-center min-w-[80px]"><div className="text-5xl font-extrabold tabular-nums leading-none">{p.qtd}</div><div className="text-[11px] uppercase text-gray-400 mt-1">caixas</div></div>
              <button className="w-16 h-16 rounded-2xl border-2 border-gray-200 dark:border-gray-700 text-3xl font-extrabold text-sky-600" onClick={() => upd({ qtd: p.qtd + 1 })}>＋</button>
            </div>
            <div className="flex gap-2 justify-center mb-2">
              {[1, 2, 3, 4, 6, 8].map((n) => <button key={n} className={`flex-1 h-10 rounded-xl border-2 text-base font-bold ${p.qtd === n ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-600" : "border-gray-200 dark:border-gray-700"}`} onClick={() => upd({ qtd: n })}>{n}</button>)}
            </div>
            <div className="text-center text-sm text-gray-500 mb-3">tara total: {p.qtd} × {psBR(tara)} = <b>{psBR(p.qtd * tara)} kg</b></div>
            <button className={bigBrand} onClick={() => setStep("peso")}>Continuar</button>
          </div>
        )}

        {step === "peso" && (
          <div>
            <Q>Peso total das caixas</Q><Sub>{nomeEsp(p.especieId)} · {p.qtd} caixa(s) na balança (com a caixa)</Sub>
            <div className="mb-3"><FotoUpload rid={rid} bucketPrefix="producaoSisp" pathPrefix="receb" url={p.fotoUrl || ""} onChange={(u) => upd({ fotoUrl: u })} label="foto na balança" /></div>
            <div className="rounded-2xl border-2 border-gray-200 dark:border-gray-700 p-5 text-center mb-2"><span className="text-5xl font-extrabold tabular-nums">{p.brutoStr === "" ? "0,00" : p.brutoStr}</span><span className="text-base text-gray-400 font-semibold ml-1">kg bruto</span></div>
            <div className="text-center text-sm text-gray-500 mb-3">− tara {p.qtd} × {psBR(tara)} = {psBR(p.qtd * tara)} kg · líquido <b>{psBR(liqKg)} kg</b></div>
            <PSKeypad onKey={(k) => upd({ brutoStr: psRtl(p.brutoStr, k) })} />
            <button className={`${bigBrand} mt-3`} onClick={() => setStep("temp")}>Continuar</button>
          </div>
        )}

        {step === "temp" && (
          <div>
            <Q>Temperatura</Q><Sub>Como o produto chegou? A tolerância muda.</Sub>
            <div className="grid grid-cols-2 gap-2.5 mb-3">
              <button className={`rounded-2xl border-2 px-3 py-4 font-bold ${p.conservacao === "refrigerado" ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-600" : "border-gray-200 dark:border-gray-700"}`} onClick={() => setCons("refrigerado")}>🧊 Refrigerado<br /><span className="text-[11px] font-medium text-gray-500">tol. ≤ {tolRefrig}°C</span></button>
              <button className={`rounded-2xl border-2 px-3 py-4 font-bold ${p.conservacao === "ultracongelado" ? "border-sky-400 bg-sky-50 dark:bg-sky-900/20 text-sky-600" : "border-gray-200 dark:border-gray-700"}`} onClick={() => setCons("ultracongelado")}>❄️ Congelado<br /><span className="text-[11px] font-medium text-gray-500">tol. ≤ {tolCong}°C</span></button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 mb-2">
              <button className={`h-11 rounded-xl border-2 font-bold text-sm ${p.tempNeg ? "border-sky-400 bg-sky-50 dark:bg-sky-900/20 text-sky-600" : "border-gray-200 dark:border-gray-700 text-gray-500"}`} onClick={() => upd({ tempNeg: true })}>− Temp. negativa</button>
              <button className={`h-11 rounded-xl border-2 font-bold text-sm ${!p.tempNeg ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-600" : "border-gray-200 dark:border-gray-700 text-gray-500"}`} onClick={() => upd({ tempNeg: false })}>+ Temp. positiva</button>
            </div>
            <div className={`rounded-2xl border-2 p-5 text-center mb-1 ${tempWarn ? "border-rose-400 bg-rose-50 dark:bg-rose-900/20" : p.tempNeg ? "border-sky-300 bg-sky-50/60 dark:bg-sky-900/15" : "border-amber-300 bg-amber-50/60 dark:bg-amber-900/15"}`}><span className="text-5xl font-extrabold tabular-nums">{p.tempNeg ? "−" : "+"}{p.tempStr === "" ? "0,0" : p.tempStr}</span><span className="text-base text-gray-400 font-semibold ml-1">°C</span></div>
            <div className="text-center text-xs mb-3 min-h-[16px]">{p.tempStr === "" ? "" : tempWarn ? <span className="text-rose-600 font-semibold">⚠️ Acima da tolerância (≤ {tolAtual}°C p/ {consLabel(p.conservacao).toLowerCase()})</span> : <span className="text-gray-500">Dentro da tolerância ✓</span>}</div>
            <PSKeypad onKey={(k) => upd({ tempStr: psTemp(p.tempStr, k) })} />
            <button className={`${bigBrand} mt-3`} onClick={() => setStep("conf")}>Continuar</button>
          </div>
        )}

        {step === "conf" && (
          <div>
            <Q>Este produto está conforme?</Q><Sub>Frescor, cor, odor e temperatura dentro do padrão.</Sub>
            <div className="space-y-3">
              <button className="w-full h-16 rounded-2xl bg-emerald-600 text-white text-lg font-bold" onClick={() => { upd({ conforme: true }); setStep("rev"); }}>✓ SIM, conforme</button>
              <button className="w-full h-16 rounded-2xl bg-rose-600 text-white text-lg font-bold" onClick={() => { upd({ conforme: false }); setStep("motivo"); }}>✕ NÃO conforme</button>
            </div>
          </div>
        )}

        {step === "motivo" && (
          <div>
            <Q>Por que não<br />está conforme?</Q><Sub>Registro obrigatório. Escolha o motivo e descreva.</Sub>
            <div className="flex flex-wrap gap-2 mb-3">
              {PS_MOTIVOS.map((m) => <button key={m} className={`px-3 h-10 rounded-xl border-2 text-sm font-bold ${p.motivo === m ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-600" : "border-gray-200 dark:border-gray-700"}`} onClick={() => upd({ motivo: m })}>{m}</button>)}
            </div>
            <textarea className={`${INPUT} h-auto py-2`} rows={3} placeholder="Ex.: caixa com odor forte e gelo derretido na chegada…" value={p.motivoDesc} onChange={(e) => upd({ motivoDesc: e.target.value })} />
            <button className={`${bigBrand} mt-3`} disabled={!motivoOk} onClick={() => setStep("rev")}>Continuar</button>
          </div>
        )}

        {step === "rev" && (
          <div>
            <Q>Confirmar dados</Q><Sub>Deste produto.</Sub>
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 text-sm mb-4">
              {[["Espécie", nomeEsp(p.especieId)], ["Caixas", `${p.qtd} × caixa padrão`], ["Peso bruto", `${p.brutoStr || "0,00"} kg`], ["Tara", `${psBR(p.qtd * tara)} kg`], ["Peso líquido", `${psBR(liqKg)} kg`], ["Conservação", consLabel(p.conservacao)], ["Temperatura", `${p.tempStr ? (p.tempNeg ? "−" : "+") + p.tempStr : "—"} °C`], ["Conformidade", p.conforme ? "✓ conforme" : "⚠️ NÃO conforme"]].map(([k, v]) => (
                <div key={k} className="flex justify-between px-3 py-2.5"><span className="text-gray-500">{k}</span><span className="font-medium text-right">{v}</span></div>
              ))}
              {!p.conforme && <div className="flex justify-between px-3 py-2.5"><span className="text-gray-500">Motivo</span><span className="font-medium text-right">{p.motivo || "—"}</span></div>}
              {!p.conforme && <div className="px-3 py-2.5"><span className="text-gray-500">Descrição</span><div className="font-medium mt-0.5">{p.motivoDesc || "—"}</div></div>}
            </div>
            <button className={bigBrand} onClick={confirmaProduto}>✓ Confirmar produto</button>
          </div>
        )}

        {step === "opts" && (
          <div>
            <div className="text-center py-3">
              <div className="w-16 h-16 rounded-full bg-sky-50 dark:bg-sky-900/20 text-sky-600 flex items-center justify-center mx-auto mb-2 text-3xl">✓</div>
              <div className="text-xl font-extrabold">Produto confirmado</div>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-2 text-center"><div className="text-2xl font-extrabold tabular-nums">{produtos.length}</div><div className="text-[10px] uppercase text-gray-400">produtos</div></div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-2 text-center"><div className="text-2xl font-extrabold tabular-nums">{totCaixas}</div><div className="text-[10px] uppercase text-gray-400">caixas</div></div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-2 text-center"><div className="text-2xl font-extrabold tabular-nums">{psBR(totLiq)}</div><div className="text-[10px] uppercase text-gray-400">kg líq.</div></div>
            </div>
            <div className="space-y-3">
              <button className={bigBrand} onClick={novoProduto}>＋ Adicionar novo produto</button>
              <button className={bigGhost} onClick={() => setStep("resumo")}>Concluir recebimento</button>
            </div>
          </div>
        )}

        {step === "resumo" && (
          <div>
            <Q>Confira antes de salvar</Q><Sub>Fornecedor: {semForn ? "Sem fornecedor" : (fornNome || "—")}</Sub>
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 text-sm mb-3">
              {produtos.map((it) => (
                <div key={it.id} className="flex justify-between px-3 py-2.5">
                  <span><b>{nomeEsp(it.especieId)}</b> · {it.qtdCaixas} cx</span>
                  <span className="text-gray-500 text-right">{psBR(liqItem(it))} kg líq {it.conforme === false ? "· ⚠️" : "· ✓"}</span>
                </div>
              ))}
            </div>
            <input className={`${INPUT} mb-2`} placeholder="Nº da nota/romaneio do fornecedor (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
            <textarea className={`${INPUT} h-auto py-2 mb-3`} rows={2} placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
            <button className={bigBrand} disabled={salvando} onClick={() => void finalizar()}>{salvando ? "Salvando…" : "CONFIRMAR RECEBIMENTO"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Gerar plano de produção ──────────────────────────────────────────────────────
function PlanoEditor({ rid, meNome, recebimento, especies, cortes, onClose }: {
  rid: string; meNome: string | null; recebimento: ProducaoSispRecebimento;
  especies: ProducaoSispEspecie[]; cortes: ProducaoSispCorte[]; onClose: () => void;
}) {
  const [alvos, setAlvos] = useState<ProducaoSispPlanoAlvo[]>([]);
  const [especieId, setEspecieId] = useState("");
  const [corteId, setCorteId] = useState("");
  const [conserv, setConserv] = useState<ProducaoSispConservacao>("ultracongelado");
  const [gramagem, setGramagem] = useState("");
  const [instrucao, setInstrucao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const especiesReceb = useMemo(() => {
    const ids = Array.from(new Set(recebimento.itens.map((i) => i.especieId)));
    return especies.filter((e) => ids.includes(e.id));
  }, [recebimento, especies]);
  const cortesDaEspecie = cortes.filter((c) => c.especieId === especieId && c.ativo !== false);

  function addAlvo() {
    setErro("");
    if (!especieId) { setErro("Escolha a espécie."); return; }
    if (!corteId) { setErro("Escolha o corte/produto."); return; }
    setAlvos((prev) => [...prev, {
      id: uid(), especieId, corteId, conservacao: conserv,
      gramagemPorcaoG: gramagem.trim() === "" ? null : Number(gramagem),
      pesoBrutoDestinadoKg: null, instrucao: instrucao.trim() || null,
    }]);
    setCorteId(""); setGramagem(""); setInstrucao("");
  }

  async function salvar() {
    setErro("");
    if (alvos.length === 0) { setErro("Adicione ao menos um produto-alvo."); return; }
    setSalvando(true);
    try {
      const plano: ProducaoSispPlano = {
        id: uid(), restaurantId: rid, recebimentoId: recebimento.id,
        alvos, status: "aguardando_producao", criadoEm: hojeISO(), criadoPorNome: meNome,
      };
      await repo.salvarPlano(plano);
      await repo.salvarRecebimento({ ...recebimento, status: "planejado" });
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  const nomeEsp = (id: string) => especies.find((e) => e.id === id)?.nome || "—";
  const nomeCorte = (id: string) => cortes.find((c) => c.id === id)?.nome || "—";

  return (
    <Overlay titulo="Gerar plano de produção" onClose={onClose}
      footer={<button className={`${BTN_PRIMARY} w-full`} disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar plano"}</button>}>
      <div className="text-xs text-gray-500">Recebimento de {recebimento.fornecedorNome || "sem fornecedor"} · {fmtKg(repo.pesoBrutoRecebimento(recebimento))}</div>

      {alvos.length > 0 && (
        <div className="space-y-2">
          {alvos.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <div className="min-w-0 text-sm">
                <div className="font-medium truncate">{nomeEsp(a.especieId)} — {nomeCorte(a.corteId)}</div>
                <div className="text-xs text-gray-500">{CONSERV.find((c) => c.v === a.conservacao)?.label}{a.gramagemPorcaoG ? ` · ${a.gramagemPorcaoG} g/porção` : ""}</div>
              </div>
              <button className="text-gray-400 hover:text-rose-600" onClick={() => setAlvos((prev) => prev.filter((x) => x.id !== a.id))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Adicionar produto-alvo</div>
        {erro && <div className="text-xs text-rose-600">{erro}</div>}
        <select className={INPUT} value={especieId} onChange={(e) => { setEspecieId(e.target.value); setCorteId(""); }}>
          <option value="">Espécie…</option>
          {especiesReceb.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <select className={INPUT} value={corteId} disabled={!especieId} onChange={(e) => setCorteId(e.target.value)}>
          <option value="">Corte / produto…</option>
          {cortesDaEspecie.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {especieId && cortesDaEspecie.length === 0 && <div className="text-[11px] text-amber-600">Cadastre cortes dessa espécie na aba Config.</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Conservação
            <select className={INPUT} value={conserv} onChange={(e) => setConserv(e.target.value as ProducaoSispConservacao)}>
              {CONSERV.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Gramagem/porção (g)
            <input className={INPUT} type="number" inputMode="numeric" placeholder="ex.: 400" value={gramagem} onChange={(e) => setGramagem(e.target.value)} />
          </label>
        </div>
        <textarea className={`${INPUT} h-auto py-2`} rows={2} placeholder="Instrução de corte (etiqueta [E2])" value={instrucao} onChange={(e) => setInstrucao(e.target.value)} />
        <button className={`${BTN_GHOST} w-full`} onClick={addAlvo}><Plus size={14} /> Adicionar produto</button>
      </div>
    </Overlay>
  );
}

// ── Catálogo: espécies, cortes, fornecedores, config ─────────────────────────────
function CatalogoTab({ rid, especies, cortes, fornecedores, config, podeEditar }: {
  rid: string; especies: ProducaoSispEspecie[]; cortes: ProducaoSispCorte[];
  fornecedores: ProducaoSispFornecedor[]; config: ProducaoSispConfig | null; podeEditar: boolean;
}) {
  const [sub, setSub] = useTabPersistida("producaoSisp_cat", "especies", ["especies", "cortes", "fornecedores", "config"] as const);

  if (!podeEditar) return <div className="py-10 text-center text-sm text-gray-500">Sem permissão para editar o catálogo.</div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {([["especies", "Espécies"], ["cortes", "Cortes"], ["fornecedores", "Fornecedores"], ["config", "Config"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSub(k)} className={`h-8 px-3 rounded-full text-xs font-medium whitespace-nowrap ${sub === k ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900" : "border border-gray-300 dark:border-gray-600"}`}>{l}</button>
        ))}
      </div>
      {sub === "especies" && <EspeciesCat rid={rid} especies={especies} />}
      {sub === "cortes" && <CortesCat rid={rid} especies={especies} cortes={cortes} />}
      {sub === "fornecedores" && <FornecedoresCat rid={rid} fornecedores={fornecedores} />}
      {sub === "config" && <ConfigCat key={config?.atualizadoEm || "none"} rid={rid} config={config} />}
    </div>
  );
}

function EspeciesCat({ rid, especies }: { rid: string; especies: ProducaoSispEspecie[] }) {
  const [nome, setNome] = useState("");
  const [cientifico, setCientifico] = useState("");
  async function add() {
    if (!nome.trim()) return;
    await repo.salvarEspecie({ id: uid(), restaurantId: rid, nome: nome.trim(), nomeCientifico: cientifico.trim() || null, ativo: true, criadoEm: hojeISO() });
    setNome(""); setCientifico("");
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <input className={INPUT} placeholder="Nome (ex.: Pescada amarela)" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input className={INPUT} placeholder="Nome científico (opcional)" value={cientifico} onChange={(e) => setCientifico(e.target.value)} />
        <button className={`${BTN_GHOST} w-full`} onClick={() => void add()}><Plus size={14} /> Adicionar espécie</button>
      </div>
      <div className="space-y-2">
        {especies.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
            <div className="min-w-0 text-sm"><div className="font-medium truncate">{e.nome}</div>{e.nomeCientifico && <div className="text-xs text-gray-500 italic truncate">{e.nomeCientifico}</div>}</div>
            <button className="text-gray-400 hover:text-rose-600" onClick={() => void repo.excluirEspecie(e.id)}><Trash2 size={16} /></button>
          </div>
        ))}
        {especies.length === 0 && <div className="text-xs text-gray-400 italic">Nenhuma espécie ainda.</div>}
      </div>
    </div>
  );
}

function CortesCat({ rid, especies, cortes }: { rid: string; especies: ProducaoSispEspecie[]; cortes: ProducaoSispCorte[] }) {
  const [especieId, setEspecieId] = useState("");
  const [nome, setNome] = useState("");
  const [conserv, setConserv] = useState<ProducaoSispConservacao>("ultracongelado");
  const [valUltra, setValUltra] = useState("");
  const [valRefri, setValRefri] = useState("");
  const [precoVar, setPrecoVar] = useState("");
  const [precoAta, setPrecoAta] = useState("");
  const [rend, setRend] = useState("");
  async function add() {
    if (!especieId || !nome.trim()) return;
    await repo.salvarCorte({
      id: uid(), restaurantId: rid, especieId, nome: nome.trim(),
      rendimentoEsperadoPct: rend.trim() === "" ? null : Number(rend),
      conservacaoPadrao: conserv,
      validadeDias: { ultracongelado: valUltra.trim() === "" ? null : Number(valUltra), refrigerado: valRefri.trim() === "" ? null : Number(valRefri) },
      precoVarejoKg: precoVar.trim() === "" ? null : Number(precoVar),
      precoAtacadoKg: precoAta.trim() === "" ? null : Number(precoAta),
      ativo: true, criadoEm: hojeISO(),
    });
    setNome(""); setValUltra(""); setValRefri(""); setPrecoVar(""); setPrecoAta(""); setRend("");
  }
  const nomeEsp = (id: string) => especies.find((e) => e.id === id)?.nome || "—";
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <select className={INPUT} value={especieId} onChange={(e) => setEspecieId(e.target.value)}>
          <option value="">Espécie…</option>
          {especies.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <input className={INPUT} placeholder="Nome do corte (ex.: Filé com pele)" value={nome} onChange={(e) => setNome(e.target.value)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Conservação padrão
            <select className={INPUT} value={conserv} onChange={(e) => setConserv(e.target.value as ProducaoSispConservacao)}>
              {CONSERV.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Rendimento esperado (%)
            <input className={INPUT} type="number" inputMode="decimal" value={rend} onChange={(e) => setRend(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Validade ultracongelado (dias)
            <input className={INPUT} type="number" inputMode="numeric" value={valUltra} onChange={(e) => setValUltra(e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">Validade refrigerado (dias)
            <input className={INPUT} type="number" inputMode="numeric" value={valRefri} onChange={(e) => setValRefri(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Preço varejo (R$/kg)
            <input className={INPUT} type="number" inputMode="decimal" value={precoVar} onChange={(e) => setPrecoVar(e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">Preço atacado (R$/kg)
            <input className={INPUT} type="number" inputMode="decimal" value={precoAta} onChange={(e) => setPrecoAta(e.target.value)} />
          </label>
        </div>
        <button className={`${BTN_GHOST} w-full`} onClick={() => void add()}><Plus size={14} /> Adicionar corte</button>
      </div>
      <div className="space-y-2">
        {cortes.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
            <div className="min-w-0 text-sm"><div className="font-medium truncate">{c.nome}</div><div className="text-xs text-gray-500 truncate">{nomeEsp(c.especieId)}{c.precoVarejoKg ? ` · R$ ${c.precoVarejoKg}/kg` : ""}</div></div>
            <button className="text-gray-400 hover:text-rose-600" onClick={() => void repo.excluirCorte(c.id)}><Trash2 size={16} /></button>
          </div>
        ))}
        {cortes.length === 0 && <div className="text-xs text-gray-400 italic">Nenhum corte ainda.</div>}
      </div>
    </div>
  );
}

function FornecedoresCat({ rid, fornecedores }: { rid: string; fornecedores: ProducaoSispFornecedor[] }) {
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [whats, setWhats] = useState("");
  const [reg, setReg] = useState("");
  async function add() {
    if (!nome.trim()) return;
    await repo.salvarFornecedor({ id: uid(), restaurantId: rid, nome: nome.trim(), cnpj: cnpj.trim() || null, whatsapp: whats.trim() || null, registroSanitario: reg.trim() || null, ativo: true, criadoEm: hojeISO() });
    setNome(""); setCnpj(""); setWhats(""); setReg("");
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <input className={INPUT} placeholder="Nome / razão social" value={nome} onChange={(e) => setNome(e.target.value)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className={INPUT} placeholder="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          <input className={INPUT} placeholder="WhatsApp" value={whats} onChange={(e) => setWhats(e.target.value)} />
        </div>
        <input className={INPUT} placeholder="Registro sanitário / SIF (origem)" value={reg} onChange={(e) => setReg(e.target.value)} />
        <button className={`${BTN_GHOST} w-full`} onClick={() => void add()}><Plus size={14} /> Adicionar fornecedor</button>
      </div>
      <div className="space-y-2">
        {fornecedores.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
            <div className="min-w-0 text-sm"><div className="font-medium truncate">{f.nome}</div><div className="text-xs text-gray-500 truncate">{[f.cnpj, f.registroSanitario && `SIF ${f.registroSanitario}`].filter(Boolean).join(" · ") || "—"}</div></div>
            <button className="text-gray-400 hover:text-rose-600" onClick={() => void repo.excluirFornecedor(f.id)}><Trash2 size={16} /></button>
          </div>
        ))}
        {fornecedores.length === 0 && <div className="text-xs text-gray-400 italic">Nenhum fornecedor ainda.</div>}
      </div>
    </div>
  );
}

// ── F2: lançar produção / rendimento (plano → lotes) ─────────────────────────
function ProducaoEditor({ rid, meNome, plano, recebimento, especies, cortes, lotes, config, onDone }: {
  rid: string; meNome: string | null; plano: ProducaoSispPlano; recebimento: ProducaoSispRecebimento | null;
  especies: ProducaoSispEspecie[]; cortes: ProducaoSispCorte[]; lotes: ProducaoSispLote[];
  config: ProducaoSispConfig | null; onDone: () => void;
}) {
  type LinhaForm = { bruto: string; beneficiado: string; pacotes: string; custoMpKg: string; precoVar: string; precoAta: string };
  const [form, setForm] = useState<Record<string, LinhaForm>>(() => {
    const init: Record<string, LinhaForm> = {};
    plano.alvos.forEach((a) => {
      const c = cortes.find((x) => x.id === a.corteId);
      init[a.id] = {
        bruto: a.pesoBrutoDestinadoKg ? String(a.pesoBrutoDestinadoKg) : "",
        beneficiado: "", pacotes: "", custoMpKg: "",
        precoVar: c?.precoVarejoKg != null ? String(c.precoVarejoKg) : "",
        precoAta: c?.precoAtacadoKg != null ? String(c.precoAtacadoKg) : "",
      };
    });
    return init;
  });
  const [subs, setSubs] = useState<{ id: string; nome: string; kg: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const set = (alvoId: string, campo: keyof LinhaForm, v: string) =>
    setForm((prev) => ({ ...prev, [alvoId]: { ...prev[alvoId], [campo]: v } }));
  const nomeEsp = (id: string) => especies.find((e) => e.id === id)?.nome || "—";
  const nomeCorte = (id: string) => cortes.find((c) => c.id === id)?.nome || "—";
  const addSub = (nome: string) => setSubs((prev) => [...prev, { id: uid(), nome, kg: "" }]);
  const setSubKg = (id: string, kg: string) => setSubs((prev) => prev.map((s) => s.id === id ? { ...s, kg } : s));
  const rmSub = (id: string) => setSubs((prev) => prev.filter((s) => s.id !== id));

  async function salvar() {
    setErro("");
    const hoje = new Date();
    const prefixoBase = (config?.lotePrefixo || "").trim();
    const hojePrefixoISO = hoje.toISOString().slice(0, 10);
    let seq = lotes.filter((l) => (l.fabricacaoEm || "").slice(0, 10) === hojePrefixoISO).length;

    const novos: ProducaoSispLote[] = [];
    for (const a of plano.alvos) {
      const f = form[a.id];
      const bruto = Number(f.bruto) || 0;
      const benef = Number(f.beneficiado) || 0;
      const pac = Math.round(Number(f.pacotes) || 0);
      if (benef <= 0 && pac <= 0) continue; // alvo não produzido agora
      if (benef <= 0) { setErro(`Informe o peso beneficiado de ${nomeCorte(a.corteId)}.`); return; }
      if (pac <= 0) { setErro(`Informe o nº de pacotes de ${nomeCorte(a.corteId)}.`); return; }
      const corte = cortes.find((c) => c.id === a.corteId);
      const prefixo = prefixoBase || nomeEsp(a.especieId).replace(/[^A-Za-zÀ-ÿ]/g, "").slice(0, 3);
      seq += 1;
      const custoMpKg = Number(f.custoMpKg) || 0;
      const custoKgBeneficiado = custoMpKg > 0 && bruto > 0 && benef > 0
        ? Math.round((custoMpKg * bruto / benef) * 100) / 100 : null;
      const validadeDias = corte?.validadeDias?.[a.conservacao] ?? null;
      const fabISO = hojeISO();
      novos.push({
        id: uid(), restaurantId: rid, planoId: plano.id, recebimentoId: plano.recebimentoId,
        especieId: a.especieId, corteId: a.corteId,
        codigo: repo.gerarCodigoLote(prefixo, seq, hoje),
        conservacao: a.conservacao,
        pesoBrutoEntradaKg: bruto, pesoBeneficiadoKg: benef,
        rendimentoPct: repo.rendimentoPct(bruto, benef),
        nPacotes: pac,
        custoKgBeneficiado,
        precoVarejoKg: f.precoVar.trim() === "" ? null : Number(f.precoVar),
        precoAtacadoKg: f.precoAta.trim() === "" ? null : Number(f.precoAta),
        fabricacaoEm: fabISO, validadeEm: repo.calcValidadeISO(fabISO, validadeDias),
        saldoPacotes: pac, saldoKg: benef, local: "fabrica", status: "disponivel",
        criadoEm: fabISO, criadoPorNome: meNome,
      });
    }
    if (novos.length === 0) { setErro("Lance o peso beneficiado e os pacotes de ao menos um produto."); return; }
    setSalvando(true);
    try {
      const subprodutos = subs.map((s) => ({ nome: s.nome, pesoKg: Number((s.kg || "0").replace(",", ".")) || 0 })).filter((s) => s.pesoKg > 0);
      await repo.salvarProducao(novos, { ...plano, status: "produzido", produzidoEm: hojeISO(), subprodutos: subprodutos.length ? subprodutos : null });
      onDone();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar."); setSalvando(false);
    }
  }

  return (
    <Overlay titulo="Lançar produção / rendimento" onClose={onDone}
      footer={<button className={`${BTN_PRIMARY} w-full`} disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Gerar lotes"}</button>}>
      <div className="text-xs text-gray-500">{recebimento?.fornecedorNome || "Recebimento"} · pese o beneficiado de cada produto. O rendimento sai automático.</div>
      {erro && <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}

      {plano.alvos.map((a) => {
        const f = form[a.id];
        const bruto = Number(f.bruto) || 0, benef = Number(f.beneficiado) || 0;
        const rend = repo.rendimentoPct(bruto, benef);
        const esperado = cortes.find((c) => c.id === a.corteId)?.rendimentoEsperadoPct ?? null;
        const destoa = rend != null && esperado != null && Math.abs(rend - esperado) > 10;
        const feito = benef > 0;
        return (
          <div key={a.id} className={`rounded-xl border p-3 space-y-2 ${feito ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/15" : "border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/15"}`}>
            <div className="font-medium text-sm">{nomeEsp(a.especieId)} — {nomeCorte(a.corteId)}
              <span className="text-xs font-normal text-gray-400"> · {CONSERV.find((c) => c.v === a.conservacao)?.label}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">Bruto destinado (kg)
                <input className={INPUT} type="number" inputMode="decimal" value={f.bruto} onChange={(e) => set(a.id, "bruto", e.target.value)} />
              </label>
              <label className="text-xs text-gray-500">Beneficiado (kg)
                <input className={INPUT} type="number" inputMode="decimal" value={f.beneficiado} onChange={(e) => set(a.id, "beneficiado", e.target.value)} />
              </label>
            </div>
            {rend != null && (
              <div className={`text-xs inline-flex items-center gap-1 ${destoa ? "text-amber-600" : "text-emerald-600"}`}>
                {destoa && <AlertTriangle size={12} />} Rendimento {rend}%{esperado != null ? ` (esperado ${esperado}%)` : ""}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">Nº de pacotes
                <input className={INPUT} type="number" inputMode="numeric" value={f.pacotes} onChange={(e) => set(a.id, "pacotes", e.target.value)} />
              </label>
              <label className="text-xs text-gray-500">Custo MP (R$/kg bruto)
                <input className={INPUT} type="number" inputMode="decimal" placeholder="opcional" value={f.custoMpKg} onChange={(e) => set(a.id, "custoMpKg", e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">Preço varejo (R$/kg)
                <input className={INPUT} type="number" inputMode="decimal" value={f.precoVar} onChange={(e) => set(a.id, "precoVar", e.target.value)} />
              </label>
              <label className="text-xs text-gray-500">Preço atacado (R$/kg)
                <input className={INPUT} type="number" inputMode="decimal" value={f.precoAta} onChange={(e) => set(a.id, "precoAta", e.target.value)} />
              </label>
            </div>
          </div>
        );
      })}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Subprodutos <span className="font-normal normal-case">(aparas, espinhas, cabeça…)</span></div>
        {subs.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <span className="text-sm flex-1">{s.nome}</span>
            <input className={`${INPUT} w-24`} type="number" inputMode="decimal" placeholder="kg" value={s.kg} onChange={(e) => setSubKg(s.id, e.target.value)} />
            <button className="text-gray-400 hover:text-rose-600 shrink-0" onClick={() => rmSub(s.id)}><Trash2 size={15} /></button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5">
          {["Aparas", "Espinha", "Cabeça", "Pele", "Vísceras", "Outro"].map((n) => (
            <button key={n} className={BTN_GHOST} onClick={() => addSub(n)}><Plus size={13} /> {n}</button>
          ))}
        </div>
      </div>
      <div className="text-[11px] text-gray-400">Cada produto vira um lote no estoque da fábrica. Imprima a etiqueta SISP pelo botão na esteira.</div>
    </Overlay>
  );
}

// ── F3: romaneio / expedição (fábrica → loja / restaurante / atacado) ─────────
function RomaneioEditor({ rid, meNome, lotes, especies, cortes, restaurants, activeRestaurant, onClose }: {
  rid: string; meNome: string | null; lotes: ProducaoSispLote[];
  especies: ProducaoSispEspecie[]; cortes: ProducaoSispCorte[];
  restaurants: Restaurant[]; activeRestaurant: Restaurant | null; onClose: () => void;
}) {
  const [destinoTipo, setDestinoTipo] = useState<ProducaoSispRomaneioDestino>("loja");
  const [destRestId, setDestRestId] = useState("");
  const [clienteNome, setClienteNome] = useState("");
  const [tipoManual, setTipoManual] = useState<ProducaoSispRomaneioTipo | null>(null);
  const [fiscal, setFiscal] = useState(false);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const outrosRest = restaurants.filter((r) => r.id !== rid);
  const nomeEsp = (id: string) => especies.find((e) => e.id === id)?.nome || "—";
  const nomeCorte = (id: string) => cortes.find((c) => c.id === id)?.nome || "—";
  const onlyDigits = (s?: string | null) => (s || "").replace(/\D/g, "");

  // Tipo sugerido pelo CNPJ (mesmo CNPJ = transferência; diferente = venda).
  const destRest = restaurants.find((r) => r.id === destRestId) || null;
  const tipoSugerido: ProducaoSispRomaneioTipo = (() => {
    if (destinoTipo === "clienteAtacado") return "venda";
    const my = onlyDigits(activeRestaurant?.cnpj), d = onlyDigits(destRest?.cnpj);
    if (my && d && my !== d) return "venda";
    return "transferencia";
  })();
  const tipoEfetivo = tipoManual ?? tipoSugerido;

  function peçosLote(l: ProducaoSispLote, qtd: number) {
    return l.saldoPacotes > 0 ? Math.round((l.saldoKg * qtd / l.saldoPacotes) * 1000) / 1000 : 0;
  }

  async function expedir() {
    setErro("");
    const itens: ProducaoSispRomaneioItem[] = [];
    const lotesUpd: ProducaoSispLote[] = [];
    for (const l of lotes) {
      const q = Math.round(Number(sel[l.id]) || 0);
      if (q <= 0) continue;
      if (q > l.saldoPacotes) { setErro(`Lote ${l.codigo}: máximo ${l.saldoPacotes} pacotes.`); return; }
      const pesoKg = peçosLote(l, q);
      itens.push({ loteId: l.id, corteId: l.corteId, pesoKg, qtdPacotes: q });
      const saldoPacotes = l.saldoPacotes - q;
      const saldoKg = Math.round((l.saldoKg - pesoKg) * 1000) / 1000;
      lotesUpd.push({ ...l, saldoPacotes, saldoKg, status: saldoPacotes <= 0 ? "esgotado" : "disponivel" });
    }
    if (itens.length === 0) { setErro("Selecione ao menos um lote e a quantidade."); return; }

    let destinoNome: string;
    let destinoId: string | null = null;
    if (destinoTipo === "loja") { destinoNome = destRest?.nome || "Loja"; destinoId = destRestId || null; }
    else if (destinoTipo === "restaurante") {
      if (!destRestId) { setErro("Escolha o restaurante de destino."); return; }
      destinoNome = destRest?.nome || "Restaurante"; destinoId = destRestId;
    } else {
      if (!clienteNome.trim()) { setErro("Informe o nome do cliente atacado."); return; }
      destinoNome = clienteNome.trim();
    }

    setSalvando(true);
    try {
      const romaneio: ProducaoSispRomaneio = {
        id: uid(), restaurantId: rid, tipo: tipoEfetivo, destinoTipo, destinoId, destinoNome,
        itens, status: "em_transito", fiscal: tipoEfetivo === "venda" ? fiscal : null, obs: null,
        expedidoEm: hojeISO(), expedidoPorNome: meNome, criadoEm: hojeISO(),
      };
      await repo.expedir(romaneio, lotesUpd);
      // Etiqueta master do saco
      const lotesSel = lotes.filter((l) => (Number(sel[l.id]) || 0) > 0);
      const resumo = Array.from(new Set(lotesSel.map((l) => `${nomeEsp(l.especieId)} — ${nomeCorte(l.corteId)}`))).join(", ");
      const doc = await etiquetaMasterPDF({
        razaoSocial: activeRestaurant?.nome, destino: destinoNome,
        tipo: tipoEfetivo === "venda" ? "Venda" : "Transferência",
        produtoResumo: resumo, lotes: lotesSel.map((l) => l.codigo),
        pesoTotalKg: itens.reduce((s, it) => s + it.pesoKg, 0),
        qtdPacotes: itens.reduce((s, it) => s + it.qtdPacotes, 0),
        romaneioId: romaneio.id, expedidoISO: romaneio.expedidoEm,
      });
      abrirPDF(doc);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao expedir."); setSalvando(false);
    }
  }

  return (
    <Overlay titulo="Expedir / romaneio" onClose={onClose}
      footer={<button className={`${BTN_PRIMARY} w-full`} disabled={salvando} onClick={() => void expedir()}>{salvando ? "Expedindo…" : "Expedir e imprimir master"}</button>}>
      {erro && <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Destino</div>
        <div className="grid grid-cols-3 gap-2">
          {([["loja", "Loja"], ["restaurante", "Restaurante"], ["clienteAtacado", "Atacado"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => { setDestinoTipo(v); setTipoManual(null); }}
              className={`h-9 rounded-lg text-sm font-medium ${destinoTipo === v ? "bg-sky-600 text-white" : "border border-gray-300 dark:border-gray-600"}`}>{l}</button>
          ))}
        </div>
        {(destinoTipo === "loja" || destinoTipo === "restaurante") && (
          <select className={INPUT} value={destRestId} onChange={(e) => { setDestRestId(e.target.value); setTipoManual(null); }}>
            <option value="">{destinoTipo === "loja" ? "Loja (padrão) — ou escolha a filial…" : "Escolha o restaurante…"}</option>
            {outrosRest.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
        )}
        {destinoTipo === "clienteAtacado" && (
          <input className={INPUT} placeholder="Nome do cliente atacado" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} />
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full font-medium ${tipoEfetivo === "venda" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"}`}>
            {tipoEfetivo === "venda" ? "Venda (outro CNPJ)" : "Transferência (mesmo CNPJ)"}
          </span>
          <button className="underline text-gray-400" onClick={() => setTipoManual(tipoEfetivo === "venda" ? "transferencia" : "venda")}>trocar</button>
        </div>
        {tipoEfetivo === "venda" && (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fiscal} onChange={(e) => setFiscal(e.target.checked)} /> Registrar como fiscal (nota sai no sistema fiscal)
          </label>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Lotes a enviar</div>
        {lotes.map((l) => {
          const q = Number(sel[l.id]) || 0;
          return (
            <div key={l.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <div className="font-medium truncate">{nomeEsp(l.especieId)} — {nomeCorte(l.corteId)}</div>
                  <div className="text-xs text-gray-500">Lote {l.codigo} · saldo {l.saldoPacotes} pac · {fmtKg(l.saldoKg)}</div>
                </div>
                <input className={`${INPUT} w-20 text-center`} type="number" inputMode="numeric" min={0} max={l.saldoPacotes}
                  placeholder="pac" value={sel[l.id] ?? ""} onChange={(e) => setSel((p) => ({ ...p, [l.id]: e.target.value }))} />
              </div>
              {q > 0 && <div className="text-[11px] text-gray-400 mt-1">≈ {fmtKg(peçosLote(l, Math.min(q, l.saldoPacotes)))} (proporcional; peso real na entrada)</div>}
            </div>
          );
        })}
      </div>
    </Overlay>
  );
}

// ── F3: entrada na loja (pesa pacote a pacote → serializa peça + varejo) ──────
function EntradaLojaEditor({ rid, meNome, romaneio, lotes, especies, cortes, config, onClose }: {
  rid: string; meNome: string | null; romaneio: ProducaoSispRomaneio;
  lotes: ProducaoSispLote[]; especies: ProducaoSispEspecie[]; cortes: ProducaoSispCorte[];
  config: ProducaoSispConfig | null; onClose: () => void;
}) {
  const [pecas, setPecas] = useState<ProducaoSispPeca[]>([]);
  const [loteId, setLoteId] = useState(romaneio.itens[0]?.loteId || "");
  const [peso, setPeso] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const nomeEsp = (id: string) => especies.find((e) => e.id === id)?.nome || "—";
  const nomeCorte = (id: string) => cortes.find((c) => c.id === id)?.nome || "—";
  const lotesDoRomaneio = romaneio.itens.map((it) => lotes.find((l) => l.id === it.loteId)).filter(Boolean) as ProducaoSispLote[];

  const esperadoPac = romaneio.itens.reduce((s, it) => s + it.qtdPacotes, 0);
  const esperadoKg = romaneio.itens.reduce((s, it) => s + it.pesoKg, 0);
  const somaKg = pecas.reduce((s, p) => s + p.pesoKg, 0);
  const divKg = esperadoKg > 0 ? Math.abs(somaKg - esperadoKg) / esperadoKg : 0;

  function adicionar() {
    setErro("");
    const l = lotes.find((x) => x.id === loteId);
    if (!l) { setErro("Escolha o lote."); return; }
    const kg = Number(peso) || 0;
    if (kg <= 0) { setErro("Informe o peso do pacote."); return; }
    const corte = cortes.find((c) => c.id === l.corteId);
    setPecas((prev) => [...prev, {
      id: uid(), restaurantId: rid, loteId: l.id, especieId: l.especieId, corteId: l.corteId,
      pesoKg: kg, precoKg: l.precoVarejoKg ?? corte?.precoVarejoKg ?? null,
      conservacao: l.conservacao, validadeEm: l.validadeEm, local: "loja",
      status: "em_estoque", criadoEm: hojeISO(),
    }]);
    setPeso("");
  }

  async function finalizar() {
    setErro("");
    if (pecas.length === 0) { setErro("Pese ao menos um pacote."); return; }
    setSalvando(true);
    try {
      const romUpd: ProducaoSispRomaneio = {
        ...romaneio, status: "recebido", recebidoEm: hojeISO(), recebidoPorNome: meNome,
        pesoRecebidoKg: Math.round(somaKg * 1000) / 1000, pacotesRecebidos: pecas.length,
      };
      await repo.receberNaLoja(pecas, [], romUpd);
      const doc = await etiquetaVarejoPDF(config?.razaoSocial || null, pecas.map((p) => ({
        id: p.id, produto: `${nomeEsp(p.especieId)} — ${nomeCorte(p.corteId)}`,
        cientifico: especies.find((e) => e.id === p.especieId)?.nomeCientifico,
        pesoKg: p.pesoKg, precoKg: p.precoKg, codigoLote: lotes.find((l) => l.id === p.loteId)?.codigo || "—",
        validadeISO: p.validadeEm, conservacao: CONSERV.find((c) => c.v === p.conservacao)?.label || p.conservacao,
      })));
      abrirPDF(doc);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao receber."); setSalvando(false);
    }
  }

  return (
    <Overlay titulo="Conferir entrada na loja" onClose={onClose}
      footer={<button className={`${BTN_PRIMARY} w-full`} disabled={salvando} onClick={() => void finalizar()}>{salvando ? "Salvando…" : "Finalizar e imprimir varejo"}</button>}>
      {erro && <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}

      <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-500 text-xs">Pacotes</span>
          <span className={pecas.length === esperadoPac ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>{pecas.length} / {esperadoPac}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-gray-500 text-xs">Peso</span>
          <span className={divKg > 0.05 ? "text-amber-600 font-medium" : "text-emerald-600 font-medium"}>{fmtKg(somaKg)} / {fmtKg(esperadoKg)}</span>
        </div>
        {(pecas.length !== esperadoPac || divKg > 0.05) && pecas.length > 0 && (
          <div className="mt-1 text-[11px] text-amber-600 inline-flex items-center gap-1"><AlertTriangle size={12} /> Divergência vs. master — confira antes de finalizar.</div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1"><Scale size={13} /> Pesar pacote</div>
        <select className={INPUT} value={loteId} onChange={(e) => setLoteId(e.target.value)}>
          {lotesDoRomaneio.map((l) => <option key={l.id} value={l.id}>{nomeEsp(l.especieId)} — {nomeCorte(l.corteId)} (Lote {l.codigo})</option>)}
        </select>
        <div className="flex gap-2">
          <input className={INPUT} type="number" inputMode="decimal" placeholder="peso (kg)" value={peso} onChange={(e) => setPeso(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") adicionar(); }} />
          <button className={BTN_GHOST} onClick={adicionar}><Plus size={14} /> Peça</button>
        </div>
        <div className="text-[11px] text-gray-400">Cada pacote pesado vira uma peça com QR único de varejo (estoque da loja + venda).</div>
      </div>

      {pecas.length > 0 && (
        <div className="space-y-1">
          {pecas.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1.5 text-sm">
              <div className="min-w-0 flex items-center gap-2">
                <QrCode size={13} className="text-gray-400 shrink-0" />
                <span className="truncate">{nomeCorte(p.corteId)} · {fmtKg(p.pesoKg)}</span>
              </div>
              <button className="text-gray-400 hover:text-rose-600" onClick={() => setPecas((prev) => prev.filter((x) => x.id !== p.id))}><Trash2 size={15} /></button>
            </div>
          )).reverse()}
        </div>
      )}
    </Overlay>
  );
}

function ConfigCat({ rid, config }: { rid: string; config: ProducaoSispConfig | null }) {
  const [registro, setRegistro] = useState(config?.registroSisp || "");
  const [razao, setRazao] = useState(config?.razaoSocial || "");
  const [cnpj, setCnpj] = useState(config?.cnpj || "");
  const [endereco, setEndereco] = useState(config?.endereco || "");
  const [sac, setSac] = useState(config?.sac || "");
  const [prefixo, setPrefixo] = useState(config?.lotePrefixo || "");
  const [tolRef, setTolRef] = useState(String(config?.tolTempRefrigC ?? 4));
  const [tolCong, setTolCong] = useState(String(config?.tolTempCongeladoC ?? -12));
  const [taras, setTaras] = useState<{ id: string; nome: string; taraKg: string }[]>(
    (config?.taraTipos && config.taraTipos.length ? config.taraTipos : [{ id: uid(), nome: "Caixa padrão", taraKg: 0.8 }]).map((t) => ({ id: t.id, nome: t.nome, taraKg: String(t.taraKg) }))
  );
  const [rotulos, setRotulos] = useState<{ codigo: string; produto: string }[]>(config?.rotulos ? config.rotulos.map((r) => ({ ...r })) : []);
  const [salvo, setSalvo] = useState(false);

  const n = (s: string) => Number((s || "").replace(",", ".")) || 0;
  async function salvar() {
    await repo.salvarConfig(rid, {
      rid, registroSisp: registro.trim() || null, razaoSocial: razao.trim() || null, cnpj: cnpj.trim() || null,
      endereco: endereco.trim() || null, sac: sac.trim() || null, lotePrefixo: prefixo.trim().toUpperCase() || null,
      tolTempRefrigC: n(tolRef), tolTempCongeladoC: n(tolCong),
      taraTipos: taras.filter((t) => t.nome.trim()).map((t) => ({ id: t.id, nome: t.nome.trim(), taraKg: n(t.taraKg) })),
      rotulos: rotulos.filter((r) => r.codigo.trim()).map((r) => ({ codigo: r.codigo.trim(), produto: r.produto.trim() })),
    });
    setSalvo(true); setTimeout(() => setSalvo(false), 2000);
  }
  const Secao = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{titulo}</div>
      {children}
    </div>
  );
  return (
    <div className="space-y-3">
      <Secao titulo="Registro SISP & rótulo da etiqueta">
        <input className={INPUT} placeholder="Nº de registro no SISP (ex.: 2209)" value={registro} onChange={(e) => setRegistro(e.target.value)} />
        <input className={INPUT} placeholder="Razão social (ex.: SOROROCA RESTAURANTE LTDA)" value={razao} onChange={(e) => setRazao(e.target.value)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className={INPUT} placeholder="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          <input className={INPUT} placeholder="SAC (telefone)" value={sac} onChange={(e) => setSac(e.target.value)} />
        </div>
        <input className={INPUT} placeholder="Endereço do estabelecimento" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
        <input className={INPUT} placeholder="Prefixo do lote (ex.: PAM)" value={prefixo} onChange={(e) => setPrefixo(e.target.value)} />
      </Secao>

      <Secao titulo="Rótulos aprovados no registro">
        {rotulos.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input className={`${INPUT} w-28`} placeholder="2209/001" value={r.codigo} onChange={(e) => setRotulos((p) => p.map((x, j) => j === i ? { ...x, codigo: e.target.value } : x))} />
            <input className={INPUT} placeholder="peixe congelado" value={r.produto} onChange={(e) => setRotulos((p) => p.map((x, j) => j === i ? { ...x, produto: e.target.value } : x))} />
            <button className="text-gray-400 hover:text-rose-600 shrink-0" onClick={() => setRotulos((p) => p.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
          </div>
        ))}
        <button className={BTN_GHOST} onClick={() => setRotulos((p) => [...p, { codigo: "", produto: "" }])}><Plus size={13} /> Rótulo</button>
      </Secao>

      <Secao titulo="Tipos de caixa & tara">
        <div className="text-[11px] text-gray-500">A tara é descontada do peso bruto no recebimento.</div>
        {taras.map((t, i) => (
          <div key={t.id} className="flex gap-2 items-center">
            <input className={INPUT} placeholder="Nome (ex.: Caixa padrão)" value={t.nome} onChange={(e) => setTaras((p) => p.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))} />
            <input className={`${INPUT} w-24`} type="number" inputMode="decimal" placeholder="kg" value={t.taraKg} onChange={(e) => setTaras((p) => p.map((x, j) => j === i ? { ...x, taraKg: e.target.value } : x))} />
            {taras.length > 1 && <button className="text-gray-400 hover:text-rose-600 shrink-0" onClick={() => setTaras((p) => p.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}
          </div>
        ))}
        <button className={BTN_GHOST} onClick={() => setTaras((p) => [...p, { id: uid(), nome: "", taraKg: "" }])}><Plus size={13} /> Tipo de caixa</button>
      </Secao>

      <Secao titulo="Limites de conferência (temperatura)">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Refrigerado ≤ (°C)
            <input className={INPUT} type="number" inputMode="decimal" value={tolRef} onChange={(e) => setTolRef(e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">Congelado ≤ (°C)
            <input className={INPUT} type="number" inputMode="decimal" value={tolCong} onChange={(e) => setTolCong(e.target.value)} />
          </label>
        </div>
      </Secao>

      <button className={`${BTN_PRIMARY} w-full`} onClick={() => void salvar()}>{salvo ? <><Check size={16} /> Salvo</> : "Salvar configuração"}</button>
    </div>
  );
}
