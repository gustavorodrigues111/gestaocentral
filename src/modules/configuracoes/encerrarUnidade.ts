// Encerramento de unidade COM DATA DE CORTE (último dia de funcionamento).
// Histórico ATÉ a data fica intacto (tagueado com a unidade encerrada). A
// partir do dia seguinte, tudo daquela unidade é migrado pra unidade-destino:
//   - empregados com unidadePadraoId = unidade encerrada → destino (sempre;
//     é o vínculo "atual" da pessoa, não tem recorte de data)
//   - freelaShifts com date > corte → unidadeId = destino
//   - gorjetas com date > corte → unidadeId = destino
//   - escala: unidadesReais/unidadesPrevistas, células com date > corte → destino
//
// Datas YYYY-MM-DD comparam lexicograficamente, então `date > corte` funciona.
import {
  collection, doc, getDocs, query, where, writeBatch,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Empregado, EscalaMes, FreelaShift, Gorjeta } from "../../core/types";

export type ImpactoEncerramento = {
  empregados: { id: string; nome: string }[];
  turnos: number;
  gorjetas: number;
  escalaCelulas: number;
};

type Dados = {
  empregados: Empregado[];
  shifts: FreelaShift[];
  gorjetas: Gorjeta[];
  escalas: EscalaMes[];
};

async function carregar(rid: string): Promise<Dados> {
  const [empSnap, shSnap, goSnap, esSnap] = await Promise.all([
    getDocs(query(collection(db, "empregados"), where("restaurantId", "==", rid))),
    getDocs(query(collection(db, "freelaShifts"), where("restaurantId", "==", rid))),
    getDocs(query(collection(db, "gorjetas"), where("restaurantId", "==", rid))),
    getDocs(query(collection(db, "escalas"), where("restaurantId", "==", rid))),
  ]);
  return {
    empregados: empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Empregado)),
    shifts: shSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FreelaShift)),
    gorjetas: goSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Gorjeta)),
    escalas: esSnap.docs.map((d) => ({ id: d.id, ...d.data() } as EscalaMes)),
  };
}

// Conta células de escala (unidadesReais + unidadesPrevistas) com date > corte
// apontando pra unidade encerrada.
function contarEscalaCelulas(e: EscalaMes, unitId: string, corte: string): number {
  let n = 0;
  for (const mapa of [e.unidadesReais, e.unidadesPrevistas]) {
    if (!mapa) continue;
    for (const porData of Object.values(mapa)) {
      for (const [date, uid] of Object.entries(porData || {})) {
        if (uid === unitId && date > corte) n++;
      }
    }
  }
  return n;
}

export async function contarImpacto(rid: string, unitId: string, corte: string): Promise<ImpactoEncerramento> {
  const { empregados, shifts, gorjetas, escalas } = await carregar(rid);
  return {
    empregados: empregados.filter((e) => e.unidadePadraoId === unitId).map((e) => ({ id: e.id, nome: e.nome })),
    turnos: shifts.filter((s) => (s.unidadeId || null) === unitId && (s.date || "") > corte).length,
    gorjetas: gorjetas.filter((g) => (g.unidadeId || null) === unitId && (g.date || "") > corte).length,
    escalaCelulas: escalas.reduce((acc, e) => acc + contarEscalaCelulas(e, unitId, corte), 0),
  };
}

// Aplica o encerramento. Escreve em lotes de até 400 ops. NÃO mexe no doc do
// restaurante (o chamador persiste as unidades com encerradaEm/ativa).
export async function aplicarEncerramento(
  rid: string, unitId: string, corte: string, destinoId: string,
): Promise<ImpactoEncerramento> {
  const { empregados, shifts, gorjetas, escalas } = await carregar(rid);

  const empAlvo = empregados.filter((e) => e.unidadePadraoId === unitId);
  const shAlvo = shifts.filter((s) => (s.unidadeId || null) === unitId && (s.date || "") > corte);
  const goAlvo = gorjetas.filter((g) => (g.unidadeId || null) === unitId && (g.date || "") > corte);
  const esAlvo = escalas.filter((e) => contarEscalaCelulas(e, unitId, corte) > 0);

  // Monta as operações.
  type Op = { ref: ReturnType<typeof doc>; data: Record<string, unknown> };
  const ops: Op[] = [];
  const now = new Date().toISOString();

  for (const e of empAlvo) ops.push({ ref: doc(db, "empregados", e.id), data: { unidadePadraoId: destinoId, updatedAt: now } });
  for (const s of shAlvo) ops.push({ ref: doc(db, "freelaShifts", s.id), data: { unidadeId: destinoId, updatedAt: now } });
  for (const g of goAlvo) ops.push({ ref: doc(db, "gorjetas", g.id), data: { unidadeId: destinoId } });

  // Escala: reescreve os mapas inteiros (mais seguro que field-paths com pontos
  // em ids de data). Só as células com date > corte apontando pra unidade saem.
  for (const e of esAlvo) {
    const remap = (mapa?: EscalaMes["unidadesReais"]) => {
      if (!mapa) return undefined;
      const out: NonNullable<EscalaMes["unidadesReais"]> = {};
      for (const [empId, porData] of Object.entries(mapa)) {
        out[empId] = {};
        for (const [date, uid] of Object.entries(porData || {})) {
          out[empId][date] = uid === unitId && date > corte ? destinoId : uid;
        }
      }
      return out;
    };
    const data: Record<string, unknown> = { updatedAt: now };
    const nr = remap(e.unidadesReais);
    const np = remap(e.unidadesPrevistas);
    if (nr) data.unidadesReais = nr;
    if (np) data.unidadesPrevistas = np;
    ops.push({ ref: doc(db, "escalas", e.id), data });
  }

  // Commit em lotes de 400.
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) batch.update(op.ref, op.data);
    await batch.commit();
  }

  return {
    empregados: empAlvo.map((e) => ({ id: e.id, nome: e.nome })),
    turnos: shAlvo.length,
    gorjetas: goAlvo.length,
    escalaCelulas: esAlvo.reduce((acc, e) => acc + contarEscalaCelulas(e, unitId, corte), 0),
  };
}
