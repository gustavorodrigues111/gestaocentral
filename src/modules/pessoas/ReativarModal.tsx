import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Input } from "../../core/ui/Input";
import { Button } from "../../core/ui/Button";
import { logAudit } from "../../core/audit/versionedChange";
import type { Empregado, Pessoa, Restaurant } from "../../core/types";

type Props = {
  pessoa: Pessoa;
  onClose: () => void;
};

export function ReativarModal({ pessoa, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [form, setForm] = useState({
    nome: pessoa.nome || "",
    email: pessoa.email || "",
    cpf: pessoa.cpf || "",
    whatsapp: pessoa.whatsapp || "",
  });
  // Lista de restaurantes em que a Pessoa tem Empregado demitido — pra
  // poder oferecer remover do `restaurantIds` no momento da reativação.
  const [vinculosDemitidos, setVinculosDemitidos] = useState<{
    restaurantId: string;
    nomeRest: string;
    empregadoId: string;
    demitidoEm: string | null | undefined;
  }[]>([]);
  const [limparVinculosDemitidos, setLimparVinculosDemitidos] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Carrega Empregados demitidos da Pessoa + nomes dos restaurantes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const empQ = query(collection(db, "empregados"), where("pessoaId", "==", pessoa.id));
        const empSnap = await getDocs(empQ);
        const empregados = empSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Empregado));
        const demitidos = empregados.filter((e) => !e.estaAtivo);
        if (demitidos.length === 0) {
          if (!cancelled) setVinculosDemitidos([]);
          return;
        }
        // Busca nome dos restaurantes envolvidos
        const ridsUnicos = Array.from(new Set(demitidos.map((e) => e.restaurantId)));
        const nomesPorRid: Record<string, string> = {};
        await Promise.all(ridsUnicos.map(async (rid) => {
          const snap = await getDoc(doc(db, "restaurants", rid));
          const r = snap.exists() ? (snap.data() as Restaurant) : null;
          nomesPorRid[rid] = r?.nome || rid;
        }));
        if (cancelled) return;
        setVinculosDemitidos(demitidos.map((e) => ({
          restaurantId: e.restaurantId,
          nomeRest: nomesPorRid[e.restaurantId] || e.restaurantId,
          empregadoId: e.id,
          demitidoEm: e.demitidoEm,
        })));
      } catch (e) {
        console.error("Erro ao carregar vínculos demitidos", e);
      }
    })();
    return () => { cancelled = true; };
  }, [pessoa.id]);

  async function reativar() {
    if (!me) return;
    if (!form.nome.trim()) { setErr("Nome obrigatório"); return; }
    setErr("");
    setSaving(true);
    try {
      // Calcula novo restaurantIds: se "limpar vínculos demitidos" está ligado,
      // remove os rids onde só tem empregado inativo. Mantém os outros.
      const ridsParaRemover = limparVinculosDemitidos
        ? new Set(vinculosDemitidos.map((v) => v.restaurantId))
        : new Set<string>();
      const novosRids = (pessoa.restaurantIds || []).filter((rid) => !ridsParaRemover.has(rid));

      await updateDoc(doc(db, "pessoas", pessoa.id), {
        ativa: true,
        inativadaEm: null,
        inativadaPor: null,
        motivoInativacao: null,
        nome: form.nome.trim(),
        email: form.email.trim().toLowerCase(),
        cpf: form.cpf.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        restaurantIds: novosRids,
      });
      await logAudit({
        entityType: "pessoa",
        entityId: pessoa.id,
        acao: "reativado",
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
    <Modal title={`Reativar — ${pessoa.nome}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-800 dark:text-emerald-300">
          ✓ Reativar restaura o acesso da pessoa ao sistema.
          <p className="text-xs mt-1 opacity-80">
            Empregados vinculados continuam DEMITIDOS — pra readmitir como equipe num restaurante,
            edita a aba Vínculos depois (vai criar novo período preservando o histórico).
          </p>
        </div>

        <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
          Confirme/atualize os dados
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Nome completo *"
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            autoFocus
          />
          <Input
            label="Email (login)"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            label="CPF"
            value={form.cpf}
            onChange={(e) => setForm({ ...form, cpf: e.target.value })}
          />
          <Input
            label="WhatsApp"
            value={form.whatsapp}
            onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          />
        </div>

        {pessoa.motivoInativacao && (
          <div className="text-[11px] text-gray-500 dark:text-gray-400 italic">
            Motivo da inativação anterior: <strong>{pessoa.motivoInativacao}</strong>
          </div>
        )}

        {vinculosDemitidos.length > 0 && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={limparVinculosDemitidos}
                onChange={(e) => setLimparVinculosDemitidos(e.target.checked)}
                className="mt-0.5 accent-emerald-600"
              />
              <div className="text-xs text-amber-900 dark:text-amber-300">
                <strong>Limpar vínculos com empresas onde foi demitida</strong>
                <p className="text-[11px] opacity-80 mt-0.5">
                  Remove essas empresas de <code>pessoa.restaurantIds</code>. O Empregado
                  demitido fica preservado no histórico daquela empresa, mas a Pessoa
                  deixa de aparecer como vinculada. Útil quando ela vai pra outra
                  empresa do grupo e você não quer arrastar o vínculo antigo.
                </p>
              </div>
            </label>
            <div className="text-[11px] text-amber-900/80 dark:text-amber-300/80 pl-5">
              {limparVinculosDemitidos ? "Vai desvincular" : "Vai manter"}:{" "}
              {vinculosDemitidos.map((v, i) => (
                <span key={v.restaurantId}>
                  {i > 0 ? ", " : ""}
                  <strong>{v.nomeRest}</strong>
                  {v.demitidoEm && (
                    <span className="opacity-70"> (demitida em {v.demitidoEm.split("-").reverse().join("/")})</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={reativar} disabled={saving}>{saving ? "..." : "Reativar"}</Button>
        </div>
      </div>
    </Modal>
  );
}
