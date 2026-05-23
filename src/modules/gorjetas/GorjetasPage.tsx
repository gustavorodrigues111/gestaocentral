import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig, canUse, unidadesAcessiveis } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { ModuleConfigButton } from "../../core/ui/ModuleConfigButton";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import {
  daysInMonth, dowShort, fmtAnoMes, nomeMes, pad2, parseYmd, shiftMonth,
} from "../../core/utils/date";
import type { Cargo, Empregado, EscalaMes, Gorjeta, SplitVersion, Unidade } from "../../core/types";
import { getActiveSplitVersion } from "./splitRules";
import { RegrasDivisaoConfig } from "./RegrasDivisaoConfig";
import { DivisaoMesTab } from "./DivisaoMesTab";
import { publicarGorjeta, despublicarGorjeta } from "./publicar";
import { PublicarGorjetasModal } from "./PublicarGorjetasModal";

const fmtBR = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function GorjetasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "gorjetas");
  const podeConfig = canConfig(me, rid, "gorjetas");

  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);

  const [gorjetas, setGorjetas] = useState<Gorjeta[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [escala, setEscala] = useState<EscalaMes | null>(null);
  const [splitVersions, setSplitVersions] = useState<SplitVersion[]>([]);
  const [loading, setLoading] = useState(true);
  // Estado de tab (modal por dia foi removido — edição é inline no ListaDiasInline)
  const [tab, setTab] = useState<"lancamentos" | "divisao">("lancamentos");
  // Filtro de unidade (multi-unidades) — compartilhado entre tabs.
  // "" = todas
  const [filtroUnidadeId, setFiltroUnidadeId] = useState<string>("");

  // SplitVersions do restaurante (regras de divisão)
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "splitVersions"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setSplitVersions(snap.docs.map(d => ({ id: d.id, ...d.data() }) as SplitVersion));
    });
    return () => unsub();
  }, [rid]);

  // Empregados
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [rid]);

  // Cargos
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [rid]);

  // Escala do mês
  useEffect(() => {
    if (!rid) return;
    const ref = doc(db, "escalas", `${rid}_${fmtAnoMes(ano, mes)}`);
    const unsub = onSnapshot(ref, (snap) => {
      setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [rid, ano, mes]);

  // Gorjetas do mês — query simples (só restaurantId), filtra mês no client
  // pra não precisar criar composite index no Firestore
  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(
      collection(db, "gorjetas"),
      where("restaurantId", "==", rid),
    );
    const unsub = onSnapshot(q, (snap) => {
      const inicio = `${ano}-${pad2(mes)}-01`;
      const fim    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
      let list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as Gorjeta)
        .filter(g => g.date >= inicio && g.date <= fim);
      // Filtra pelo escopo de unidade da permissão (se restrito)
      const escopo = unidadesAcessiveis(me, rid, "gorjetas");
      if (escopo !== null) {
        list = list.filter(g => !g.unidadeId || escopo.includes(g.unidadeId));
      }
      list.sort((a, b) => a.date.localeCompare(b.date));
      setGorjetas(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid, ano, mes]);

  // Multi-unidades. UI ativa apenas quando há 2+ unidades ativas.
  const todasUnidades = activeRestaurant?.unidades || [];
  const usaMultiUnidades = todasUnidades.filter(u => u.ativa).length > 1;
  // Escopo de permissão de gorjetas — se ampla, mostra todas; senão filtra
  const escopoUnidades = unidadesAcessiveis(me, rid, "gorjetas");
  const unidades = escopoUnidades === null
    ? todasUnidades
    : todasUnidades.filter(u => escopoUnidades.includes(u.id));
  const unidadesAtendimento = unidades.filter(u => u.tipo === "atendimento" && u.ativa);
  // Pra filtro: todas as ativas (atendimento + produção). Empregados de
  // produção dividem gorjeta de TODAS as unidades, então faz sentido filtrar
  // por eles na Divisão (Cozinha de Produção etc).
  // Atendimento primeiro pra leitura natural.
  const unidadesAtivasParaFiltro = useMemo(() => {
    const ativas = unidades.filter(u => u.ativa);
    return [
      ...ativas.filter(u => u.tipo === "atendimento"),
      ...ativas.filter(u => u.tipo === "producao"),
    ];
  }, [unidades]);

  // Key da gorjeta na map:
  //   single-unit: date            (gorjetaMap["2026-05-10"])
  //   multi-unidade: date|unidadeId (gorjetaMap["2026-05-10|u_abc"])
  const gorjetaMap = useMemo(() => {
    const m: Record<string, Gorjeta> = {};
    gorjetas.forEach(g => {
      const key = g.unidadeId ? `${g.date}|${g.unidadeId}` : g.date;
      m[key] = g;
    });
    return m;
  }, [gorjetas]);

  const totaisMes = useMemo(() => {
    // Aplica o filtro de unidade do header — quando filtra por uma unidade
    // de ATENDIMENTO, só considera as gorjetas daquela unidade.
    // Filtro de PRODUÇÃO é ignorado aqui (produção não arrecada, então não
    // faz sentido limitar bruto/líquido por ela).
    const tipoFiltro = filtroUnidadeId
      ? unidades.find(u => u.id === filtroUnidadeId)?.tipo
      : undefined;
    const fonte = (filtroUnidadeId && tipoFiltro === "atendimento")
      ? gorjetas.filter(g => g.unidadeId === filtroUnidadeId)
      : gorjetas;

    const bruto = fonte.reduce((s, g) => s + (g.valorBruto || 0), 0);
    // Líquido é DERIVADO da regra vigente no DIA, não do snapshot `g.valorLiquido`
    // (que é legado e fica 0 nos docs novos). Usa a splitVersion da data pra
    // pegar a taxRate vigente — robusto se a regra muda retroativamente.
    const liquido = fonte.reduce((s, g) => {
      if (!g.valorBruto || g.semGorjeta) return s;
      const splitVersion = getActiveSplitVersion(splitVersions, g.date);
      const taxRate = splitVersion?.taxRate ?? 0;
      return s + g.valorBruto * (1 - taxRate / 100);
    }, 0);
    const datasUnicas = new Set(fonte.map(g => g.date));
    return { bruto, liquido, dias: datasUnicas.size, lancamentos: fonte.length };
  }, [gorjetas, splitVersions, filtroUnidadeId, unidades]);

  function navegarMes(delta: number) {
    const next = shiftMonth(ano, mes, delta);
    setAno(next.ano);
    setMes(next.mes);
  }

  // Estado pro modal de publicação em lote
  const [showPublicar, setShowPublicar] = useState(false);
  // Quantas gorjetas estão "publicáveis" (lançadas + ainda não publicadas)
  const qtdPublicaveis = useMemo(() => {
    return gorjetas.filter(g => !g.publicada && !g.semGorjeta && g.valorBruto > 0).length;
  }, [gorjetas]);

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeUsar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">💸 Gorjetas</h1>
          {/* Filtro de unidades. Multi-unidades → pills (Todas + cada uma).
              Single-unidade → 1 pill com o nome do restaurante (sempre ativa). */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {usaMultiUnidades && unidadesAtivasParaFiltro.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setFiltroUnidadeId("")}
                  className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
                    filtroUnidadeId === ""
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  Todas
                </button>
                {unidadesAtivasParaFiltro.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setFiltroUnidadeId(u.id)}
                    className={`text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full transition-colors ${
                      filtroUnidadeId === u.id
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {u.nome}
                  </button>
                ))}
              </>
            ) : (
              <span className="text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full bg-indigo-600 text-white cursor-default">
                {activeRestaurant.nome}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {podeConfig && qtdPublicaveis > 0 && (
            <Button
              size="sm"
              onClick={() => setShowPublicar(true)}
              title="Publicar gorjetas pros empregados verem (congela a divisão)"
            >
              📢 Publicar gorjetas ({qtdPublicaveis})
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[160px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
          <ModuleConfigButton title="⚙️ Regras de divisão de gorjeta" disabled={!podeConfig}>
            <RegrasDivisaoConfig
              rid={rid}
              onClose={() => { /* fechado pelo Modal */ }}
            />
          </ModuleConfigButton>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4">
        <button
          type="button"
          onClick={() => setTab("lancamentos")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "lancamentos"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
          }`}
        >
          📅 Lançamentos
        </button>
        <button
          type="button"
          onClick={() => setTab("divisao")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "divisao"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
          }`}
        >
          📊 Divisão do mês
        </button>
      </div>

      {tab === "lancamentos" && (
        <>
          {/* Resumo do mês.
              Desktop: 3 colunas iguais.
              Mobile: Bruto sozinho na 1ª linha (valor pode passar de R$ 100k);
                      Líquido + Dias dividem a 2ª linha. */}
          <div className="mb-5 grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
            <Card label="Bruto do mês" value={fmtBR(totaisMes.bruto)} />
            <div className="grid grid-cols-2 gap-2 md:contents">
              <Card label="Líquido do mês" value={fmtBR(totaisMes.liquido)} highlight />
              <Card label="Dias lançados" value={`${totaisMes.dias} dia(s)`} />
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : (
            <ListaDiasInline
              ano={ano}
              mes={mes}
              rid={rid}
              gorjetaMap={gorjetaMap}
              splitVersions={splitVersions}
              unidadesAtendimento={unidadesAtendimento}
              unidades={unidades}
              usaMultiUnidades={usaMultiUnidades}
              filtroUnidadeId={filtroUnidadeId}
              podeEditar={podeConfig}
              meId={me?.id || ""}
              meNome={me?.nome || ""}
              empregados={empregados}
              cargos={cargos}
              escala={escala}
            />
          )}
        </>
      )}

      {tab === "divisao" && (
        <DivisaoMesTab
          ano={ano}
          mes={mes}
          gorjetas={gorjetas}
          empregados={empregados}
          cargos={cargos}
          escala={escala}
          splitVersions={splitVersions}
          restaurantNome={activeRestaurant.nome}
          unidades={unidades}
          usaMultiUnidades={usaMultiUnidades}
          filtroUnidadeId={filtroUnidadeId}
        />
      )}

      {showPublicar && (
        <PublicarGorjetasModal
          onClose={() => setShowPublicar(false)}
          gorjetas={gorjetas}
          empregados={empregados}
          cargos={cargos}
          escala={escala}
          splitVersions={splitVersions}
          unidades={unidades}
          usaMultiUnidades={usaMultiUnidades}
          meId={me?.id || ""}
          meNome={me?.nome || ""}
        />
      )}

    </div>
  );
}

function Card({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${
      highlight
        ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800"
        : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
    }`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-bold ${highlight ? "text-emerald-700 dark:text-emerald-300" : "text-gray-900 dark:text-gray-100"}`}>
        {value}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ListaDiasInline — versão simplificada da tela de Lançamentos.
// Cada dia (× unidade se multi) tem inputs/botões diretos:
//   - Input "Valor bruto" inline (vírgula OK)
//   - Toggle "Sem gorjeta hoje" (zera valor e marca explicitamente)
//   - Toggle "Publicar" (visibilidade no portal do empregado)
//   - Aviso ⚠ "Sem regra" quando nenhuma splitVersion cobre a data
// SEM modal, SEM botão "pagar por dia" (pagamento é mensal — feito offline).
// ════════════════════════════════════════════════════════════════════════════
function ListaDiasInline({
  ano, mes, rid, gorjetaMap, splitVersions, unidadesAtendimento, unidades, usaMultiUnidades,
  filtroUnidadeId, podeEditar, meId, meNome,
  empregados, cargos, escala,
}: {
  ano: number; mes: number; rid: string;
  gorjetaMap: Record<string, Gorjeta>;
  splitVersions: SplitVersion[];
  unidadesAtendimento: Unidade[];
  unidades: Unidade[];
  usaMultiUnidades: boolean;
  filtroUnidadeId: string;
  podeEditar: boolean;
  meId: string;
  meNome: string;
  empregados: Empregado[];
  cargos: Cargo[];
  escala: EscalaMes | null;
}) {
  const dias = daysInMonth(ano, mes);
  const todayYmd = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();

  // No Lançamentos só faz sentido unidades de ATENDIMENTO (produção não arrecada).
  // Se o filtro do header for de produção, ignora aqui (mostra todas as de
  // atendimento) — a vista do Lançamentos não tem o que filtrar por produção.
  const filtroValidoLancamentos = useMemo(() => {
    if (!filtroUnidadeId) return "";
    const u = unidadesAtendimento.find(x => x.id === filtroUnidadeId);
    return u ? filtroUnidadeId : "";  // se não é atendimento, descarta
  }, [filtroUnidadeId, unidadesAtendimento]);

  const unidadesParaRow: { id: string; nome: string }[] = usaMultiUnidades
    ? unidadesAtendimento
        .filter(u => !filtroValidoLancamentos || u.id === filtroValidoLancamentos)
        .map(u => ({ id: u.id, nome: u.nome }))
    : [{ id: "", nome: "" }];

  // Estado local pros inputs (em edição, valor raw que o user está digitando).
  // Quando NÃO está em edição, o display vem formatado com pt-BR (2.953,36).
  const [valorInputs, setValorInputs] = useState<Record<string, string>>({});
  // Bottom-sheet mobile — guarda { date, unidadeId } sendo editado
  const [editingMobile, setEditingMobile] = useState<{ date: string; unidadeId: string } | null>(null);

  function keyFor(date: string, unidadeId: string) {
    return unidadeId ? `${date}|${unidadeId}` : date;
  }
  function docIdFor(date: string, unidadeId: string) {
    return unidadeId ? `${rid}_${date}_${unidadeId}` : `${rid}_${date}`;
  }
  // Formata número como string pt-BR com separador de milhar (sem R$).
  function fmtMoneyInput(n: number): string {
    if (!n) return "";
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Parse "2.953,36" ou "2953.36" ou "2953,36" → 2953.36
  function parseMoneyInput(s: string): number {
    const clean = (s || "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    return parseFloat(clean) || 0;
  }
  function valorEditado(date: string, unidadeId: string): string {
    const k = keyFor(date, unidadeId);
    if (k in valorInputs) return valorInputs[k];   // user digitando agora
    const g = gorjetaMap[k];
    return g && g.valorBruto > 0 ? fmtMoneyInput(g.valorBruto) : "";
  }

  async function gravar(date: string, unidadeId: string, fields: Partial<Gorjeta>) {
    const k = keyFor(date, unidadeId);
    const existente = gorjetaMap[k];
    const id = docIdFor(date, unidadeId);
    const now = new Date().toISOString();
    const payload = existente
      ? { ...existente, ...fields, updatedAt: now }
      : {
          id,
          restaurantId: rid,
          date,
          unidadeId: unidadeId || null,
          valorBruto: 0,
          valorLiquido: 0,
          taxRate: 0,
          semGorjeta: false,
          publicada: false,
          observacao: "",
          createdAt: now,
          createdBy: meId,
          updatedAt: now,
          paidAt: null,
          paidBy: null,
          ...fields,
        };
    await setDoc(doc(db, "gorjetas", id), sanitizeForFirestore(payload));
  }

  async function salvarValor(date: string, unidadeId: string, raw: string) {
    if (!podeEditar) return;
    const v = parseMoneyInput(raw);
    const k = keyFor(date, unidadeId);
    await gravar(date, unidadeId, { valorBruto: Math.round(v * 100) / 100, semGorjeta: false });
    // Limpa o state local — próximo render usa o valor formatado do gorjetaMap
    setValorInputs(s => { const c = { ...s }; delete c[k]; return c; });
  }
  async function toggleSemGorjeta(date: string, unidadeId: string) {
    if (!podeEditar) return;
    const g = gorjetaMap[keyFor(date, unidadeId)];
    const novo = !g?.semGorjeta;
    setValorInputs(s => ({ ...s, [keyFor(date, unidadeId)]: novo ? "" : (s[keyFor(date, unidadeId)] ?? "") }));
    await gravar(date, unidadeId, { semGorjeta: novo, valorBruto: novo ? 0 : (g?.valorBruto ?? 0) });
  }
  async function togglePublicada(date: string, unidadeId: string) {
    if (!podeEditar) return;
    const g = gorjetaMap[keyFor(date, unidadeId)];
    if (!g) return;
    if (g.publicada) {
      const ok = confirm(
        "Despublicar a gorjeta deste dia?\n\n" +
        "Vai apagar o snapshot da divisão. O empregado deixa de ver. " +
        "Pra publicar de novo, é só clicar em Publicar — vai recalcular " +
        "a divisão com a escala atual."
      );
      if (!ok) return;
      await despublicarGorjeta(g);
      return;
    }
    // Publicar 1 dia: confirma + congela snapshot
    const ok = confirm(
      `Publicar gorjeta de ${date}?\n\n` +
      "A divisão vai ser CALCULADA agora com a escala atual e CONGELADA. " +
      "Edições posteriores na escala desse dia não vão recalcular."
    );
    if (!ok) return;
    try {
      await publicarGorjeta({
        gorjeta: g, empregados, cargos, escala, splitVersions, unidades,
        publicadoPorId: meId, publicadoPorNome: meNome,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Erro ao publicar");
    }
  }

  // Paleta pra diferenciar unidades em restaurantes multi-unidades.
  // Duas pegadas:
  //   - `border` (6px na esquerda): marca o "trilho" da unidade ao longo das linhas
  //   - `chip` (bg + texto): chip colorido na coluna "Unidade" pra leitura rápida
  // O fundo da linha em si NÃO é pintado — assim as cores semânticas
  // (weekend amber, publicada emerald, today indigo) continuam funcionando
  // exatamente como num restaurante single-unidade.
  const UNIDADE_PALETA: { border: string; chip: string }[] = [
    { border: "border-l-sky-500 dark:border-l-sky-400",
      chip: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
    { border: "border-l-violet-500 dark:border-l-violet-400",
      chip: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
    { border: "border-l-pink-500 dark:border-l-pink-400",
      chip: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200" },
    { border: "border-l-teal-500 dark:border-l-teal-400",
      chip: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200" },
  ];
  function corUnidade(unidadeId: string): { border: string; chip: string } {
    if (!usaMultiUnidades || !unidadeId) {
      return { border: "border-l-transparent", chip: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" };
    }
    const idx = unidadesAtendimento.findIndex(x => x.id === unidadeId);
    return UNIDADE_PALETA[(idx >= 0 ? idx : 0) % UNIDADE_PALETA.length];
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      {Array.from({ length: dias }, (_, i) => i + 1).map(dia => {
        const date = `${ano}-${pad2(mes)}-${pad2(dia)}`;
        const d = parseYmd(date);
        const wd = d.getDay();
        const weekend = wd === 0 || wd === 6;
        const isToday = date === todayYmd;
        const splitVersion = getActiveSplitVersion(splitVersions, date);
        const semRegra = !splitVersion;

        return unidadesParaRow.map((u, idx) => {
          const k = keyFor(date, u.id);
          const g = gorjetaMap[k];
          const isPublicada = !!g?.publicada;
          const isSemGorjeta = !!g?.semGorjeta;
          const hasValor = !!g && g.valorBruto > 0;

          const liquido = hasValor && splitVersion ? g.valorBruto * (1 - splitVersion.taxRate / 100) : 0;
          const corU = corUnidade(u.id);
          // Reforço visual entre dias: borda topo bem leve no PRIMEIRO row do dia
          // pra ficar claro que o dia X tem N rows (uma por unidade).
          const isPrimeiroDoDia = idx === 0;

          return (
            <Fragment key={k}>
              {/* Desktop: linha em grid horizontal.
                  Cores semânticas (weekend/publicada/today) funcionam IGUAL
                  no single e no multi. Em multi: barra grossa colorida da
                  unidade na esquerda (6px) + chip colorido na coluna Unidade. */}
              <div
                className={`hidden md:grid grid-cols-[70px_120px_1fr_auto] items-center gap-3 px-3 py-2 text-sm ${
                  isPrimeiroDoDia ? "border-t border-gray-200 dark:border-gray-700" : "border-t border-gray-100/60 dark:border-gray-800/60"
                } ${usaMultiUnidades ? `border-l-[6px] ${corU.border}` : ""} ${
                  weekend ? "bg-amber-50/30 dark:bg-amber-900/10" : ""
                } ${isToday ? "ring-1 ring-indigo-300 dark:ring-indigo-700 ring-inset" : ""} ${
                  isPublicada ? "bg-emerald-50/50 dark:bg-emerald-900/10" : ""
                }`}
              >
                {/* Dia */}
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {idx === 0 ? (
                    <>
                      {pad2(dia)}
                      <span className="ml-1 text-[10px] text-gray-400 uppercase">{dowShort(d)}</span>
                    </>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-700">·</span>
                  )}
                </div>

                {/* Unidade — chip colorido quando multi, traço quando single */}
                <div className="text-xs">
                  {usaMultiUnidades ? (
                    <span className={`inline-block text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full truncate max-w-full ${corU.chip}`}>
                      {u.nome}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </div>

                {/* Valor (ou aviso/marker) */}
                <div className="flex items-center gap-2 min-w-0">
                  {semRegra ? (
                    <span className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
                      ⚠ Sem regra cadastrada — cadastre nas Configurações pra dividir esse dia
                    </span>
                  ) : isSemGorjeta ? (
                    <span className="text-xs text-gray-500 italic">— Sem gorjeta hoje —</span>
                  ) : (
                    <>
                      <span className="text-xs text-gray-500">R$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={!podeEditar}
                        placeholder="0,00"
                        value={valorEditado(date, u.id)}
                        onChange={(e) => setValorInputs(s => ({ ...s, [k]: e.target.value }))}
                        onBlur={(e) => salvarValor(date, u.id, e.target.value)}
                        className="w-28 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right tabular-nums"
                      />
                      {hasValor && splitVersion && (
                        <span className="text-[11px] text-gray-500">
                          retenção {splitVersion.taxRate}% → líquido {fmtBR(liquido)}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Ações */}
                <div className="flex items-center gap-1">
                  {podeEditar && !semRegra && (
                    <button
                      type="button"
                      onClick={() => toggleSemGorjeta(date, u.id)}
                      title={isSemGorjeta ? "Reabrir lançamento" : "Marcar este dia como sem gorjeta"}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${
                        isSemGorjeta
                          ? "bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
                          : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      {isSemGorjeta ? "✓ Sem gorjeta" : "Sem gorjeta"}
                    </button>
                  )}
                  {podeEditar && hasValor && !semRegra && (
                    <button
                      type="button"
                      onClick={() => togglePublicada(date, u.id)}
                      title={isPublicada ? "Despublicar (volta a ficar só pro escritório)" : "Publicar pra empregados verem"}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${
                        isPublicada
                          ? "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 font-semibold"
                          : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      {isPublicada ? "📢 Publicada" : "Publicar"}
                    </button>
                  )}
                </div>
              </div>

              {/* Mobile: card vertical com ✏️ → bottom-sheet.
                  Cores semânticas iguais em single e multi. Em multi: barra
                  grossa (6px) na esquerda + chip colorido com nome da unidade. */}
              <div
                className={`md:hidden px-3 py-2.5 ${
                  isPrimeiroDoDia ? "border-t border-gray-200 dark:border-gray-700" : "border-t border-gray-100/60 dark:border-gray-800/60"
                } ${usaMultiUnidades ? `border-l-[6px] ${corU.border}` : isToday ? "border-l-[6px] border-l-indigo-400 dark:border-l-indigo-600" : ""} ${
                  weekend ? "bg-amber-50/20 dark:bg-amber-900/10" : ""
                } ${isPublicada ? "bg-emerald-50/30 dark:bg-emerald-900/10" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-bold text-base text-gray-900 dark:text-gray-100 tabular-nums">{pad2(dia)}</span>
                    <span className="text-[10px] text-gray-400 uppercase">{dowShort(d)}</span>
                    {usaMultiUnidades && (
                      <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full truncate ${corU.chip}`}>
                        {u.nome}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hasValor ? (
                      <span className="font-bold tabular-nums text-gray-900 dark:text-gray-100">{fmtBR(g.valorBruto)}</span>
                    ) : isSemGorjeta ? (
                      <span className="text-xs text-gray-500 italic">sem gorjeta</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                    {podeEditar && !semRegra && (
                      <button
                        type="button"
                        onClick={() => setEditingMobile({ date, unidadeId: u.id })}
                        className="text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-base leading-none px-1"
                        title="Editar"
                      >
                        ✏️
                      </button>
                    )}
                  </div>
                </div>
                {semRegra ? (
                  <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠ Sem regra cadastrada — cadastre nas Configurações
                  </div>
                ) : hasValor && splitVersion ? (
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="text-gray-500 dark:text-gray-400">
                      retém {splitVersion.taxRate}% → líquido {fmtBR(liquido)}
                    </span>
                    {isPublicada && (
                      <span className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                        📢 publicada
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            </Fragment>
          );
        });
      })}

      {/* Bottom-sheet mobile pra editar um dia */}
      {editingMobile && (() => {
        const { date, unidadeId } = editingMobile;
        const k = keyFor(date, unidadeId);
        const g = gorjetaMap[k];
        const u = unidadesParaRow.find(x => x.id === unidadeId);
        const splitVersion = getActiveSplitVersion(splitVersions, date);
        return (
          <EditDiaSheet
            date={date}
            unidadeNome={usaMultiUnidades ? u?.nome : undefined}
            gorjeta={g}
            taxRate={splitVersion?.taxRate ?? 0}
            valorInicialRaw={valorEditado(date, unidadeId)}
            onSalvarValor={async (raw) => {
              await salvarValor(date, unidadeId, raw);
            }}
            onToggleSemGorjeta={async () => { await toggleSemGorjeta(date, unidadeId); }}
            onTogglePublicada={async () => { await togglePublicada(date, unidadeId); }}
            onClose={() => setEditingMobile(null)}
          />
        );
      })()}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// EditDiaSheet — bottom-sheet mobile pra editar um dia de gorjeta
// ────────────────────────────────────────────────────────────────────────────

function EditDiaSheet({
  date, unidadeNome, gorjeta, taxRate, valorInicialRaw,
  onSalvarValor, onToggleSemGorjeta, onTogglePublicada, onClose,
}: {
  date: string;
  unidadeNome?: string;
  gorjeta?: Gorjeta;
  taxRate: number;
  valorInicialRaw: string;
  onSalvarValor: (raw: string) => Promise<void>;
  onToggleSemGorjeta: () => Promise<void>;
  onTogglePublicada: () => Promise<void>;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(valorInicialRaw);
  const [saving, setSaving] = useState(false);
  const d = parseYmd(date);
  const semGorjeta = !!gorjeta?.semGorjeta;
  const publicada = !!gorjeta?.publicada;
  const hasValor = !!gorjeta && gorjeta.valorBruto > 0;
  const parsedValor = (() => {
    const clean = (raw || "").replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    return parseFloat(clean) || 0;
  })();
  const liquido = parsedValor > 0 ? parsedValor * (1 - taxRate / 100) : 0;

  async function aplicar() {
    setSaving(true);
    try { await onSalvarValor(raw); onClose(); }
    finally { setSaving(false); }
  }

  return (
    <div className="md:hidden fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
          <div>
            <div className="font-bold text-gray-900 dark:text-gray-100">
              {pad2(d.getDate())}/{pad2(d.getMonth() + 1)} <span className="text-xs text-gray-400 uppercase ml-1">{dowShort(d)}</span>
            </div>
            {unidadeNome && <div className="text-[11px] text-gray-500 dark:text-gray-400">{unidadeNome}</div>}
          </div>
          <button onClick={onClose} className="text-gray-400 text-xl px-2">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {!semGorjeta && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                Valor bruto (R$)
              </label>
              <input
                autoFocus
                type="text"
                inputMode="decimal"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="0,00"
                className="w-full px-3 py-2 text-base rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-right tabular-nums"
              />
              {parsedValor > 0 && taxRate > 0 && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 text-right">
                  retém {taxRate}% → líquido <strong>{fmtBR(liquido)}</strong>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={async () => { await onToggleSemGorjeta(); onClose(); }}
            className={`w-full px-3 py-2 text-sm rounded-lg border transition-colors ${
              semGorjeta
                ? "bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
                : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            {semGorjeta ? "✓ Marcado como sem gorjeta — toque pra reabrir" : "Marcar como sem gorjeta hoje"}
          </button>

          {hasValor && !semGorjeta && (
            <button
              type="button"
              onClick={async () => { await onTogglePublicada(); }}
              className={`w-full px-3 py-2 text-sm rounded-lg border transition-colors ${
                publicada
                  ? "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 font-semibold"
                  : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              {publicada ? "📢 Publicada — toque pra despublicar" : "Publicar pra empregados verem"}
            </button>
          )}
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 p-3 flex gap-2">
          <Button variant="secondary" onClick={onClose} className="flex-1">Fechar</Button>
          {!semGorjeta && (
            <Button onClick={aplicar} disabled={saving} className="flex-1">
              {saving ? "Salvando..." : "Salvar valor"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}


// GorjetasConfig antigo foi substituído por RegrasDivisaoConfig (Fase 16A).
// O arquivo RegrasDivisaoConfig.tsx faz CRUD de SplitVersion versionado.
