import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { todayYmd, fmtBR } from "../../core/utils/date";
import { CHECKLIST_FREQ_LABEL, CHECKLIST_TURNO_LABEL, AREAS } from "../../core/types";
import type { Area, ChecklistFrequencia, ChecklistRun, ChecklistTemplate, Empregado } from "../../core/types";
import { ChecklistTemplateModal } from "./ChecklistTemplateModal";
import { ImportarChecklistModal } from "./ImportarChecklistModal";
import { ChecklistRunModal } from "./ChecklistRunModal";
import { itemDoDia, temFreqPorItem } from "./recorrencia";

type Tab = "hoje" | "templates" | "historico";

export function ChecklistsPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  // Permissão POR ABA (com retrocompat pro esquema antigo ver/configurar):
  //   executar  → aba "Checklists do dia" (preencher)
  //   configurar→ aba "Templates"
  //   verTime   → aba "Histórico" (execuções de todos)
  const isMaster = !!me?.isMaster;
  const { can } = useCanAcao(rid);
  const verLegado = canVer(me, rid, "checklists");
  const configLegado = canConfigurar(me, rid, "checklists");
  const podeExecutar = isMaster || can("checklists", "executar") || verLegado;
  const podeConfig = isMaster || can("checklists", "configurar") || configLegado;
  const podeHistorico = isMaster || can("checklists", "verTime") || podeConfig || verLegado;
  const podeVer = podeExecutar || podeConfig || podeHistorico;

  const [tab, setTab] = useState<Tab>("hoje");
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [runs, setRuns] = useState<ChecklistRun[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [loading, setLoading] = useState(true);

  const [editTemplate, setEditTemplate] = useState<ChecklistTemplate | "new" | null>(null);
  const [importando, setImportando] = useState(false);
  const [runEditor, setRunEditor] = useState<{ template: ChecklistTemplate; run: ChecklistRun | null } | null>(null);

  const [filtroArea, setFiltroArea] = useState<"todas" | Area>("todas");
  const [filtroFreq, setFiltroFreq] = useState<"todas" | ChecklistFrequencia>("todas");
  const [searchHist, setSearchHist] = useState("");

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    const q = query(collection(db, "checklistTemplates"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ChecklistTemplate);
      list.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
      setTemplates(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "checklistRuns"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ChecklistRun);
      list.sort((a, b) => (b.iniciadoEm || "").localeCompare(a.iniciadoEm || ""));
      setRuns(list);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "empregados"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado));
    });
    return () => unsub();
  }, [rid]);

  const today = todayYmd();
  const dow = new Date(today + "T12:00:00").getDay(); // 0=Dom..6=Sáb

  // ── Templates "do dia" ──────────────────────────────────────────────────
  const templatesHoje = useMemo(() => {
    return templates.filter(t => {
      if (!t.ativo) return false;
      // Frequência POR ITEM: aparece se tiver pelo menos 1 item do dia.
      if (temFreqPorItem(t.itens || [])) return (t.itens || []).some(i => itemDoDia(i, today));
      if (t.frequencia === "diaria") {
        if (!t.diasSemana || t.diasSemana.length === 0) return true;
        return t.diasSemana.includes(dow);
      }
      if (t.frequencia === "semanal") {
        // aparece se foi rodado há 7+ dias OU nunca rodou
        const ultimoRun = runs.find(r => r.templateId === t.id);
        if (!ultimoRun) return true;
        const diff = (new Date(today).getTime() - new Date(ultimoRun.data + "T00:00:00").getTime()) / (1000 * 3600 * 24);
        return diff >= 7;
      }
      if (t.frequencia === "mensal") {
        const ultimoRun = runs.find(r => r.templateId === t.id);
        if (!ultimoRun) return true;
        return ultimoRun.data.slice(0, 7) !== today.slice(0, 7);
      }
      // "avulsa" — sempre aparece manualmente
      return false;
    });
  }, [templates, runs, today, dow]);

  // Run de hoje pra cada template (se houver)
  const runHojeMap = useMemo(() => {
    const m: Record<string, ChecklistRun> = {};
    for (const r of runs) {
      if (r.data === today && !m[r.templateId]) m[r.templateId] = r;
    }
    return m;
  }, [runs, today]);

  // ── Templates filtrados (aba Templates) ────────────────────────────────
  const templatesFiltered = useMemo(() => {
    return templates.filter(t => {
      if (filtroArea !== "todas" && t.area !== filtroArea) return false;
      if (filtroFreq !== "todas" && t.frequencia !== filtroFreq) return false;
      return true;
    });
  }, [templates, filtroArea, filtroFreq]);

  // ── Histórico filtrado ─────────────────────────────────────────────────
  const runsFiltered = useMemo(() => {
    if (!searchHist.trim()) return runs;
    const s = searchHist.toLowerCase();
    return runs.filter(r =>
      r.templateNomeSnapshot.toLowerCase().includes(s) ||
      r.executorNome.toLowerCase().includes(s) ||
      r.data.includes(s)
    );
  }, [runs, searchHist]);

  // Stats topo
  const totalHoje = templatesHoje.length;
  const feitosHoje = templatesHoje.filter(t => runHojeMap[t.id]?.status === "completo").length;
  const emAndamento = templatesHoje.filter(t => runHojeMap[t.id]?.status === "rascunho").length;

  async function excluirTemplate(t: ChecklistTemplate) {
    if (!confirm(`Excluir template "${t.nome}"? Runs antigas continuam preservadas.`)) return;
    await deleteDoc(doc(db, "checklistTemplates", t.id));
  }

  async function excluirRun(r: ChecklistRun) {
    if (!confirm(`Excluir essa execução de "${r.templateNomeSnapshot}" (${fmtBR(r.data)})?`)) return;
    await deleteDoc(doc(db, "checklistRuns", r.id));
  }

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  const empMap = Object.fromEntries(empregados.map(e => [e.id, e]));

  // Aba efetiva conforme permissão (cai na primeira que a pessoa pode ver).
  const abaEfetiva: Tab =
    (tab === "templates" && podeConfig) ? "templates"
    : (tab === "historico" && podeHistorico) ? "historico"
    : podeExecutar ? "hoje"
    : podeConfig ? "templates"
    : "historico";
  const abasDisp: [Tab, string][] = [];
  if (podeExecutar) abasDisp.push(["hoje", `✅ Checklists do dia (${feitosHoje}/${totalHoje})`]);
  if (podeConfig) abasDisp.push(["templates", `📋 Templates (${templates.length})`]);
  if (podeHistorico) abasDisp.push(["historico", `📊 Histórico (${runs.length})`]);

  function abrirRunPraTemplate(t: ChecklistTemplate) {
    const existente = runHojeMap[t.id];
    setRunEditor({ template: t, run: existente || null });
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-end mb-4 flex-wrap gap-2">
        {podeConfig && abaEfetiva === "templates" && (<>
          <Button variant="secondary" onClick={() => setImportando(true)}>📥 Importar</Button>
          <Button onClick={() => setEditTemplate("new")}>+ Novo template</Button>
        </>)}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {abasDisp.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              abaEfetiva === id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB CHECKLISTS DO DIA */}
      {abaEfetiva === "hoje" && (
        <div className="space-y-3">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">A fazer</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{totalHoje - feitosHoje}</div>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Em andamento</div>
              <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{emAndamento}</div>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Feitos</div>
              <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{feitosHoje}</div>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Carregando...</div>
          ) : templatesHoje.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum checklist agendado pra hoje</p>
              {podeConfig && (
                <p className="text-sm text-gray-500 mt-2">Crie templates na aba "Templates" e marque a frequência.</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {templatesHoje.map(t => {
                const run = runHojeMap[t.id];
                const completo = run?.status === "completo";
                const rascunho = run?.status === "rascunho";
                const pct = run ? Math.round((run.feitos / Math.max(1, run.totalItens)) * 100) : 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => abrirRunPraTemplate(t)}
                    className={`w-full text-left rounded-xl border p-4 transition-colors ${
                      completo
                        ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20"
                        : rascunho
                          ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20"
                          : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-indigo-400 dark:hover:border-indigo-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-gray-900 dark:text-gray-100">{t.nome}</h3>
                          {t.area && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{t.area}</span>}
                          {t.turno && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">{CHECKLIST_TURNO_LABEL[t.turno]}</span>}
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                            {CHECKLIST_FREQ_LABEL[t.frequencia]}
                          </span>
                          {t.horarioReferencia && <span className="text-xs text-gray-500">⏰ {t.horarioReferencia}</span>}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          {t.itens.length} item(ns) · {t.itens.filter(i => i.obrigatorio).length} obrigatório(s)
                        </div>
                      </div>
                      <div className="text-right">
                        {completo ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-bold text-sm">✓ Concluído</span>
                        ) : rascunho ? (
                          <div>
                            <div className="text-amber-700 dark:text-amber-400 font-bold text-sm">⏳ {pct}%</div>
                            <div className="text-[10px] text-gray-500">{run.feitos}/{run.totalItens}</div>
                          </div>
                        ) : (
                          <span className="text-indigo-700 dark:text-indigo-400 font-medium text-sm">▶ Iniciar</span>
                        )}
                      </div>
                    </div>
                    {run?.executorNome && (
                      <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200 dark:border-gray-800">
                        👤 {run.executorNome}
                        {run.finalizadoEm && <> · ✓ {new Date(run.finalizadoEm).toLocaleString("pt-BR")}</>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Avulsos disponíveis */}
          {templates.filter(t => t.ativo && t.frequencia === "avulsa").length > 0 && (
            <div className="pt-4 border-t border-gray-200 dark:border-gray-800">
              <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-2">Checklists avulsos disponíveis</h3>
              <div className="flex flex-wrap gap-2">
                {templates.filter(t => t.ativo && t.frequencia === "avulsa").map(t => (
                  <Button
                    key={t.id}
                    variant="secondary"
                    size="sm"
                    onClick={() => abrirRunPraTemplate(t)}
                  >
                    ▶ {t.nome}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB TEMPLATES */}
      {abaEfetiva === "templates" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Área:</span>
            {(["todas", ...AREAS] as const).map(a => (
              <button
                key={a}
                type="button"
                onClick={() => setFiltroArea(a)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filtroArea === a
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
                }`}
              >
                {a === "todas" ? "Todas" : a}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Frequência:</span>
            {(["todas", "diaria", "semanal", "mensal", "avulsa"] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFiltroFreq(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filtroFreq === f
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
                }`}
              >
                {f === "todas" ? "Todas" : CHECKLIST_FREQ_LABEL[f]}
              </button>
            ))}
          </div>

          {templatesFiltered.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Nenhum template</p>
              {podeConfig && (
                <p className="text-sm text-gray-500 mt-2">Crie clicando em "+ Novo template"</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {templatesFiltered.map(t => (
                <div
                  key={t.id}
                  className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 ${!t.ativo ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-gray-900 dark:text-gray-100">{t.nome}</h3>
                        {t.area && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{t.area}</span>}
                        {t.turno && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">{CHECKLIST_TURNO_LABEL[t.turno]}</span>}
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300">
                          {CHECKLIST_FREQ_LABEL[t.frequencia]}
                        </span>
                        {!t.ativo && <span className="text-[10px] uppercase text-gray-500">Inativo</span>}
                      </div>
                      {t.descricao && <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t.descricao}</p>}
                      <div className="text-xs text-gray-500 mt-1">
                        {t.itens.length} item(ns)
                        {t.horarioReferencia && <> · ⏰ {t.horarioReferencia}</>}
                      </div>
                    </div>
                    {podeConfig && (
                      <div className="flex gap-1">
                        <Button variant="secondary" size="sm" onClick={() => setEditTemplate(t)}>Editar</Button>
                        <Button variant="danger" size="sm" onClick={() => excluirTemplate(t)}>×</Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB HISTÓRICO */}
      {abaEfetiva === "historico" && (
        <div className="space-y-3">
          <Input
            placeholder="🔍 Buscar (template, executor, data YYYY-MM-DD)..."
            value={searchHist}
            onChange={(e) => setSearchHist(e.target.value)}
          />

          {runsFiltered.length === 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
              <div className="text-4xl mb-3">📊</div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Sem execuções</p>
            </div>
          ) : (
            <div className="space-y-2">
              {runsFiltered.slice(0, 100).map(r => {
                const completo = r.status === "completo";
                const exec = r.executorEmpregadoId ? empMap[r.executorEmpregadoId] : null;
                return (
                  <div
                    key={r.id}
                    className={`border rounded-xl p-3 ${
                      completo
                        ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10"
                        : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium text-gray-900 dark:text-gray-100">{r.templateNomeSnapshot}</h4>
                          {r.templateAreaSnapshot && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{r.templateAreaSnapshot}</span>}
                          {completo ? (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">✓ Completo</span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">⏳ {r.status}</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          📅 {new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR")} · 👤 {r.executorNome || exec?.nome || "?"}
                          <> · {r.feitos}/{r.totalItens} ({Math.round((r.feitos / Math.max(1, r.totalItens)) * 100)}%)</>
                        </div>
                        {r.observacaoGeral && <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 italic">{r.observacaoGeral}</p>}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="secondary" size="sm" onClick={() => {
                          const tmpl = templates.find(t => t.id === r.templateId);
                          if (tmpl) setRunEditor({ template: tmpl, run: r });
                          else alert("Template não encontrado (foi excluído).");
                        }}>{podeConfig ? "Ver/Editar" : "Ver"}</Button>
                        {podeConfig && <Button variant="danger" size="sm" onClick={() => excluirRun(r)}>×</Button>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {runsFiltered.length > 100 && (
                <div className="text-xs text-gray-500 text-center py-2">Mostrando 100 mais recentes de {runsFiltered.length}</div>
              )}
            </div>
          )}
        </div>
      )}

      {editTemplate && (
        <ChecklistTemplateModal
          template={editTemplate === "new" ? null : editTemplate}
          restaurantId={rid}
          onClose={() => setEditTemplate(null)}
        />
      )}
      {importando && (
        <ImportarChecklistModal
          rid={rid}
          onClose={() => setImportando(false)}
          onCriado={(tpl) => { setImportando(false); setEditTemplate(tpl); }}
        />
      )}
      {runEditor && (
        <ChecklistRunModal
          template={runEditor.template}
          run={runEditor.run}
          empregados={empregados}
          restaurantId={rid}
          podeConfig={podeConfig}
          onClose={() => setRunEditor(null)}
        />
      )}
    </div>
  );
}
