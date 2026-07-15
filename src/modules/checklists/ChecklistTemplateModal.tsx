import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { AREAS, CHECKLIST_TURNO_LABEL } from "../../core/types";
import type { Area, Cargo, ChecklistItemTemplate, ChecklistTemplate, ChecklistTurno, Empregado, Pessoa } from "../../core/types";
import { FotoUpload } from "./FotoUpload";
import { temFreqPorItem, freqItemLabel } from "./recorrencia";

type Props = {
  template: ChecklistTemplate | null;
  restaurantId: string;
  onClose: () => void;
};

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
// Chip arredondado padrão (selecionado × não).
const CHIP = (active: boolean) => `px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${active ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`;
// Chip de dia da semana: largura igual (grid de 7 colunas) pra caber tudo numa linha no mobile.
const CHIP_DOW = (active: boolean) => `w-full px-0 py-1.5 text-xs font-medium rounded-full border transition-colors text-center ${active ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`;

export function ChecklistTemplateModal({ template, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !template;

  const [nome, setNome] = useState(template?.nome || "");
  const [descricao, setDescricao] = useState(template?.descricao || "");
  // "Quando" unifica frequência + dias: por dia da semana (diária), semanal, mensal, avulso.
  const [quando, setQuando] = useState<"dias" | "semanal" | "mensal" | "avulsa">(template ? (template.frequencia === "diaria" ? "dias" : template.frequencia) : "dias");
  const [turno, setTurno] = useState<ChecklistTurno | "">(template?.turno || "");
  const [diasSemana, setDiasSemana] = useState<number[]>(template?.diasSemana || []);
  const [funcoes, setFuncoes] = useState<Area[]>(template?.funcoes || []);
  const [responsaveisIds, setResponsaveisIds] = useState<string[]>(template?.responsaveisIds || []);
  const [ativo, setAtivo] = useState(template?.ativo ?? true);
  const [itens, setItens] = useState<ChecklistItemTemplate[]>(template?.itens || []);
  const [novoItem, setNovoItem] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  useEffect(() => {
    if (!restaurantId) return;
    const u1 = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", restaurantId)), snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa).filter(p => p.ativa !== false)));
    const u2 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", restaurantId)), snap => setEmpregados(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado)));
    const u3 = onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", restaurantId)), snap => setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo)));
    return () => { u1(); u2(); u3(); };
  }, [restaurantId]);
  const pessoasOrd = useMemo(() => [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas]);
  const nomePorId = useMemo(() => Object.fromEntries(pessoas.map(p => [p.id, p.nome])), [pessoas]);
  // Área de cada pessoa: empregado ativo → cargo → área.
  const areaPorPessoa = useMemo(() => {
    const cargoArea = new Map(cargos.map(c => [c.id, c.area]));
    const m = new Map<string, Area>();
    for (const e of empregados) { if (e.pessoaId && e.estaAtivo) { const a = cargoArea.get(e.cargoId); if (a) m.set(e.pessoaId, a); } }
    return m;
  }, [empregados, cargos]);
  const toggleFuncao = (a: Area) => setFuncoes(s => s.includes(a) ? s.filter(x => x !== a) : [...s, a]);
  const toggleResp = (id: string) => setResponsaveisIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  // Pessoas das áreas selecionadas + as já escolhidas que ficaram fora da área.
  const pessoasDaArea = useMemo(() => pessoasOrd.filter(p => { const a = areaPorPessoa.get(p.id); return a != null && funcoes.includes(a); }), [pessoasOrd, areaPorPessoa, funcoes]);
  const respForaArea = useMemo(() => responsaveisIds.filter(id => !pessoasDaArea.some(p => p.id === id)), [responsaveisIds, pessoasDaArea]);

  function toggleDow(d: number) {
    setDiasSemana(s => s.includes(d) ? s.filter(x => x !== d) : [...s, d].sort());
  }

  function addItem() {
    const t = novoItem.trim();
    if (!t) return;
    const newItem: ChecklistItemTemplate = {
      id: `i_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      texto: t,
      ordem: itens.length + 1,
      obrigatorio: true,
    };
    setItens(s => [...s, newItem]);
    setNovoItem("");
  }
  function removerItem(id: string) {
    setItens(s => s.filter(i => i.id !== id).map((i, idx) => ({ ...i, ordem: idx + 1 })));
  }
  function moveItem(id: string, dir: -1 | 1) {
    setItens(s => {
      const idx = s.findIndex(i => i.id === id);
      if (idx === -1) return s;
      const novoIdx = idx + dir;
      if (novoIdx < 0 || novoIdx >= s.length) return s;
      const arr = [...s];
      [arr[idx], arr[novoIdx]] = [arr[novoIdx], arr[idx]];
      return arr.map((i, k) => ({ ...i, ordem: k + 1 }));
    });
  }
  function patchItem(id: string, patch: Partial<ChecklistItemTemplate>) {
    setItens(s => s.map(i => i.id === id ? { ...i, ...patch } : i));
  }

  async function salvar() {
    if (!nome.trim()) { setErr("Nome obrigatório"); return; }
    if (itens.length === 0) { setErr("Adicione pelo menos 1 item"); return; }
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: Omit<ChecklistTemplate, "id"> = {
        restaurantId,
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        area: funcoes[0] || undefined,
        frequencia: quando === "dias" ? "diaria" : quando,
        turno: turno || null,
        diasSemana: quando === "dias" && diasSemana.length > 0 ? diasSemana : undefined,
        funcoes: funcoes.length > 0 ? funcoes : undefined,
        responsaveisIds: responsaveisIds.length > 0 ? responsaveisIds : undefined,
        itens,
        ativo,
        criadoEm: template?.criadoEm || now,
        criadoPor: template?.criadoPor || me.id,
        atualizadoEm: now,
      };
      if (isNew) {
        await addDoc(collection(db, "checklistTemplates"), sanitizeForFirestore(payload));
      } else {
        await updateDoc(doc(db, "checklistTemplates", template.id), sanitizeForFirestore(payload));
      }
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? "+ Novo template de checklist" : `Editar — ${template.nome}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="ex: Abertura do salão"
          autoFocus
        />

        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Descrição</label>
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={2}
            placeholder="Pra que serve, quando rodar, etc."
            className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y"
          />
        </div>

        {/* Quando fazer — unifica frequência + dias da semana */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Quando fazer</label>
          <div className="flex flex-wrap gap-1.5">
            {([["dias", "Dias da semana"], ["semanal", "Semanal"], ["mensal", "Mensal"], ["avulsa", "Avulso"]] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setQuando(v)} className={CHIP(quando === v)}>{l}</button>
            ))}
          </div>
          {quando === "dias" && (
            <div className="mt-2">
              <div className="grid grid-cols-7 gap-1">
                {[1, 2, 3, 4, 5, 6, 0].map(i => (
                  <button key={i} type="button" onClick={() => toggleDow(i)} className={CHIP_DOW(diasSemana.includes(i))}>{DOW_LABELS[i]}</button>
                ))}
              </div>
              {diasSemana.length === 0 && <span className="text-[11px] text-gray-400 mt-1 block">= todos os dias</span>}
            </div>
          )}
          {temFreqPorItem(itens) && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">Alguns itens têm frequência própria — para esses, a regra abaixo de cada item vale; esta configuração geral é ignorada nos itens com frequência definida.</p>
          )}
        </div>

        {/* Turno (opcional) */}
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Turno <span className="text-gray-400 font-normal">(opcional)</span></label>
          <div className="flex flex-wrap gap-1.5">
            {(["abertura", "meio", "fechamento"] as ChecklistTurno[]).map(t => (
              <button key={t} type="button" onClick={() => setTurno(turno === t ? "" : t)} className={CHIP(turno === t)}>{CHECKLIST_TURNO_LABEL[t]}</button>
            ))}
          </div>
        </div>

        {/* Atribuição — funções (área) + pessoas */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 p-3 space-y-2.5">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">👥 Quem é responsável <span className="text-gray-400 font-normal">— vazio = qualquer um com permissão</span></div>
          <div>
            <div className="text-[11px] text-gray-500 mb-1">Funções (área)</div>
            <div className="flex flex-wrap gap-1.5">
              {AREAS.map(a => <button key={a} type="button" onClick={() => toggleFuncao(a)} className={CHIP(funcoes.includes(a))}>{a}</button>)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500 mb-1">Pessoas específicas <span className="text-gray-400">(cinza = fora · índigo = responsável)</span></div>
            {funcoes.length === 0 ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 shadow-sm shadow-rose-200/60 dark:shadow-none">👤 Selecione uma área acima pra escolher as pessoas</div>
            ) : pessoasDaArea.length === 0 ? (
              <div className="text-[11px] text-gray-400">Nenhuma pessoa cadastrada {funcoes.length === 1 ? `em ${funcoes[0]}` : "nessas áreas"}.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {pessoasDaArea.map(p => <button key={p.id} type="button" onClick={() => toggleResp(p.id)} className={CHIP(responsaveisIds.includes(p.id))}>{p.nome}</button>)}
              </div>
            )}
            {respForaArea.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {respForaArea.map(id => (
                  <span key={id} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" title="Selecionada, mas fora das áreas atuais">{nomePorId[id] || "?"}<button type="button" onClick={() => setResponsaveisIds(s => s.filter(x => x !== id))} className="hover:text-rose-600">×</button></span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Itens */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
            Itens ({itens.length})
          </label>
          <div className="space-y-2 mb-2">
            {itens.map((item, idx) => (
              <div key={item.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2.5 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-[11px] text-gray-500 flex items-center justify-center shrink-0">{idx + 1}</span>
                  <input value={item.texto} onChange={(e) => patchItem(item.id, { texto: e.target.value })} placeholder="tarefa" className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                  <div className="flex flex-col shrink-0">
                    <button type="button" onClick={() => moveItem(item.id, -1)} disabled={idx === 0} className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none">▲</button>
                    <button type="button" onClick={() => moveItem(item.id, 1)} disabled={idx === itens.length - 1} className="text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none">▼</button>
                  </div>
                  <button type="button" onClick={() => removerItem(item.id)} className="text-gray-300 hover:text-rose-600 text-base shrink-0">×</button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 pl-8">
                  {([["obrigatorio", "Obrigatório"], ["exigeObs", "Exige obs"], ["exigeFoto", "Exige foto"]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => patchItem(item.id, { [k]: !item[k] } as Partial<ChecklistItemTemplate>)} className={CHIP(!!item[k])}>{l}</button>
                  ))}
                </div>
                <div className="mt-2 pl-8 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-gray-400 mr-0.5">Frequência:</span>
                    {([["diaria", "Todo dia"], ["semanal", "Dia da semana"], ["quinzenal", "Quinzenal"], ["mensal", "Mensal"]] as const).map(([f, l]) => (
                      <button key={f} type="button" onClick={() => patchItem(item.id, { freq: f, ...(f === "diaria" ? { diasSemana: undefined, semanaParidade: undefined, diaDoMes: undefined } : {}), ...(f === "mensal" ? { diasSemana: undefined, semanaParidade: undefined, diaDoMes: item.diaDoMes || 1 } : {}), ...(f === "quinzenal" ? { semanaParidade: item.semanaParidade || "A" } : {}) })} className={CHIP((item.freq || "diaria") === f)}>{l}</button>
                    ))}
                    {item.freq && <span className="text-[11px] text-gray-400 ml-1">→ {freqItemLabel(item)}</span>}
                  </div>
                  {(item.freq === "semanal" || item.freq === "quinzenal" || (item.freq === "diaria" && item.diasSemana?.length)) && (
                    <div className="grid grid-cols-7 gap-1">
                      {DOW_LABELS.map((lbl, dow) => {
                        const on = (item.diasSemana || []).includes(dow);
                        return (
                          <button key={dow} type="button" onClick={() => { const cur = item.diasSemana || []; patchItem(item.id, { diasSemana: on ? cur.filter(x => x !== dow) : [...cur, dow].sort() }); }} className={CHIP_DOW(on)}>{lbl}</button>
                        );
                      })}
                    </div>
                  )}
                  {item.freq === "diaria" && !item.diasSemana?.length && (
                    <button type="button" onClick={() => patchItem(item.id, { diasSemana: [0, 1, 2, 3, 4, 5, 6] })} className="text-[11px] text-indigo-500 hover:underline">restringir a dias específicos</button>
                  )}
                  {item.freq === "quinzenal" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-400 mr-0.5">Semana:</span>
                      {(["A", "B"] as const).map(p => (
                        <button key={p} type="button" onClick={() => patchItem(item.id, { semanaParidade: p })} className={CHIP((item.semanaParidade || "A") === p)}>Semana {p}</button>
                      ))}
                      <span className="text-[11px] text-gray-400">(a 1ª semana de 2026 é A)</span>
                    </div>
                  )}
                  {item.freq === "mensal" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-gray-400">Todo dia</span>
                      <input type="number" min={1} max={31} value={item.diaDoMes || 1} onChange={(e) => patchItem(item.id, { diaDoMes: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)) })} className="w-16 px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                      <span className="text-[11px] text-gray-400">do mês</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2 pl-8 flex-wrap">
                  <input value={item.descricao || ""} onChange={(e) => patchItem(item.id, { descricao: e.target.value })} placeholder="como fazer (opcional)" className="flex-1 min-w-[160px] px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
                  <FotoUpload rid={restaurantId} pathPrefix={`guia_${item.id}`} url={item.fotoGuiaUrl} onChange={(u) => patchItem(item.id, { fotoGuiaUrl: u || undefined })} label="foto-guia" />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 items-center rounded-2xl border border-dashed border-indigo-300 dark:border-indigo-700 p-1.5 pl-3">
            <span className="text-gray-400 text-sm">＋</span>
            <input value={novoItem} onChange={(e) => setNovoItem(e.target.value)} placeholder="Novo item — digite e Enter" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} className="flex-1 py-1.5 bg-transparent text-sm outline-none dark:text-gray-100" />
            <Button size="sm" onClick={addItem} disabled={!novoItem.trim()}>Adicionar</Button>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3 flex items-center gap-2">
          <button type="button" onClick={() => setAtivo(!ativo)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${ativo ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300" : "border-gray-300 dark:border-gray-700 text-gray-500"}`}>{ativo ? "✓ Ativo" : "Inativo"}</button>
          <span className="text-[11px] text-gray-400">desativado some da lista do dia</span>
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : isNew ? "Criar" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
