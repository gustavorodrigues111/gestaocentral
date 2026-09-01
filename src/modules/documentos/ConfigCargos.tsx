// ════════════════════════════════════════════════════════════════════════════
//  Configuração de cargos p/ CONTRATOS (por empresa). Complementa o cargo do app
//  (coleção `cargos`, o mesmo que a Admissão usa) com os campos que o contrato
//  precisa: CBO, função legal, regime, jornada, gorjeta média e atribuições.
//  Guardado em `documentosCargos` (1 por cargoId). Sem cadastro → contrato não
//  puxa os dados do cargo e pede pra configurar aqui.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { Modal } from "../../core/ui/Modal";
import type { Cargo } from "../../core/types";

export type DocCargo = {
  id: string;
  restaurantId: string;
  cargoId: string;
  funcao: string;
  cbo?: string;
  salario?: number | null;
  regime: "presencial" | "hibrido" | "externo";
  horario?: string;
  gorjeta_texto?: string;
  descricao?: string[];
  ajuda_custo_home_office?: number | null;
  presencial_dias_horarios?: string;
  home_office_dias_horarios?: string;
  observacoes?: string;
  atualizadoEm?: string;
};

const REGIMES: [DocCargo["regime"], string][] = [
  ["presencial", "Presencial"],
  ["hibrido", "Híbrido (home office parcial)"],
  ["externo", "Externo (art. 62, sem controle de jornada)"],
];

function novoDe(cargo: Cargo): Omit<DocCargo, "id"> {
  return {
    restaurantId: cargo.restaurantId, cargoId: cargo.id, funcao: cargo.nome,
    cbo: "", salario: cargo.salarioBase ?? null, regime: "presencial",
    horario: "", gorjeta_texto: "",
    descricao: cargo.descricao ? cargo.descricao.split("\n").map(s => s.trim()).filter(Boolean) : [],
  };
}

const lbl = "text-xs font-semibold text-gray-600 dark:text-gray-400";
const ta = "px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 w-full focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500";

export function ConfigCargos({ rid }: { rid: string }) {
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [docs, setDocs] = useState<DocCargo[]>([]);
  const [edit, setEdit] = useState<{ cargo: Cargo; form: DocCargo } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!rid) { setCargos([]); return; }
    return onSnapshot(query(collection(db, "cargos"), where("restaurantId", "==", rid)),
      s => setCargos(s.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo).filter(c => c.ativo !== false)), () => setCargos([]));
  }, [rid]);

  useEffect(() => {
    if (!rid) { setDocs([]); return; }
    return onSnapshot(query(collection(db, "documentosCargos"), where("restaurantId", "==", rid)),
      s => setDocs(s.docs.map(d => ({ id: d.id, ...d.data() }) as DocCargo)), () => setDocs([]));
  }, [rid]);

  const porCargo = useMemo(() => {
    const m = new Map<string, DocCargo>();
    docs.forEach(d => m.set(d.cargoId, d));
    return m;
  }, [docs]);

  const lista = useMemo(() => [...cargos].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome)), [cargos]);

  function abrir(cargo: Cargo) {
    const existente = porCargo.get(cargo.id);
    setErro("");
    setEdit({ cargo, form: existente ? { ...existente } : { id: "", ...novoDe(cargo) } });
  }

  async function salvar() {
    if (!edit) return;
    const f = edit.form;
    if (!f.funcao.trim()) { setErro("A função (nome legal) é obrigatória."); return; }
    setSalvando(true); setErro("");
    try {
      const payload = sanitizeForFirestore({
        restaurantId: rid, cargoId: f.cargoId, funcao: f.funcao.trim(),
        cbo: f.cbo?.trim() || "", salario: f.salario ?? null, regime: f.regime,
        horario: f.horario?.trim() || "", gorjeta_texto: f.gorjeta_texto?.trim() || "",
        descricao: (f.descricao || []).map(s => s.trim()).filter(Boolean),
        ...(f.regime === "hibrido" ? {
          ajuda_custo_home_office: f.ajuda_custo_home_office ?? null,
          presencial_dias_horarios: f.presencial_dias_horarios?.trim() || "",
          home_office_dias_horarios: f.home_office_dias_horarios?.trim() || "",
        } : {}),
        observacoes: f.observacoes?.trim() || "",
        atualizadoEm: new Date().toISOString(),
      });
      if (f.id) await updateDoc(doc(db, "documentosCargos", f.id), payload);
      else await addDoc(collection(db, "documentosCargos"), payload);
      setEdit(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Falha ao salvar."); }
    finally { setSalvando(false); }
  }

  const setF = (patch: Partial<DocCargo>) => setEdit(e => e ? { ...e, form: { ...e.form, ...patch } } : e);

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Cada cargo da empresa recebe aqui os dados que o <strong>contrato</strong> precisa (CBO, jornada, gorjeta média, atribuições).
        A geração do contrato puxa o cargo da <strong>admissão</strong> e usa esta configuração — cargo sem configurar não preenche esses campos.
      </p>

      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          Nenhum cargo cadastrado nesta empresa. Cadastre os cargos no módulo de Cargos/Equipe — eles aparecem aqui pra configurar o contrato.
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map(c => {
            const d = porCargo.get(c.id);
            const ok = !!d && !!(d.cbo || d.horario || (d.descricao && d.descricao.length));
            return (
              <div key={c.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {d?.funcao || c.nome}
                    <span className={`ml-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${ok ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300" : "text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                      {ok ? "configurado" : "falta configurar"}
                    </span>
                  </div>
                  <div className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
                    {d?.cbo ? `CBO ${d.cbo}` : "sem CBO"}
                    {d?.salario ? ` · R$ ${d.salario.toLocaleString("pt-BR")}` : (c.salarioBase ? ` · R$ ${c.salarioBase.toLocaleString("pt-BR")} (base)` : "")}
                    {d?.regime ? ` · ${d.regime}` : ""}
                  </div>
                </div>
                <button type="button" onClick={() => abrir(c)}
                  className="text-xs font-semibold px-3 py-2 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 whitespace-nowrap">
                  {ok ? "Editar" : "Configurar"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {edit && (
        <Modal title={`Contrato · ${edit.cargo.nome}`} onClose={() => setEdit(null)} maxWidth="max-w-xl">
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Função (nome legal) *" value={edit.form.funcao} onChange={e => setF({ funcao: e.target.value })} />
              <Input label="CBO" value={edit.form.cbo || ""} onChange={e => setF({ cbo: e.target.value })} placeholder="ex: 5132-05" />
              <Input label="Salário (R$)" type="number" value={edit.form.salario ?? ""} onChange={e => setF({ salario: e.target.value === "" ? null : Number(e.target.value) })} />
              <div className="flex flex-col gap-1">
                <label className={lbl}>Regime</label>
                <select value={edit.form.regime} onChange={e => setF({ regime: e.target.value as DocCargo["regime"] })} className={ta}>
                  {REGIMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className={lbl}>Jornada / horário (texto completo do contrato)</label>
              <textarea rows={3} value={edit.form.horario || ""} onChange={e => setF({ horario: e.target.value })} className={ta}
                placeholder="De segunda a sexta, das 09:00 às 18:00, com 1h de intervalo, 44h semanais…" />
            </div>

            <div className="flex flex-col gap-1">
              <label className={lbl}>Gorjeta média (cláusula — texto que entra na remuneração)</label>
              <textarea rows={2} value={edit.form.gorjeta_texto || ""} onChange={e => setF({ gorjeta_texto: e.target.value })} className={ta}
                placeholder="Além do salário, o(a) empregado(a) receberá gorjetas conforme rateio, com média mensal aproximada de R$ …" />
            </div>

            <div className="flex flex-col gap-1">
              <label className={lbl}>Atribuições (uma por linha)</label>
              <textarea rows={5} value={(edit.form.descricao || []).join("\n")} onChange={e => setF({ descricao: e.target.value.split("\n") })} className={ta}
                placeholder={"Preparo e finalização de pratos\nConferência de mise en place\n…"} />
            </div>

            {edit.form.regime === "hibrido" && (
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10 p-3 space-y-3">
                <div className="text-[12px] font-semibold text-indigo-700 dark:text-indigo-300">Home office (regime híbrido)</div>
                <Input label="Ajuda de custo home office (R$)" type="number" value={edit.form.ajuda_custo_home_office ?? ""} onChange={e => setF({ ajuda_custo_home_office: e.target.value === "" ? null : Number(e.target.value) })} />
                <div className="flex flex-col gap-1">
                  <label className={lbl}>Dias/horários presenciais</label>
                  <textarea rows={2} value={edit.form.presencial_dias_horarios || ""} onChange={e => setF({ presencial_dias_horarios: e.target.value })} className={ta} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={lbl}>Dias/horários em casa</label>
                  <textarea rows={2} value={edit.form.home_office_dias_horarios || ""} onChange={e => setF({ home_office_dias_horarios: e.target.value })} className={ta} />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className={lbl}>Observações internas (não vão no contrato)</label>
              <textarea rows={2} value={edit.form.observacoes || ""} onChange={e => setF({ observacoes: e.target.value })} className={ta} />
            </div>

            {erro && <div className="text-sm text-rose-600">{erro}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
