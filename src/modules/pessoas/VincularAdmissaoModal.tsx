// ════════════════════════════════════════════════════════════════════════════
//  Modal — Vincular pessoa de admissão
//
//  Aberto pelo botão na tela de Pessoas. Lista as admissões DESTE restaurante
//  que ainda NÃO viraram cadastro (sem pessoaIdCriada) e não estão canceladas/
//  expiradas. "Vincular" chama aprovarAdmissao → cria a Pessoa + o Empregado
//  (com cargo, horários e dados preenchidos na admissão). Idempotente.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { aprovarAdmissao } from "../../core/admissao/admissaoHelpers";
import type { Admissao, Cargo } from "../../core/types";

const STATUS_LABEL: Record<string, string> = {
  a_admitir: "Dados básicos",
  formulario_enviado: "Aguardando preenchimento",
  formulario_preenchido: "Exames / conta / dados",
  solicitacao_contabilidade: "Contabilidade & contratos",
  pronto_admissao: "Pronto pra admitir",
  admitido: "Admitido (onboarding)",
};

type Props = { restaurantId: string; onClose: () => void };

export function VincularAdmissaoModal({ restaurantId, onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [admissoes, setAdmissoes] = useState<Admissao[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [vinculandoId, setVinculandoId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    const q1 = query(collection(db, "admissoes"), where("restaurantId", "==", restaurantId));
    const u1 = onSnapshot(q1, (snap) => {
      setAdmissoes(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Admissao));
      setLoading(false);
    });
    const q2 = query(collection(db, "cargos"), where("restaurantId", "==", restaurantId));
    const u2 = onSnapshot(q2, (snap) => {
      setCargos(snap.docs.map(d => ({ ...d.data(), id: d.id }) as Cargo));
    });
    return () => { u1(); u2(); };
  }, [restaurantId]);

  // Admissões prontas pra virar Pessoa+Empregado: ainda não criadas e não
  // canceladas/expiradas.
  const pendentes = useMemo(
    () => admissoes
      .filter(a => !a.pessoaIdCriada && a.status !== "cancelada" && a.status !== "expirada")
      .sort((a, b) => (a.candidato.nome || "").localeCompare(b.candidato.nome || "")),
    [admissoes],
  );

  function cargoNome(id: string): string {
    return cargos.find(c => c.id === id)?.nome || "—";
  }

  async function vincular(adm: Admissao) {
    if (!me) return;
    const ok = confirm(
      `Criar o registro definitivo de ${adm.candidato.nome}?\n\n` +
      `${adm.pessoaIdVinculada ? "• Vincular à Pessoa já existente" : "• Criar nova Pessoa"}\n` +
      `• Criar Empregado · cargo "${cargoNome(adm.cargoId)}"\n` +
      `• Horários e dados preenchidos na admissão são aplicados.\n\n` +
      `Continuar?`,
    );
    if (!ok) return;
    setErro("");
    setMsg("");
    setVinculandoId(adm.id);
    try {
      await aprovarAdmissao(adm, me);
      setMsg(`✓ ${adm.candidato.nome} criado(a) em Pessoas.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao vincular.");
    } finally {
      setVinculandoId(null);
    }
  }

  return (
    <Modal title="📥 Vincular pessoa de admissão" onClose={onClose} maxWidth="max-w-lg">
      <div className="p-4 space-y-3">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Admissões em andamento que ainda não viraram cadastro. "Vincular" cria a
          Pessoa + o Empregado (com cargo, horários e dados preenchidos na admissão).
        </p>
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Carregando…</div>
        ) : pendentes.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
            Nenhuma admissão pendente de vínculo. 🎉
          </div>
        ) : (
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {pendentes.map(adm => (
              <div
                key={adm.id}
                className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {adm.candidato.nome}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {cargoNome(adm.cargoId)} · {STATUS_LABEL[adm.status] || adm.status}
                    {adm.pessoaIdVinculada ? " · 🔗 Pessoa existente" : ""}
                  </div>
                </div>
                <Button size="sm" onClick={() => vincular(adm)} disabled={vinculandoId !== null}>
                  {vinculandoId === adm.id ? "Vinculando…" : "Vincular"}
                </Button>
              </div>
            ))}
          </div>
        )}
        {msg && <div className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</div>}
        {erro && <div className="text-xs text-rose-600 dark:text-rose-400">{erro}</div>}
      </div>
    </Modal>
  );
}
