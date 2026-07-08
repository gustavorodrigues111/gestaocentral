// Prazos Trabalhistas — AGENDA AGREGADORA (Fase 1: leitura).
// Junta num só lugar os prazos de RH que já vivem em outros módulos:
//   • Experiência (45/90) — derivado de empregados.admissaoAtual
//   • Exames — examesEmpregado.proximoVencimento
//   • Uniformes/EPIs — entregasUniforme.itens[].validadeAte
// Mesmo visual do Contas Fixas/Prazos Técnicos: chips + Calendário/Lista.
// Fase 2 (pendente): "marcar resolvido" gravando no módulo de origem.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where, setDoc, doc, deleteDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { Button } from "../../core/ui/Button";
import { parseYmd, ymd, fmtBR } from "../../core/utils/date";
import { buscarFeriadosProximos } from "../sites/feriadosHelper";
import { darBaixa } from "../exames/repository";
import type { Empregado, ExameEmpregado, EntregaUniforme } from "../../core/types";

type Cat = "experiencia" | "exame" | "uniforme" | "epi";
const CAT_LABEL: Record<Cat, string> = { experiencia: "Experiência", exame: "Exame", uniforme: "Uniforme", epi: "EPI" };
const CAT_COR: Record<Cat, string> = {
  experiencia: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  exame: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  uniforme: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  epi: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
};
type Item = { id: string; cat: Cat; data: string; titulo: string; sub: string; detalhe?: string; exameId?: string };

function inicioSemanaSeg(s: string): string {
  const d = parseYmd(s); const dow = d.getDay(); const off = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + off); return ymd(d);
}
function addDias(s: string, n: number): string { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
const DOW_LBL = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export function PrazosTrabalhistasPage() {
  const { rid } = useParams<{ rid: string }>();
  const { pessoa } = useAuth();
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [exames, setExames] = useState<ExameEmpregado[]>([]);
  const [entregas, setEntregas] = useState<EntregaUniforme[]>([]);
  const [resolvidos, setResolvidos] = useState<Set<string>>(new Set());
  const [feriados, setFeriados] = useState<Record<string, string>>({});
  const [vis, setVis] = useState<"lista" | "calendario">("calendario");
  const [filtroCat, setFiltroCat] = useState<Cat | "todos">("todos");
  const [acao, setAcao] = useState<Item | null>(null);
  const hoje = new Date().toISOString().slice(0, 10);
  const [semanaInicio, setSemanaInicio] = useState<string>(() => inicioSemanaSeg(hoje));

  useEffect(() => {
    if (!rid) return;
    const subs = [
      onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)),
        s => setEmpregados(s.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado))),
      onSnapshot(query(collection(db, "examesEmpregado"), where("restaurantId", "==", rid)),
        s => setExames(s.docs.map(d => ({ id: d.id, ...d.data() }) as ExameEmpregado))),
      onSnapshot(query(collection(db, "entregasUniforme"), where("restaurantId", "==", rid)),
        s => setEntregas(s.docs.map(d => ({ id: d.id, ...d.data() }) as EntregaUniforme))),
      onSnapshot(query(collection(db, "agendaTrabResolvidos"), where("restaurantId", "==", rid)),
        s => setResolvidos(new Set(s.docs.map(d => d.id))), () => setResolvidos(new Set())),
    ];
    return () => subs.forEach(u => u());
  }, [rid]);

  async function marcarResolvido(it: Item) {
    await setDoc(doc(db, "agendaTrabResolvidos", it.id), sanitizeForFirestore({
      id: it.id, restaurantId: rid, cat: it.cat, titulo: it.titulo, sub: it.sub, data: it.data,
      resolvidoEm: new Date().toISOString(), resolvidoPor: pessoa?.id || null,
    }));
    setAcao(null);
  }
  async function desmarcarResolvido(it: Item) {
    await deleteDoc(doc(db, "agendaTrabResolvidos", it.id));
    setAcao(null);
  }
  async function baixarExame(it: Item, realizadoEm: string) {
    if (!it.exameId || !pessoa) return;
    await darBaixa({ exameId: it.exameId, realizadoEm, autor: { id: pessoa.id, nome: pessoa.nome } });
    setAcao(null);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const listas = await Promise.all([buscarFeriadosProximos("SP", 14).catch(() => []), buscarFeriadosProximos("PA", 14).catch(() => [])]);
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const f of listas.flat()) map[f.date] = f.name;
        setFeriados(map);
      } catch { /* sem feriados */ }
    })();
    return () => { alive = false; };
  }, []);

  const nomePorPessoa = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of empregados) { if (e.pessoaId) m[e.pessoaId] = e.nome; }
    return m;
  }, [empregados]);

  // Agrega os 3 fontes num só array de itens datados.
  const itens = useMemo<Item[]>(() => {
    const out: Item[] = [];
    // Experiências (45/90) — só empregados ativos ainda dentro/perto da janela.
    for (const e of empregados) {
      if (!e.estaAtivo || e.demitidoEm) continue;
      const adm = e.admissaoAtual;
      if (!adm) continue;
      const fim1 = addDias(adm, 45), fim2 = addDias(adm, 90);
      if (fim1 >= addDias(hoje, -15)) out.push({ id: `exp1-${e.id}`, cat: "experiencia", data: fim1, titulo: "Fim experiência · 1º período (45d)", sub: e.nome, detalhe: `Admissão ${fmtBR(adm)}` });
      if (fim2 >= addDias(hoje, -15)) out.push({ id: `exp2-${e.id}`, cat: "experiencia", data: fim2, titulo: "Fim experiência · 2º período (90d)", sub: e.nome, detalhe: `Admissão ${fmtBR(adm)}` });
    }
    // Exames
    for (const ex of exames) {
      if (!ex.ativo || !ex.proximoVencimento) continue;
      out.push({ id: `exm-${ex.id}`, cat: "exame", data: ex.proximoVencimento, titulo: ex.tipoNomeSnapshot, sub: ex.empregadoNomeSnapshot, detalhe: ex.fornecedor, exameId: ex.id });
    }
    // Uniformes/EPIs — itens com validade, de entregas não canceladas.
    for (const en of entregas) {
      if (en.cancelamento) continue;
      const nome = (en.pessoaId && nomePorPessoa[en.pessoaId]) || en.candidatoSnapshot?.nome || "—";
      for (const it of (en.itens || [])) {
        if (!it.validadeAte) continue;
        const cat: Cat = it.caEpi ? "epi" : "uniforme";
        out.push({ id: `uni-${en.id}-${it.itemId}-${it.validadeAte}`, cat, data: it.validadeAte, titulo: it.nome, sub: nome, detalhe: it.caEpi ? `CA ${it.caEpi}` : undefined });
      }
    }
    return out.sort((a, b) => a.data.localeCompare(b.data));
  }, [empregados, exames, entregas, hoje, nomePorPessoa]);

  // Resolvidos NÃO somem — ficam verdes no calendário (igual conta paga).
  const cats = (["experiencia", "exame", "uniforme", "epi"] as Cat[]).filter(c => itens.some(i => i.cat === c));
  const visiveis = itens.filter(i => filtroCat === "todos" || i.cat === filtroCat);
  const vencidos = visiveis.filter(i => !resolvidos.has(i.id) && i.data < hoje).length;

  // Calendário-semana
  const dias = Array.from({ length: 7 }, (_, i) => { const d = parseYmd(semanaInicio); d.setDate(d.getDate() + i); return ymd(d); });
  const porDia = new Map<string, Item[]>();
  for (const i of visiveis) if (dias.includes(i.data)) { const a = porDia.get(i.data) || []; a.push(i); porDia.set(i.data, a); }
  const navegar = (delta: number) => { const d = parseYmd(semanaInicio); d.setDate(d.getDate() + delta * 7); setSemanaInicio(ymd(d)); };

  const chip = (active: boolean, label: string, onClick: () => void, key?: string) => (
    <button key={key} type="button" onClick={onClick}
      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{label}</button>
  );

  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-sm text-gray-500">{visiveis.length} prazo{visiveis.length === 1 ? "" : "s"}{vencidos > 0 && <span className="text-rose-600 font-medium"> · {vencidos} vencido{vencidos === 1 ? "" : "s"}</span>}</div>
      </header>

      <div className="mb-3 rounded-xl border border-sky-200 dark:border-sky-900/50 bg-sky-50/50 dark:bg-sky-950/15 p-2.5 text-[11px] text-sky-800 dark:text-sky-300">
        📅 Prazos vindos dos módulos de origem (Admissão/experiência, Exames, Uniformes). Clique num item pra resolver — exame dá baixa de verdade (recalcula o próximo); os demais saem da agenda.
      </div>

      {itens.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {chip(vis === "calendario", "📅 Calendário", () => setVis("calendario"))}
          {chip(vis === "lista", "📋 Lista", () => setVis("lista"))}
          <span className="mx-1 h-4 w-px bg-gray-200 dark:bg-gray-700" />
          {chip(filtroCat === "todos", "Todos", () => setFiltroCat("todos"))}
          {cats.map(c => chip(filtroCat === c, CAT_LABEL[c], () => setFiltroCat(c), c))}
        </div>
      )}

      {itens.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">🧑‍⚖️</div>
          <p>Nenhum prazo trabalhista em aberto nesta empresa.</p>
          <p className="text-sm mt-1">Aparecem aqui: fim de experiência (45/90), exames e uniformes/EPIs com validade.</p>
        </div>
      ) : vis === "calendario" ? (
        <div>
          <div className="flex items-center justify-center gap-2 mb-3">
            <Button size="sm" variant="ghost" onClick={() => navegar(-1)}>‹</Button>
            <Button size="sm" variant="ghost" onClick={() => setSemanaInicio(inicioSemanaSeg(hoje))}>Hoje</Button>
            <Button size="sm" variant="ghost" onClick={() => navegar(1)}>›</Button>
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 ml-2">{fmtBR(dias[0])} – {fmtBR(dias[6])}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-7 gap-1.5">
            {dias.map((d, i) => {
              const wd = parseYmd(d).getDay();
              const feriadoNome = feriados[d];
              const naoUtil = wd === 0 || wd === 6 || !!feriadoNome;
              const ehHoje = d === hoje;
              const lista = porDia.get(d) || [];
              const corDia = naoUtil ? "border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/15" : "border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/15";
              return (
                <div key={d} title={feriadoNome ? `Feriado: ${feriadoNome}` : undefined}
                  className={`rounded-xl border p-1.5 min-h-[150px] ${ehHoje ? "ring-1 ring-indigo-400" : ""} ${corDia}`}>
                  <div className={`text-[11px] font-semibold mb-1 flex items-center justify-between ${ehHoje ? "text-indigo-600 dark:text-indigo-300" : naoUtil ? "text-amber-700 dark:text-amber-400" : "text-blue-700 dark:text-blue-400"}`}>
                    <span>{DOW_LBL[i]} {parseYmd(d).getDate()}</span>{lista.length > 0 && <span className="opacity-60">{lista.length}</span>}
                  </div>
                  {feriadoNome && <div className="text-[9px] text-amber-600 dark:text-amber-400 mb-1 truncate">🎉 {feriadoNome}</div>}
                  <div className="space-y-1">
                    {lista.map(it => {
                      const resolvido = resolvidos.has(it.id);
                      return (
                      <div key={it.id} onClick={() => setAcao(it)} title="clique pra resolver"
                        className={`cursor-pointer hover:shadow-sm rounded-lg border px-1.5 py-1 text-[11px] leading-tight ${resolvido ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20" : it.data < hoje ? "border-rose-300 bg-rose-50 dark:bg-rose-900/20" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"}`}>
                        <div className="flex items-center gap-1"><span className={`text-[8px] font-medium px-1 py-0.5 rounded-full ${CAT_COR[it.cat]}`}>{CAT_LABEL[it.cat]}</span></div>
                        <div className="font-semibold text-gray-800 dark:text-gray-100 break-words flex items-start gap-1">{resolvido && <span className="text-emerald-600">✓</span>}{it.titulo}</div>
                        <div className="text-gray-500 dark:text-gray-400 truncate">{it.sub}</div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {visiveis.map(it => {
            const resolvido = resolvidos.has(it.id);
            const atrasado = !resolvido && it.data < hoje;
            return (
              <div key={it.id} onClick={() => setAcao(it)}
                className={`p-3 rounded-xl border cursor-pointer hover:shadow-md transition-shadow ${resolvido ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20" : atrasado ? "border-rose-200 dark:border-rose-900/50 bg-white dark:bg-gray-900" : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CAT_COR[it.cat]}`}>{CAT_LABEL[it.cat]}</span>
                      {resolvido && <span className="text-emerald-600">✓</span>}{it.titulo}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{it.sub}{it.detalhe ? ` · ${it.detalhe}` : ""}</div>
                  </div>
                  <div className={`shrink-0 text-sm font-medium ${resolvido ? "text-emerald-600" : atrasado ? "text-rose-600" : "text-gray-700 dark:text-gray-300"}`}>{fmtBR(it.data)}{atrasado && " ⚠️"}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {acao && <AcaoModal it={acao} resolvido={resolvidos.has(acao.id)} onClose={() => setAcao(null)} onBaixarExame={baixarExame} onResolver={marcarResolvido} onDesresolver={desmarcarResolvido} hoje={hoje} />}
    </div>
  );
}

function AcaoModal({ it, resolvido, onClose, onBaixarExame, onResolver, onDesresolver, hoje }: {
  it: Item; resolvido: boolean; onClose: () => void; hoje: string;
  onBaixarExame: (it: Item, realizadoEm: string) => Promise<void>;
  onResolver: (it: Item) => Promise<void>;
  onDesresolver: (it: Item) => Promise<void>;
}) {
  const [dataReal, setDataReal] = useState(hoje);
  const [busy, setBusy] = useState(false);
  const ehExame = it.cat === "exame";
  const origem = it.cat === "exame" ? "módulo Exames" : it.cat === "experiencia" ? "Gestor de Tarefas (decisão de experiência)" : "módulo Uniformes";
  const inp = "px-2 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100";
  async function run(fn: () => Promise<void>) { setBusy(true); try { await fn(); } catch (e) { alert("Erro: " + (e instanceof Error ? e.message : "?")); } finally { setBusy(false); } }
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 mb-1"><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${CAT_COR[it.cat]}`}>{CAT_LABEL[it.cat]}</span></div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{it.titulo}</h2>
        <p className="text-xs text-gray-500 mb-4">{it.sub} · vence {fmtBR(it.data)}</p>

        {ehExame ? (
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-2 text-sm"><span className="text-xs text-gray-600 dark:text-gray-300">Exame realizado em</span><input type="date" value={dataReal} onChange={(e) => setDataReal(e.target.value)} className={inp} /></label>
            <p className="text-[11px] text-gray-400">Grava no {origem}: registra no histórico e recalcula o próximo vencimento pela periodicidade.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button disabled={busy} onClick={() => void run(() => onBaixarExame(it, dataReal))}>{busy ? "…" : "✓ Marcar realizado"}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{resolvido
              ? "Este prazo está marcado como resolvido (verde). Você pode desmarcar se precisar."
              : <>Marcar como resolvido deixa o item <b>verde</b> no calendário (não some). A renovação/decisão em si você registra no <b>{origem}</b>.</>}</p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              {resolvido
                ? <Button variant="secondary" disabled={busy} onClick={() => void run(() => onDesresolver(it))}>{busy ? "…" : "Desmarcar"}</Button>
                : <Button disabled={busy} onClick={() => void run(() => onResolver(it))}>{busy ? "…" : "✓ Marcar resolvido"}</Button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
