import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { logAudit } from "../../core/audit/versionedChange";
import { fmtAnoMes, nomeMes, pad2 } from "../../core/utils/date";
import type { EscalaMes, EscalaSnapshot, Gorjeta, VTFolha } from "../../core/types";

type Props = {
  rid: string;
  ano: number;
  mes: number;
  escala: EscalaMes | null;
  onClose: () => void;
};

export function FecharMesModal({ rid, ano, mes, escala, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Validações pré-fechamento — busca contagens
  const [stats, setStats] = useState<{
    gorjetasTotal: number;
    gorjetasNaoPagas: number;
    vtPago: boolean;
    diasComReal: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const inicio = `${ano}-${pad2(mes)}-01`;
        const fim = `${ano}-${pad2(mes)}-31`;
        const qG = query(
          collection(db, "gorjetas"),
          where("restaurantId", "==", rid),
        );
        const snapG = await getDocs(qG);
        const gorjetasMes = snapG.docs
          .map(d => ({ id: d.id, ...d.data() }) as Gorjeta)
          .filter(g => g.date >= inicio && g.date <= fim);
        const gorjetasNaoPagas = gorjetasMes.filter(g => !g.paidAt).length;

        const vtRef = await getDocs(query(
          collection(db, "vtFolhas"),
          where("restaurantId", "==", rid),
        ));
        const folha = vtRef.docs
          .map(d => ({ id: d.id, ...d.data() }) as VTFolha)
          .find(f => f.ano === ano && f.mes === mes);
        const vtPago = !!folha && Object.values(folha.itens || {}).every(i => !!i.paidAt);

        const diasComReal = Object.values(escala?.real || {})
          .reduce((s, byEmp) => s + Object.keys(byEmp).length, 0);

        if (!alive) return;
        setStats({
          gorjetasTotal: gorjetasMes.length,
          gorjetasNaoPagas,
          vtPago,
          diasComReal,
        });
      } catch (e) {
        console.error(e);
      }
    })();
    return () => { alive = false; };
  }, [rid, ano, mes, escala]);

  const podeFechar = useMemo(() => stats !== null, [stats]);
  const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;

  async function fechar() {
    if (!me) return;
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const snapshot: EscalaSnapshot = {
        snapshotEm: now,
        motivo: "fechamento",
        motivoTexto: motivo.trim() || undefined,
        prevista: escala?.prevista || {},
        real: escala?.real || {},
        vtPagoEm: escala?.vtPagoEm ?? null,
        fechadoEm: null,            // ainda não fechado nessa snapshot
        fechadoPor: null,
        registradoPor: me.id,
      };
      const versoes = [...(escala?.versoesAnteriores || []), snapshot];

      await updateDoc(doc(db, "escalas", escalaId), sanitizeForFirestore({
        fechadoEm: now,
        fechadoPor: me.id,
        fechadoMotivo: motivo.trim() || undefined,
        reabertoEm: null,
        reabertoPor: null,
        reabertoMotivo: null,
        versoesAnteriores: versoes,
        updatedAt: now,
      }));

      await logAudit({
        entityType: "restaurant",
        entityId: rid,
        restaurantId: rid,
        acao: "alterado",
        diff: { fechadoEm: { antes: null, depois: now } },
        motivo: motivo.trim() || `Fechamento ${nomeMes(mes)}/${ano}`,
        registradoPor: me.id,
      });
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`🔒 Fechar ${nomeMes(mes)} ${ano}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
          ⚠ Ao fechar:
          <ul className="list-disc ml-5 mt-1 text-xs space-y-0.5">
            <li>Escala (Prevista e Real) fica <strong>read-only</strong></li>
            <li>Gorjetas não podem mais ser editadas</li>
            <li>Snapshot do estado vira histórico permanente</li>
            <li>Pra reverter, precisa de permissão <code>escalaReabrir</code></li>
          </ul>
        </div>

        {!stats ? (
          <div className="text-sm text-gray-500">Carregando dados do mês...</div>
        ) : (
          <div className="space-y-2">
            <Check
              ok={stats.diasComReal > 0}
              label={`Real preenchida em ${stats.diasComReal} célula(s)`}
              hint="Ideal ter pelo menos algumas células preenchidas. Sem dados na Real, gorjetas usam a Prevista."
            />
            <Check
              ok={stats.gorjetasTotal > 0}
              label={`${stats.gorjetasTotal} gorjeta(s) lançada(s)`}
              hint={stats.gorjetasTotal === 0 ? "Mês sem gorjeta — confirma se está certo" : undefined}
            />
            {stats.gorjetasTotal > 0 && (
              <Check
                ok={stats.gorjetasNaoPagas === 0}
                label={stats.gorjetasNaoPagas === 0
                  ? "Todas as gorjetas pagas"
                  : `${stats.gorjetasNaoPagas} gorjeta(s) NÃO pagas`}
                hint={stats.gorjetasNaoPagas > 0 ? "Recomendo pagar antes de fechar — congela snapshot da divisão" : undefined}
              />
            )}
            <Check
              ok={stats.vtPago}
              label={stats.vtPago ? "VT pago" : "VT pendente"}
              hint={!stats.vtPago ? "Se VT ainda não foi pago, divergências não vão refletir" : undefined}
            />
          </div>
        )}

        <Input
          label="Motivo / observação (opcional)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="ex: fechamento mensal padrão"
        />

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={fechar} disabled={!podeFechar || saving}>
            {saving ? "Fechando..." : "🔒 Confirmar fechamento"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal de reabertura ─────────────────────────────────────────────────────

export function ReabrirMesModal({ rid, ano, mes, escala, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const escalaId = `${rid}_${fmtAnoMes(ano, mes)}`;

  async function reabrir() {
    if (!me) return;
    if (!motivo.trim()) { setErr("Motivo obrigatório pra reabrir"); return; }
    setErr("");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const snapshot: EscalaSnapshot = {
        snapshotEm: now,
        motivo: "reabertura",
        motivoTexto: motivo.trim(),
        prevista: escala?.prevista || {},
        real: escala?.real || {},
        vtPagoEm: escala?.vtPagoEm ?? null,
        fechadoEm: escala?.fechadoEm ?? null,
        fechadoPor: escala?.fechadoPor ?? null,
        registradoPor: me.id,
      };
      const versoes = [...(escala?.versoesAnteriores || []), snapshot];

      await updateDoc(doc(db, "escalas", escalaId), sanitizeForFirestore({
        fechadoEm: null,
        fechadoPor: null,
        reabertoEm: now,
        reabertoPor: me.id,
        reabertoMotivo: motivo.trim(),
        versoesAnteriores: versoes,
        updatedAt: now,
      }));

      await logAudit({
        entityType: "restaurant",
        entityId: rid,
        restaurantId: rid,
        acao: "alterado",
        diff: { fechadoEm: { antes: escala?.fechadoEm, depois: null } },
        motivo: `Reabertura: ${motivo.trim()}`,
        registradoPor: me.id,
      });
      onClose();
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`🔓 Reabrir ${nomeMes(mes)} ${ano}`} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 p-3 text-sm text-rose-800 dark:text-rose-300">
          ⚠ Reabrir mês fechado é uma <strong>ação excepcional</strong>. Tudo que registrar a partir
          daqui pode afetar gorjetas, VT, divergências. O snapshot do estado fechado vai pro histórico.
        </div>

        <Input
          label="Motivo da reabertura *"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="ex: ajuste retroativo de gorjeta erroneamente lançada"
        />

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={reabrir} disabled={saving || !motivo.trim()}>
            {saving ? "Reabrindo..." : "🔓 Confirmar reabertura"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`text-base flex-shrink-0 ${ok ? "text-emerald-600" : "text-amber-600"}`}>
        {ok ? "✓" : "⚠"}
      </span>
      <div className="flex-1">
        <div className={ok ? "text-gray-700 dark:text-gray-300" : "text-amber-800 dark:text-amber-300"}>
          {label}
        </div>
        {hint && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}
