export type Team = 'T' | 'CT';
export type Difficulty = 'recruit' | 'veteran' | 'elite';

export interface HudState {
  phase: 'warmup' | 'live' | 'over';
  hp: number;
  maxHp: number;
  armor: number;
  helmet: boolean;
  alive: boolean;
  respawnIn: number;
  protection: boolean;
  slot: number;
  primaryId: string;
  secondaryId: string;
  mag: number;
  reserve: number;
  reloading: boolean;
  nades: number;
  money: number;
  kills: number;
  deaths: number;
  headshots: number;
  tScore: number;
  ctScore: number;
  target: number;
  timeLeft: number;
  scoped: boolean;
  focus: boolean;
  spreadPx: number;
  lowAmmo: boolean;
  killerName: string;
  killerWeapon: string;
  killerHeadshot: boolean;
  warmupLeft: number;
}

export interface KillEntry {
  id: number;
  killer: string;
  victim: string;
  killerTeam: Team | 'X';
  victimTeam: Team;
  weapon: string;
  headshot: boolean;
  suicide: boolean;
  t: number;
}

export interface ScoreRow {
  name: string;
  team: Team;
  bot: boolean;
  kills: number;
  deaths: number;
  headshots: number;
  money: number;
  ping: number;
  alive: boolean;
}

export interface MapEntity {
  x: number;
  z: number;
  yaw: number;
  team: Team;
  alive: boolean;
  player: boolean;
}

export interface EngineOptions {
  playerName: string;
  team: Team;
  difficulty: Difficulty;
  /** players per side, e.g. 4 = 4v4 */
  squad: number;
  sensitivity: number;
  volume: number;
}

export interface GameResult {
  winner: Team | 'DRAW';
  mvp: string;
  mvpKills: number;
  mvpTeam: Team;
  tScore: number;
  ctScore: number;
}

export interface EngineEvents {
  onHUD: (h: HudState) => void;
  onKillFeed: (feed: KillEntry[]) => void;
  onScoreboard: (rows: ScoreRow[]) => void;
  onHitmarker: (kill: boolean, headshot: boolean, knifed: boolean) => void;
  onDamage: (amount: number, angleDeg: number, killerName: string) => void;
  onKillConfirm: (victim: string, reward: number, headshot: boolean, weapon: string) => void;
  onGameOver: (r: GameResult) => void;
  onLockChange: (locked: boolean) => void;
  onToast: (msg: string, kind: 'info' | 'warn' | 'cash') => void;
}
