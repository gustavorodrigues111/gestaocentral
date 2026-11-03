// Painel do Salão — tela de parede (kiosk) do restaurante. Só visualização;
// ações caem num "portão" pedindo login no dispositivo pessoal. A MÚSICA é
// controlável direto (via /api/spotify-control). Colunas reordenáveis (ordem
// salva por estação). Dados dos demais módulos ligam em seguida (F2, módulo a
// módulo). Rota: /r/:rid/painel (tela cheia, fundo escuro sempre).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Music, Play, Pause, SkipForward, SkipBack, Volume2, MessageSquare, CheckSquare, Utensils, ChefHat, Lock } from "lucide-react";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";

async function ctrl(rid: string, action: string, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch("/api/spotify-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rid, action, ...extra }) });
  return r.json().catch(() => ({ ok: false }));
}
const fmtTime = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function PainelSalaoPage() {
  const { rid = "" } = useParams();
  const { activeRestaurant } = useRestaurant();
  const [agora, setAgora] = useState(new Date());
  const [gate, setGate] = useState(false);

  // ── Música (ao vivo) ──
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
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 15000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!tocando) return; const dur = Number(faixa?.duration_ms) || 0; const t = setInterval(() => setProgress((p) => (dur && p + 1000 > dur ? dur : p + 1000)), 1000); return () => clearInterval(t); }, [tocando, faixa?.duration_ms]);

  async function mus(action: string, extra: Record<string, unknown> = {}) { await ctrl(rid, action, extra); setTimeout(() => void carregarMusica(), 400); }

  const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const mes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const hora = `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;

  // placeholders (ligam nos próximos pushes)
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
  const Breve = ({ txt }: { txt: string }) => <div className="flex-1 grid place-items-center text-center text-[#6f7889] text-sm px-3">{txt}</div>;
  const col = "bg-[#15171c] border border-[#222730] rounded-2xl p-3.5 flex flex-col gap-3 min-w-0";

  return (
    <div className="fixed inset-0 z-50 bg-[#121317] text-[#eef1f5] overflow-auto" style={{ fontFamily: "system-ui, sans-serif" }}>
      <div className="min-h-full flex flex-col gap-3 p-4">
        {/* Status */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl grid place-items-center font-extrabold text-[#1a1205]" style={{ background: "linear-gradient(135deg,#e3a63c,#b9792a)" }}>{(activeRestaurant?.nome || "R")[0]}</div>
            <div><div className="font-extrabold text-lg leading-none">{activeRestaurant?.nome || "Restaurante"} · Salão</div><div className="text-[11px] text-[#9aa3b2]">Painel operacional</div></div>
          </div>
          <div className="flex gap-2 flex-wrap ml-auto items-center">
            <Kpi ic={<MessageSquare size={15} />} cor="#25d366" v="—" l="WhatsApp" />
            <Kpi ic={<CheckSquare size={15} />} cor="#e3a63c" v="—" l="Checklists" />
            <Kpi ic={<Utensils size={15} />} cor="#e3a63c" v="—" l="Reservas" />
            <Kpi ic={<ChefHat size={15} />} cor="#4b9bf0" v="—" l="Freelas" />
            <div className="text-right pl-1"><div className="font-extrabold text-2xl tabular-nums leading-none">{hora}</div><div className="text-[11px] text-[#9aa3b2] capitalize">{dias[agora.getDay()].slice(0, 3)}, {agora.getDate()} {mes[agora.getMonth()]}</div></div>
          </div>
        </div>

        {/* Colunas */}
        <div className="grid gap-3 flex-1" style={{ gridTemplateColumns: "1.15fr 1fr 1fr 1fr 1fr" }}>
          {/* MÚSICA (ao vivo) */}
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
          <div className={col}><ColHead ic={<Utensils size={15} />} cor="#e3a63c" title="Reservas do turno" /><Breve txt="Ligando ao módulo de Reservas…" /></div>
          {/* FREELAS & TURNOS */}
          <div className={col}><ColHead ic={<ChefHat size={15} />} cor="#4b9bf0" title="Freelas & Turnos" /><Breve txt="Ligando aos Freelas e Turnos…" /></div>
          {/* CHECKLISTS */}
          <div className={col}><ColHead ic={<CheckSquare size={15} />} cor="#e3a63c" title="Checklists" /><Breve txt="Ligando ao módulo de Checklists…" /></div>
          {/* WHATSAPP */}
          <div className={col}>
            <ColHead ic={<MessageSquare size={15} />} cor="#25d366" title="WhatsApp" />
            <Breve txt="Ligando ao inbox do WhatsApp…" />
            <button onClick={() => setGate(true)} className="rounded-xl border border-[#2a2f39] bg-[#1b1e25] py-3 text-sm font-bold">Abrir inbox</button>
          </div>
        </div>
      </div>

      {/* Portão: ações pedem login pessoal */}
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
