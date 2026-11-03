// Música Ambiente — controla o som do restaurante pelo Spotify (AudioCast M5 via
// Spotify Connect). Os tokens ficam no servidor; esta tela fala só com
// /api/spotify-control. F1: conectar conta, escolher dispositivo, tocar playlists
// e músicas, play/pause/pular/volume. Agenda por horário = v2.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Music, Play, Pause, SkipForward, SkipBack, Volume2, Speaker, RefreshCw, Search, LogOut, Loader2, ListMusic } from "lucide-react";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { PageContainer } from "../../core/ui/PageContainer";

type Device = { id: string; name: string; type: string; is_active: boolean; volume_percent?: number | null };
type Playlist = { id: string; uri: string; name: string; images?: { url: string }[]; tracks?: { total?: number } };
type Track = { uri: string; name: string; artists?: { name: string }[] };

async function ctrl(rid: string, action: string, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch("/api/spotify-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rid, action, ...extra }) });
  return r.json().catch(() => ({ ok: false, erro: "parse" }));
}

const BTN = "inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold";

export function MusicaAmbientePage() {
  const { rid = "" } = useParams();
  const { can } = useCanAcao(rid);
  const { activeRestaurant } = useRestaurant();
  const podeVer = can("musicaAmbiente", "ver");
  const podeConfig = can("musicaAmbiente", "config");

  const [carregando, setCarregando] = useState(true);
  const [conectado, setConectado] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [player, setPlayer] = useState<any>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [q, setQ] = useState("");
  const [buscaPl, setBuscaPl] = useState<Playlist[]>([]);
  const [buscaTr, setBuscaTr] = useState<Track[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscouVazio, setBuscouVazio] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const deviceAtivo = useMemo(() => devices.find((d) => d.is_active) || null, [devices]);
  const tocando = !!player?.is_playing;
  const faixa = player?.item;

  const carregarEstado = useCallback(async () => {
    const [dv, st] = await Promise.all([ctrl(rid, "devices"), ctrl(rid, "state")]);
    setDevices(Array.isArray(dv?.devices) ? (dv.devices as Device[]) : []);
    setPlayer(st?.player || null);
    const errTxt = dv?.error ? ` — ${dv.error.message || dv.error.reason || JSON.stringify(dv.error)}` : "";
    setDiag(`dispositivos: HTTP ${dv?.status ?? "?"}${errTxt} · ${(dv?.devices || []).length} na lista · player: HTTP ${st?.status ?? "?"}`);
  }, [rid]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const s = await ctrl(rid, "status");
    setConectado(!!s?.conectado); setDisplayName(s?.displayName || null);
    if (s?.conectado) {
      await carregarEstado();
      const pl = await ctrl(rid, "playlists");
      if (pl?.items) setPlaylists(pl.items as Playlist[]);
    }
    setCarregando(false);
  }, [rid, carregarEstado]);

  useEffect(() => {
    // mensagem de retorno do OAuth (?sp=ok|erro)
    const sp = new URLSearchParams(window.location.search).get("sp");
    if (sp === "ok") setMsg("Conta Spotify conectada.");
    else if (sp === "erro") setMsg("Falha ao conectar. Tente de novo.");
    if (sp) window.history.replaceState({}, "", window.location.pathname);
    void carregar();
  }, [carregar]);

  useEffect(() => {
    if (!conectado) return;
    pollRef.current = setInterval(() => { void carregarEstado(); }, 6000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [conectado, carregarEstado]);

  async function acao(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const r = await ctrl(rid, action, extra);
    if (r && r.ok === false && r.erro) setMsg(r.erro === "sem_conta" ? "Conta desconectada." : r.erro === "nao_configurado" ? "Spotify não configurado no servidor." : `Erro: ${r.erro}`);
    setTimeout(() => void carregarEstado(), 400);
    setBusy(false);
  }
  const alvoDevice = () => deviceAtivo?.id || devices[0]?.id || "";
  async function tocarContexto(uri: string) { await acao("play", { contextUri: uri, deviceId: alvoDevice() }); }
  async function tocarFaixa(uri: string) { await acao("play", { uris: [uri], deviceId: alvoDevice() }); }

  async function buscar() {
    const termo = q.trim();
    if (!termo) { setBuscaPl([]); setBuscaTr([]); setBuscouVazio(false); return; }
    setBuscando(true); setBuscouVazio(false);
    try {
      const r = await ctrl(rid, "search", { q: termo });
      // A busca do Spotify pode trazer itens nulos na lista — filtra pra não quebrar.
      const pls = ((r?.playlists?.items || []) as (Playlist | null)[]).filter((x): x is Playlist => !!x);
      const trs = ((r?.tracks?.items || []) as (Track | null)[]).filter((x): x is Track => !!x);
      setBuscaPl(pls); setBuscaTr(trs);
      setBuscouVazio(pls.length === 0 && trs.length === 0);
      if (r && r.ok === false && r.erro) setMsg(`Busca: ${r.erro}`);
    } finally { setBuscando(false); }
  }

  if (!podeVer) return <PageContainer><div className="py-16 text-center text-sm text-gray-500">Você não tem acesso à Música Ambiente.</div></PageContainer>;

  return (
    <PageContainer>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center"><Music size={18} /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight">Música Ambiente</h1>
          <p className="text-xs text-gray-500 truncate">{activeRestaurant?.nome || "Restaurante"}{displayName ? ` · Spotify: ${displayName}` : ""}</p>
        </div>
        <button className="w-9 h-9 grid place-items-center rounded-lg text-gray-400 hover:text-emerald-600" onClick={() => void carregar()} title="Atualizar"><RefreshCw size={16} /></button>
      </div>

      {msg && <div className="mb-3 text-xs rounded-lg px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">{msg}</div>}

      {carregando ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="animate-spin mx-auto mb-2" size={22} /> Carregando…</div>
      ) : !conectado ? (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-6 text-center">
          <Music size={36} className="mx-auto text-emerald-500 mb-3" />
          <div className="font-semibold">Conecte a conta Spotify</div>
          <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">Precisa de Spotify Premium. O AudioCast M5 deve estar ligado e logado no Spotify pelo app AudioCast pra aparecer como dispositivo.</p>
          {podeConfig ? (
            <a href={`/api/spotify-auth?rid=${encodeURIComponent(rid)}`} className={`${BTN} bg-emerald-600 hover:bg-emerald-700 text-white mt-4`}>Conectar conta Spotify</a>
          ) : <div className="text-xs text-amber-600 mt-3">Só quem tem a permissão de configurar pode conectar a conta.</div>}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Dispositivos */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1.5"><Speaker size={13} /> Dispositivo</div>
            {devices.length === 0 ? (
              <div className="text-xs text-gray-400">Nenhum dispositivo online. Abra o Spotify (celular/PC, conta Lobozó), toque uma música e escolha o <b>AudioCast M5</b> no ícone de dispositivos (Spotify Connect) — depois toque em atualizar.{diag && <span className="block mt-1 text-[10px] text-gray-300 dark:text-gray-600">{diag}</span>}</div>
            ) : (
              <div className="space-y-1.5">
                {devices.map((d) => (
                  <button key={d.id} onClick={() => void acao("transfer", { deviceId: d.id, play: tocando })} className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-sm ${d.is_active ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300" : "border-gray-200 dark:border-gray-700"}`}>
                    <Speaker size={15} /> <span className="flex-1 text-left truncate">{d.name}</span>
                    {d.is_active && <span className="text-[10px] font-bold">ATIVO</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Player */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center gap-3">
              {faixa?.album?.images?.[0]?.url ? <img src={faixa.album.images[0].url} alt="" className="w-14 h-14 rounded-lg object-cover" /> : <div className="w-14 h-14 rounded-lg bg-gray-100 dark:bg-gray-800 grid place-items-center text-gray-400"><Music size={20} /></div>}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{faixa?.name || "Nada tocando"}</div>
                <div className="text-xs text-gray-500 truncate">{(faixa?.artists || []).map((a: any) => a.name).join(", ") || (deviceAtivo ? deviceAtivo.name : "escolha um dispositivo")}</div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-3 mt-3">
              <button disabled={busy} className="w-11 h-11 grid place-items-center rounded-full border border-gray-200 dark:border-gray-700" onClick={() => void acao("previous")}><SkipBack size={18} /></button>
              <button disabled={busy} className="w-14 h-14 grid place-items-center rounded-full bg-emerald-600 text-white" onClick={() => void acao(tocando ? "pause" : "play", tocando ? {} : { deviceId: alvoDevice() })}>{tocando ? <Pause size={24} /> : <Play size={24} />}</button>
              <button disabled={busy} className="w-11 h-11 grid place-items-center rounded-full border border-gray-200 dark:border-gray-700" onClick={() => void acao("next")}><SkipForward size={18} /></button>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Volume2 size={16} className="text-gray-400 shrink-0" />
              <input type="range" min={0} max={100} defaultValue={deviceAtivo?.volume_percent ?? 50} onMouseUp={(e) => void acao("volume", { volume: Number((e.target as HTMLInputElement).value), deviceId: alvoDevice() })} onTouchEnd={(e) => void acao("volume", { volume: Number((e.target as HTMLInputElement).value), deviceId: alvoDevice() })} className="flex-1 accent-emerald-600" />
            </div>
          </div>

          {/* Busca */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700">
                <Search size={15} className="text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void buscar(); }} placeholder="Buscar playlist ou música…" className="flex-1 bg-transparent text-sm outline-none" />
              </div>
              <button disabled={buscando} className={`${BTN} border border-gray-200 dark:border-gray-700`} onClick={() => void buscar()}>{buscando ? <Loader2 size={15} className="animate-spin" /> : "Buscar"}</button>
            </div>
            {buscouVazio && !buscando && <div className="mt-3 text-xs text-gray-400">Nenhum resultado para "{q}".</div>}
            {(buscaPl.length > 0 || buscaTr.length > 0) && (
              <div className="mt-3 space-y-1.5 max-h-72 overflow-auto">
                {buscaPl.map((p) => (
                  <button key={p.id} onClick={() => void tocarContexto(p.uri)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left">
                    <ListMusic size={15} className="text-emerald-600 shrink-0" /><span className="text-sm truncate flex-1">{p.name}</span><Play size={14} className="text-gray-400" />
                  </button>
                ))}
                {buscaTr.map((t) => (
                  <button key={t.uri} onClick={() => void tocarFaixa(t.uri)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-left">
                    <Music size={15} className="text-gray-400 shrink-0" /><span className="text-sm truncate flex-1">{t.name} <span className="text-gray-400">· {(t.artists || []).map((a) => a.name).join(", ")}</span></span><Play size={14} className="text-gray-400" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Playlists da conta */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2 px-0.5">Suas playlists</div>
            <div className="grid grid-cols-2 gap-2">
              {playlists.map((p) => (
                <button key={p.id} onClick={() => void tocarContexto(p.uri)} className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden text-left active:border-emerald-400">
                  {p.images?.[0]?.url ? <img src={p.images[0].url} alt="" className="w-full aspect-square object-cover" /> : <div className="w-full aspect-square bg-gray-100 dark:bg-gray-800 grid place-items-center text-gray-400"><ListMusic size={22} /></div>}
                  <div className="p-2"><div className="text-xs font-medium truncate">{p.name}</div><div className="text-[10px] text-gray-400">{p.tracks?.total ?? 0} músicas</div></div>
                </button>
              ))}
            </div>
            {playlists.length === 0 && <div className="text-xs text-gray-400">Nenhuma playlist na conta.</div>}
          </div>

          {podeConfig && (
            <button className={`${BTN} border border-gray-200 dark:border-gray-700 text-gray-500 w-full`} onClick={async () => { if (window.confirm("Desconectar a conta Spotify deste restaurante?")) { await acao("disconnect"); void carregar(); } }}><LogOut size={15} /> Desconectar conta Spotify</button>
          )}
        </div>
      )}
    </PageContainer>
  );
}
