import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Crosshair, Skull, Shield, ShieldCheck, Bomb, Trophy, Play, RotateCcw, Home,
  Volume2, Timer, Snowflake, Target, Zap, ChevronRight, Mouse, Keyboard,
  Flame, Medal, Swords, Radar, Banknote, Crosshair as CrossIcon,
} from 'lucide-react';
import { GameEngine } from './game/engine';
import { WEAPONS } from './game/weapons';
import type { EngineOptions, GameResult, HudState, KillEntry, ScoreRow, Team, Difficulty } from './game/types';

// ================================================================ helpers
const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
};

const TEAM_META: Record<Team, { name: string; tag: string; color: string; soft: string; border: string; glow: string }> = {
  T: { name: 'ARCTIC JACKALS', tag: 'TERRORISTS', color: 'text-amber-400', soft: 'bg-amber-500/10', border: 'border-amber-500/40', glow: 'text-glow-amber' },
  CT: { name: 'FROST SENTINELS', tag: 'COUNTER-TERRORISTS', color: 'text-sky-400', soft: 'bg-sky-500/10', border: 'border-sky-500/40', glow: 'text-glow-blue' },
};

function MenuSnow() {
  const flakes = useRef(Array.from({ length: 60 }, (_, i) => ({
    left: Math.random() * 100,
    delay: -Math.random() * 14,
    dur: 7 + Math.random() * 9,
    size: 2 + Math.random() * 4,
    op: 0.25 + Math.random() * 0.6,
    key: i,
  })));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {flakes.current.map((f) => (
        <div
          key={f.key}
          className="absolute rounded-full bg-white"
          style={{
            left: `${f.left}%`, top: '-5vh', width: f.size, height: f.size, opacity: f.op,
            animation: `menuSnow ${f.dur}s linear infinite`,
            animationDelay: `${f.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] font-semibold tracking-widest text-slate-400">
        <span>{label}</span><span className="font-display text-xs text-slate-200">{value}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/** Decorative top-down preview of de_frostline */
function MapPreview() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full">
      <rect x="4" y="4" width="192" height="192" rx="6" fill="rgba(30,45,70,0.9)" stroke="rgba(140,180,230,0.35)" strokeWidth="2" />
      {/* warehouses */}
      <rect x="18" y="80" width="26" height="40" rx="2" fill="rgba(120,150,200,0.25)" stroke="rgba(150,190,240,0.5)" />
      <rect x="156" y="80" width="26" height="40" rx="2" fill="rgba(120,150,200,0.25)" stroke="rgba(150,190,240,0.5)" />
      {/* mid crates */}
      <rect x="92" y="92" width="16" height="16" fill="rgba(200,150,90,0.5)" stroke="rgba(220,170,100,0.7)" />
      <rect x="112" y="104" width="10" height="10" fill="rgba(200,150,90,0.45)" />
      <rect x="78" y="86" width="10" height="10" fill="rgba(200,150,90,0.45)" />
      <rect x="96" y="120" width="8" height="8" fill="rgba(200,150,90,0.45)" />
      <rect x="96" y="72" width="8" height="8" fill="rgba(200,150,90,0.45)" />
      {/* ice walls */}
      <rect x="126" y="96" width="22" height="6" rx="3" fill="rgba(140,200,255,0.5)" />
      <rect x="52" y="98" width="22" height="6" rx="3" fill="rgba(140,200,255,0.5)" />
      {/* towers */}
      {[[26, 26], [174, 26], [26, 174], [174, 174]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5" fill="none" stroke="rgba(160,190,230,0.6)" strokeWidth="1.5" />
      ))}
      {/* trees */}
      {[[60, 150], [140, 50], [55, 45], [145, 155]].map(([x, y], i) => (
        <g key={i}><circle cx={x} cy={y} r="4" fill="rgba(60,140,100,0.55)" /><circle cx={x} cy={y} r="1.6" fill="rgba(230,240,250,0.7)" /></g>
      ))}
      {/* spawns */}
      <ellipse cx="100" cy="182" rx="30" ry="8" fill="rgba(245,150,50,0.25)" stroke="rgba(245,150,50,0.8)" />
      <text x="100" y="185" textAnchor="middle" fontSize="7" fill="#f5b562" fontWeight="700">T SPAWN</text>
      <ellipse cx="100" cy="18" rx="30" ry="8" fill="rgba(70,160,230,0.25)" stroke="rgba(70,160,230,0.8)" />
      <text x="100" y="21" textAnchor="middle" fontSize="7" fill="#7cc7ff" fontWeight="700">CT SPAWN</text>
      <text x="100" y="100" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.65)" fontWeight="700" dy="-12">MID</text>
    </svg>
  );
}

// ================================================================ MAIN MENU
function MainMenu({ onDeploy }: { onDeploy: (o: EngineOptions) => void }) {
  const [name, setName] = useState('Ghost');
  const [team, setTeam] = useState<Team>('CT');
  const [difficulty, setDifficulty] = useState<Difficulty>('veteran');
  const [squad, setSquad] = useState(4);
  const [sensitivity, setSensitivity] = useState(1);
  const [volume, setVolume] = useState(0.8);

  const rifle = team === 'T' ? WEAPONS.ak47 : WEAPONS.m4a1s;
  const pistol = team === 'T' ? WEAPONS.glock : WEAPONS.usps;

  return (
    <div className="tactical-bg relative flex h-full flex-col overflow-y-auto bg-[#06090f]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,rgba(80,130,200,0.25),transparent_60%),radial-gradient(ellipse_at_85%_100%,rgba(200,130,60,0.12),transparent_55%)]" />
      <MenuSnow />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-6">
        {/* header */}
        <div className="anim-fadeUp flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-500/10">
              <Crosshair className="h-6 w-6 text-sky-300" />
            </div>
            <div>
              <div className="font-display text-3xl font-bold leading-none tracking-[0.22em] text-white">
                FROST<span className="text-sky-400">LINE</span>
              </div>
              <div className="mt-1 text-[11px] font-semibold tracking-[0.3em] text-slate-400">SNOW OPS // TACTICAL FPS</div>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold tracking-widest text-slate-300 md:flex">
            <Snowflake className="h-4 w-4 text-sky-300" /> DE_FROSTLINE — DUSK
          </div>
        </div>

        <div className="mt-6 grid flex-1 gap-5 lg:grid-cols-[1fr_380px]">
          {/* left: setup */}
          <div className="anim-fadeUp space-y-5" style={{ animationDelay: '0.08s' }}>
            {/* operative */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
              <div className="mb-3 text-[11px] font-bold tracking-[0.3em] text-slate-400">OPERATIVE CALLSIGN</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 14) || 'Ghost')}
                className="font-display w-full rounded-lg border border-white/10 bg-black/40 px-4 py-2.5 text-2xl font-semibold tracking-widest text-white outline-none transition focus:border-sky-400/60"
                placeholder="GHOST"
              />
            </div>

            {/* team select */}
            <div>
              <div className="mb-3 text-[11px] font-bold tracking-[0.3em] text-slate-400">CHOOSE YOUR SIDE</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(TEAM_META) as Team[]).map((t) => {
                  const m = TEAM_META[t];
                  const active = team === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setTeam(t)}
                      className={`group rounded-2xl border p-4 text-left transition-all ${active ? `${m.border} ${m.soft} shadow-[0_0_30px_rgba(0,0,0,0.5)]` : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-display text-2xl font-bold tracking-wider ${m.color} ${m.glow}`}>{t === 'T' ? 'TERRORISTS' : 'COUNTER-CT'}</span>
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full border ${active ? m.border : 'border-white/20'}`}>
                          {active && <span className={`h-2.5 w-2.5 rounded-full ${t === 'T' ? 'bg-amber-400' : 'bg-sky-400'}`} />}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-semibold tracking-widest text-slate-400">{m.name}</div>
                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                        <Swords className="h-3.5 w-3.5 opacity-70" />
                        {t === 'T' ? 'AK-47 + Glock-18' : 'M4A1-S + USP-S'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* difficulty + squad */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-2 text-[11px] font-bold tracking-[0.3em] text-slate-400">ENEMY SKILL</div>
                <div className="grid grid-cols-3 gap-2">
                  {(['recruit', 'veteran', 'elite'] as Difficulty[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`rounded-lg border px-2 py-2 text-xs font-bold tracking-wider uppercase transition ${difficulty === d ? 'border-sky-400/60 bg-sky-500/15 text-sky-200' : 'border-white/10 bg-black/30 text-slate-400 hover:text-slate-200'}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-2 text-[11px] font-bold tracking-[0.3em] text-slate-400">MATCH SIZE</div>
                <div className="grid grid-cols-3 gap-2">
                  {[3, 4, 5].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSquad(s)}
                      className={`rounded-lg border px-2 py-2 text-xs font-bold tracking-wider uppercase transition ${squad === s ? 'border-sky-400/60 bg-sky-500/15 text-sky-200' : 'border-white/10 bg-black/30 text-slate-400 hover:text-slate-200'}`}
                    >
                      {s}v{s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* sliders */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-2 flex items-center justify-between text-[11px] font-bold tracking-[0.3em] text-slate-400">
                  <span className="flex items-center gap-1.5"><Mouse className="h-3.5 w-3.5" /> SENSITIVITY</span>
                  <span className="font-display text-sm text-sky-300">{sensitivity.toFixed(2)}x</span>
                </div>
                <input type="range" min={0.3} max={2.5} step={0.05} value={sensitivity} onChange={(e) => setSensitivity(+e.target.value)} className="w-full" />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-2 flex items-center justify-between text-[11px] font-bold tracking-[0.3em] text-slate-400">
                  <span className="flex items-center gap-1.5"><Volume2 className="h-3.5 w-3.5" /> VOLUME</span>
                  <span className="font-display text-sm text-sky-300">{Math.round(volume * 100)}%</span>
                </div>
                <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(+e.target.value)} className="w-full" />
              </div>
            </div>

            {/* deploy */}
            <button
              onClick={() => onDeploy({ playerName: name || 'Ghost', team, difficulty, squad, sensitivity, volume })}
              className="group flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-sky-500 via-cyan-400 to-sky-500 bg-[length:200%_100%] px-6 py-4 font-display text-2xl font-bold tracking-[0.25em] text-[#06121f] transition-all hover:bg-right hover:shadow-[0_0_50px_rgba(80,180,255,0.45)]"
            >
              <Play className="h-6 w-6 fill-current" /> DEPLOY TO FROSTLINE
            </button>
            <div className="flex items-center justify-center gap-2 text-[11px] font-semibold tracking-widest text-slate-500">
              <Keyboard className="h-3.5 w-3.5" /> DESKTOP + MOUSE REQUIRED — CLICK CAPTURES YOUR CURSOR
            </div>
          </div>

          {/* right: map + arsenal */}
          <div className="anim-fadeUp space-y-4" style={{ animationDelay: '0.16s' }}>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                <span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.3em] text-slate-300"><Radar className="h-4 w-4 text-sky-300" /> DE_FROSTLINE</span>
                <span className="text-[10px] font-bold tracking-widest text-slate-500">SNOW // TDM FIRST TO 30</span>
              </div>
              <div className="p-3"><MapPreview /></div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 text-[11px] font-bold tracking-[0.3em] text-slate-400">YOUR LOADOUT — {TEAM_META[team].tag}</div>
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-xl font-bold tracking-wider text-white">{rifle.name}</span>
                    <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-bold tracking-widest text-slate-300">PRIMARY</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{rifle.desc}</div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                    <StatBar label="DAMAGE" value={Math.round((rifle.damage / 112) * 100)} color="bg-red-400" />
                    <StatBar label="FIRE RATE" value={Math.round((rifle.rpm / 700) * 100)} color="bg-amber-400" />
                    <StatBar label="ACCURACY" value={Math.round((1 - rifle.spread / 1.2) * 100)} color="bg-sky-400" />
                    <StatBar label="MAGAZINE" value={Math.round((rifle.mag / 30) * 100)} color="bg-emerald-400" />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                  <div>
                    <span className="font-display text-lg font-bold tracking-wider text-white">{pistol.name}</span>
                    <span className="ml-2 rounded bg-white/10 px-2 py-0.5 text-[10px] font-bold tracking-widest text-slate-300">SIDEARM</span>
                  </div>
                  <span className="font-display text-sm text-slate-400">{pistol.mag}/{pistol.reserve}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-bold tracking-widest">
                  <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300"><Flame className="mx-auto mb-1 h-4 w-4 text-orange-400" />HE NADES</div>
                  <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300"><Shield className="mx-auto mb-1 h-4 w-4 text-sky-300" />KEVLAR SHOP</div>
                  <div className="rounded-lg bg-white/5 px-2 py-2 text-slate-300"><Zap className="mx-auto mb-1 h-4 w-4 text-yellow-300" />AWP SNIPER</div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-300">
              <div className="mb-2 text-[11px] font-bold tracking-[0.3em] text-slate-400">FIELD MANUAL</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[['WASD', 'Move'], ['MOUSE', 'Aim / Fire'], ['RMB', 'Focus / Scope'], ['R', 'Reload'], ['1/2/3', 'Weapons'], ['G', 'HE grenade'], ['B', 'Buy menu'], ['TAB', 'Scoreboard'], ['SHIFT', 'Sneak'], ['SPACE', 'Jump'], ['C', 'Crouch'], ['ESC', 'Pause']].map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="min-w-[46px] rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-center font-mono text-[10px] font-bold text-sky-200">{k}</span>
                    <span className="text-slate-400">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================================================ HUD bits
function CrosshairView({ gap, visible, focus }: { gap: number; visible: boolean; focus: boolean }) {
  if (!visible) return null;
  const g = focus ? gap * 0.5 : gap;
  const len = 9;
  const c = focus ? '#7dfcff' : '#e8f4ff';
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div className="absolute rounded-full" style={{ width: 3, height: 3, background: c, left: -1.5, top: -1.5, boxShadow: '0 0 4px rgba(0,0,0,0.9)' }} />
      {[
        { x: 0, y: -g - len, w: 2, h: len },
        { x: 0, y: g, w: 2, h: len },
        { x: -g - len, y: 0, w: len, h: 2 },
        { x: g, y: 0, w: len, h: 2 },
      ].map((l, i) => (
        <div key={i} className="absolute rounded-sm" style={{ left: l.x - l.w / 2, top: l.y - l.h / 2, width: l.w, height: l.h, background: c, boxShadow: '0 0 4px rgba(0,0,0,0.9)' }} />
      ))}
    </div>
  );
}

function ScopeOverlay() {
  return (
    <div className="anim-scope pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1000 1000">
        <defs>
          <mask id="scopemask">
            <rect width="1000" height="1000" fill="white" />
            <circle cx="500" cy="500" r="330" fill="black" />
          </mask>
        </defs>
        <rect width="1000" height="1000" fill="black" mask="url(#scopemask)" opacity="0.985" />
        <circle cx="500" cy="500" r="330" fill="none" stroke="rgba(0,0,0,0.9)" strokeWidth="10" />
        <circle cx="500" cy="500" r="322" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
        <line x1="170" y1="500" x2="830" y2="500" stroke="rgba(0,0,0,0.85)" strokeWidth="2" />
        <line x1="500" y1="170" x2="500" y2="830" stroke="rgba(0,0,0,0.85)" strokeWidth="2" />
        <circle cx="500" cy="500" r="4" fill="#c00" />
      </svg>
    </div>
  );
}

const BUY_ITEMS = [
  { id: 'awp', key: '1', name: 'AWP', desc: 'Bolt sniper, scope included', price: 4750, icon: CrossIcon },
  { id: 'deagle', key: '2', name: 'Desert Eagle', desc: 'Hand cannon sidearm', price: 700, icon: Zap },
  { id: 'rifle', key: '3', name: 'Standard Rifle', desc: 'Restore team rifle — free', price: 0, icon: Target },
  { id: 'kevlar', key: '4', name: 'Kevlar Vest', desc: '+100 armor', price: 650, icon: Shield },
  { id: 'helmet', key: '5', name: 'Helmet', desc: 'Tames headshots (needs Kevlar)', price: 350, icon: ShieldCheck },
  { id: 'nade', key: '6', name: 'HE Grenade', desc: 'Big snowy boom (max 2)', price: 300, icon: Bomb },
  { id: 'ammo', key: '7', name: 'Refill Ammo', desc: 'Top up all reserves', price: 200, icon: Banknote },
];

// ================================================================ GAME
function Game({ opts, onExit, onReplay }: { opts: EngineOptions; onExit: () => void; onReplay: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [feed, setFeed] = useState<KillEntry[]>([]);
  const [score, setScore] = useState<ScoreRow[]>([]);
  const [locked, setLocked] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [gameOver, setGameOver] = useState<GameResult | null>(null);
  const [hitmark, setHitmark] = useState<{ id: number; kill: boolean; hs: boolean } | null>(null);
  const [damages, setDamages] = useState<Array<{ id: number; angle: number }>>([]);
  const [dmgFlash, setDmgFlash] = useState(0);
  const [killToast, setKillToast] = useState<{ id: number; victim: string; reward: number; hs: boolean; weapon: string } | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; kind: string }>>([]);
  const idRef = useRef(1);
  const buyOpenRef = useRef(false);
  const gameOverRef = useRef(false);
  buyOpenRef.current = buyOpen;
  gameOverRef.current = !!gameOver;

  const pushToast = useCallback((msg: string, kind: string) => {
    const id = idRef.current++;
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const engine = new GameEngine(canvas, opts, {
      onHUD: (h) => setHud(h),
      onKillFeed: (f) => setFeed(f),
      onScoreboard: (r) => setScore(r),
      onHitmarker: (kill, hs) => {
        const id = idRef.current++;
        setHitmark({ id, kill, hs });
        window.setTimeout(() => setHitmark((m) => (m && m.id === id ? null : m)), 160);
      },
      onDamage: (_amt, angle) => {
        const id = idRef.current++;
        setDamages((d) => [...d.slice(-3), { id, angle }]);
        setDmgFlash(id);
        window.setTimeout(() => setDamages((d) => d.filter((x) => x.id !== id)), 900);
      },
      onKillConfirm: (victim, reward, hs, weapon) => {
        const id = idRef.current++;
        setKillToast({ id, victim, reward, hs, weapon });
        window.setTimeout(() => setKillToast((t) => (t && t.id === id ? null : t)), 2300);
      },
      onGameOver: (r) => setGameOver(r),
      onLockChange: (l) => setLocked(l),
      onToast: (msg, kind) => pushToast(msg, kind),
    });
    engineRef.current = engine;
    engine.start();
    engine.requestLock();

    // minimap loop
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const mc = mapRef.current;
      if (!mc) return;
      const ctx = mc.getContext('2d');
      if (!ctx) return;
      const S = mc.width;
      const snap = engine.getSnapshot();
      const scale = S / (snap.bounds * 2 + 8);
      const px = (x: number) => S / 2 + x * scale;
      const pz = (z: number) => S / 2 + z * scale;
      ctx.clearRect(0, 0, S, S);
      ctx.fillStyle = 'rgba(5,10,18,0.78)';
      ctx.fillRect(0, 0, S, S);
      // colliders
      ctx.fillStyle = 'rgba(160,195,235,0.28)';
      for (const c of snap.colliders) {
        if (c.y1 < 1.0) continue;
        ctx.fillRect(px(c.x0), pz(c.z0), (c.x1 - c.x0) * scale, (c.z1 - c.z0) * scale);
      }
      // spawns
      ctx.fillStyle = 'rgba(245,150,50,0.5)';
      ctx.fillRect(px(-8), pz(46), 16 * scale, 7 * scale);
      ctx.fillStyle = 'rgba(70,160,230,0.5)';
      ctx.fillRect(px(-8), pz(-53), 16 * scale, 7 * scale);
      // nades
      ctx.fillStyle = '#ffe27a';
      for (const n of snap.nades) {
        ctx.beginPath(); ctx.arc(px(n.x), pz(n.z), 2.5, 0, 7); ctx.fill();
      }
      // entities
      for (const e of snap.entities) {
        if (!e.alive) continue;
        const x = px(e.x), y = pz(e.z);
        if (e.player) {
          // view cone
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.atan2(Math.sin(e.yaw) * -1, Math.cos(e.yaw) * -1) * -1 + Math.PI);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 26, -0.5, 0.5); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
          ctx.restore();
        } else {
          const foe = e.team !== opts.team;
          ctx.fillStyle = foe ? '#ff5a5a' : e.team === 'T' ? '#f5a83c' : '#4db2ff';
          ctx.globalAlpha = foe ? 0.95 : 1;
          ctx.beginPath(); ctx.arc(x, y, foe ? 3 : 3.6, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      // border
      ctx.strokeStyle = 'rgba(140,180,230,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, S - 2, S - 2);
    };
    draw();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat) setScoreOpen(true);
      }
      if (e.code === 'KeyB' && !e.repeat && !gameOverRef.current) {
        if (buyOpenRef.current) {
          setBuyOpen(false);
          engine.requestLock();
        } else {
          setBuyOpen(true);
          engine.exitLock();
        }
      }
      if (e.code === 'Escape' && buyOpenRef.current) {
        setBuyOpen(false);
        engine.requestLock();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') setScoreOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // number-key buying while shop open
  useEffect(() => {
    if (!buyOpen) return;
    const h = (e: KeyboardEvent) => {
      const item = BUY_ITEMS.find((b) => b.key === e.key);
      if (item) engineRef.current?.buy(item.id);
      if (e.code === 'KeyB' || e.code === 'Escape') {
        // handled by main listener; this just prevents double-toggle issues
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [buyOpen]);

  const paused = !locked && !buyOpen && !gameOver;
  const myTeam = TEAM_META[opts.team];
  const enemyTeam = TEAM_META[opts.team === 'T' ? 'CT' : 'T'];
  const curWeapon = hud ? (hud.slot === 1 ? WEAPONS[hud.primaryId as keyof typeof WEAPONS] : hud.slot === 2 ? WEAPONS[hud.secondaryId as keyof typeof WEAPONS] : WEAPONS.knife) : null;

  const buyItem = (id: string) => engineRef.current?.buy(id);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <canvas ref={canvasRef} className="game-canvas" />

      {/* crosshair + hitmarker */}
      {hud && hud.alive && hud.phase === 'live' && !hud.scoped && (
        <CrosshairView gap={hud.spreadPx} visible={!buyOpen && !paused} focus={hud.focus} />
      )}
      {hitmark && (
        <div key={hitmark.id} className={`hitmarker pointer-events-none absolute left-1/2 top-1/2 z-20 ${hitmark.hs ? 'hs' : ''} ${hitmark.kill ? 'kill' : ''}`} style={{ animation: 'hitmark 0.16s ease-out both' }}>
          {[45, 135, 225, 315].map((r) => (
            <span key={r} style={{ left: -6, top: -1, transform: `rotate(${r}deg) translateX(13px)` }} />
          ))}
        </div>
      )}
      {hud?.scoped && <ScopeOverlay />}
      {hud?.focus && <div className="pointer-events-none absolute inset-0 z-10" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)' }} />}

      {/* damage vignette + direction */}
      {dmgFlash > 0 && hud?.alive && (
        <div key={dmgFlash} className="dmg-flash pointer-events-none absolute inset-0 z-20" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(220,30,30,0.5) 100%)' }} />
      )}
      {hud && hud.alive && hud.hp <= 30 && (
        <div className="pointer-events-none absolute inset-0 z-10" style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(200,20,20,0.35) 100%)', animation: 'glowPulse 1.1s ease-in-out infinite' }} />
      )}
      {damages.map((d) => (
        <div key={d.id} className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-40 w-40 -translate-x-1/2 -translate-y-1/2" style={{ transform: `translate(-50%,-50%) rotate(${d.angle}deg)`, animation: 'dmgPulse 0.9s ease-out both' }}>
          <div className="absolute left-1/2 top-0 h-10 w-16 -translate-x-1/2 rounded-b-full bg-gradient-to-b from-red-500/90 to-transparent" style={{ clipPath: 'polygon(15% 0, 85% 0, 60% 100%, 40% 100%)' }} />
        </div>
      ))}

      {/* top center scoreboard strip */}
      {hud && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2">
          <div className="anim-fadeUp flex items-stretch overflow-hidden rounded-xl border border-white/15 bg-black/60 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-2 bg-amber-500/15 px-4 py-1.5">
              <span className="font-display text-[11px] font-bold tracking-widest text-amber-400">T</span>
              <span className="font-display text-2xl font-bold text-amber-300">{hud.tScore}</span>
            </div>
            <div className="flex flex-col items-center justify-center px-4">
              <span className="flex items-center gap-1 font-display text-lg font-bold leading-none text-white"><Timer className="h-3.5 w-3.5 text-slate-400" />{fmtTime(hud.timeLeft)}</span>
              <span className="text-[9px] font-bold tracking-[0.2em] text-slate-400">FIRST TO {hud.target}</span>
            </div>
            <div className="flex items-center gap-2 bg-sky-500/15 px-4 py-1.5">
              <span className="font-display text-2xl font-bold text-sky-300">{hud.ctScore}</span>
              <span className="font-display text-[11px] font-bold tracking-widest text-sky-400">CT</span>
            </div>
          </div>
        </div>
      )}

      {/* minimap */}
      <div className="absolute left-3 top-3 z-10">
        <canvas ref={mapRef} width={172} height={172} className="rounded-lg shadow-2xl" />
        <div className="mt-1 text-center text-[9px] font-bold tracking-[0.25em] text-slate-400">DE_FROSTLINE</div>
      </div>

      {/* killfeed */}
      <div className="absolute right-3 top-3 z-10 flex w-72 flex-col gap-1.5">
        {feed.map((f) => (
          <div key={f.id} className="anim-feedIn flex items-center justify-end gap-1.5 rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-xs backdrop-blur">
            {f.suicide ? (
              <>
                <Skull className="h-3.5 w-3.5 text-red-400" />
                <span className={`font-bold ${f.victimTeam === 'T' ? 'text-amber-300' : 'text-sky-300'}`}>{f.victim}</span>
                <span className="text-slate-400">blew self up</span>
              </>
            ) : (
              <>
                <span className={`font-bold ${f.killerTeam === 'T' ? 'text-amber-300' : 'text-sky-300'}`}>{f.killer}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-slate-200">{f.headshot ? '☠' : ''} {f.weapon}</span>
                <span className={`font-bold ${f.victimTeam === 'T' ? 'text-amber-300' : 'text-sky-300'}`}>{f.victim}</span>
              </>
            )}
          </div>
        ))}
      </div>

      {/* bottom-left vitals */}
      {hud && (
        <div className="absolute bottom-3 left-3 z-10 w-64">
          <div className="rounded-xl border border-white/10 bg-black/60 p-3 backdrop-blur">
            <div className="flex items-end justify-between">
              <span className="font-display text-5xl font-bold leading-none text-white">{hud.hp}</span>
              <span className="pb-1 text-[10px] font-bold tracking-[0.25em] text-slate-400">HEALTH</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className={`h-full rounded-full transition-all ${hud.hp > 50 ? 'bg-emerald-400' : hud.hp > 25 ? 'bg-amber-400' : 'bg-red-500'}`} style={{ width: `${hud.hp}%` }} />
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <Shield className={`h-4 w-4 ${hud.armor > 0 ? 'text-sky-300' : 'text-slate-600'}`} />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${hud.armor}%` }} />
              </div>
              <span className="font-display text-sm font-bold text-sky-200">{hud.armor}</span>
              {hud.helmet && <ShieldCheck className="h-4 w-4 text-emerald-300" />}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] font-bold tracking-widest text-slate-400">
              <span className={myTeam.color}>{myTeam.tag}</span>
              <span>K {hud.kills} / D {hud.deaths} / HS {hud.headshots}</span>
            </div>
          </div>
        </div>
      )}

      {/* bottom-right weapon */}
      {hud && curWeapon && (
        <div className="absolute bottom-3 right-3 z-10 w-72">
          <div className="rounded-xl border border-white/10 bg-black/60 p-3 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="font-display text-xl font-bold tracking-wider text-white">{curWeapon.name}</span>
              <span className="flex items-center gap-1 text-emerald-300"><Banknote className="h-4 w-4" /><span className="font-display text-lg font-bold">${hud.money}</span></span>
            </div>
            {hud.slot === 3 ? (
              <div className="mt-1 font-display text-3xl font-bold text-slate-200">— MELEE —</div>
            ) : (
              <div className="mt-1 flex items-baseline gap-2">
                <span className={`font-display text-5xl font-bold leading-none ${hud.lowAmmo ? 'text-red-400' : 'text-white'}`}>{hud.reloading ? '--' : hud.mag}</span>
                <span className="font-display text-xl text-slate-400">/ {hud.reserve}</span>
                {hud.reloading && <span className="ml-auto animate-pulse text-[11px] font-bold tracking-widest text-amber-300">RELOADING…</span>}
              </div>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              {([1, 2, 3] as const).map((s) => (
                <div key={s} className={`flex-1 rounded-md border px-2 py-1 text-center text-[10px] font-bold tracking-wider ${hud.slot === s ? 'border-sky-400/60 bg-sky-500/15 text-sky-200' : 'border-white/10 text-slate-500'}`}>
                  {s} {s === 1 ? (hud.primaryId === 'awp' ? 'AWP' : opts.team === 'T' ? 'AK' : 'M4') : s === 2 ? 'PISTOL' : 'KNIFE'}
                </div>
              ))}
              <div className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold ${hud.nades > 0 ? 'border-orange-400/50 text-orange-300' : 'border-white/10 text-slate-600'}`}>
                <Bomb className="h-3.5 w-3.5" />{hud.nades}
              </div>
            </div>
            {hud.protection && <div className="mt-1.5 text-center text-[10px] font-bold tracking-widest text-emerald-300" style={{ animation: 'glowPulse 1s infinite' }}>SPAWN PROTECTION</div>}
          </div>
        </div>
      )}

      {/* kill confirm toast */}
      {killToast && (
        <div key={killToast.id} className="anim-popIn absolute bottom-40 left-1/2 z-10 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-black/70 px-4 py-2 backdrop-blur">
            <Skull className="h-5 w-5 text-red-400" />
            <span className="font-display text-lg font-bold tracking-wider text-white">
              {killToast.hs && <span className="mr-1.5 text-red-400">HEADSHOT</span>}
              {killToast.victim}
            </span>
            <span className="font-display text-lg font-bold text-emerald-300">+${killToast.reward}</span>
          </div>
        </div>
      )}

      {/* info toasts */}
      <div className="absolute bottom-28 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
        {toasts.map((t) => (
          <div key={t.id} className={`anim-toast rounded-lg border px-3 py-1.5 text-xs font-bold tracking-wider backdrop-blur ${t.kind === 'warn' ? 'border-amber-500/50 bg-amber-950/70 text-amber-200' : 'border-white/15 bg-black/70 text-slate-200'}`}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* warmup banner */}
      {hud?.phase === 'warmup' && !gameOver && (
        <div className="absolute left-1/2 top-1/3 z-10 -translate-x-1/2 text-center">
          <div className="anim-banner font-display text-6xl font-bold tracking-[0.18em] text-white text-glow-blue">FROSTLINE</div>
          <div className="mt-2 font-display text-2xl font-bold tracking-[0.3em] text-sky-300">MATCH STARTING — {Math.ceil(hud.warmupLeft)}</div>
          <div className="mt-1 text-xs font-bold tracking-[0.25em] text-slate-400">{myTeam.tag} — FIRST TO {hud.target} ELIMINATIONS</div>
        </div>
      )}

      {/* death overlay */}
      {hud && !hud.alive && !gameOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-red-950/30">
          <div className="anim-popIn w-96 rounded-2xl border border-red-500/40 bg-black/80 p-6 text-center backdrop-blur">
            <Skull className="mx-auto h-10 w-10 text-red-400" />
            <div className="mt-2 font-display text-3xl font-bold tracking-widest text-red-300">ELIMINATED</div>
            <div className="mt-2 text-sm text-slate-300">
              by <span className="font-bold text-white">{hud.killerName}</span>
              <span className="mx-2 text-slate-500">|</span>
              <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-bold">{hud.killerWeapon}</span>
              {hud.killerHeadshot && <span className="ml-2 text-xs font-bold text-red-400">HEADSHOT</span>}
            </div>
            <div className="mt-4">
              <div className="font-display text-xl font-bold text-sky-200">REDEPLOYING IN {hud.respawnIn.toFixed(1)}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-sky-400" style={{ width: `${(1 - hud.respawnIn / 3.2) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* scoreboard */}
      {scoreOpen && !gameOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
          <div className="anim-popIn w-full max-w-2xl overflow-hidden rounded-2xl border border-white/15 bg-[#0a1018]/95 backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <span className="font-display text-xl font-bold tracking-[0.25em] text-white">SCOREBOARD</span>
              <span className="flex items-center gap-3 font-display text-lg font-bold">
                <span className="text-amber-300">T {hud?.tScore}</span>
                <span className="text-slate-500">—</span>
                <span className="text-sky-300">{hud?.ctScore} CT</span>
              </span>
            </div>
            {(['T', 'CT'] as Team[]).map((t) => (
              <div key={t} className="px-5 py-3">
                <div className={`mb-1.5 text-[11px] font-bold tracking-[0.3em] ${TEAM_META[t].color}`}>{TEAM_META[t].tag}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] tracking-widest text-slate-500">
                      <th className="py-1 font-semibold">OPERATIVE</th>
                      <th className="font-semibold">K</th><th className="font-semibold">D</th><th className="font-semibold">HS</th>
                      <th className="font-semibold">$</th><th className="font-semibold">PING</th><th className="font-semibold">STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {score.filter((r) => r.team === t).sort((a, b) => b.kills - a.kills).map((r) => (
                      <tr key={r.name} className={`border-t border-white/5 ${!r.bot ? 'bg-sky-500/10' : ''}`}>
                        <td className="py-1.5 font-bold text-slate-100">{!r.bot && <span className="mr-1.5 text-sky-300">▸</span>}{r.name}{r.bot && <span className="ml-1.5 rounded bg-white/10 px-1 text-[9px] text-slate-400">BOT</span>}</td>
                        <td className="font-display font-bold text-white">{r.kills}</td>
                        <td className="text-slate-400">{r.deaths}</td>
                        <td className="text-slate-400">{r.headshots}</td>
                        <td className="text-emerald-300">${r.money}</td>
                        <td className="text-slate-400">{r.ping}</td>
                        <td className={r.alive ? 'text-emerald-400' : 'text-red-400'}>{r.alive ? '●' : '✕'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* buy menu */}
      {buyOpen && hud && !gameOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="anim-popIn w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-[#0a1018]/95 backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <span className="font-display text-xl font-bold tracking-[0.25em] text-white">BUY EQUIPMENT <span className="text-slate-500">[B]</span></span>
              <span className="flex items-center gap-1 font-display text-xl font-bold text-emerald-300"><Banknote className="h-5 w-5" />${hud.money}</span>
            </div>
            <div className="grid gap-2 p-4">
              {BUY_ITEMS.map((item) => {
                const owned =
                  (item.id === 'awp' && hud.primaryId === 'awp') ||
                  (item.id === 'deagle' && hud.secondaryId === 'deagle') ||
                  (item.id === 'kevlar' && hud.armor >= 100) ||
                  (item.id === 'helmet' && hud.helmet) ||
                  (item.id === 'nade' && hud.nades >= 2);
                const afford = hud.money >= item.price;
                return (
                  <button
                    key={item.id}
                    onClick={() => buyItem(item.id)}
                    disabled={owned}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${owned ? 'border-emerald-500/30 bg-emerald-500/5 opacity-60' : afford ? 'border-white/10 bg-white/[0.04] hover:border-sky-400/50 hover:bg-sky-500/10' : 'border-white/10 bg-white/[0.02] opacity-50'}`}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-black/50 font-mono text-xs font-bold text-slate-300">{item.key}</span>
                    <item.icon className={`h-5 w-5 ${owned ? 'text-emerald-300' : 'text-sky-300'}`} />
                    <span className="flex-1">
                      <span className="block font-display text-lg font-bold leading-none text-white">{item.name}</span>
                      <span className="block text-xs text-slate-400">{item.desc}</span>
                    </span>
                    <span className={`font-display text-lg font-bold ${owned ? 'text-emerald-300' : afford ? 'text-emerald-300' : 'text-red-400'}`}>
                      {owned ? 'OWNED' : item.price === 0 ? 'FREE' : `$${item.price}`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-white/10 px-5 py-2.5 text-center text-[11px] font-bold tracking-widest text-slate-500">
              PRESS <span className="text-sky-300">1–7</span> TO BUY • <span className="text-sky-300">B / ESC</span> TO CLOSE & RESUME
            </div>
          </div>
        </div>
      )}

      {/* pause */}
      {paused && hud && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="anim-popIn w-full max-w-md rounded-2xl border border-white/15 bg-[#0a1018]/95 p-6 text-center">
            <div className="font-display text-4xl font-bold tracking-[0.2em] text-white">PAUSED</div>
            <div className="mt-1 text-xs font-bold tracking-[0.25em] text-slate-400">MATCH FROZEN — {hud.tScore} : {hud.ctScore}</div>
            <button
              onClick={() => engineRef.current?.requestLock()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 px-4 py-3 font-display text-xl font-bold tracking-[0.2em] text-[#06121f] transition hover:shadow-[0_0_40px_rgba(80,180,255,0.4)]"
            >
              <Play className="h-5 w-5 fill-current" /> RESUME
            </button>
            <div className="mt-4 grid grid-cols-2 gap-3 text-left">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <div className="mb-1.5 text-[10px] font-bold tracking-widest text-slate-400">SENSITIVITY</div>
                <input type="range" min={0.3} max={2.5} step={0.05} defaultValue={opts.sensitivity} onChange={(e) => engineRef.current?.setSensitivity(+e.target.value)} className="w-full" />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <div className="mb-1.5 text-[10px] font-bold tracking-widest text-slate-400">VOLUME</div>
                <input type="range" min={0} max={1} step={0.05} defaultValue={opts.volume} onChange={(e) => engineRef.current?.setVolume(+e.target.value)} className="w-full" />
              </div>
            </div>
            <button onClick={onExit} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold tracking-widest text-slate-300 transition hover:bg-white/5">
              <Home className="h-4 w-4" /> ABANDON MATCH
            </button>
            <div className="mt-3 text-[10px] font-bold tracking-widest text-slate-500">B — SHOP • TAB — SCORES • G — GRENADE • RMB — {opts.team === 'T' ? 'FOCUS' : 'FOCUS'} / AWP SCOPE</div>
          </div>
        </div>
      )}

      {/* game over */}
      {gameOver && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="anim-popIn w-full max-w-lg rounded-2xl border border-white/15 bg-[#0a1018]/95 p-8 text-center">
            {gameOver.winner === 'DRAW' ? (
              <div className="font-display text-5xl font-bold tracking-[0.15em] text-slate-200">STALEMATE</div>
            ) : (
              <>
                <div className={`text-xs font-bold tracking-[0.35em] ${gameOver.winner === opts.team ? 'text-emerald-300' : 'text-red-300'}`}>
                  {gameOver.winner === opts.team ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}
                </div>
                <div className={`anim-banner mt-1 font-display text-6xl font-bold tracking-[0.12em] ${gameOver.winner === 'T' ? 'text-amber-400 text-glow-amber' : 'text-sky-400 text-glow-blue'}`}>
                  {gameOver.winner === 'T' ? 'JACKALS WIN' : 'SENTINELS WIN'}
                </div>
              </>
            )}
            <div className="mt-3 flex items-center justify-center gap-4 font-display text-4xl font-bold">
              <span className="text-amber-300">{gameOver.tScore}</span>
              <span className="text-xl text-slate-500">—</span>
              <span className="text-sky-300">{gameOver.ctScore}</span>
            </div>
            <div className="mx-auto mt-4 flex max-w-xs items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-2.5">
              <Medal className="h-8 w-8 text-yellow-300" />
              <div className="text-left">
                <div className="text-[10px] font-bold tracking-[0.3em] text-yellow-200/80">MATCH MVP</div>
                <div className="font-display text-xl font-bold text-white">{gameOver.mvp} <span className="text-sm text-slate-400">— {gameOver.mvpKills} eliminations</span></div>
              </div>
            </div>
            <div className="mt-3 text-sm text-slate-400">
              Your line: <span className="font-bold text-white">{hud?.kills}K / {hud?.deaths}D / {hud?.headshots} HS</span>
              <span className="mx-2">•</span>Enemy: <span className="font-bold text-white">{enemyTeam.tag}</span>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={onReplay} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 px-4 py-3 font-display text-lg font-bold tracking-[0.2em] text-[#06121f] transition hover:shadow-[0_0_40px_rgba(80,180,255,0.4)]">
                <RotateCcw className="h-5 w-5" /> PLAY AGAIN
              </button>
              <button onClick={onExit} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 font-display text-lg font-bold tracking-[0.2em] text-slate-200 transition hover:bg-white/5">
                <Home className="h-5 w-5" /> MENU
              </button>
            </div>
          </div>
        </div>
      )}

      {/* controls hint */}
      {hud?.alive && hud.phase === 'live' && locked && !buyOpen && !scoreOpen && (
        <div className="absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 text-[10px] font-bold tracking-[0.2em] text-slate-500 lg:flex">
          <span><span className="text-slate-300">B</span> SHOP</span>
          <span><span className="text-slate-300">G</span> NADE</span>
          <span><span className="text-slate-300">R</span> RELOAD</span>
          <span><span className="text-slate-300">RMB</span> {hud.primaryId === 'awp' && hud.slot === 1 ? 'SCOPE' : 'FOCUS'}</span>
          <span><span className="text-slate-300">TAB</span> SCORES</span>
        </div>
      )}

      {/* protection toast for CT/T flavor */}
      {hud && !locked && !buyOpen && !gameOver && !paused && null}
    </div>
  );
}

// ================================================================ APP
export default function App() {
  const [screen, setScreen] = useState<'menu' | 'game'>('menu');
  const [opts, setOpts] = useState<EngineOptions | null>(null);
  const [session, setSession] = useState(0);

  const deploy = useCallback((o: EngineOptions) => {
    setOpts(o);
    setSession((s) => s + 1);
    setScreen('game');
  }, []);

  if (screen === 'game' && opts) {
    return (
      <div className="h-full">
        <Game
          key={session}
          opts={opts}
          onExit={() => setScreen('menu')}
          onReplay={() => setSession((s) => s + 1)}
        />
      </div>
    );
  }

  return (
    <div className="h-full">
      <MainMenu onDeploy={deploy} />
      <div className="fixed bottom-2 right-3 z-20 hidden items-center gap-1.5 text-[10px] font-semibold tracking-widest text-slate-600 md:flex">
        FROSTLINE v1.0 <ChevronRight className="h-3 w-3" /> FAN-MADE TACTICAL FPS <ChevronRight className="h-3 w-3" /> <Trophy className="h-3 w-3" />
      </div>
    </div>
  );
}
