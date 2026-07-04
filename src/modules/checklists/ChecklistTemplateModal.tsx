import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { AREAS, CHECKLIST_FREQ_LABEL, CHECKLIST_TURNO_LABEL } from "../../core/types";
import type { Area, ChecklistFrequencia, ChecklistItemTemplate, ChecklistTemplate, ChecklistTurno, Pessoa } from "../../core/types";
import { FotoUpload } from "./FotoUpload";

type Props = {
  template: ChecklistTemplate | null;
  restaurantId: string;
  onClose: () => void;
};

const FREQS: ChecklistFrequencia[] = ["diaria", "semanal", "mensal", "avulsa"];
const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function ChecklistTemplateModal({ template, restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const isNew = !template;

  const [nome, setNome] = useState(template?.nome || "");
  const [descricao, setDescricao] = useState(template?.descricao || "");
  const [area, setArea] = useState<Area | "">(template?.area || "");
  const [frequencia, setFrequencia] = useState<ChecklistFrequencia>(template?.frequencia || "diaria");
  const [turno, setTurno] = useState<ChecklistTurno | "">(template?.turno || "");
  const [diasSemana, setDiasSemana] = useState<number[]>(template?.diasSemana || []);
  const [horarioRef, setHorarioRef] = useState(template?.horarioReferencia || "");
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
        area: area || undefined,
        frequencia,
        turno: turno || null,
        diasSemana: frequencia === "diaria" && diasSemana.length > 0 ? diasSemana : undefined,
        horarioReferencia: horarioRef || undefined,
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

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Área</label>
            <select
              value={area}
              onChange={(e) => setArea(e.target.value as Area | "")}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              <option value="">Geral</option>
              {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Frequência</label>
            <select
              value={frequencia}
              onChange={(e) => setFrequencia(e.target.value as ChecklistFrequencia)}
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            >
              {FREQS.map(f => <option key={f} value={f}>{CHECKLIST_FREQ_LABEL[f]}</option>)}
            </select>
          </div>
          <Input
            label="Horário ref."
            type="time"
            value={horarioRef}
            onChange={(e) => setHorarioRef(e.target.value)}
          />
        </div>

        {/* Turno + atribuição */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Turno</label>
            <select value={turno} onChange={(e) => setTurno(e.target.value as ChecklistTurno | "")} className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="">Sem turno</option>
              {(["abertura", "meio", "fechamento"] as ChecklistTurno[]).map(t => <option key={t} value={t}>{CHECKLIST_TURNO_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Responsáveis (pessoas)</label>
            <select value="" onChange={(e) => { const id = e.target.value; if (id && !responsaveisIds.includes(id)) setResponsaveisIds(s => [...s, id]); }} className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
              <option value="">+ adicionar pessoa…</option>
              {pessoasOrd.filter(p => !responsaveisIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            {responsaveisIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {responsaveisIds.map(id => (
                  <span key={id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{nomePorId[id] || "?"}<button type="button" onClick={() => setResponsaveisIds(s => s.filter(x => x !== id))} className="hover:text-rose-600">×</button></span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Funções responsáveis (área)</label>
          <div className="flex flex-wrap gap-1 mt-1">
            {AREAS.map(a => (
              <button key={a} type="button" onClick={() => toggleFuncao(a)} className={`px-2.5 py-1 text-xs rounded-full border ${funcoes.includes(a) ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium" : "border-gray-200 dark:border-gray-800 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50"}`}>{a}</button>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-1">Vazio (pessoas e funções) = qualquer pessoa com permissão vê o checklist.</p>
        </div>

        {/* Dias da semana (só se diária) */}
        {frequencia === "diaria" && (
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Dias da semana ({diasSemana.length === 0 ? "todos" : diasSemana.length})
            </label>
            <div className="flex gap-1 mt-1">
              {DOW_LABELS.map((label, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDow(i)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors flex-1 ${
                    diasSemana.includes(i)
                      ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium"
                      : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-1">Vazio = todos os dias</p>
          </div>
        )}

        {/* Itens */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 block mb-2">
            Itens ({itens.length})
          </label>
          <div className="space-y-1 mb-2">
            {itens.map((item, idx) => (
              <div key={item.id} className="flex items-start gap-2 p-2 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <span className="text-xs text-gray-500 mt-1 font-mono w-6">{idx + 1}.</span>
                <div className="flex-1 space-y-1">
                  <Input
                    value={item.texto}
                    onChange={(e) => patchItem(item.id, { texto: e.target.value })}
                    className="text-sm"
                  />
                  <div className="flex gap-3 text-xs text-gray-600 dark:text-gray-400 flex-wrap">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={item.obrigatorio} onChange={(e) => patchItem(item.id, { obrigatorio: e.target.checked })} />
                      <span>Obrigatório</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer" title="Quando marcar feito, obriga escrever uma observação">
                      <input type="checkbox" checked={!!item.exigeObs} onChange={(e) => patchItem(item.id, { exigeObs: e.target.checked })} />
                      <span>Exige observação</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer" title="Quando marcar feito, obriga anexar uma foto de prova">
                      <input type="checkbox" checked={!!item.exigeFoto} onChange={(e) => patchItem(item.id, { exigeFoto: e.target.checked })} />
                      <span>Exige foto</span>
                    </label>
                  </div>
                  <textarea value={item.descricao || ""} onChange={(e) => patchItem(item.id, { descricao: e.target.value })} rows={1} placeholder="Como fazer (instrução, opcional)…" className="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 resize-y" />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500">Foto-guia:</span>
                    <FotoUpload rid={restaurantId} pathPrefix={`guia_${item.id}`} url={item.fotoGuiaUrl} onChange={(u) => patchItem(item.id, { fotoGuiaUrl: u || undefined })} label="foto-guia" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button type="button" onClick={() => moveItem(item.id, -1)} disabled={idx === 0} className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30">▲</button>
                  <button type="button" onClick={() => moveItem(item.id, 1)} disabled={idx === itens.length - 1} className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30">▼</button>
                </div>
                <button type="button" onClick={() => removerItem(item.id)} className="text-rose-600 hover:text-rose-700 text-sm">×</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={novoItem}
              onChange={(e) => setNovoItem(e.target.value)}
              placeholder="+ Novo item"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
              className="flex-1"
            />
            <Button onClick={addItem} disabled={!novoItem.trim()}>Adicionar</Button>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            <span className="font-medium">Ativo</span>
            <span className="text-xs text-gray-500">(desativado não aparece nem na aba Hoje nem nos avulsos)</span>
          </label>
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
