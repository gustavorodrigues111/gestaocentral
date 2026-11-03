// PainelColunas — a tela do Painel do Salão (apresentação pura). Recebe os dados
// já normalizados (via props) e cuida de tudo que é relativo ao RELÓGIO (delta
// das reservas, atraso dos checklists, "somem 2h depois") + o controle da MÚSICA
// (direto no /api/spotify-control, só isso é interativo). As ações caem num
// "portão" pedindo login pessoal. Usado por duas fontes de dados:
//   - PainelSalaoPage  → navegador autenticado, lê Firestore ao vivo
//   - PainelEstacaoPage → estação de parede, lê do feed do servidor (token)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Music, Play, Pause, SkipForward, SkipBack, Volume2, MessageSquare, CheckSquare, Utensils, ChefHat, Lock, Users, Clock } from "lucide-react";

export type PReserva = { id: string; horario?: string; status?: string; nome?: string; pessoas?: number; mesas?: string };
export type PFreelaAberto = { id: string; nome?: string; area?: string; entrada?: string };
export type PFreelaProg = { id: string; nome?: string; area?: string; entradaPrevista?: string; saidaPrevista?: string };
export type PChecklist = { id: string; nome?: string; turno?: string; area?: string; hora?: string; pct: number; completo: boolean };
export type PWaConv = { key: string; nome?: string; naoLidas: number; preview?: string };
export type PainelData = {
  nome: string;
  reservas: PReserva[];
  freelasAbertos: PFreelaAberto[];
  freelasProgramados: PFreelaProg[];
  checklists: PChecklist[];
  wa: { list: PWaConv[]; total: number };
};

async function ctrl(rid: string, action: string, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch("/api/spotify-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rid, action, ...extra }) });
  return r.json().catch(() => ({ ok: false }));
}
const fmtTime = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const hhmmToMin = (s?: string): number => { if (!s) return -1; const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const RESERVA_COR: Record<string, string> = { confirmada: "#1db954", pendente: "#e3a63c", chegou: "#4b9bf0" };
const TURNO_LABEL: Record<string, string> = { abertura: "Abertura", meio: "Meio", fechamento: "Fechamento" };

export function PainelColunas({ rid, data, atualizadoEm }: { rid: string; data: PainelData; atualizadoEm?: Date }) {
  const [agora, setAgora] = useState(new Date());
  const [gate, setGate] = useState(false);
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 15000); return () => clearInterval(t); }, []);

  // ── Música (ao vivo, interativa) ──
  const [player, setPlayer] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [vol, setVol] = useState(50);
  const [progress, setProgress] = useState(0);
  const volRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const faixa = player?.item;
  const tocando = !!player?.is_playing;
  const devAtivo = useMemo(() => devices.find((d) => d.is_active) || null, [devices]);
  const alvo = () => (devAtivo?.id || devices[0]?.id || "");
  const carregarMusica = useCallback(async () => {
    const [st, dv] = await Promise.all([ctrl(rid, "state"), ctrl(rid, "devices")]);
    setPlayer(st?.player || null);
    setProgress(Number(st?.player?.progress_ms) || 0);
    const devs = Array.isArray(dv?.devices) ? dv.devices : [];
    setDevices(devs);
    const a = devs.find((d: any) => d.is_active);
    if (a && typeof a.volume_percent === "number") setVol(a.volume_percent);
  }, [rid]);
  useEffect(() => { void carregarMusica(); const t = setInterval(() => void carregarMusica(), 8000); return () => clearInterval(t); }, [carregarMusica]);
  useEffect(() => { if (!tocando) return; const dur = Number(faixa?.duration_ms) || 0; const t = setInterval(() => setProgress((p) => (dur && p + 1000 > dur ? dur : p + 1000)), 1000); return () => clearInterval(t); }, [tocando, faixa?.duration_ms]);
  async function mus(action: string, extra: Record<string, unknown> = {}) { await ctrl(rid, action, extra); setTimeout(() => void carregarMusica(), 400); }

  // ── Relativos ao relógio ──
  const nowMin = agora.getHours() * 60 + agora.getMinutes();
  const reservasView = useMemo(() => data.reservas
    .map((r) => { const min = hhmmToMin(r.horario); return { ...r, _min: min, _delta: min - nowMin }; })
    .filter((r) => r._delta > -120) // somem 2h após o horário
    .sort((a, b) => a._min - b._min), [data.reservas, nowMin]);
  const checklistsView = useMemo(() => data.checklists.map((c) => {
    const refMin = hhmmToMin(c.hora);
    const atrasado = !c.completo && refMin >= 0 && nowMin > refMin;
    return { ...c, atrasado };
  }), [data.checklists, nowMin]);
  const chkCompletos = checklistsView.filter((c) => c.completo).length;

  const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const mes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const hora = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
  function relReserva(r: { status?: string; _delta: number }): { t: string; c: string } {
    if (r.status === "chegou") return { t: "chegou", c: "#4b9bf0" };
    const d = r._delta;
    if (d <= 0) return { t: "agora", c: "#e3a63c" };
    if (d < 60) return { t: `em ${d}min`, c: "#9aa3b2" };
    const h = Math.floor(d / 60), m = d % 60;
    return { t: `em ${h}h${m ? " " + m + "min" : ""}`, c: "#9aa3b2" };
  }

  const Kpi = ({ ic, cor, v, l }: { ic: React.ReactNode; cor: string; v: string; l: string }) => (
    <div className="flex items-center gap-2.5 rounded-2xl border border-[#2a2f39] bg-[#1b1e25] px-3 py-2">
      <div className="w-8 h-8 rounded-lg grid place-items-center" style={{ background: cor + "22", color: cor }}>{ic}</div>
      <div><div className="font-extrabold text-lg leading-none tabular-nums">{v}</div><div className="text-[10px] uppercase tracking-wide text-[#9aa3b2] font-semibold mt-0.5">{l}</div></div>
    </div>
  );
  const ColHead = ({ ic, cor, title, tag }: { ic: React.ReactNode; cor: string; title: string; tag?: string }) => (
    <div className="flex items-center gap-2.5">
      <div className="w-7 h-7 rounded-lg grid place-items-center" style={{ background: cor + "22", color: cor }}>{ic}</div>
      <h2 className="font-extrabold text-[15px] flex-1">{title}</h2>
      {tag && <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: cor + "22", color: cor }}>{tag}</span>}
    </div>
  );
  const Vazio = ({ txt }: { txt: string }) => <div className="flex-1 grid place-items-center text-center text-sm px-3" style={{ color: "#5c6373" }}>{txt}</div>;
  const col = "bg-[#15171c] border border-[#222730] rounded-2xl p-3.5 flex flex-col gap-3 min-w-0 overflow-hidden";
  const listCls = "flex-1 flex flex-col gap-2 overflow-auto -mr-1 pr-1";

  return (
    <div className="fixed inset-0 z-50 bg-[#121317] text-[#eef1f5] overflow-auto" style={{ fontFamily: "system-ui, sans-serif" }}>
      <div className="min-h-full flex flex-col gap-3 p-4">
        {/* Status */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl grid place-items-center font-extrabold text-[#1a1205]" style={{ background: "linear-gradient(135deg,#e3a63c,#b9792a)" }}>{(data.nome || "R")[0]}</div>
            <div><div className="font-extrabold text-lg leading-none">{data.nome || "Restaurante"} · Salão</div><div className="text-[11px] text-[#9aa3b2]">Painel operacional{atualizadoEm ? ` · atualizado ${String(atualizadoEm.getHours()).padStart(2, "0")}:${String(atualizadoEm.getMinutes()).padStart(2, "0")}` : ""}</div></div>
          </div>
          <div className="flex gap-2 flex-wrap ml-auto items-center">
            <Kpi ic={<MessageSquare size={15} />} cor="#25d366" v={String(data.wa.total)} l="a responder" />
            <Kpi ic={<CheckSquare size={15} />} cor="#e3a63c" v={`${chkCompletos}/${checklistsView.length}`} l="Checklists" />
            <Kpi ic={<Utensils size={15} />} cor="#e3a63c" v={String(reservasView.length)} l="Reservas" />
            <Kpi ic={<ChefHat size={15} />} cor="#4b9bf0" v={String(data.freelasAbertos.length)} l="Turnos abertos" />
            <div className="text-right pl-1"><div className="font-extrabold text-2xl tabular-nums leading-none">{hora}</div><div className="text-[11px] text-[#9aa3b2] capitalize">{dias[agora.getDay()].slice(0, 3)}, {agora.getDate()} {mes[agora.getMonth()]}</div></div>
          </div>
        </div>

        {/* Colunas */}
        <div className="grid gap-3 flex-1 min-h-0" style={{ gridTemplateColumns: "1.15fr 1fr 1fr 1fr 1fr" }}>
          {/* MÚSICA */}
          <div className={col}>
            <ColHead ic={<Music size={15} />} cor="#1db954" title="Música Ambiente" tag={devAtivo ? "● No ar" : "parado"} />
            <div className="flex gap-3">
              <div className="w-28 h-28 shrink-0 rounded-xl overflow-hidden bg-[#20242c] grid place-items-center text-[#6f7889]">
                {faixa?.album?.images?.[0]?.url ? <img src={faixa.album.images[0].url} alt="" className="w-full h-full object-cover" /> : <Music size={34} />}
              </div>
              <div className="min-w-0 flex flex-col justify-center">
                <div className="font-extrabold text-[17px] leading-tight line-clamp-2">{faixa?.name || "Nada tocando"}</div>
                <div className="text-[13px] text-[#9aa3b2] truncate">{(faixa?.artists || []).map((a: any) => a.name).join(", ") || (devAtivo ? devAtivo.name : "—")}</div>
              </div>
            </div>
            <div>
              <div className="h-1.5 rounded bg-[#2b3038] overflow-hidden"><div className="h-full bg-[#1db954] rounded" style={{ width: `${faixa?.duration_ms ? Math.min(100, progress / faixa.duration_ms * 100) : 0}%` }} /></div>
              <div className="flex justify-between text-[10.5px] text-[#6f7889] tabular-nums mt-1"><span>{fmtTime(progress)}</span><span>{fmtTime(Number(faixa?.duration_ms) || 0)}</span></div>
            </div>
            <div className="flex items-center justify-center gap-3">
              <button className="w-9 h-9 grid place-items-center rounded-full border border-[#2a2f39]" onClick={() => void mus("previous")}><SkipBack size={16} /></button>
              <button className="w-12 h-12 grid place-items-center rounded-full bg-[#1db954] text-[#04170c]" onClick={() => void mus(tocando ? "pause" : "play", tocando ? {} : { deviceId: alvo() })}>{tocando ? <Pause size={22} /> : <Play size={22} />}</button>
              <button className="w-9 h-9 grid place-items-center rounded-full border border-[#2a2f39]" onClick={() => void mus("next")}><SkipForward size={16} /></button>
            </div>
            <div className="flex items-center gap-2">
              <Volume2 size={16} className="text-[#9aa3b2]" />
              <input type="range" min={0} max={100} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); if (volRef.current) clearTimeout(volRef.current); volRef.current = setTimeout(() => void ctrl(rid, "volume", { volume: v, deviceId: alvo() }), 250); }} className="flex-1 accent-[#1db954]" />
              <b className="text-xs text-[#9aa3b2] w-9 text-right tabular-nums">{vol}%</b>
            </div>
            {player?.context && <div className="text-[11px] text-[#1db954] truncate">▸ tocando de uma playlist</div>}
          </div>

          {/* RESERVAS */}
          <div className={col}>
            <ColHead ic={<Utensils size={15} />} cor="#e3a63c" title="Reservas do turno" tag={reservasView.length ? `${reservasView.length}` : undefined} />
            {reservasView.length === 0 ? <Vazio txt="Sem reservas pro restante do turno" /> : (
              <div className={listCls}>
                {reservasView.map((r) => {
                  const rel = relReserva(r);
                  return (
                    <div key={r.id} className="rounded-xl border border-[#242a33] bg-[#1b1e25] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: RESERVA_COR[r.status || ""] || "#9aa3b2" }} />
                        <span className="font-extrabold tabular-nums text-[15px]">{r.horario || "--:--"}</span>
                        <span className="text-[11px] font-bold" style={{ color: rel.c }}>{rel.t}</span>
                        <span className="ml-auto flex items-center gap-1 text-[12px] text-[#9aa3b2]"><Users size={12} />{r.pessoas || "?"}</span>
                      </div>
                      <div className="text-[13px] font-semibold truncate mt-0.5">{r.nome || "Reserva"}</div>
                      {r.mesas && <div className="text-[11px] text-[#6f7889] truncate">{r.mesas}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* FREELAS & TURNOS */}
          <div className={col}>
            <ColHead ic={<ChefHat size={15} />} cor="#4b9bf0" title="Freelas & Turnos" tag={data.freelasAbertos.length ? `${data.freelasAbertos.length} aberto(s)` : undefined} />
            {data.freelasAbertos.length === 0 && data.freelasProgramados.length === 0 ? <Vazio txt="Nenhum freela programado hoje" /> : (
              <div className={listCls}>
                {data.freelasAbertos.map((s) => (
                  <div key={s.id} className="rounded-xl border px-3 py-2" style={{ borderColor: "#1e4a2e", background: "#13241a" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: "#1db95422", color: "#1db954" }}>EM TURNO</span>
                      <span className="ml-auto text-[12px] tabular-nums text-[#9aa3b2]">desde {s.entrada || "--:--"}</span>
                    </div>
                    <div className="text-[13px] font-semibold truncate mt-0.5">{s.nome || "Freela"}</div>
                    {s.area && <div className="text-[11px] text-[#6f7889] truncate">{s.area}</div>}
                  </div>
                ))}
                {data.freelasProgramados.map((s) => (
                  <div key={s.id} className="rounded-xl border border-[#242a33] bg-[#1b1e25] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Clock size={12} className="text-[#6f7889]" />
                      <span className="font-extrabold tabular-nums text-[14px]">{s.entradaPrevista || "--:--"}{s.saidaPrevista ? `–${s.saidaPrevista}` : ""}</span>
                      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#4b9bf022", color: "#4b9bf0" }}>programado</span>
                    </div>
                    <div className="text-[13px] font-semibold truncate mt-0.5">{s.nome || "Freela"}</div>
                    {s.area && <div className="text-[11px] text-[#6f7889] truncate">{s.area}</div>}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setGate(true)} className="rounded-xl border border-[#2a2f39] bg-[#1b1e25] py-2.5 text-[13px] font-bold shrink-0">Abrir turno</button>
          </div>

          {/* CHECKLISTS */}
          <div className={col}>
            <ColHead ic={<CheckSquare size={15} />} cor="#e3a63c" title="Checklists" tag={checklistsView.length ? `${chkCompletos}/${checklistsView.length}` : undefined} />
            {checklistsView.length === 0 ? <Vazio txt="Sem checklists pra hoje" /> : (
              <div className={listCls}>
                {checklistsView.map((c) => (
                  <div key={c.id} className={`rounded-xl border px-3 py-2 ${c.atrasado ? "animate-pulse" : ""}`} style={{ borderColor: c.completo ? "#1e4a2e" : c.atrasado ? "#5a2320" : "#242a33", background: c.completo ? "#13241a" : c.atrasado ? "#241414" : "#1b1e25" }}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[13px] truncate flex-1">{c.nome}</span>
                      <span className="font-extrabold tabular-nums text-[13px]" style={{ color: c.completo ? "#1db954" : c.atrasado ? "#f06b60" : "#e3a63c" }}>{c.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded bg-[#2b3038] overflow-hidden mt-1.5"><div className="h-full rounded" style={{ width: `${c.pct}%`, background: c.completo ? "#1db954" : c.atrasado ? "#f06b60" : "#e3a63c" }} /></div>
                    <div className="flex items-center gap-2 mt-1 text-[10.5px] text-[#6f7889]">
                      {c.turno && <span className="font-semibold" style={{ color: "#9aa3b2" }}>{TURNO_LABEL[c.turno] || c.turno}</span>}
                      {c.hora && <span className="flex items-center gap-0.5"><Clock size={10} />{c.hora}</span>}
                      {c.atrasado && <span className="ml-auto font-extrabold" style={{ color: "#f06b60" }}>atrasado</span>}
                      {c.completo && <span className="ml-auto font-extrabold" style={{ color: "#1db954" }}>✓ ok</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* WHATSAPP */}
          <div className={col}>
            <ColHead ic={<MessageSquare size={15} />} cor="#25d366" title="WhatsApp" tag={data.wa.total ? `${data.wa.total}` : undefined} />
            {data.wa.list.length === 0 ? <Vazio txt="Tudo respondido 🎉" /> : (
              <div className={listCls}>
                {data.wa.list.map((c) => (
                  <div key={c.key} className="rounded-xl border border-[#242a33] bg-[#1b1e25] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[13px] truncate flex-1">{c.nome || c.key}</span>
                      <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: "#25d36622", color: "#25d366" }}>{c.naoLidas}</span>
                    </div>
                    <div className="text-[11.5px] text-[#9aa3b2] truncate mt-0.5">{c.preview || "…"}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setGate(true)} className="rounded-xl border border-[#2a2f39] bg-[#1b1e25] py-2.5 text-[13px] font-bold shrink-0">Abrir inbox</button>
          </div>
        </div>
      </div>

      {/* Portão */}
      {gate && (
        <div className="fixed inset-0 z-[60] bg-black/75 grid place-items-center p-6" onClick={() => setGate(false)}>
          <div className="bg-[#1b1e25] border border-[#2a2f39] rounded-2xl max-w-sm w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-2xl grid place-items-center mx-auto mb-3" style={{ background: "#3a2e17", color: "#e3a63c" }}><Lock size={26} /></div>
            <div className="font-extrabold text-lg mb-1">Ação protegida</div>
            <p className="text-sm text-[#9aa3b2] mb-4">Este painel é só de visualização. Pra responder ou lançar, entre com o <b>seu login</b> no planejamento.app pelo celular ou navegador.</p>
            <div className="text-[13px] font-bold">admin.planejamento.app</div>
            <button className="mt-4 w-full rounded-xl py-3 font-extrabold text-[#1a1205]" style={{ background: "#e3a63c" }} onClick={() => setGate(false)}>Entendi</button>
          </div>
        </div>
      )}
    </div>
  );
}
