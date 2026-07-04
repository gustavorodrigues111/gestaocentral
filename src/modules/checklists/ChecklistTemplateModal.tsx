import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { AREAS, CHECKLIST_TURNO_LABEL } from "../../core/types";
import type { Area, ChecklistItemTemplate, ChecklistTemplate, ChecklistTurno, Pessoa } from "../../core/types";
import { FotoUpload } from "./FotoUpload";

type Props = {
  template: ChecklistTemplate | null;
  restaurantId: string;
  onClose: () => void;
};

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
// Chip arredondado padrão (selecionado × não).
const CHIP = (active: boolean) => `px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${active ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300" : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`;

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
  useEffect(() => {
    if (!restaurantId) return;
    const u = onSnapshot(query(collection(db, "pessoas"), where("restaurantIds", "array-contains", restaurantId)), snap => setPessoas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa).filter(p => p.ativa !== false)));
    return () => u();
  }, [restaurantId]);
  const pessoasOrd = useMemo(() => [...pessoas].sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas]);
  const nomePorId = useMemo(() => Object.fromEntries(pessoas.map(p => [p.id, p.nome])), [pessoas]);
  const toggleFuncao = (a: Area) => setFuncoes(s => s.includes(a) ? s.filter(x => x !== a) : [...s, a]);

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
            <div className="flex flex-wrap gap-1.5 mt-2 items-center">
              {DOW_LABELS.map((label, i) => (
                <button key={i} type="button" onClick={() => toggleDow(i)} className={CHIP(diasSemana.includes(i))}>{label}</button>
              ))}
              <span className="text-[11px] text-gray-400 ml-1">{diasSemana.length === 0 ? "= todos os dias" : ""}</span>
            </div>
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
            <div className="text-[11px] text-gray-500 mb-1">Pessoas específicas</div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {responsaveisIds.map(id => (
                <span key={id} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{nomePorId[id] || "?"}<button type="button" onClick={() => setResponsaveisIds(s => s.filter(x => x !== id))} className="hover:text-rose-600">×</button></span>
              ))}
              <select value="" onChange={(e) => { const id = e.target.value; if (id && !responsaveisIds.includes(id)) setResponsaveisIds(s => [...s, id]); }} className="text-xs px-3 py-1.5 rounded-full border border-dashed border-gray-300 dark:border-gray-600 bg-transparent text-gray-500 cursor-pointer">
                <option value="">+ pessoa…</option>
                {pessoasOrd.filter(p => !responsaveisIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
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
