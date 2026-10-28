// Produção SISP (peixaria) — mobile-first. O módulo transita como ESTEIRA por
// status: recebimento → plano → produção (rendimento) → lote → saída.
// F1 entrega: esteira (painel de pendências) + wizard de recebimento + gerar plano
// + catálogo (espécies, cortes, fornecedores). Captura v1: foto (câmera do celular),
// peso e temperatura digitados. Leitores (balança/termômetro) plugam depois.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Fish, Plus, X, ChevronLeft, Trash2, Check, AlertTriangle, Package, ClipboardList, ArrowRight, Boxes } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PageContainer } from "../../core/ui/PageContainer";
import { useTabPersistida } from "../../core/hooks/useTabPersistida";
import { FotoUpload } from "../checklists/FotoUpload";
import type {
  ProducaoSispEspecie, ProducaoSispCorte, ProducaoSispFornecedor,
  ProducaoSispRecebimento, ProducaoSispRecebimentoItem, ProducaoSispPlano,
  ProducaoSispPlanoAlvo, ProducaoSispConservacao, ProducaoSispPesoModo, ProducaoSispConfig,
} from "../../core/types";
import * as repo from "./producaoSispRepo";
import { uid } from "./producaoSispRepo";

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
  const { activeRestaurant } = useRestaurant();
  const { can } = useCanAcao(rid);

  const [tab, setTab] = useTabPersistida("producaoSisp_tab", "esteira", ["esteira", "catalogo"] as const);
  const [especies, setEspecies] = useState<ProducaoSispEspecie[]>([]);
  const [cortes, setCortes] = useState<ProducaoSispCorte[]>([]);
  const [fornecedores, setFornecedores] = useState<ProducaoSispFornecedor[]>([]);
  const [recebimentos, setRecebimentos] = useState<ProducaoSispRecebimento[]>([]);
  const [planos, setPlanos] = useState<ProducaoSispPlano[]>([]);
  const [config, setConfig] = useState<ProducaoSispConfig | null>(null);

  const [novoReceb, setNovoReceb] = useState(false);
  const [planoDe, setPlanoDe] = useState<ProducaoSispRecebimento | null>(null);

  useEffect(() => {
    if (!rid) return;
    const subs = [
      repo.ouvirEspecies(rid, setEspecies),
      repo.ouvirCortes(rid, setCortes),
      repo.ouvirFornecedores(rid, setFornecedores),
      repo.ouvirRecebimentos(rid, setRecebimentos),
      repo.ouvirPlanos(rid, setPlanos),
      repo.ouvirConfig(rid, setConfig),
    ];
    return () => subs.forEach((u) => u());
  }, [rid]);

  const podeVer = can("producaoSisp", "ver");
  const podeReceber = can("producaoSisp", "receber");
  const podePlanejar = can("producaoSisp", "planejar");
  const podeCatalogo = can("producaoSisp", "catalogo");

  const aguardandoPlano = useMemo(() => recebimentos.filter((r) => r.status === "aguardando_plano"), [recebimentos]);
  const aguardandoProducao = useMemo(() => planos.filter((p) => p.status === "aguardando_producao"), [planos]);

  if (!podeVer) {
    return (
      <PageContainer>
        <div className="py-16 text-center text-sm text-gray-500">Você não tem acesso à Produção SISP.</div>
      </PageContainer>
    );
  }

  const nomeEspecie = (id: string) => especies.find((e) => e.id === id)?.nome || "—";

  return (
    <PageContainer>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 flex items-center justify-center"><Fish size={18} /></div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-tight">Produção SISP</h1>
          <p className="text-xs text-gray-500 truncate">{activeRestaurant?.nome || "Peixaria"}</p>
        </div>
      </div>

      {/* Abas (mobile: pílulas) */}
      <div className="flex gap-2 my-3">
        <button onClick={() => setTab("esteira")} className={`h-9 px-4 rounded-full text-sm font-medium ${tab === "esteira" ? "bg-sky-600 text-white" : "border border-gray-300 dark:border-gray-600"}`}>Esteira</button>
        <button onClick={() => setTab("catalogo")} className={`h-9 px-4 rounded-full text-sm font-medium ${tab === "catalogo" ? "bg-sky-600 text-white" : "border border-gray-300 dark:border-gray-600"}`}>Catálogo</button>
      </div>

      {tab === "esteira" && (
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
                  <div className="font-medium text-sm">{r?.fornecedorNome || "Recebimento"} · {p.alvos.length} produto(s)</div>
                  <div className="text-xs text-gray-500 truncate">{p.alvos.map((a) => nomeEspecie(a.especieId) + " — " + (cortes.find((c) => c.id === a.corteId)?.nome || "")).join(" · ")}</div>
                  <div className="mt-1 text-[11px] text-gray-400">Lançar rendimento chega na F2.</div>
                </Card>
              );
            })}
          </Fila>

          <Fila titulo="Disponível para saída" icone={<Boxes size={15} />} vazio="Estoque da fábrica aparece aqui (a partir da F2).">
            {null}
          </Fila>
        </div>
      )}

      {tab === "catalogo" && (
        <CatalogoTab
          rid={rid} especies={especies} cortes={cortes} fornecedores={fornecedores} config={config}
          podeEditar={podeCatalogo}
        />
      )}

      {novoReceb && (
        <RecebimentoWizard
          rid={rid} meNome={pessoa?.nome || null} meId={pessoa?.id || null}
          especies={especies} fornecedores={fornecedores}
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
    </PageContainer>
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
function RecebimentoWizard({ rid, meNome, meId, especies, fornecedores, onClose }: {
  rid: string; meNome: string | null; meId: string | null;
  especies: ProducaoSispEspecie[]; fornecedores: ProducaoSispFornecedor[]; onClose: () => void;
}) {
  const [passo, setPasso] = useState(1);
  const [fornecedorId, setFornecedorId] = useState<string>("");
  const [semForn, setSemForn] = useState(false);
  const [novoForn, setNovoForn] = useState(false);
  const [fNome, setFNome] = useState("");
  const [fCnpj, setFCnpj] = useState("");
  const [fWhats, setFWhats] = useState("");
  const [fReg, setFReg] = useState("");
  const [itens, setItens] = useState<ProducaoSispRecebimentoItem[]>([]);
  const [nota, setNota] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const fornSel = fornecedores.find((f) => f.id === fornecedorId) || null;

  async function salvarNovoFornecedor(): Promise<string | null> {
    if (!fNome.trim()) { setErro("Informe o nome do fornecedor."); return null; }
    const f: ProducaoSispFornecedor = {
      id: uid(), restaurantId: rid, nome: fNome.trim(),
      cnpj: fCnpj.trim() || null, whatsapp: fWhats.trim() || null,
      registroSanitario: fReg.trim() || null, ativo: true, criadoEm: hojeISO(),
    };
    await repo.salvarFornecedor(f);
    setFornecedorId(f.id); setNovoForn(false);
    return f.id;
  }

  async function finalizar() {
    setErro("");
    if (itens.length === 0) { setErro("Adicione ao menos uma leva."); return; }
    let fid = fornecedorId || null;
    let fnome: string | null = fornSel?.nome || null;
    if (novoForn && fNome.trim()) { fid = await salvarNovoFornecedor(); fnome = fNome.trim(); }
    if (!semForn && !fid) { setErro("Selecione um fornecedor, cadastre um, ou marque 'sem fornecedor'."); return; }
    setSalvando(true);
    try {
      const r: ProducaoSispRecebimento = {
        id: uid(), restaurantId: rid,
        fornecedorId: semForn ? null : fid, fornecedorNome: semForn ? null : fnome,
        notaFornecedor: nota.trim() || null, obs: obs.trim() || null,
        itens, status: "aguardando_plano",
        recebidoEm: hojeISO(), recebidoPorId: meId, recebidoPorNome: meNome, criadoEm: hojeISO(),
      };
      await repo.salvarRecebimento(r);
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar.");
      setSalvando(false);
    }
  }

  const footer = passo < 3
    ? <button className={`${BTN_PRIMARY} w-full`} onClick={() => { setErro(""); if (passo === 1 && !semForn && !fornecedorId && !(novoForn && fNome.trim())) { setErro("Escolha o fornecedor ou marque 'sem fornecedor'."); return; } setPasso(passo + 1); }}>Continuar <ArrowRight size={16} /></button>
    : <button className={`${BTN_PRIMARY} w-full`} disabled={salvando} onClick={() => void finalizar()}>{salvando ? "Salvando…" : "Salvar recebimento"}</button>;

  return (
    <Overlay titulo={`Novo recebimento · passo ${passo}/3`} onClose={onClose} footer={footer}>
      {erro && <div className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-900/20 rounded-lg px-3 py-2">{erro}</div>}

      {passo === 1 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Fornecedor</div>
          {!novoForn && (
            <>
              <select className={INPUT} value={fornecedorId} disabled={semForn} onChange={(e) => setFornecedorId(e.target.value)}>
                <option value="">Selecione um fornecedor…</option>
                {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
              <div className="flex gap-2">
                <button className={BTN_GHOST} onClick={() => { setNovoForn(true); setSemForn(false); setFornecedorId(""); }}><Plus size={14} /> Novo</button>
                <label className="inline-flex items-center gap-2 text-sm px-3">
                  <input type="checkbox" checked={semForn} onChange={(e) => { setSemForn(e.target.checked); if (e.target.checked) setFornecedorId(""); }} />
                  Receber sem fornecedor
                </label>
              </div>
              {semForn && <div className="text-[11px] text-amber-600 inline-flex items-center gap-1"><AlertTriangle size={12} /> Fica pendente de relacionar o fornecedor antes de lançar o rendimento.</div>}
            </>
          )}
          {novoForn && (
            <div className="space-y-2 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <input className={INPUT} placeholder="Nome / razão social *" value={fNome} onChange={(e) => setFNome(e.target.value)} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input className={INPUT} placeholder="CNPJ" value={fCnpj} onChange={(e) => setFCnpj(e.target.value)} />
                <input className={INPUT} placeholder="WhatsApp" value={fWhats} onChange={(e) => setFWhats(e.target.value)} />
              </div>
              <input className={INPUT} placeholder="Registro sanitário / SIF (origem)" value={fReg} onChange={(e) => setFReg(e.target.value)} />
              <div className="flex gap-2">
                <button className={BTN_GHOST} onClick={() => void salvarNovoFornecedor()}><Check size={14} /> Salvar fornecedor</button>
                <button className={BTN_GHOST} onClick={() => setNovoForn(false)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {passo === 2 && (
        <LevasStep rid={rid} especies={especies} itens={itens} setItens={setItens} />
      )}

      {passo === 3 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Revisar</div>
          <div className="text-sm">{semForn ? "Sem fornecedor" : (fornSel?.nome || (novoForn ? fNome : "—"))}</div>
          <div className="space-y-2">
            {itens.map((it) => (
              <div key={it.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 text-sm">
                <div className="font-medium">{especies.find((e) => e.id === it.especieId)?.nome || "—"}</div>
                <div className="text-xs text-gray-500">{it.qtdCaixas} caixa(s) · {fmtKg(it.pesoBrutoKg)} {it.temperaturaC != null ? `· ${it.temperaturaC}°C` : ""} {it.conforme === false ? "· ⚠ rejeitada" : ""}</div>
              </div>
            ))}
          </div>
          <input className={INPUT} placeholder="Nº da nota/romaneio do fornecedor (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          <textarea className={`${INPUT} h-auto py-2`} rows={2} placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
        </div>
      )}
    </Overlay>
  );
}

// ── Passo 2: adicionar levas ────────────────────────────────────────────────────
function LevasStep({ rid, especies, itens, setItens }: {
  rid: string; especies: ProducaoSispEspecie[];
  itens: ProducaoSispRecebimentoItem[]; setItens: (f: (prev: ProducaoSispRecebimentoItem[]) => ProducaoSispRecebimentoItem[]) => void;
}) {
  const [especieId, setEspecieId] = useState("");
  const [qtdCaixas, setQtdCaixas] = useState("1");
  const [pesoModo, setPesoModo] = useState<ProducaoSispPesoModo>("total");
  const [pesoTotal, setPesoTotal] = useState("");
  const [pesoNominal, setPesoNominal] = useState("");
  const [pesosCaixa, setPesosCaixa] = useState<string[]>([""]);
  const [tempC, setTempC] = useState("");
  const [conforme, setConforme] = useState(true);
  const [foto, setFoto] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  const qtd = Math.max(1, parseInt(qtdCaixas) || 1);

  function pesoBruto(): number {
    if (pesoModo === "total") return Number(pesoTotal) || 0;
    if (pesoModo === "nominal") return (Number(pesoNominal) || 0) * qtd;
    let s = 0; for (let i = 0; i < qtd; i++) s += Number(pesosCaixa[i]) || 0; return s;
  }

  function adicionar() {
    setErro("");
    if (!especieId) { setErro("Escolha a espécie."); return; }
    const pb = pesoBruto();
    if (pb <= 0) { setErro("Informe o peso."); return; }
    const it: ProducaoSispRecebimentoItem = {
      id: uid(), especieId, qtdCaixas: qtd, pesoModo, pesoBrutoKg: pb,
      pesosPorCaixaKg: pesoModo === "porCaixa" ? pesosCaixa.slice(0, qtd).map((p) => Number(p) || 0) : null,
      pesoNominalCaixaKg: pesoModo === "nominal" ? (Number(pesoNominal) || 0) : null,
      temperaturaC: tempC.trim() === "" ? null : Number(tempC),
      conforme, motivoRejeicao: null, loteFornecedor: null, validadeOrigem: null, fotoUrl: foto,
    };
    setItens((prev) => [...prev, it]);
    setEspecieId(""); setQtdCaixas("1"); setPesoTotal(""); setPesoNominal(""); setPesosCaixa([""]); setTempC(""); setConforme(true); setFoto(null); setPesoModo("total");
  }

  return (
    <div className="space-y-4">
      {itens.length > 0 && (
        <div className="space-y-2">
          {itens.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
              <div className="min-w-0 text-sm">
                <div className="font-medium truncate">{especies.find((e) => e.id === it.especieId)?.nome || "—"}</div>
                <div className="text-xs text-gray-500">{it.qtdCaixas} cx · {fmtKg(it.pesoBrutoKg)} {it.temperaturaC != null ? `· ${it.temperaturaC}°C` : ""}</div>
              </div>
              <button className="text-gray-400 hover:text-rose-600" onClick={() => setItens((prev) => prev.filter((x) => x.id !== it.id))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Adicionar leva</div>
        {erro && <div className="text-xs text-rose-600">{erro}</div>}
        <select className={INPUT} value={especieId} onChange={(e) => setEspecieId(e.target.value)}>
          <option value="">Espécie…</option>
          {especies.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        {especies.length === 0 && <div className="text-[11px] text-amber-600">Cadastre espécies na aba Catálogo primeiro.</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Qtd. de caixas
            <input className={INPUT} type="number" inputMode="numeric" min={1} value={qtdCaixas} onChange={(e) => setQtdCaixas(e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">Como pesou
            <select className={INPUT} value={pesoModo} onChange={(e) => setPesoModo(e.target.value as ProducaoSispPesoModo)}>
              <option value="total">Peso total da leva</option>
              <option value="nominal">Nominal × qtd</option>
              <option value="porCaixa">Por caixa</option>
            </select>
          </label>
        </div>

        {pesoModo === "total" && (
          <label className="text-xs text-gray-500">Peso total bruto (kg)
            <input className={INPUT} type="number" inputMode="decimal" value={pesoTotal} onChange={(e) => setPesoTotal(e.target.value)} />
          </label>
        )}
        {pesoModo === "nominal" && (
          <label className="text-xs text-gray-500">Peso nominal por caixa (kg) — total: {fmtKg((Number(pesoNominal) || 0) * qtd)}
            <input className={INPUT} type="number" inputMode="decimal" value={pesoNominal} onChange={(e) => setPesoNominal(e.target.value)} />
          </label>
        )}
        {pesoModo === "porCaixa" && (
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Peso de cada caixa (kg) — total: {fmtKg(pesoBruto())}</div>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: qtd }).map((_, i) => (
                <input key={i} className={INPUT} type="number" inputMode="decimal" placeholder={`cx ${i + 1}`} value={pesosCaixa[i] ?? ""}
                  onChange={(e) => setPesosCaixa((prev) => { const next = [...prev]; while (next.length <= i) next.push(""); next[i] = e.target.value; return next; })} />
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">Temperatura (°C)
            <input className={INPUT} type="number" inputMode="decimal" placeholder="ex.: -18" value={tempC} onChange={(e) => setTempC(e.target.value)} />
          </label>
          <label className="text-xs text-gray-500">Conformidade
            <select className={INPUT} value={conforme ? "1" : "0"} onChange={(e) => setConforme(e.target.value === "1")}>
              <option value="1">Aprovada</option>
              <option value="0">Rejeitada</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Foto da caixa:</span>
          <FotoUpload rid={rid} bucketPrefix="producaoSisp" pathPrefix="receb" url={foto} onChange={setFoto} label="foto" />
        </div>

        <button className={`${BTN_GHOST} w-full`} onClick={adicionar}><Plus size={14} /> Adicionar leva</button>
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
        {especieId && cortesDaEspecie.length === 0 && <div className="text-[11px] text-amber-600">Cadastre cortes dessa espécie no Catálogo.</div>}
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

function ConfigCat({ rid, config }: { rid: string; config: ProducaoSispConfig | null }) {
  const [registro, setRegistro] = useState(config?.registroSisp || "");
  const [razao, setRazao] = useState(config?.razaoSocial || "");
  const [cnpj, setCnpj] = useState(config?.cnpj || "");
  const [prefixo, setPrefixo] = useState(config?.lotePrefixo || "");
  const [salvo, setSalvo] = useState(false);
  async function salvar() {
    await repo.salvarConfig(rid, { rid, registroSisp: registro.trim() || null, razaoSocial: razao.trim() || null, cnpj: cnpj.trim() || null, lotePrefixo: prefixo.trim().toUpperCase() || null });
    setSalvo(true); setTimeout(() => setSalvo(false), 2000);
  }
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
      <div className="text-xs text-gray-500">Dados que entram na etiqueta SISP oficial.</div>
      <input className={INPUT} placeholder="Nº de registro no SISP" value={registro} onChange={(e) => setRegistro(e.target.value)} />
      <input className={INPUT} placeholder="Razão social" value={razao} onChange={(e) => setRazao(e.target.value)} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className={INPUT} placeholder="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
        <input className={INPUT} placeholder="Prefixo do lote (ex.: PAM)" value={prefixo} onChange={(e) => setPrefixo(e.target.value)} />
      </div>
      <button className={`${BTN_PRIMARY} w-full`} onClick={() => void salvar()}>{salvo ? <><Check size={16} /> Salvo</> : "Salvar configuração"}</button>
    </div>
  );
}
