import { useMemo, useState } from "react";
import {
  addDoc, collection, deleteField, doc, getDoc, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { TimeInput } from "../../core/ui/TimeInput";
import { fmtAnoMes, parseYmd, todayYmd } from "../../core/utils/date";
import { AREAS, type Area, type Empregado, type Pessoa } from "../../core/types";
import { onlyDigits, resolverPixWhats } from "./helpers";
import { SeletorSemana } from "./SeletorSemana";
import { CadastroPorCpf } from "./CadastroPorCpf";

type Props = {
  restaurantId: string;
  empregados: Empregado[];
  pessoas: Pessoa[];
  initialDate?: string;
  onClose: () => void;
  onSaved: () => void;
};

type EscolhaTipo = null | "empregado" | "freela";

type SelecionadoEmp   = { tipo: "empregado"; emp: Empregado };
type SelecionadoFreela = { tipo: "freela"; pessoa: Pessoa };
type Selecionado = SelecionadoEmp | SelecionadoFreela | null;

export function NovoTurnoModal({
  restaurantId, empregados, pessoas, initialDate, onClose, onSaved,
}: Props) {
  const { pessoa: me } = useAuth();
  const [date, setDate] = useState(initialDate || todayYmd());
  const [area, setArea] = useState<Area | "">("");
  const [entrada, setEntrada] = useState("");
  const [obs, setObs] = useState("");

  const [escolhaTipo, setEscolhaTipo] = useState<EscolhaTipo>(null);
  const [selecionado, setSelecionado] = useState<Selecionado>(null);
  const [mostrarCadastro, setMostrarCadastro] = useState(false);

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const isFutura = date > todayYmd();
  const statusAlvo: "agendado" | "aberto" = isFutura ? "agendado" : "aberto";

  // Empregados ativos do restaurante
  const empregadosAtivos = useMemo(
    () => empregados
      .filter((e) => e.restaurantId === restaurantId && e.estaAtivo)
      .sort((a, b) => a.nome.localeCompare(b.nome)),
    [empregados, restaurantId],
  );

  // Freelas = pessoas do restaurante com PIX e que NÃO são empregados (CPF diferente)
  const cpfsEmpregados = useMemo(
    () => new Set(empregados.filter((e) => e.cpf).map((e) => onlyDigits(e.cpf))),
    [empregados],
  );
  const freelas = useMemo(
    () => pessoas
      .filter((p) => p.restaurantIds.includes(restaurantId) && p.ativa && p.pix)
      .filter((p) => !p.cpf || !cpfsEmpregados.has(onlyDigits(p.cpf)))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
    [pessoas, restaurantId, cpfsEmpregados],
  );

  async function salvar() {
    setErr("");
    if (!me) return;
    if (!selecionado) { setErr("Selecione um freela."); return; }
    if (!date) { setErr("Data obrigatória."); return; }
    if (!area) { setErr("Área obrigatória."); return; }
    if (!isFutura && !entrada) {
      setErr("Hora de início é obrigatória pra turno que já começou.");
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const isEmp = selecionado.tipo === "empregado";
      const nome  = isEmp ? selecionado.emp.nome   : selecionado.pessoa.nome;
      const cpf   = isEmp ? selecionado.emp.cpf    : selecionado.pessoa.cpf;
      const extras = isEmp
        ? resolverPixWhats({ tipo: "empregado", id: selecionado.emp.id, nome, cpf: cpf || undefined }, pessoas)
        : { pix: selecionado.pessoa.pix, whatsapp: selecionado.pessoa.whatsapp };

      const payload = {
        restaurantId,
        empregadoId: isEmp ? selecionado.emp.id : null,
        pessoaId:    isEmp ? null : selecionado.pessoa.id,
        nomeSnapshot: nome,
        ...(cpf ? { cpfSnapshot: cpf } : {}),
        ...(extras.pix ? { pixSnapshot: extras.pix } : {}),
        ...(extras.whatsapp ? { whatsappSnapshot: extras.whatsapp } : {}),
        date,
        scheduledDate: date,
        area,
        ...(entrada ? { entrada } : {}),
        status: statusAlvo,
        lotePagamentoId: null,
        ...(obs.trim() ? { observacao: obs.trim() } : {}),
        lancadoPor: me.id,
        lancadoPorNome: me.nome,
        lancadoEm: now,
        updatedAt: now,
      };
      await addDoc(collection(db, "freelaShifts"), payload);

      if (isEmp) {
        await marcarFreelaNaEscala(restaurantId, selecionado.emp.id, date);
      }
      onSaved();
    } catch (e) {
      console.error(e);
      setErr("Erro ao salvar. Tente novamente.");
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isFutura ? "📅 Agendar turno de freela" : "📝 Lançar turno de freela"}
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        {/* ─── Data: seletor de semana ─── */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            Data *
          </label>
          <SeletorSemana value={date} onChange={setDate} />
        </div>

        {/* ─── Quem é o freela: etapa progressiva ─── */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            Quem é o freela? *
          </label>

          {!escolhaTipo && !selecionado && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEscolhaTipo("empregado")}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-3 text-sm font-medium bg-white dark:bg-gray-900 hover:border-indigo-400 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/20 transition-colors"
              >
                👨‍💼 Empregado da casa
              </button>
              <button
                type="button"
                onClick={() => setEscolhaTipo("freela")}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-3 text-sm font-medium bg-white dark:bg-gray-900 hover:border-indigo-400 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/20 transition-colors"
              >
                🎒 Freela
              </button>
            </div>
          )}

          {/* Lista empregados */}
          {escolhaTipo === "empregado" && !selecionado && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto">
              {empregadosAtivos.length === 0 ? (
                <div className="p-3 text-xs text-gray-500">Nenhum empregado ativo.</div>
              ) : (
                empregadosAtivos.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelecionado({ tipo: "empregado", emp: e })}
                    className="w-full text-left px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    {e.nome}
                  </button>
                ))
              )}
              <div className="p-2 text-right">
                <button type="button" onClick={() => setEscolhaTipo(null)} className="text-[11px] text-gray-500 hover:underline">
                  ← voltar
                </button>
              </div>
            </div>
          )}

          {/* Lista freelas + cadastro */}
          {escolhaTipo === "freela" && !selecionado && !mostrarCadastro && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 max-h-64 overflow-y-auto">
              {freelas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelecionado({ tipo: "freela", pessoa: p })}
                  className="w-full text-left px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  {p.nome}
                  {p.cpf && <span className="ml-2 text-[10px] text-gray-500">{p.cpf}</span>}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMostrarCadastro(true)}
                className="w-full text-left px-3 py-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
              >
                + Cadastrar novo freela
              </button>
              <div className="p-2 text-right">
                <button type="button" onClick={() => setEscolhaTipo(null)} className="text-[11px] text-gray-500 hover:underline">
                  ← voltar
                </button>
              </div>
            </div>
          )}

          {/* Cadastro por CPF */}
          {escolhaTipo === "freela" && mostrarCadastro && !selecionado && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-900">
              <CadastroPorCpf
                restaurantId={restaurantId}
                onConcluido={(p) => {
                  setMostrarCadastro(false);
                  setSelecionado({ tipo: "freela", pessoa: p });
                }}
                onCancelar={() => setMostrarCadastro(false)}
              />
            </div>
          )}

          {/* Selecionado */}
          {selecionado && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {selecionado.tipo === "empregado" ? "👨‍💼 " : "🎒 "}
                  {selecionado.tipo === "empregado" ? selecionado.emp.nome : selecionado.pessoa.nome}
                </div>
                <div className="text-[11px] text-gray-600 dark:text-gray-400">
                  {selecionado.tipo === "empregado" ? "Empregado da casa" : "Freela"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setSelecionado(null); setEscolhaTipo(null); setMostrarCadastro(false); }}
                className="text-[11px] text-gray-500 hover:underline"
              >
                Trocar
              </button>
            </div>
          )}
        </div>

        {/* ─── Área ─── */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Área *</label>
          <select
            value={area}
            onChange={(e) => setArea(e.target.value as Area | "")}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">— selecione —</option>
            {AREAS.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </div>

        {/* ─── Hora de início ─── */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            {isFutura ? "Hora de início (opcional)" : "Hora de início *"}
          </label>
          <TimeInput value={entrada} onChange={setEntrada} placeholder="HH:MM" />
        </div>

        {/* ─── Observação ─── */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Observação (opcional)</label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            placeholder="Ex: cobertura de noite de quinta…"
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
          />
        </div>

        <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded p-2">
          💡 Valor (R$/h ou diária) é preenchido pelo <strong>DP</strong> depois.
        </div>

        {selecionado?.tipo === "empregado" && (
          <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
            Empregado registrado — ao salvar, o dia <strong>{date}</strong> será marcado como <strong>"freela"</strong> na escala (Praticada).
          </div>
        )}

        {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || !selecionado}>
            {saving ? "Salvando…" : (isFutura ? "Agendar" : "Lançar")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

async function marcarFreelaNaEscala(rid: string, empregadoId: string, ymdDate: string) {
  const d = parseYmd(ymdDate);
  const ano = d.getFullYear();
  const mes = d.getMonth() + 1;
  const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;
  const ref = doc(db, "escalas", escalaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      id: escalaId, restaurantId: rid, ano, mes,
      prevista: {}, real: { [empregadoId]: { [ymdDate]: "freela" } },
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await updateDoc(ref, {
    [`real.${empregadoId}.${ymdDate}`]: "freela",
    updatedAt: new Date().toISOString(),
  });
}

export async function limparFreelaDaEscala(rid: string, empregadoId: string, ymdDate: string) {
  const d = parseYmd(ymdDate);
  const ano = d.getFullYear();
  const mes = d.getMonth() + 1;
  const ref = doc(db, "escalas", `${rid}_${fmtAnoMes(ano, mes)}`);
  await updateDoc(ref, {
    [`real.${empregadoId}.${ymdDate}`]: deleteField(),
    updatedAt: new Date().toISOString(),
  });
}
