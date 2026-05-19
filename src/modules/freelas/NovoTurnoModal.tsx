import { useMemo, useState } from "react";
import {
  addDoc, collection, deleteField, doc, getDoc, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { TimeInput } from "../../core/ui/TimeInput";
import { fmtAnoMes, parseYmd, todayYmd } from "../../core/utils/date";
import { AREAS, type Area, type Empregado, type Pessoa } from "../../core/types";
import { CadastroRapidoFreelaModal } from "./CadastroRapidoFreelaModal";
import {
  listarCandidatos,
  resolverPixWhats,
  type FreelaCandidato,
} from "./helpers";

type Props = {
  restaurantId: string;
  empregados: Empregado[];
  pessoas: Pessoa[];
  initialDate?: string;
  onClose: () => void;
  onSaved: () => void;
};

// Modal único de criação de turno. Status definido pela DATA:
//   - Data futura  → "agendado" (entrada/saída opcionais — preencher quando rolar)
//   - Data ≤ hoje  → "aberto"   (entrada obrigatória — turno já começou)
//
// Operador (qualquer permissão `ver`) preenche aqui. Valor (hora/diária + R$)
// é responsabilidade do DP — preenchido depois, na tab Lançamentos.
export function NovoTurnoModal({
  restaurantId, empregados, pessoas, initialDate, onClose, onSaved,
}: Props) {
  const { pessoa: me } = useAuth();
  const [date, setDate] = useState(initialDate || todayYmd());
  const [area, setArea] = useState<Area | "">("");
  const [candidatoId, setCandidatoId] = useState("");
  const [entrada, setEntrada] = useState("");
  const [obs, setObs] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCadastro, setShowCadastro] = useState(false);

  const isFutura = date > todayYmd();
  const statusAlvo: "agendado" | "aberto" = isFutura ? "agendado" : "aberto";

  const candidatos = useMemo(
    () => listarCandidatos(empregados, pessoas, restaurantId),
    [empregados, pessoas, restaurantId],
  );
  const candidato: FreelaCandidato | null = useMemo(
    () => candidatos.find((c) => `${c.tipo}:${c.id}` === candidatoId) || null,
    [candidatos, candidatoId],
  );

  async function salvar() {
    setErr("");
    if (!me) return;
    if (!candidato) { setErr("Selecione um freela."); return; }
    if (!date) { setErr("Data obrigatória."); return; }
    if (!area) { setErr("Área obrigatória."); return; }
    // Entrada obrigatória pra turno que JÁ começou (data ≤ hoje)
    if (!isFutura && !entrada) {
      setErr("Hora de início é obrigatória pra turno que já começou.");
      return;
    }
    if (candidato.tipo === "freela" && !candidato.pix) {
      setErr("Esse freela está sem PIX. Complete o cadastro em Pessoas.");
      return;
    }
    setSaving(true);
    try {
      const extras = resolverPixWhats(candidato, pessoas);
      const now = new Date().toISOString();

      const payload = {
        restaurantId,
        empregadoId: candidato.tipo === "empregado" ? candidato.id : null,
        pessoaId:    candidato.tipo === "freela"    ? candidato.id : null,
        nomeSnapshot: candidato.nome,
        ...(candidato.cpf  ? { cpfSnapshot: candidato.cpf } : {}),
        ...(extras.pix     ? { pixSnapshot: extras.pix } : {}),
        ...(extras.whatsapp? { whatsappSnapshot: extras.whatsapp } : {}),
        date,
        scheduledDate: date,
        ...(area    ? { area } : {}),
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

      // Empregado registrado cobrindo turno extra → marca "freela" na escala
      if (candidato.tipo === "empregado") {
        await marcarFreelaNaEscala(restaurantId, candidato.id, date);
      }
      onSaved();
    } catch (e) {
      console.error(e);
      setErr("Erro ao salvar. Tente novamente.");
      setSaving(false);
    }
  }

  return (
    <>
      <Modal
        title={isFutura ? "📅 Agendar turno de freela" : "📝 Lançar turno de freela"}
        onClose={onClose}
        maxWidth="max-w-md"
      >
        <div className="space-y-3">
          <Input
            label="Data *"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-2">
            {isFutura
              ? "Data futura — vai criar como agendado. Quando o dia chegar, edite e preencha entrada/saída."
              : "Data já chegou — vai criar como aberto. Preencha pelo menos a hora de início."}
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Freela *
            </label>
            <select
              value={candidatoId}
              onChange={(e) => setCandidatoId(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">— selecione —</option>
              <optgroup label="🧑‍💼 Empregados (turno extra)">
                {candidatos.filter((c) => c.tipo === "empregado").map((c) => (
                  <option key={`${c.tipo}:${c.id}`} value={`${c.tipo}:${c.id}`}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
              <optgroup label="🎒 Freelas cadastrados">
                {candidatos.filter((c) => c.tipo === "freela").map((c) => (
                  <option key={`${c.tipo}:${c.id}`} value={`${c.tipo}:${c.id}`}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              type="button"
              onClick={() => setShowCadastro(true)}
              className="self-start text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
            >
              + Cadastrar novo freela
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Área *
            </label>
            <select
              value={area}
              onChange={(e) => setArea(e.target.value as Area | "")}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">— selecione —</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              {isFutura ? "Hora de início (opcional)" : "Hora de início *"}
            </label>
            <TimeInput value={entrada} onChange={setEntrada} placeholder="HH:MM" />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              Observação (opcional)
            </label>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              rows={2}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
              placeholder="Ex: cobertura de noite de quinta…"
            />
          </div>

          <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded p-2">
            💡 Valor (R$/h ou diária) e tipo de cobrança são preenchidos pelo
            <strong> DP</strong> depois — não preencha aqui.
          </div>

          {candidato?.tipo === "empregado" && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
              Empregado registrado — ao salvar, o dia <strong>{date}</strong> será
              marcado como <strong>"freela"</strong> na escala (Praticada).
            </div>
          )}

          {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>
              {saving ? "Salvando…" : (isFutura ? "Agendar" : "Lançar")}
            </Button>
          </div>
        </div>
      </Modal>

      {showCadastro && (
        <CadastroRapidoFreelaModal
          restaurantId={restaurantId}
          onSaved={(p) => {
            setCandidatoId(`freela:${p.id}`);
            setShowCadastro(false);
          }}
          onClose={() => setShowCadastro(false)}
        />
      )}
    </>
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
      id: escalaId,
      restaurantId: rid,
      ano, mes,
      prevista: {},
      real: { [empregadoId]: { [ymdDate]: "freela" } },
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
