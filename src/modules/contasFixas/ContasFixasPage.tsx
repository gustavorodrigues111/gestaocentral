// Contas Fixas — pagamentos recorrentes. Duas abas:
//  📅 Visualização — trabalho do dia a dia: escolhe a competência (mês) e vai
//     marcando cada conta como paga; status pendente/atrasada/paga.
//  📝 Cadastro — config: categoria, recorrência, dia, PIX, empresa(s).
// Escopo por empresa (rid da rota). Importador de CSV (master) pra popular.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  collection, onSnapshot, query, orderBy, setDoc, doc, updateDoc, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { Button } from "../../core/ui/Button";
import type {
  ContaFixa, ContaFixaCategoria, ContaFixaRecorrencia, Endereco,
} from "../../core/types";
import {
  CONTA_FIXA_CATEGORIA_LABEL, CONTA_FIXA_RECORRENCIA_LABEL,
} from "../../core/types";
import {
  ymd, parseYmd, parseAnoMes, fmtAnoMes, daysInMonth, proximoDiaUtil, fmtBR, nomeMes, shiftMonth,
} from "../../core/utils/date";
import { buscarFeriadosProximos } from "../sites/feriadosHelper";
import { ContaFixaDetalheModal } from "./ContaFixaDetalheModal";

const pad2 = (n: number) => String(n).padStart(2, "0");
function inicioSemanaSeg(s: string): string {
  const d = parseYmd(s); const dow = d.getDay(); const off = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + off); return ymd(d);
}
const nrm = (s: string) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function ContasFixasPage() {
  const { pessoa } = useAuth();
  const { rid } = useParams<{ rid: string }>();
  const { restaurants } = useRestaurant();
  const [contas, setContas] = useState<ContaFixa[]>([]);
  const [enderecos, setEnderecos] = useState<Endereco[]>([]);
  const [aba, setAba] = useState<"visualizacao" | "cadastro">("visualizacao");
  const [editando, setEditando] = useState<ContaFixa | null>(null);
  const [detalheConta, setDetalheConta] = useState<{ conta: ContaFixa; cmp: string } | null>(null);
  const [criando, setCriando] = useState(false);
  const [novaInit, setNovaInit] = useState<Partial<ContaFixa> | null>(null); // criar já com dia preenchido
  const [importando, setImportando] = useState(false);
  const hoje = new Date().toISOString().slice(0, 10);
  const [comp, setComp] = useState(hoje.slice(0, 7)); // "YYYY-MM"
  const [filtro, setFiltro] = useState<"todas" | "apagar" | "pagas">("todas");
  const [filtroCat, setFiltroCat] = useState<string>(""); // "" = todas (vale nas 2 abas)
  const [filtroEnd, setFiltroEnd] = useState<string>("todas"); // por unidade/endereço
  const [vis, setVis] = useState<"calendario" | "lista">("calendario");
  const [semanaInicio, setSemanaInicio] = useState<string>(() => inicioSemanaSeg(hoje));
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropDia, setDropDia] = useState<string | null>(null);
  const [feriados, setFeriados] = useState<Record<string, string>>({}); // data → nome

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const listas = await Promise.all([
          buscarFeriadosProximos("SP", 14).catch(() => []),
          buscarFeriadosProximos("PA", 14).catch(() => []),
        ]);
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const f of listas.flat()) map[f.date] = f.name;
        setFeriados(map);
      } catch { /* offline: sem feriados, cai no fim de semana só */ }
    })();
    return () => { alive = false; };
  }, []);
  const feriadosSet = useMemo(() => new Set(Object.keys(feriados)), [feriados]);

  useEffect(() => {
    const u = onSnapshot(
      query(collection(db, "contasFixas"), orderBy("nome")),
      snap => setContas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ContaFixa).filter(c => !c.deletadoEm))
    );
    return () => u();
  }, []);

  const ridsKey = restaurants.map(r => r.id).join(",");
  useEffect(() => {
    const rids = ridsKey ? ridsKey.split(",").slice(0, 10) : [];
    if (!rids.length) { setEnderecos([]); return; }
    const u = onSnapshot(query(collection(db, "enderecos"), where("restaurantId", "in", rids)),
      snap => setEnderecos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Endereco)), () => setEnderecos([]));
    return () => u();
  }, [ridsKey]);
  const endById = useMemo(() => Object.fromEntries(enderecos.map(e => [e.id, e])), [enderecos]);

  const daEmpresa = useMemo(
    () => contas.filter(c => (c.restaurantIds || []).includes(rid || ""))
      .sort((a, b) => (a.diaDoMes || 99) - (b.diaDoMes || 99)),
    [contas, rid]
  );

  if (!pessoa) return null;

  // Data efetiva da conta num mês: override do mês (arrasto) ou dia do cadastro
  // já corrigido pro próximo dia útil (fim de semana → segue pro dia útil).
  // Data "natural": dia do cadastro corrigido pro próximo dia útil (sem override).
  const dataNatural = (c: ContaFixa, cmp: string): string | null => {
    if (!c.diaDoMes) return null;
    const { ano, mes } = parseAnoMes(cmp);
    const dia = Math.min(c.diaDoMes, daysInMonth(ano, mes));
    return proximoDiaUtil(`${fmtAnoMes(ano, mes)}-${pad2(dia)}`, feriadosSet);
  };
  const dataEfetiva = (c: ContaFixa, cmp: string): string | null => c.ajustesData?.[cmp] || dataNatural(c, cmp);
  // No Cadastro o dia é o configurado (sem pulo de dia útil nem override do mês).
  const dataCadastro = (c: ContaFixa, cmp: string): string | null => {
    if (!c.diaDoMes) return null;
    const { ano, mes } = parseAnoMes(cmp);
    return `${fmtAnoMes(ano, mes)}-${pad2(Math.min(c.diaDoMes, daysInMonth(ano, mes)))}`;
  };
  const statusDe = (c: ContaFixa, cmp: string): "paga" | "atrasada" | "pendente" => {
    if (c.pagamentos?.[cmp]) return "paga";
    const ed = dataEfetiva(c, cmp);
    if (ed && ed < hoje) return "atrasada";
    return "pendente";
  };

  const endsDaEmpresa = enderecos.filter(e => e.restaurantId === rid && (e.ativo !== false || daEmpresa.some(c => c.enderecoId === e.id)));
  const base = daEmpresa.filter(c => (!filtroCat || c.categoria === filtroCat) && (filtroEnd === "todas" || c.enderecoId === filtroEnd));
  const catsPresentes = [...new Set(daEmpresa.map(c => c.categoria))];

  // Lista (aba Visualização · modo lista) — filtra por status na competência
  const visiveisLista = base.filter(c => {
    if (aba !== "visualizacao") return true;
    const s = statusDe(c, comp);
    if (filtro === "pagas") return s === "paga";
    if (filtro === "apagar") return s !== "paga";
    return true;
  });
  const nPagas = base.filter(c => statusDe(c, comp) === "paga").length;
  const nAtras = base.filter(c => statusDe(c, comp) === "atrasada").length;

  // Calendário-semana — no Cadastro usa o dia configurado; na Visualização a
  // data efetiva (dia útil + ajuste do mês).
  const noCadastro = aba === "cadastro";
  const dias = Array.from({ length: 7 }, (_, i) => { const d = parseYmd(semanaInicio); d.setDate(d.getDate() + i); return ymd(d); });
  const mesesVis = [...new Set(dias.map(d => d.slice(0, 7)))];
  const porDia = new Map<string, { c: ContaFixa; cmp: string }[]>();
  for (const cmp of mesesVis) for (const c of base) {
    const ed = noCadastro ? dataCadastro(c, cmp) : dataEfetiva(c, cmp);
    if (ed && dias.includes(ed)) { const arr = porDia.get(ed) || []; arr.push({ c, cmp }); porDia.set(ed, arr); }
  }
  const navegar = (delta: number) => { const d = parseYmd(semanaInicio); d.setDate(d.getDate() + delta * 7); setSemanaInicio(ymd(d)); };
  const tituloSemana = `${fmtBR(dias[0])} – ${fmtBR(dias[6])}`;

  async function togglePago(c: ContaFixa, cmp: string) {
    const novo = { ...(c.pagamentos || {}) };
    if (novo[cmp]) delete novo[cmp]; else novo[cmp] = { pagoEm: new Date().toISOString(), pagoPor: pessoa!.id };
    await updateDoc(doc(db, "contasFixas", c.id), { pagamentos: novo, atualizadoEm: new Date().toISOString() });
    // O Gestor de Tarefas reflete automaticamente (deriva ao vivo de contasFixas).
  }
  async function moverPara(id: string, cmp: string, novaData: string) {
    const c = contas.find(x => x.id === id); if (!c) return;
    const novo = { ...(c.ajustesData || {}) };
    if (novaData === dataNatural(c, cmp)) delete novo[cmp]; // voltou pro dia original → some o ajuste
    else novo[cmp] = novaData;
    await updateDoc(doc(db, "contasFixas", id), { ajustesData: novo, atualizadoEm: new Date().toISOString() });
  }

  const tab = (v: "visualizacao" | "cadastro", label: string) => (
    <button type="button" onClick={() => setAba(v)}
      className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${aba === v ? "border-indigo-500 text-indigo-600 dark:text-indigo-300" : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}>{label}</button>
  );
  const chip = (active: boolean, label: string, onClick: () => void, key?: string) => (
    <button key={key} type="button" onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{label}</button>
  );
  const STCOR: Record<string, string> = {
    paga: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    atrasada: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    pendente: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  };
  const STLBL: Record<string, string> = { paga: "✓ Paga", atrasada: "⚠️ Atrasada", pendente: "Pendente" };

  // Card de conta (usado na lista e no calendário)
  const catSelect = (
    <label className="flex items-center gap-1.5 text-xs text-gray-500">Categoria
      <select value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}
        className="h-9 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm shadow-sm dark:text-gray-100">
        <option value="">Todas</option>
        {catsPresentes.map(k => <option key={k} value={k}>{CONTA_FIXA_CATEGORIA_LABEL[k]}</option>)}
      </select>
    </label>
  );
  const { ano: cAno, mes: cMes } = parseAnoMes(comp);
  const shiftComp = (delta: number) => { const s = shiftMonth(cAno, cMes, delta); setComp(fmtAnoMes(s.ano, s.mes)); };
  const compSelect = (
    <label className="flex items-center gap-1.5 text-xs text-gray-500">Competência
      <span className="inline-flex items-center h-9 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
        <button type="button" onClick={() => shiftComp(-1)} className="px-2 h-full text-gray-500 hover:text-indigo-600 text-lg leading-none">‹</button>
        <span className="px-1 min-w-[100px] text-center text-sm font-medium text-gray-700 dark:text-gray-200">{nomeMes(cMes)} {cAno}</span>
        <button type="button" onClick={() => shiftComp(1)} className="px-2 h-full text-gray-500 hover:text-indigo-600 text-lg leading-none">›</button>
      </span>
    </label>
  );

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-gray-500">
          {base.length} conta{base.length === 1 ? "" : "s"}
          {aba === "visualizacao" && vis === "lista" && <> · <span className="text-emerald-600 font-medium">{nPagas} paga{nPagas === 1 ? "" : "s"}</span>{nAtras > 0 && <span className="text-rose-600 font-medium"> · {nAtras} atrasada{nAtras === 1 ? "" : "s"}</span>}</>}
        </div>
        <div className="flex items-center gap-2">
          {pessoa.isMaster && <Button variant="secondary" onClick={() => setImportando(true)}>⬆️ Importar CSV</Button>}
          <Button onClick={() => setCriando(true)}>+ Nova Conta Fixa</Button>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-4">
        {tab("visualizacao", "📅 Visualização")}{tab("cadastro", "📝 Cadastro")}
      </nav>

      {daEmpresa.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {catSelect}
          {endsDaEmpresa.length > 1 && (
            <>
              <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
              {chip(filtroEnd === "todas", "Todas as unidades", () => setFiltroEnd("todas"))}
              {endsDaEmpresa.map(e => chip(filtroEnd === e.id, `📍 ${e.apelido}`, () => setFiltroEnd(e.id), e.id))}
            </>
          )}
          <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
          {chip(vis === "calendario", "📅 Calendário", () => setVis("calendario"))}
          {chip(vis === "lista", "📋 Lista", () => setVis("lista"))}
          {aba === "visualizacao" && vis === "lista" && (
            <>
              <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
              {compSelect}
              {chip(filtro === "todas", "Todas", () => setFiltro("todas"))}
              {chip(filtro === "apagar", "A pagar", () => setFiltro("apagar"))}
              {chip(filtro === "pagas", "Pagas", () => setFiltro("pagas"))}
            </>
          )}
        </div>
      )}

      {daEmpresa.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📋</div>
          <p>Nenhuma conta fixa nesta empresa.</p>
          <p className="text-sm mt-1">Use <b>+ Nova Conta Fixa</b> ou <b>⬆️ Importar CSV</b> pra popular.</p>
        </div>
      ) : vis === "calendario" ? (
        <div>
          <div className="flex items-center justify-center gap-2 mb-3">
            <Button size="sm" variant="ghost" onClick={() => navegar(-1)}>‹</Button>
            <Button size="sm" variant="ghost" onClick={() => setSemanaInicio(inicioSemanaSeg(hoje))}>Hoje</Button>
            <Button size="sm" variant="ghost" onClick={() => navegar(1)}>›</Button>
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 ml-2">{tituloSemana}</span>
          </div>
          <p className="text-[11px] text-gray-400 mb-2 text-center">{noCadastro
            ? "Clique num card pra editar (dia, recorrência, valor). “+ Nova” cria uma conta sempre naquele dia do mês."
            : "Arraste um card pra mudar a data só neste mês. Pra mudar sempre, edite no 📝 Cadastro."}</p>
          <div className="grid grid-cols-1 sm:grid-cols-7 gap-1.5">
            {dias.map((d, i) => {
              const wd = parseYmd(d).getDay();
              const fds = wd === 0 || wd === 6;
              const feriadoNome = feriados[d];
              const naoUtil = fds || !!feriadoNome;
              const ehHoje = d === hoje;
              const diaMes = parseYmd(d).getDate();
              const itens = porDia.get(d) || [];
              const corDia = dropDia === d
                ? "border-indigo-400 bg-indigo-50/60 dark:bg-indigo-900/25"
                : naoUtil
                  ? "border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/15"
                  : "border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/15";
              return (
                <div key={d}
                  onDragOver={noCadastro ? undefined : (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropDia !== d) setDropDia(d); }}
                  onDragLeave={noCadastro ? undefined : () => { if (dropDia === d) setDropDia(null); }}
                  onDrop={noCadastro ? undefined : (e) => { e.preventDefault(); const raw = e.dataTransfer.getData("text/plain"); const [id, cmp] = raw.split("|"); setDropDia(null); setDragId(null); if (id) void moverPara(id, cmp, d); }}
                  title={feriadoNome ? `Feriado: ${feriadoNome}` : undefined}
                  className={`rounded-xl border p-1.5 min-h-[150px] flex flex-col ${ehHoje ? "ring-1 ring-indigo-400" : ""} ${corDia}`}>
                  <div className={`text-[11px] font-semibold mb-1 flex items-center justify-between ${ehHoje ? "text-indigo-600 dark:text-indigo-300" : naoUtil ? "text-amber-700 dark:text-amber-400" : "text-blue-700 dark:text-blue-400"}`}>
                    <span>{["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][i]} {diaMes}</span>
                    {itens.length > 0 && <span className="opacity-60">{itens.length}</span>}
                  </div>
                  {feriadoNome && <div className="text-[9px] text-amber-600 dark:text-amber-400 mb-1 truncate" title={feriadoNome}>🎉 {feriadoNome}</div>}
                  <div className="space-y-1 flex-1">
                    {itens.map(({ c, cmp }) => {
                      const st = statusDe(c, cmp);
                      const end = c.enderecoId ? endById[c.enderecoId] : null;
                      const corCard = noCadastro
                        ? "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                        : st === "paga" ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20"
                        : st === "atrasada" ? "border-rose-300 bg-rose-50 dark:bg-rose-900/20"
                        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900";
                      return (
                        <div key={c.id + cmp} draggable={!noCadastro}
                          onDragStart={noCadastro ? undefined : (e) => { e.dataTransfer.setData("text/plain", `${c.id}|${cmp}`); e.dataTransfer.effectAllowed = "move"; setDragId(c.id); }}
                          onDragEnd={noCadastro ? undefined : () => { setDragId(null); setDropDia(null); }}
                          onClick={() => noCadastro ? setEditando(c) : setDetalheConta({ conta: c, cmp })}
                          title={noCadastro ? `${c.nome} — clique pra editar` : `${c.nome} — clique pra ver detalhes`}
                          className={`rounded-lg border px-1.5 py-1 text-[11px] leading-tight ${noCadastro ? "cursor-pointer hover:shadow-sm" : "cursor-grab active:cursor-grabbing"} ${dragId === c.id ? "opacity-40" : ""} ${corCard}`}>
                          <div className="font-semibold text-gray-800 dark:text-gray-100 flex items-start gap-1">{!noCadastro && st === "paga" && <span className="text-emerald-600">✓</span>}<span className="break-words">{c.fornecedor?.trim() || c.nome}</span></div>
                          {c.fornecedor?.trim() && c.nome ? <div className="text-gray-600 dark:text-gray-300 break-words">{c.nome}</div> : null}
                          <div className="text-gray-500 dark:text-gray-400">{CONTA_FIXA_CATEGORIA_LABEL[c.categoria]}{c.valorEstimado ? ` · R$ ${c.valorEstimado.toFixed(2)}` : ""}{noCadastro && c.recorrencia !== "mensal" ? ` · ${CONTA_FIXA_RECORRENCIA_LABEL[c.recorrencia]}` : ""}</div>
                          {end && <div className="text-gray-400 dark:text-gray-500 truncate">📍 {end.apelido}</div>}
                          {!noCadastro && c.ajustesData?.[cmp] && <div className="text-[9px] text-amber-600">• movida neste mês</div>}
                        </div>
                      );
                    })}
                  </div>
                  {noCadastro && (
                    <button type="button" onClick={() => setNovaInit({ diaDoMes: diaMes, restaurantIds: rid ? [rid] : [] })}
                      className="mt-1 text-[10px] text-gray-400 hover:text-indigo-600 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg py-0.5">+ Nova</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : visiveisLista.length === 0 ? (
        <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">Nenhuma conta com esse filtro{aba === "visualizacao" ? " nesta competência" : ""}.</div>
      ) : (
        <div className="space-y-2">
          {visiveisLista.map(c => {
            const st = statusDe(c, comp);
            return (
              <div key={c.id} onClick={() => aba === "cadastro" ? setEditando(c) : undefined}
                className={`p-3 rounded-xl border bg-white dark:bg-gray-900 transition-shadow ${aba === "cadastro" ? "cursor-pointer hover:shadow-md" : ""} ${aba === "visualizacao" && st === "atrasada" ? "border-rose-200 dark:border-rose-900/50" : "border-gray-200 dark:border-gray-800"}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5 flex-wrap">
                      {c.fornecedor?.trim() || c.nome}
                      {aba === "visualizacao" && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STCOR[st]}`}>{STLBL[st]}</span>}
                    </div>
                    {c.fornecedor?.trim() && c.nome ? <div className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{c.nome}</div> : null}
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {CONTA_FIXA_CATEGORIA_LABEL[c.categoria]}
                      {c.diaDoMes ? ` · dia ${c.diaDoMes}` : ""}
                      {c.valorEstimado ? ` · R$ ${c.valorEstimado.toFixed(2)}` : ""}
                      {c.observacoes ? ` · ${c.observacoes}` : ""}
                    </div>
                    {c.enderecoId && endById[c.enderecoId] && <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">📍 {endById[c.enderecoId].apelido}</div>}
                  </div>
                  {aba === "visualizacao" && (
                    <button type="button" onClick={() => void togglePago(c, comp)}
                      className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border ${st === "paga" ? "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300" : "border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"}`}>
                      {st === "paga" ? "✓ Pago" : "Marcar pago"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(criando || editando || novaInit) && (
        <ContaFixaForm
          conta={editando}
          init={novaInit || undefined}
          onClose={() => { setCriando(false); setEditando(null); setNovaInit(null); }}
          restaurantes={restaurants.map(r => ({ id: r.id, nome: r.nome }))}
          enderecos={enderecos}
          pessoaId={pessoa.id}
        />
      )}

      {detalheConta && (
        <ContaFixaDetalheModal conta={detalheConta.conta} competencia={detalheConta.cmp} pessoaId={pessoa.id} onClose={() => setDetalheConta(null)} />
      )}
      {importando && (
        <ImportContasModal
          onClose={() => setImportando(false)}
          restaurantes={restaurants.map(r => ({ id: r.id, nome: r.nome }))}
          pessoaId={pessoa.id}
        />
      )}
    </div>
  );
}

// ─── Importador de CSV ───────────────────────────────────────────────────────
// Colunas: empresa,categoria,nome,fornecedor,dia,recorrencia,observacao
// Idempotente: id determinístico por (empresa + nome + dia).
function ImportContasModal({ onClose, restaurantes, pessoaId }: {
  onClose: () => void; restaurantes: { id: string; nome: string }[]; pessoaId: string;
}) {
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<{ ok: number; semEmpresa: string[] } | null>(null);
  const catValidas = new Set(Object.keys(CONTA_FIXA_CATEGORIA_LABEL));
  const recValidas = new Set(Object.keys(CONTA_FIXA_RECORRENCIA_LABEL));

  function parseCSV(txt: string): string[][] {
    const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (q) {
        if (ch === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* ignora */ }
      else cur += ch;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }

  async function importar() {
    const rows = parseCSV(texto.trim());
    if (rows.length < 2) { alert("CSV vazio ou sem linhas de dados."); return; }
    const head = rows[0].map(h => nrm(h));
    const idx = (name: string) => head.indexOf(name);
    const iEmp = idx("empresa"), iCat = idx("categoria"), iNome = idx("nome"),
      iForn = idx("fornecedor"), iDia = idx("dia"), iRec = idx("recorrencia"), iObs = idx("observacao");
    if (iEmp < 0 || iNome < 0) { alert("CSV precisa ter ao menos as colunas 'empresa' e 'nome'."); return; }
    setBusy(true);
    const now = new Date().toISOString();
    const semEmpresa = new Set<string>();
    let ok = 0;
    try {
      for (const r of rows.slice(1)) {
        const empRaw = (r[iEmp] || "").trim();
        const rest = restaurantes.find(x => nrm(x.nome) === nrm(empRaw));
        if (!rest) { if (empRaw) semEmpresa.add(empRaw); continue; }
        const nome = (r[iNome] || "").trim();
        if (!nome) continue;
        const cat = iCat >= 0 && catValidas.has((r[iCat] || "").trim()) ? (r[iCat] as ContaFixaCategoria) : "outros";
        const rec = iRec >= 0 && recValidas.has((r[iRec] || "").trim()) ? (r[iRec] as ContaFixaRecorrencia) : "mensal";
        const diaN = iDia >= 0 ? parseInt((r[iDia] || "").trim()) : NaN;
        const id = `cf-imp-${rest.id}-${nrm(nome).replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${isNaN(diaN) ? "x" : diaN}`;
        const data: ContaFixa = {
          id, nome, fornecedor: (iForn >= 0 ? r[iForn] : "").trim() || undefined,
          categoria: cat, restaurantIds: [rest.id],
          observacoes: (iObs >= 0 ? r[iObs] : "").trim() || undefined,
          recorrencia: rec, diaDoMes: isNaN(diaN) ? undefined : diaN,
          diasAntecedencia: 3, responsavelPadraoId: pessoaId,
          projetoId: "proj-financ-rot", subprojetoId: "sub-financ-contas",
          ativo: true, criadoEm: now, criadoPor: pessoaId, atualizadoEm: now,
        };
        await setDoc(doc(db, "contasFixas", id), sanitizeForFirestore(data));
        ok++;
      }
      setResultado({ ok, semEmpresa: [...semEmpresa] });
    } catch (e) { alert("Erro ao importar: " + (e instanceof Error ? e.message : "?")); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">⬆️ Importar Contas Fixas (CSV)</h2>
        <p className="text-xs text-gray-500 mt-1 mb-3">Colunas: <code>empresa, categoria, nome, fornecedor, dia, recorrencia, observacao</code>. A empresa é casada pelo nome. Reimportar não duplica (id determinístico por empresa+nome+dia).</p>
        {resultado ? (
          <div className="text-sm space-y-2">
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-emerald-800 dark:text-emerald-300">✓ {resultado.ok} conta(s) importada(s)/atualizada(s).</div>
            {resultado.semEmpresa.length > 0 && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-amber-800 dark:text-amber-300 text-xs">
                ⚠️ Empresas não reconhecidas (linhas ignoradas): {resultado.semEmpresa.join(", ")}. Confira se o nome bate com o cadastro da empresa.
              </div>
            )}
            <div className="flex justify-end"><Button onClick={onClose}>Fechar</Button></div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer">
                📄 Escolher arquivo .csv
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setTexto); e.currentTarget.value = ""; }} />
              </label>
              <span className="text-xs text-gray-400">ou cole o conteúdo abaixo</span>
            </div>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={8}
              className="w-full text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 p-2"
              placeholder="empresa,categoria,nome,fornecedor,dia,recorrencia,observacao&#10;Sororoca,alugueis,Aluguel do Imóvel,Simão Álvares 785,10,mensal," />
            <div className="flex gap-2 justify-end mt-3">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => void importar()} disabled={busy || !texto.trim()}>{busy ? "Importando…" : "Importar"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ContaFixaForm({ conta, init, onClose, restaurantes, enderecos, pessoaId }: {
  conta: ContaFixa | null;
  init?: Partial<ContaFixa>;
  onClose: () => void;
  restaurantes: { id: string; nome: string }[];
  enderecos: Endereco[];
  pessoaId: string;
}) {
  const [f, setF] = useState<Partial<ContaFixa>>(conta ? { ...conta } : {
    nome: "",
    categoria: "outros" as ContaFixaCategoria,
    restaurantIds: [],
    recorrencia: "mensal" as ContaFixaRecorrencia,
    diasAntecedencia: 3,
    responsavelPadraoId: pessoaId,
    projetoId: "proj-financ-rot",
    subprojetoId: "sub-financ-contas",
    ativo: true,
    ...(init || {}),
  });

  async function salvar() {
    if (!f.fornecedor?.trim() && !f.nome?.trim()) { alert("Informe ao menos o Nome"); return; }
    const now = new Date().toISOString();
    const id = conta?.id || `cf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const data: ContaFixa = {
      id,
      nome: f.nome?.trim() || "",
      fornecedor: f.fornecedor?.trim() || undefined,
      categoria: f.categoria || "outros",
      restaurantIds: f.restaurantIds || [],
      enderecoId: f.enderecoId,
      valorEstimado: f.valorEstimado,
      pix: f.pix,
      banco: f.banco,
      titular: f.titular,
      observacoes: f.observacoes,
      recorrencia: f.recorrencia || "mensal",
      diaDoMes: f.diaDoMes,
      diaDaSemana: f.diaDaSemana,
      mesDoAno: f.mesDoAno,
      diasAntecedencia: f.diasAntecedencia ?? 3,
      responsavelPadraoId: f.responsavelPadraoId || pessoaId,
      responsavelPadraoNome: f.responsavelPadraoNome,
      projetoId: f.projetoId || "proj-financ-rot",
      subprojetoId: f.subprojetoId || "sub-financ-contas",
      ultimaGeracaoChave: f.ultimaGeracaoChave,
      ativo: f.ativo ?? true,
      deletadoEm: f.deletadoEm,
      deletadoPor: f.deletadoPor,
      criadoEm: conta?.criadoEm || now,
      criadoPor: conta?.criadoPor || pessoaId,
      atualizadoEm: now,
    };
    await setDoc(doc(db, "contasFixas", id), sanitizeForFirestore(data));
    onClose();
  }

  async function excluir() {
    if (!conta) return;
    if (!confirm(`Excluir "${conta.nome}"? Isso vai pra lixeira (não é exclusão definitiva).`)) return;
    await setDoc(doc(db, "contasFixas", conta.id), sanitizeForFirestore({
      ...conta,
      deletadoEm: new Date().toISOString(),
      deletadoPor: pessoaId,
    }));
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">
          {conta ? "Editar Conta Fixa" : "Nova Conta Fixa"}
        </h2>
        <div className="space-y-3">
          <Field label="Nome *">
            <input value={f.fornecedor || ""} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} className="cf-input" autoFocus placeholder="Ex: ENEL, Grenna Imóveis, Vivo" />
          </Field>
          <Field label="Descrição">
            <input value={f.nome || ""} onChange={(e) => setF({ ...f, nome: e.target.value })} className="cf-input" placeholder="Ex: Conta de energia, Aluguel do imóvel" />
          </Field>
          <Field label="Categoria *">
            <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value as ContaFixaCategoria })} className="cf-input">
              {(Object.keys(CONTA_FIXA_CATEGORIA_LABEL) as ContaFixaCategoria[]).map(c => (
                <option key={c} value={c}>{CONTA_FIXA_CATEGORIA_LABEL[c]}</option>
              ))}
            </select>
          </Field>
          <Field label="Empresa(s) que paga(m) *">
            <div className="flex flex-wrap gap-2">
              {restaurantes.map(r => (
                <label key={r.id} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={(f.restaurantIds || []).includes(r.id)}
                    onChange={(e) => {
                      const cur = f.restaurantIds || [];
                      setF({ ...f, restaurantIds: e.target.checked ? [...cur, r.id] : cur.filter(x => x !== r.id) });
                    }}
                  />
                  {r.nome}
                </label>
              ))}
            </div>
          </Field>
          {(() => {
            const ridsSel = f.restaurantIds || [];
            const opts = enderecos.filter(e => (ridsSel.length ? ridsSel.includes(e.restaurantId) : true) && (e.ativo !== false || e.id === f.enderecoId));
            if (opts.length === 0 && !f.enderecoId) return null;
            return (
              <Field label="Endereço (opcional — útil p/ aluguel e consumo)">
                <select value={f.enderecoId || ""} onChange={(e) => setF({ ...f, enderecoId: e.target.value || undefined })} className="cf-input">
                  <option value="">— sem endereço —</option>
                  {opts.map(e => <option key={e.id} value={e.id}>{e.apelido}{e.ativo === false ? " (inativo)" : ""}</option>)}
                </select>
              </Field>
            );
          })()}
          <Field label="Valor estimado (R$)">
            <input type="number" step="0.01" value={f.valorEstimado || ""} onChange={(e) => setF({ ...f, valorEstimado: e.target.value ? parseFloat(e.target.value) : undefined })} className="cf-input" />
          </Field>
          <Field label="Recorrência *">
            <select value={f.recorrencia} onChange={(e) => setF({ ...f, recorrencia: e.target.value as ContaFixaRecorrencia })} className="cf-input">
              {(Object.keys(CONTA_FIXA_RECORRENCIA_LABEL) as ContaFixaRecorrencia[]).map(r => (
                <option key={r} value={r}>{CONTA_FIXA_RECORRENCIA_LABEL[r]}</option>
              ))}
            </select>
          </Field>
          {(f.recorrencia === "mensal" || f.recorrencia === "anual" || f.recorrencia === "trimestral" || f.recorrencia === "semestral") && (
            <Field label="Dia do mês (1-31)">
              <input type="number" min="1" max="31" value={f.diaDoMes || ""} onChange={(e) => setF({ ...f, diaDoMes: e.target.value ? parseInt(e.target.value) : undefined })} className="cf-input" />
            </Field>
          )}
          {f.recorrencia === "semanal" && (
            <Field label="Dia da semana">
              <select value={f.diaDaSemana ?? 1} onChange={(e) => setF({ ...f, diaDaSemana: parseInt(e.target.value) })} className="cf-input">
                <option value="0">Domingo</option><option value="1">Segunda</option><option value="2">Terça</option>
                <option value="3">Quarta</option><option value="4">Quinta</option><option value="5">Sexta</option><option value="6">Sábado</option>
              </select>
            </Field>
          )}
          <Field label="Dias de antecedência do lembrete">
            <input type="number" min="0" max="60" value={f.diasAntecedencia ?? 3} onChange={(e) => setF({ ...f, diasAntecedencia: parseInt(e.target.value) || 0 })} className="cf-input" />
          </Field>
          <Field label="Chave PIX (opcional)">
            <input value={f.pix || ""} onChange={(e) => setF({ ...f, pix: e.target.value })} className="cf-input" />
          </Field>
          <Field label="Banco (opcional)">
            <input value={f.banco || ""} onChange={(e) => setF({ ...f, banco: e.target.value })} className="cf-input" placeholder="Ex: Nubank" />
          </Field>
          <Field label="Titular (opcional)">
            <input value={f.titular || ""} onChange={(e) => setF({ ...f, titular: e.target.value })} className="cf-input" />
          </Field>
          <Field label="Observações (vão pra nota da tarefa)">
            <textarea value={f.observacoes || ""} onChange={(e) => setF({ ...f, observacoes: e.target.value })} className="cf-input" rows={3} />
          </Field>
        </div>
        <style>{`.cf-input { width: 100%; padding: 6px 10px; border: 1px solid rgb(209 213 219); border-radius: 8px; background: white; font-size: 14px; } .dark .cf-input { background: rgb(17 24 39); border-color: rgb(55 65 81); color: white; }`}</style>
        <div className="flex gap-2 justify-between mt-5">
          {conta ? <Button variant="ghost" onClick={excluir}>🗑️ Excluir</Button> : <span />}
          <div className="flex gap-2">
            <Button onClick={onClose} variant="ghost">Cancelar</Button>
            <Button onClick={salvar}>{conta ? "Salvar" : "Criar"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>
      {children}
    </label>
  );
}
