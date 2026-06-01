// ════════════════════════════════════════════════════════════════════════════
//  Sub-tab "Cargos" da aba "Compatibilidade de cadastros".
//
//  Bidirecional: compara cargos do Planejamento (coleção /cargos — entidade
//  global por restaurante, mas a tela compara contra A conta Sólides do
//  restaurante ativo) com os cargos cadastrados na Sólides (Tangerino
//  job-role). Auto-match por nome normalizado (sem acento, sem caixa, sem
//  espaços extras). Quando casa exato e é único nos dois lados, grava
//  cargo.solidesId.
//
//  Master pode:
//   - ↑ Criar na Sólides: cargo do Planejamento que não tem par lá vira POST
//     /job-role/register; recebe o id da Sólides e grava em cargo.solidesId
//   - ↓ Trazer pro Planejamento: cargo da Sólides que não existe aqui vira
//     novo doc em /cargos com defaults razoáveis e solidesId já preenchido
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, doc, getDoc, onSnapshot, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../../../core/firebase/config";
import { sanitizeForFirestore } from "../../../core/firebase/sanitize";
import { useAuth } from "../../../core/auth/AuthContext";
import { useRestaurant } from "../../../core/restaurant/RestaurantContext";
import { fmtBRDateTime } from "../../../core/utils/date";
import type { Cargo } from "../../../core/types";
import {
  createSolidesJobRole,
  fetchSolidesJobRoles,
  type SolidesJobRole,
} from "../../../core/excecoes/solidesJobRolesClient";
import { normalizeNome } from "./matching";

type Props = { rid: string };

type LinhaStatus =
  | "ok"          // ✓ idêntico (nome casa + solidesId mapeado)
  | "diverge"     // ⚠ nomes diferentes (já tem solidesId mas nome divergiu)
  | "so_plan"    // → só no Planejamento
  | "so_sol"     // ← só na Sólides
  | "ambiguo";   // ? mais de um candidato em algum dos lados

type Linha = {
  key: string;
  status: LinhaStatus;
  // Lado Planejamento (cargo)
  cargo?: Cargo;
  // Lado Sólides (job-role)
  solides?: SolidesJobRole;
  // Pra ambíguos: candidatos do lado que tem mais de 1
  candidatosPlan?: Cargo[];
  candidatosSol?: SolidesJobRole[];
};

// Schema do doc /comparacoesCadastros/{rid}_cargos — snapshot pra hidratar.
// Cada linha guarda só o suficiente pra mostrar a tela; status é
// recalculado no front se desejado, mas no boot só renderiza o snapshot.
type ComparacaoCargosDoc = {
  rid: string;
  atualizadoEm: string;       // ISO
  atualizadoPor: string;
  atualizadoPorNome: string;
  snapshot: Array<{
    status: LinhaStatus;
    cargoId?: string;
    cargoNome?: string;
    solidesId?: number;
    solidesNome?: string;
  }>;
};

// Ordem para sort: primeiro o que precisa de atenção
function statusOrder(s: LinhaStatus): number {
  switch (s) {
    case "diverge":  return 0;
    case "so_plan":  return 1;
    case "so_sol":   return 2;
    case "ambiguo":  return 3;
    case "ok":       return 4;
  }
}

export function CargosSubTab({ rid }: Props) {
  const { activeRestaurant } = useRestaurant();
  const { pessoa } = useAuth();
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [solidesCache, setSolidesCache] = useState<SolidesJobRole[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string | null>(null);
  const [atualizadoPorNome, setAtualizadoPorNome] = useState<string>("");
  const [modalCriarSolides, setModalCriarSolides] = useState<Cargo | null>(null);
  const [modalTrazerPlan, setModalTrazerPlan] = useState<SolidesJobRole | null>(null);

  const isMaster = pessoa?.isMaster === true;
  const shortCode = activeRestaurant?.shortCode || "";

  // Carrega cargos do Firestore (global, sem filtro por rid)
  useEffect(() => {
    const u = onSnapshot(collection(db, "cargos"), (snap) => {
      setCargos(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => u();
  }, []);

  // Reconstroi linhas a partir de cargos[] + solidesCache[].
  // Usado tanto pelo botão "Comparar agora" quanto pela hidratação a partir
  // do doc (depois de carregar o doc, fazemos UM build com os dados frescos
  // ao invés de só renderizar o snapshot serializado — assim a UI sempre
  // reflete o estado real do cargo.solidesId mesmo após edits manuais).
  const construirLinhas = useCallback(
    (cargosArr: Cargo[], solList: SolidesJobRole[]): Linha[] => {
      // Index por nome normalizado
      const cargosByNorm = new Map<string, Cargo[]>();
      for (const c of cargosArr) {
        if (!c.ativo) continue; // só ativos no matching
        const k = normalizeNome(c.nome);
        if (!k) continue;
        if (!cargosByNorm.has(k)) cargosByNorm.set(k, []);
        cargosByNorm.get(k)!.push(c);
      }
      const solByNorm = new Map<string, SolidesJobRole[]>();
      for (const s of solList) {
        const k = normalizeNome(s.name);
        if (!k) continue;
        if (!solByNorm.has(k)) solByNorm.set(k, []);
        solByNorm.get(k)!.push(s);
      }
      const cargosUsados = new Set<string>();
      const solUsados = new Set<number>();
      const out: Linha[] = [];

      // 1) Match por solidesId já gravado — fonte da verdade pra "ok" vs "diverge"
      for (const c of cargosArr) {
        if (!c.ativo) continue;
        if (typeof c.solidesId === "number") {
          const sol = solList.find((s) => s.id === c.solidesId);
          if (sol) {
            const ok = normalizeNome(c.nome) === normalizeNome(sol.name);
            out.push({
              key: `paired_${c.id}_${sol.id}`,
              status: ok ? "ok" : "diverge",
              cargo: c,
              solides: sol,
            });
            cargosUsados.add(c.id);
            solUsados.add(sol.id);
          }
        }
      }

      // 2) Match por nome normalizado — auto-mata só se único em ambos os lados
      for (const [k, cs] of cargosByNorm.entries()) {
        const sols = solByNorm.get(k) || [];
        // Filtra os que já foram usados na etapa 1
        const csLivres = cs.filter((c) => !cargosUsados.has(c.id));
        const solsLivres = sols.filter((s) => !solUsados.has(s.id));
        if (csLivres.length === 0 && solsLivres.length === 0) continue;
        if (csLivres.length === 1 && solsLivres.length === 1) {
          const c = csLivres[0];
          const s = solsLivres[0];
          out.push({
            key: `matched_${c.id}_${s.id}`,
            status: "ok",
            cargo: c,
            solides: s,
          });
          cargosUsados.add(c.id);
          solUsados.add(s.id);
        } else if (csLivres.length > 1 || solsLivres.length > 1) {
          // Ambíguo: mostra como linha agrupada (não auto-mata)
          out.push({
            key: `ambig_${k}`,
            status: "ambiguo",
            candidatosPlan: csLivres.length > 0 ? csLivres : undefined,
            candidatosSol: solsLivres.length > 0 ? solsLivres : undefined,
          });
          csLivres.forEach((c) => cargosUsados.add(c.id));
          solsLivres.forEach((s) => solUsados.add(s.id));
        }
      }

      // 3) Sobra dos dois lados
      for (const c of cargosArr) {
        if (!c.ativo) continue;
        if (cargosUsados.has(c.id)) continue;
        out.push({ key: `so_plan_${c.id}`, status: "so_plan", cargo: c });
      }
      for (const s of solList) {
        if (solUsados.has(s.id)) continue;
        out.push({ key: `so_sol_${s.id}`, status: "so_sol", solides: s });
      }

      // Sort
      out.sort((a, b) => {
        const da = statusOrder(a.status);
        const db_ = statusOrder(b.status);
        if (da !== db_) return da - db_;
        const an = a.cargo?.nome || a.solides?.name || "";
        const bn = b.cargo?.nome || b.solides?.name || "";
        return an.localeCompare(bn);
      });
      return out;
    },
    [],
  );

  // Hidrata snapshot do doc /comparacoesCadastros/{rid}_cargos
  useEffect(() => {
    if (!rid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "comparacoesCadastros", `${rid}_cargos`));
        if (cancelled) return;
        if (!snap.exists()) {
          setUltimaAtualizacao(null);
          setAtualizadoPorNome("");
          return;
        }
        const data = snap.data() as ComparacaoCargosDoc;
        setUltimaAtualizacao(data.atualizadoEm || null);
        setAtualizadoPorNome(data.atualizadoPorNome || "");
        // Reconstrói SolidesJobRole[] a partir do snapshot pra alimentar
        // o build local sem precisar bater na Sólides de novo.
        const solReconst: SolidesJobRole[] = [];
        const vistos = new Set<number>();
        for (const r of data.snapshot || []) {
          if (typeof r.solidesId === "number" && !vistos.has(r.solidesId)) {
            solReconst.push({ id: r.solidesId, name: r.solidesNome || "" });
            vistos.add(r.solidesId);
          }
        }
        setSolidesCache(solReconst);
      } catch (e) {
        console.warn("[compatibilidade-cargos] falha ao hidratar:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [rid]);

  // Sempre que cargos ou cache da Sólides mudam, re-renderiza as linhas.
  useEffect(() => {
    if (solidesCache == null) return;
    setLinhas(construirLinhas(cargos, solidesCache));
  }, [cargos, solidesCache, construirLinhas]);

  async function comparar() {
    if (!shortCode) {
      setErro("Restaurante ativo sem shortCode configurado.");
      return;
    }
    setLoading(true);
    setErro("");
    try {
      const sol = await fetchSolidesJobRoles(shortCode);
      const novasLinhas = construirLinhas(cargos, sol);
      setSolidesCache(sol);
      setLinhas(novasLinhas);

      // Auto-grava solidesId nos cargos que casaram (ok por match de nome
      // automático — não sobrescreve solidesId já existente).
      const updates: Array<Promise<void>> = [];
      for (const l of novasLinhas) {
        if (l.status !== "ok") continue;
        if (!l.cargo || !l.solides) continue;
        if (l.cargo.solidesId === l.solides.id) continue;
        updates.push(
          updateDoc(doc(db, "cargos", l.cargo.id), { solidesId: l.solides.id })
            .catch((e) => console.warn("[compatibilidade-cargos] falha ao salvar solidesId:", e)),
        );
      }
      if (updates.length > 0) await Promise.all(updates);

      // Persiste snapshot
      const agora = new Date().toISOString();
      const payload: ComparacaoCargosDoc = {
        rid,
        atualizadoEm: agora,
        atualizadoPor: pessoa?.id || "",
        atualizadoPorNome: pessoa?.nome || "",
        snapshot: novasLinhas.map((l) => ({
          status: l.status,
          cargoId: l.cargo?.id,
          cargoNome: l.cargo?.nome,
          solidesId: l.solides?.id,
          solidesNome: l.solides?.name,
        })),
      };
      try {
        await setDoc(
          doc(db, "comparacoesCadastros", `${rid}_cargos`),
          sanitizeForFirestore(payload),
        );
        setUltimaAtualizacao(agora);
        setAtualizadoPorNome(pessoa?.nome || "");
      } catch (e) {
        console.warn("[compatibilidade-cargos] falha ao persistir doc:", e);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao comparar cargos.");
    } finally {
      setLoading(false);
    }
  }

  const resumo = useMemo(() => {
    if (!linhas) return null;
    const r = { ok: 0, diverge: 0, soPlan: 0, soSol: 0, ambiguo: 0 };
    for (const l of linhas) {
      if (l.status === "ok") r.ok += 1;
      else if (l.status === "diverge") r.diverge += 1;
      else if (l.status === "so_plan") r.soPlan += 1;
      else if (l.status === "so_sol") r.soSol += 1;
      else if (l.status === "ambiguo") r.ambiguo += 1;
    }
    return r;
  }, [linhas]);

  // ── Ações ────────────────────────────────────────────────────────────────

  async function confirmarCriarSolides(c: Cargo) {
    try {
      const created = await createSolidesJobRole({
        restaurantKey: shortCode,
        name: c.nome,
        externalId: c.id,
      });
      await updateDoc(doc(db, "cargos", c.id), { solidesId: created.id });
      // Atualiza cache local da Sólides (insere o novo)
      setSolidesCache((prev) => {
        const base = prev || [];
        if (base.some((s) => s.id === created.id)) return base;
        return [...base, created];
      });
      setModalCriarSolides(null);
    } catch (e) {
      alert("Erro ao criar na Sólides: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function confirmarTrazerPlan(s: SolidesJobRole) {
    if (!pessoa?.id) {
      alert("Sem usuário logado.");
      return;
    }
    try {
      // Cria um novo doc /cargos com defaults razoáveis. Cargo é GLOBAL mas
      // gravamos o rid ativo no restaurantId (mantém compat com leituras
      // existentes que filtram por restaurantId, como CargosTab).
      const novo = {
        restaurantId: rid,
        nome: s.name,
        area: "Salão" as const,                // default; user ajusta depois
        tipoVinculo: "registrado" as const,    // default seguro pra registro
        pontos: 1,
        semGorjeta: false,
        recebeProducao: false,
        ativo: true,
        ordem: 999,
        createdAt: new Date().toISOString(),
        solidesId: s.id,
      };
      await addDoc(collection(db, "cargos"), sanitizeForFirestore(novo));
      setModalTrazerPlan(null);
    } catch (e) {
      alert("Erro ao trazer pro Planejamento: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Cargos</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Compara os cargos cadastrados no Planejamento com os da Sólides. Match automático
              por nome (sem caixa/acento). Bidirecional: master pode criar nos dois lados.
            </p>
          </div>
          <button
            type="button"
            onClick={comparar}
            disabled={loading || !shortCode}
            className="text-[11px] uppercase tracking-wider font-semibold px-3 py-1.5 rounded-full transition-colors bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "⏳ comparando…" : "🔄 Comparar agora"}
          </button>
        </div>

        {erro && (
          <div className="mt-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg px-3 py-2">
            {erro}
          </div>
        )}

        {resumo && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold">
              ✓ {resumo.ok} idêntico(s)
            </span>
            <span className={`px-2.5 py-1 rounded-full font-semibold ${resumo.diverge > 0 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
              ⚠ {resumo.diverge} divergente(s)
            </span>
            <span className={`px-2.5 py-1 rounded-full font-semibold ${resumo.soPlan > 0 ? "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
              → {resumo.soPlan} só Plan
            </span>
            <span className={`px-2.5 py-1 rounded-full font-semibold ${resumo.soSol > 0 ? "bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-700 dark:text-fuchsia-300" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
              ← {resumo.soSol} só Sólides
            </span>
            <span className={`px-2.5 py-1 rounded-full font-semibold ${resumo.ambiguo > 0 ? "bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>
              ? {resumo.ambiguo} ambíguo(s)
            </span>
          </div>
        )}

        {ultimaAtualizacao && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
            Última atualização: <span className="tabular-nums">{fmtBRDateTime(ultimaAtualizacao)}</span>
            {atualizadoPorNome && <> · por {atualizadoPorNome}</>}
          </div>
        )}
      </div>

      {linhas && linhas.length === 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 text-center text-sm text-gray-500">
          Nenhum cargo cadastrado dos dois lados.
        </div>
      )}

      {linhas && linhas.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-600 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Nome Plan</th>
                  <th className="px-3 py-2 text-left font-semibold">ID Plan</th>
                  <th className="px-3 py-2 text-left font-semibold">Nome Sólides</th>
                  <th className="px-3 py-2 text-left font-semibold">ID Sólides</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="text-gray-700 dark:text-gray-300">
                {linhas.map((l) => (
                  <LinhaCargoRow
                    key={l.key}
                    linha={l}
                    isMaster={isMaster}
                    onCriarSolides={() => l.cargo && setModalCriarSolides(l.cargo)}
                    onTrazerPlan={() => l.solides && setModalTrazerPlan(l.solides)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalCriarSolides && (
        <ModalConfirmar
          titulo="↑ Criar cargo na Sólides"
          descricao={
            <>
              Vou criar o cargo <strong>{modalCriarSolides.nome}</strong> na Sólides
              {shortCode ? <> ({shortCode})</> : null}. O id retornado será gravado no
              Planejamento como mapeamento permanente.
            </>
          }
          onClose={() => setModalCriarSolides(null)}
          onConfirm={() => confirmarCriarSolides(modalCriarSolides)}
        />
      )}

      {modalTrazerPlan && (
        <ModalConfirmar
          titulo="↓ Trazer cargo pro Planejamento"
          descricao={
            <>
              Vou criar um novo cargo <strong>{modalTrazerPlan.name}</strong> no Planejamento,
              já vinculado ao id {modalTrazerPlan.id} da Sólides. Você ainda precisa ajustar
              área, pontos de gorjeta e tipo de vínculo depois — esses campos vêm com defaults.
            </>
          }
          onClose={() => setModalTrazerPlan(null)}
          onConfirm={() => confirmarTrazerPlan(modalTrazerPlan)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Linha da tabela
// ────────────────────────────────────────────────────────────────────────────

function LinhaCargoRow({
  linha, isMaster, onCriarSolides, onTrazerPlan,
}: {
  linha: Linha;
  isMaster: boolean;
  onCriarSolides: () => void;
  onTrazerPlan: () => void;
}) {
  const { status, cargo, solides, candidatosPlan, candidatosSol } = linha;
  const trClass = status === "ok"
    ? ""
    : status === "diverge"
      ? "bg-amber-50/40 dark:bg-amber-900/10"
      : status === "so_plan"
        ? "bg-sky-50/40 dark:bg-sky-900/10"
        : status === "so_sol"
          ? "bg-fuchsia-50/40 dark:bg-fuchsia-900/10"
          : "bg-orange-50/40 dark:bg-orange-900/10";

  // Ambíguo: lista os candidatos
  if (status === "ambiguo") {
    return (
      <tr className={`border-t border-gray-100 dark:border-gray-800/60 ${trClass}`}>
        <td className="px-3 py-2" colSpan={2}>
          {candidatosPlan && candidatosPlan.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {candidatosPlan.map((c) => (
                <span key={c.id}>{c.nome} <span className="text-gray-400 text-[10px]">({c.id})</span></span>
              ))}
            </div>
          ) : <span className="text-gray-400">—</span>}
        </td>
        <td className="px-3 py-2" colSpan={2}>
          {candidatosSol && candidatosSol.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {candidatosSol.map((s) => (
                <span key={s.id}>{s.name} <span className="text-gray-400 text-[10px]">({s.id})</span></span>
              ))}
            </div>
          ) : <span className="text-gray-400">—</span>}
        </td>
        <td className="px-3 py-2">
          <span className="px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 font-semibold">? ambíguo</span>
        </td>
        <td className="px-3 py-2 text-gray-400 italic text-[11px]">resolver manualmente</td>
      </tr>
    );
  }

  return (
    <tr className={`border-t border-gray-100 dark:border-gray-800/60 ${trClass}`}>
      <td className="px-3 py-2">{cargo?.nome ?? <span className="text-gray-400">—</span>}</td>
      <td className="px-3 py-2 tabular-nums text-[10px] text-gray-500 dark:text-gray-400">
        {cargo?.id ?? "—"}
      </td>
      <td className="px-3 py-2">{solides?.name ?? <span className="text-gray-400">—</span>}</td>
      <td className="px-3 py-2 tabular-nums text-[10px] text-gray-500 dark:text-gray-400">
        {solides?.id ?? "—"}
      </td>
      <td className="px-3 py-2">
        {status === "ok" && (
          <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold">✓ idêntico</span>
        )}
        {status === "diverge" && (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-semibold">⚠ nomes diferentes</span>
        )}
        {status === "so_plan" && (
          <span className="px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 font-semibold">→ só Plan</span>
        )}
        {status === "so_sol" && (
          <span className="px-2 py-0.5 rounded-full bg-fuchsia-100 dark:bg-fuchsia-900/40 text-fuchsia-700 dark:text-fuchsia-300 font-semibold">← só Sólides</span>
        )}
      </td>
      <td className="px-3 py-2">
        {isMaster && status === "so_plan" && (
          <button
            type="button"
            onClick={onCriarSolides}
            className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
          >
            ↑ Criar na Sólides
          </button>
        )}
        {isMaster && status === "so_sol" && (
          <button
            type="button"
            onClick={onTrazerPlan}
            className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
          >
            ↓ Trazer pro Plan
          </button>
        )}
      </td>
    </tr>
  );
}

// ────────────────────────────────────────────────────────────────────────────
//  Modal de confirmação genérico
// ────────────────────────────────────────────────────────────────────────────

function ModalConfirmar({
  titulo, descricao, onClose, onConfirm,
}: {
  titulo: string;
  descricao: React.ReactNode;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    setSalvando(true);
    try {
      await onConfirm();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{titulo}</h2>
        </header>
        <div className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300">
          {descricao}
        </div>
        <footer className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="text-xs font-semibold px-3 py-1.5 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={salvando}
            className="text-xs font-semibold uppercase tracking-wider px-4 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {salvando ? "Confirmando…" : "Confirmar"}
          </button>
        </footer>
      </div>
    </div>
  );
}
