import * as THREE from 'three';
import { SoundEngine } from './audio';
import { WEAPONS, buildViewModel, buildBotGun, PRIMARY_DEFAULT, SECONDARY_DEFAULT, type WeaponId } from './weapons';
import { buildMap, type Collider, type MapData } from './map';
import type { Team, Difficulty, EngineOptions, EngineEvents, HudState, KillEntry, ScoreRow, MapEntity, GameResult } from './types';

// ---------------------------------------------------------------- helpers
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const DIFF: Record<Difficulty, { skillMin: number; skillMax: number; reactMin: number; reactMax: number; dmg: number; speed: number }> = {
  recruit: { skillMin: 0.22, skillMax: 0.42, reactMin: 0.7, reactMax: 1.25, dmg: 0.7, speed: 3.9 },
  veteran: { skillMin: 0.4, skillMax: 0.62, reactMin: 0.42, reactMax: 0.8, dmg: 1.0, speed: 4.4 },
  elite: { skillMin: 0.58, skillMax: 0.82, reactMin: 0.24, reactMax: 0.55, dmg: 1.12, speed: 4.9 },
};

const T_NAMES = ['Vex', 'Rattler', 'Havoc', 'Nomad', 'Kodiak', 'Sable', 'Dune', 'Jackal'];
const CT_NAMES = ['Glacier', 'Halo', 'Bishop', 'Nova', 'Drift', 'Sentinel', 'Echo', 'Pine'];

// ---------------------------------------------------------------- types
interface Ammo { mag: number; reserve: number }

interface Bot {
  name: string; team: Team; bot: true;
  hp: number; armor: number; alive: boolean;
  pos: THREE.Vector3; yaw: number; targetYaw: number;
  group: THREE.Group; legL: THREE.Mesh; legR: THREE.Mesh; torso: THREE.Mesh; gunTip: THREE.Object3D; tag: THREE.Sprite | null;
  weapon: WeaponId; ammo: Ammo; reloadingUntil: number; lastShot: number;
  state: 'patrol' | 'engage';
  waypoint: THREE.Vector3; nextThink: number;
  targetIsPlayer: boolean; targetBot: Bot | null; reactionAt: number;
  burstLeft: number; nextBurstAt: number; nextShotAt: number;
  strafeDir: number; strafeAt: number;
  respawnAt: number; deathT: number;
  kills: number; deaths: number; headshots: number; money: number; ping: number;
  skill: number; speed: number; walkPhase: number;
  headBox: THREE.Mesh; bodyBox: THREE.Mesh;
  aimError: number;
}

interface Particle { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; maxLife: number; grav: number; spin: number }
interface Tracer { mesh: THREE.Mesh; life: number; maxLife: number }
interface Nade { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; fuse: number; lastBeep: number; fromPlayer: boolean }

// ================================================================== ENGINE
export class GameEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private map: MapData;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private opts: EngineOptions;
  private ev: EngineEvents;
  sound = new SoundEngine();

  private time = 0;
  private phase: 'warmup' | 'live' | 'over' = 'warmup';
  private warmupLeft = 3.5;
  private timeLeft = 480;
  private target = 30;
  private tScore = 0;
  private ctScore = 0;
  private result: GameResult | null = null;

  locked = false;
  private keys = new Set<string>();
  private mouseDown = false;
  aiming = false;

  // player state
  private pPos = new THREE.Vector3();
  private pVel = new THREE.Vector3();
  private yaw = 0; private pitch = 0;
  private hp = 100; private armor = 0; private helmet = false;
  private alive = true; private respawnAt = 0; private deathT = 0; private protectionUntil = 0;
  private primary: WeaponId; private secondary: WeaponId;
  private slot: 1 | 2 | 3 = 1;
  private ammo: Record<string, Ammo> = {};
  private nades = 0; private money = 800;
  private pKills = 0; private pDeaths = 0; private pHeadshots = 0;
  private crouched = false; private onGround = true;
  private lastShot = 0; private reloadingUntil = 0; private reloadStages = 0;
  private switchingUntil = 0; private scoped = false; private focus = false;
  private bloom = 0; private bobPhase = 0; private stepAcc = 0;
  private shake = 0; private kick = 0; private knifeT = 0;
  private killerName = ''; private killerWeapon = ''; private killerHs = false;
  private wasAirborne = false;

  private bots: Bot[] = [];
  private viewmodels = new Map<WeaponId, { group: THREE.Group; muzzle: THREE.Object3D }>();
  private gunRig = new THREE.Group();
  private muzzleLight = new THREE.PointLight(0xffc37a, 0, 18, 2);
  private muzzleSprite: THREE.Sprite;
  private flashTex: THREE.CanvasTexture;

  private particles: Particle[] = [];
  private tracers: Tracer[] = [];
  private nadesLive: Nade[] = [];
  private snow!: THREE.Points;
  private snowVel!: Float32Array;

  private feed: KillEntry[] = [];
  private feedId = 1;
  private hudTimer = 0; private scoreTimer = 0; private feedTimer = 0;
  private raycaster = new THREE.Raycaster();

  private onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private onMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
  private onMouseUp = (e: MouseEvent) => this.handleMouseUp(e);
  private onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onWheel = (e: WheelEvent) => this.handleWheel(e);
  private onLockChange = () => this.handleLockChange();
  private onCtx = (e: Event) => e.preventDefault();
  private onResize = () => this.handleResize();
  private onGesture = () => this.sound.resume();

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions, ev: EngineEvents) {
    this.canvas = canvas;
    this.opts = { ...opts };
    this.ev = ev;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 600);
    this.camera.rotation.order = 'YXZ';

    this.map = buildMap(this.scene);

    this.primary = PRIMARY_DEFAULT[opts.team];
    this.secondary = SECONDARY_DEFAULT[opts.team];
    for (const id of Object.keys(WEAPONS)) {
      const def = WEAPONS[id as WeaponId];
      this.ammo[id] = { mag: def.mag, reserve: def.reserve };
    }

    // gun rig attached to camera
    this.camera.add(this.gunRig);
    this.gunRig.position.set(0.26, -0.25, -0.5);
    this.scene.add(this.camera);
    for (const id of ['ak47', 'm4a1s', 'awp', 'glock', 'usps', 'deagle', 'knife'] as WeaponId[]) {
      const vm = buildViewModel(id);
      vm.group.visible = false;
      this.gunRig.add(vm.group);
      this.viewmodels.set(id, vm);
    }
    this.updateGunVisibility();

    // muzzle flash shared assets
    const fc = document.createElement('canvas');
    fc.width = fc.height = 64;
    const fx = fc.getContext('2d')!;
    const g = fx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.35, 'rgba(255,190,110,0.9)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    fx.fillStyle = g; fx.fillRect(0, 0, 64, 64);
    this.flashTex = new THREE.CanvasTexture(fc);
    this.muzzleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.muzzleSprite.scale.set(0.5, 0.5, 1);
    this.muzzleSprite.visible = false;
    this.scene.add(this.muzzleSprite);
    this.scene.add(this.muzzleLight);

    this.buildSnow();
    this.spawnPlayer(true);
    this.spawnBots();

    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onLockChange);
    canvas.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('pointerdown', this.onGesture);
    window.addEventListener('keydown', this.onGesture);
  }

  // ------------------------------------------------------------- lifecycle
  start() {
    this.sound.init();
    this.sound.setVolume(this.opts.volume);
    this.sound.startAmbience();
    this.sound.roundStart();
    this.pushHud(true);
    this.pushScore();
    this.clock.start();
    this.loop();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.canvas.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('pointerdown', this.onGesture);
    window.removeEventListener('keydown', this.onGesture);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.sound.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.renderer.dispose();
  }

  requestLock() {
    if (this.locked || this.disposed) return;
    this.sound.resume();
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch { /* noop */ }
  }

  exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  setSensitivity(s: number) { this.opts.sensitivity = s; }
  setVolume(v: number) { this.opts.volume = v; this.sound.setVolume(v); }

  // ------------------------------------------------------------- setup
  private buildSnow() {
    const N = 2200;
    const pos = new Float32Array(N * 3);
    this.snowVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rand(-70, 70);
      pos[i * 3 + 1] = rand(0, 42);
      pos[i * 3 + 2] = rand(-70, 70);
      this.snowVel[i] = rand(1.4, 4.2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.85, depthWrite: false });
    this.snow = new THREE.Points(geo, mat);
    this.scene.add(this.snow);
  }

  private spawnPlayer(first = false) {
    const list = this.opts.team === 'T' ? this.map.tSpawns : this.map.ctSpawns;
    const s = list[Math.floor(Math.random() * list.length)];
    this.pPos.set(s.x + rand(-1, 1), 0, s.z + rand(-1, 1));
    this.pVel.set(0, 0, 0);
    this.yaw = s.yaw + rand(-0.2, 0.2);
    this.pitch = 0;
    this.hp = 100;
    this.alive = true;
    this.deathT = 0;
    this.crouched = false;
    this.reloadingUntil = 0;
    this.scoped = false; this.aiming = false;
    if (this.armor > 0) this.armor = 100;
    // refill mags on respawn, keep reserves (mercy refill if empty)
    for (const id of [this.primary, this.secondary]) {
      const def = WEAPONS[id];
      const a = this.ammo[id];
      if (a.reserve <= 0 && !first) a.reserve = Math.ceil(def.reserve / 2);
      a.mag = def.mag;
    }
    if (!first) this.protectionUntil = this.time + 1.5;
    else this.protectionUntil = this.time + 3.5;
    this.pushHud(true);
  }

  private spawnBots() {
    const d = DIFF[this.opts.difficulty];
    const mkTeam = (team: Team, count: number, names: string[]) => {
      for (let i = 0; i < count; i++) {
        let name = names[i % names.length];
        if (name.toLowerCase() === this.opts.playerName.toLowerCase()) name = name + '_';
        const skill = rand(d.skillMin, d.skillMax);
        const weapon: WeaponId = i === 0 ? 'awp' : team === 'T' ? 'ak47' : 'm4a1s';
        const def = WEAPONS[weapon];
        const bot: Bot = {
          name, team, bot: true, hp: 100, armor: Math.random() < 0.5 ? 100 : 0, alive: true,
          pos: new THREE.Vector3(), yaw: 0, targetYaw: 0,
          group: new THREE.Group(), legL: null as unknown as THREE.Mesh, legR: null as unknown as THREE.Mesh,
          torso: null as unknown as THREE.Mesh, gunTip: null as unknown as THREE.Object3D, tag: null,
          weapon, ammo: { mag: def.mag, reserve: def.reserve * 3 },
          reloadingUntil: 0, lastShot: 0, state: 'patrol',
          waypoint: new THREE.Vector3(), nextThink: rand(0, 0.3),
          targetIsPlayer: false, targetBot: null, reactionAt: 0,
          burstLeft: 0, nextBurstAt: 0, nextShotAt: 0,
          strafeDir: 1, strafeAt: 0, respawnAt: 0, deathT: 0,
          kills: 0, deaths: 0, headshots: 0, money: 800, ping: Math.floor(rand(12, 85)),
          skill, speed: d.speed * rand(0.92, 1.08), walkPhase: rand(0, 6),
          headBox: null as unknown as THREE.Mesh, bodyBox: null as unknown as THREE.Mesh,
          aimError: 0,
        };
        this.buildBotMesh(bot);
        this.placeBotAtSpawn(bot);
        this.bots.push(bot);
      }
    };
    const perSide = this.opts.squad;
    if (this.opts.team === 'T') {
      mkTeam('T', perSide - 1, T_NAMES);
      mkTeam('CT', perSide, CT_NAMES);
    } else {
      mkTeam('CT', perSide - 1, CT_NAMES);
      mkTeam('T', perSide, T_NAMES);
    }
  }

  private buildBotMesh(bot: Bot) {
    const isT = bot.team === 'T';
    const jacket = new THREE.MeshStandardMaterial({ color: isT ? 0xb5762a : 0x2e6fb7, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: isT ? 0x4a3b2a : 0x1f2a3a, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a67c, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: isT ? 0x5a4326 : 0x1d3a5f, roughness: 0.8 });
    const g = bot.group;

    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.24), pants);
    legL.position.set(-0.14, 0.39, 0); legL.castShadow = true;
    const legR = legL.clone(); legR.position.x = 0.14;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.32), jacket);
    torso.position.set(0, 1.12, 0); torso.castShadow = true;
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.36), dark);
    vest.position.set(0, 1.15, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
    head.position.set(0, 1.68, 0); head.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.3), dark);
    cap.position.set(0, 1.85, 0);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), jacket);
    armL.position.set(-0.2, 1.3, -0.3);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.42), jacket);
    armR.position.set(0.2, 1.28, -0.24);
    const { group: gun, muzzle } = buildBotGun(bot.weapon);
    gun.position.set(0.14, 1.32, -0.35);
    bot.gunTip = muzzle;
    g.add(legL, legR, torso, vest, head, cap, armL, armR, gun);
    bot.legL = legL; bot.legR = legR; bot.torso = torso;

    // invisible hitboxes (material invisible => skipped by renderer, still raycastable)
    const hbMat = new THREE.MeshBasicMaterial({ visible: false });
    const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), hbMat);
    headBox.position.set(0, 1.62, 0);
    headBox.userData = { bot, part: 'head' };
    const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.55), hbMat);
    bodyBox.position.set(0, 0.85, 0);
    bodyBox.userData = { bot, part: 'body' };
    g.add(headBox, bodyBox);
    bot.headBox = headBox; bot.bodyBox = bodyBox;

    // teammate name tag
    if (bot.team === this.opts.team) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.font = 'bold 30px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const w = ctx.measureText(bot.name).width + 28;
      ctx.fillRect(128 - w / 2, 6, w, 44);
      ctx.fillStyle = isT ? '#f5b562' : '#7cc7ff';
      ctx.fillText(bot.name, 128, 40);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
      spr.scale.set(1.9, 0.475, 1);
      spr.position.set(0, 2.25, 0);
      spr.renderOrder = 999;
      g.add(spr);
      bot.tag = spr;
    }
    this.scene.add(g);
  }

  private placeBotAtSpawn(bot: Bot) {
    const list = bot.team === 'T' ? this.map.tSpawns : this.map.ctSpawns;
    const s = list[Math.floor(Math.random() * list.length)];
    bot.pos.set(s.x + rand(-1.5, 1.5), 0, s.z + rand(-1.5, 1.5));
    bot.yaw = s.yaw + rand(-0.3, 0.3);
    bot.targetYaw = bot.yaw;
    bot.hp = 100;
    bot.alive = true;
    bot.deathT = 0;
    bot.state = 'patrol';
    bot.targetBot = null; bot.targetIsPlayer = false;
    bot.burstLeft = 0;
    const def = WEAPONS[bot.weapon];
    bot.ammo = { mag: def.mag, reserve: def.reserve * 3 };
    bot.waypoint.copy(this.randomWaypoint());
    bot.group.rotation.set(0, bot.yaw, 0);
    bot.group.position.copy(bot.pos);
    bot.group.visible = true;
  }

  private randomWaypoint(): THREE.Vector3 {
    const wps = this.map.waypoints;
    return wps[Math.floor(Math.random() * wps.length)];
  }

  // ------------------------------------------------------------- input
  private handleLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) { this.mouseDown = false; this.aiming = false; this.keys.clear(); }
    this.ev.onLockChange(this.locked);
  }

  private handleMouseMove(e: MouseEvent) {
    if (!this.locked || !this.alive || this.phase === 'over') return;
    const s = 0.0022 * this.opts.sensitivity * (this.scoped ? 0.3 : this.focus ? 0.7 : 1);
    this.yaw -= e.movementX * s;
    this.pitch -= e.movementY * s;
    this.pitch = clamp(this.pitch, -1.45, 1.45);
  }

  private handleMouseDown(e: MouseEvent) {
    if (!this.locked || this.phase !== 'live' || !this.alive) return;
    if (e.button === 0) {
      this.mouseDown = true;
      this.tryFire(this.time, true);
    } else if (e.button === 2) {
      const def = this.currentDef();
      if (this.slot !== 3 && this.time > this.switchingUntil && this.time > this.reloadingUntil) {
        this.aiming = true;
        if (def.id === 'awp') { this.scoped = true; this.sound.scope(); }
        else this.focus = true;
      }
    }
  }

  private handleMouseUp(e: MouseEvent) {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) { this.aiming = false; this.scoped = false; this.focus = false; }
  }

  private handleWheel(e: WheelEvent) {
    if (!this.locked || !this.alive || this.phase !== 'live') return;
    const d = e.deltaY > 0 ? 1 : -1;
    const order: Array<1 | 2 | 3> = [1, 2, 3];
    const next = order[(order.indexOf(this.slot) + d + 3) % 3];
    this.switchSlot(next);
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.code === 'Tab' || e.code === 'KeyB') return; // handled by React UI
    this.keys.add(e.code);
    if (!this.locked || this.phase !== 'live' || !this.alive) return;
    if (e.code === 'Digit1') this.switchSlot(1);
    else if (e.code === 'Digit2') this.switchSlot(2);
    else if (e.code === 'Digit3') this.switchSlot(3);
    else if (e.code === 'KeyR') this.startReload();
    else if (e.code === 'KeyG') this.throwGrenade();
    else if (e.code === 'KeyC') this.crouched = !this.crouched;
  }

  private handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------- weapons
  private currentId(): WeaponId {
    return this.slot === 1 ? this.primary : this.slot === 2 ? this.secondary : 'knife';
  }
  private currentDef() { return WEAPONS[this.currentId()]; }

  private switchSlot(n: 1 | 2 | 3) {
    if (n === this.slot || this.time < this.switchingUntil) return;
    this.slot = n;
    this.switchingUntil = this.time + 0.38;
    this.reloadingUntil = 0;
    this.scoped = false; this.focus = false; this.aiming = false;
    this.updateGunVisibility();
    this.sound.swap();
    this.pushHud(true);
  }

  private updateGunVisibility() {
    const id = this.currentId();
    this.viewmodels.forEach((vm, key) => { vm.group.visible = key === id; });
  }

  private tryFire(now: number, freshClick: boolean) {
    if (!this.alive || this.phase !== 'live') return;
    if (now < this.switchingUntil || now < this.reloadingUntil) return;
    const def = this.currentDef();
    const interval = 60 / def.rpm;
    if (now - this.lastShot < interval) return;
    if (!def.auto && !freshClick) return;

    if (def.id === 'knife') { this.swingKnife(now); return; }

    const a = this.ammo[def.id];
    if (a.mag <= 0) {
      this.sound.empty();
      this.lastShot = now;
      this.startReload();
      return;
    }
    a.mag--;
    this.lastShot = now;

    // spread
    const speed = Math.hypot(this.pVel.x, this.pVel.z);
    let spread = def.spread;
    if (def.id === 'awp') spread = this.scoped ? 0.03 : 7.0;
    else if (this.focus) spread *= 0.55;
    spread += this.bloom + speed * 0.22 + (this.onGround ? 0 : 1.2) - (this.crouched ? 0.18 : 0);
    spread = Math.max(0.02, spread);

    // direction with cone jitter
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const jitter = THREE.MathUtils.degToRad(spread);
    dir.x += rand(-jitter, jitter); dir.y += rand(-jitter, jitter); dir.z += rand(-jitter, jitter) * 0.3;
    dir.normalize();

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.raycaster.set(origin, dir);
    this.raycaster.far = 220;

    const targets: THREE.Object3D[] = [this.map.ground, ...this.map.solids];
    for (const b of this.bots) {
      if (b.alive && b.team !== this.opts.team) targets.push(b.headBox, b.bodyBox);
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    const hit = hits[0];
    const end = hit ? hit.point.clone() : origin.clone().addScaledVector(dir, 160);

    // muzzle world pos
    const vm = this.viewmodels.get(def.id)!;
    const mzl = new THREE.Vector3();
    vm.muzzle.getWorldPosition(mzl);

    this.flashMuzzle(mzl);
    this.spawnTracer(mzl, end, 0xffe9b8);

    if (hit && hit.object.userData.bot) {
      const bot: Bot = hit.object.userData.bot;
      const head = hit.object.userData.part === 'head';
      let dmg = def.damage * (head ? def.headshotMult : 1);
      const dist = origin.distanceTo(hit.point);
      if (dist > def.range) dmg *= clamp(1 - (dist - def.range) * 0.012, 0.45, 1);
      this.damageBot(bot, dmg, true, head, def);
      this.puff(hit.point, 0xa01818, 6, 3.2, 0.09, 9, 0.5);
    } else if (hit) {
      this.impactEffect(hit.point, hit.face?.normal);
    }

    // recoil + bloom
    this.pitch = clamp(this.pitch + def.kick * 0.0105, -1.45, 1.45);
    this.yaw += rand(-1, 1) * def.kick * 0.0035;
    this.bloom = Math.min(2.4, this.bloom + def.kick * 0.16);
    this.kick = 1;
    this.shake = Math.min(1, this.shake + def.kick * 0.06);

    // sound
    const s = this.sound;
    if (def.id === 'ak47') s.ak();
    else if (def.id === 'm4a1s') s.m4();
    else if (def.id === 'awp') s.awp();
    else if (def.id === 'deagle') s.deagle();
    else if (def.id === 'usps') s.usp();
    else s.pistol();

    if (a.mag === 0) this.ev.onToast('Magazine empty — press R to reload', 'warn');
    this.pushHud(true);
  }

  private swingKnife(now: number) {
    this.lastShot = now;
    this.knifeT = 1;
    this.sound.knifeSwing();
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.raycaster.set(origin, dir);
    this.raycaster.far = 2.7;
    const targets: THREE.Object3D[] = [];
    for (const b of this.bots) {
      if (b.alive && b.team !== this.opts.team) targets.push(b.headBox, b.bodyBox);
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits[0]) {
      const bot: Bot = hits[0].object.userData.bot;
      const head = hits[0].object.userData.part === 'head';
      this.sound.knifeHit();
      this.damageBot(bot, WEAPONS.knife.damage * (head ? 1.6 : 1), true, head, WEAPONS.knife);
      this.puff(hits[0].point, 0xa01818, 8, 3.5, 0.09, 9, 0.5);
    }
  }

  private startReload() {
    const def = this.currentDef();
    if (def.id === 'knife' || !this.alive || this.phase !== 'live') return;
    const a = this.ammo[def.id];
    if (this.time < this.reloadingUntil || a.mag >= def.mag) return;
    if (a.reserve <= 0) { this.sound.denied(); this.ev.onToast('No reserve ammo — buy a refill [B]', 'warn'); return; }
    this.reloadingUntil = this.time + def.reloadTime;
    this.reloadStages = 0;
    this.scoped = false; this.focus = false;
    this.pushHud(true);
  }

  private throwGrenade() {
    if (this.nades <= 0) { this.sound.denied(); this.ev.onToast('No HE grenades — buy one [B]', 'warn'); return; }
    if (this.nadesLive.filter((n) => n.fromPlayer).length >= 2) return;
    this.nades--;
    this.sound.pin();
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2f4a2c, roughness: 0.5, metalness: 0.4 }));
    mesh.position.copy(origin).addScaledVector(dir, 0.6);
    this.scene.add(mesh);
    this.nadesLive.push({
      mesh, pos: mesh.position.clone(),
      vel: dir.multiplyScalar(15).add(new THREE.Vector3(0, 3.5, 0)),
      fuse: 2.0, lastBeep: 0, fromPlayer: true,
    });
    this.pushHud(true);
  }

  // ------------------------------------------------------------- damage
  private damageBot(bot: Bot, dmg: number, byPlayer: boolean, head: boolean, def: { name: string; armorPen: number }) {
    if (!bot.alive || this.phase !== 'live') return;
    if (bot.armor > 0) {
      dmg = dmg * (1 - 0.5 * def.armorPen);
      bot.armor = Math.max(0, bot.armor - dmg * 0.4);
    }
    bot.hp -= dmg;
    if (byPlayer) {
      this.sound.hit(head);
      if (bot.hp <= 0) this.handleKill('player', bot, def.name, head, false);
      else this.ev.onHitmarker(false, head, def.name === 'Tactical Knife');
    } else if (bot.hp <= 0) {
      this.handleKill(null, bot, def.name, head, false);
    }
    // aggro: bots retaliate against attacker
    if (bot.hp > 0 && byPlayer) {
      bot.targetIsPlayer = true; bot.targetBot = null;
      bot.state = 'engage';
      bot.reactionAt = Math.min(bot.reactionAt, this.time + 0.3);
    }
  }

  private damagePlayer(dmg: number, from: THREE.Vector3, killerName: string, byBot: Bot | null, head: boolean) {
    if (!this.alive || this.phase !== 'live' || this.time < this.protectionUntil) return;
    if (this.armor > 0) {
      const pen = byBot ? WEAPONS[byBot.weapon].armorPen : 0.8;
      dmg = head && this.helmet ? dmg * 0.55 : dmg * (1 - 0.5 * pen);
      this.armor = Math.max(0, this.armor - dmg * 0.35);
    } else if (head) {
      dmg *= 1.6;
    }
    this.hp -= dmg;
    this.sound.hurt();
    this.shake = Math.min(1.2, this.shake + 0.25);
    // direction angle
    const dx = from.x - this.pPos.x, dz = from.z - this.pPos.z;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const cross = fx * dz - fz * dx;
    const dot = fx * dx + fz * dz;
    const ang = (Math.atan2(cross, dot) * 180) / Math.PI;
    this.ev.onDamage(dmg, -ang, killerName);
    if (this.hp <= 0) this.handleKill(byBot, 'player', byBot ? WEAPONS[byBot.weapon].name : 'HE Grenade', head, false);
    else this.pushHud(true);
  }

  private handleKill(killer: Bot | 'player' | null, victim: Bot | 'player', weapon: string, headshot: boolean, suicide: boolean) {
    const vName = victim === 'player' ? this.opts.playerName : victim.name;
    const vTeam: Team = victim === 'player' ? this.opts.team : victim.team;
    let kName = '—';
    let kTeam: Team | 'X' = 'X';
    if (killer === 'player') { kName = this.opts.playerName; kTeam = this.opts.team; }
    else if (killer) { kName = killer.name; kTeam = killer.team; }

    // score
    if (!suicide && killer) {
      if (kTeam === 'T') this.tScore++; else this.ctScore++;
    } else {
      if (vTeam === 'T') this.ctScore++; else this.tScore++;
    }

    // victim dies
    if (victim === 'player') {
      this.alive = false;
      this.pDeaths++;
      this.deathT = 0.0001;
      this.respawnAt = this.time + 3.2;
      this.killerName = suicide ? 'Yourself' : kName;
      this.killerWeapon = weapon;
      this.killerHs = headshot;
      this.sound.death();
      this.scoped = false; this.focus = false; this.mouseDown = false;
    } else {
      victim.alive = false;
      victim.deaths++;
      victim.deathT = 0.0001;
      victim.respawnAt = this.time + 3.2;
      this.sound.death(this.spatial(victim.pos, 0.8));
    }

    // killer rewards
    if (!suicide && killer === 'player') {
      this.pKills++;
      if (headshot) this.pHeadshots++;
      const reward = weapon === 'Tactical Knife' ? 600 : headshot ? 400 : 300;
      this.money = Math.min(16000, this.money + reward);
      this.hp = Math.min(100, this.hp + 25); // adrenaline
      this.sound.killConfirm();
      this.ev.onHitmarker(true, headshot, weapon === 'Tactical Knife');
      this.ev.onKillConfirm(vName, reward, headshot, weapon);
    } else if (!suicide && killer && typeof killer === 'object') {
      killer.kills++;
      if (headshot) killer.headshots++;
      killer.money = Math.min(16000, killer.money + 300);
    }

    this.feed.unshift({ id: this.feedId++, killer: kName, victim: vName, killerTeam: kTeam, victimTeam: vTeam, weapon, headshot, suicide, t: this.time });
    if (this.feed.length > 7) this.feed.pop();
    this.ev.onKillFeed([...this.feed]);
    this.pushHud(true);
    this.pushScore();
    this.checkWin();
  }

  private checkWin() {
    if (this.phase === 'over') return;
    let winner: Team | 'DRAW' | null = null;
    if (this.tScore >= this.target && this.tScore > this.ctScore) winner = 'T';
    else if (this.ctScore >= this.target && this.ctScore > this.tScore) winner = 'CT';
    else if (this.tScore >= this.target && this.ctScore >= this.target) winner = this.tScore === this.ctScore ? 'DRAW' : this.tScore > this.ctScore ? 'T' : 'CT';
    if (winner) this.endMatch(winner);
  }

  private endMatch(winner: Team | 'DRAW') {
    this.phase = 'over';
    this.scoped = false; this.focus = false; this.aiming = false; this.mouseDown = false;
    let mvp = this.opts.playerName, mvpKills = this.pKills, mvpTeam = this.opts.team;
    for (const b of this.bots) {
      if (b.kills > mvpKills) { mvp = b.name; mvpKills = b.kills; mvpTeam = b.team; }
    }
    this.result = { winner, mvp, mvpKills, mvpTeam, tScore: this.tScore, ctScore: this.ctScore };
    if (winner === 'DRAW') this.sound.lose();
    else if (winner === this.opts.team) this.sound.win();
    else this.sound.lose();
    this.exitLock();
    this.pushHud(true);
    this.ev.onGameOver(this.result);
  }

  // ------------------------------------------------------------- buy menu
  buy(id: string): boolean {
    if (this.phase === 'over' || !this.alive) return false;
    const price = (p: number) => {
      if (this.money < p) { this.sound.denied(); this.ev.onToast('Not enough cash', 'warn'); return false; }
      this.money -= p;
      return true;
    };
    switch (id) {
      case 'awp':
        if (this.primary === 'awp') return false;
        if (!price(WEAPONS.awp.price)) return false;
        this.primary = 'awp';
        this.ammo.awp = { mag: 5, reserve: 15 };
        this.slot = 1; this.updateGunVisibility();
        break;
      case 'rifle': {
        const d = this.opts.team === 'T' ? 'ak47' : 'm4a1s';
        if (this.primary === d) return false;
        this.primary = d;
        this.ammo[d] = { mag: WEAPONS[d].mag, reserve: WEAPONS[d].reserve };
        this.slot = 1; this.updateGunVisibility();
        break;
      }
      case 'deagle':
        if (this.secondary === 'deagle') return false;
        if (!price(700)) return false;
        this.secondary = 'deagle';
        this.ammo.deagle = { mag: 7, reserve: 35 };
        break;
      case 'kevlar':
        if (this.armor >= 100) { this.sound.denied(); return false; }
        if (!price(650)) return false;
        this.armor = 100;
        break;
      case 'helmet':
        if (this.helmet) return false;
        if (this.armor <= 0) { this.sound.denied(); this.ev.onToast('Buy Kevlar first', 'warn'); return false; }
        if (!price(350)) return false;
        this.helmet = true;
        break;
      case 'nade':
        if (this.nades >= 2) { this.sound.denied(); return false; }
        if (!price(300)) return false;
        this.nades++;
        break;
      case 'ammo': {
        const ids = [this.primary, this.secondary];
        let need = false;
        for (const wid of ids) {
          const def = WEAPONS[wid];
          if (this.ammo[wid].reserve < def.reserve) need = true;
        }
        if (!need) { this.sound.denied(); this.ev.onToast('Ammo already full', 'info'); return false; }
        if (!price(200)) return false;
        for (const wid of ids) this.ammo[wid].reserve = WEAPONS[wid].reserve;
        break;
      }
      default: return false;
    }
    this.sound.buy();
    this.pushHud(true);
    this.pushScore();
    return true;
  }

  // ------------------------------------------------------------- collision
  private collideCircle(x: number, z: number, r: number, feetY: number, height: number): [number, number] {
    for (const c of this.map.colliders) {
      if (feetY + 0.35 >= c.y1 || feetY + height <= c.y0) continue;
      const nx = clamp(x, c.x0, c.x1), nz = clamp(z, c.z0, c.z1);
      const dx = x - nx, dz = z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          x = nx + (dx / d) * r;
          z = nz + (dz / d) * r;
        } else {
          // inside: push along min axis
          const pl = x - c.x0, pr = c.x1 - x, pt = z - c.z0, pb = c.z1 - z;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) x = c.x0 - r; else if (m === pr) x = c.x1 + r;
          else if (m === pt) z = c.z0 - r; else z = c.z1 + r;
        }
      }
    }
    const B = this.map.bounds;
    x = clamp(x, -B, B); z = clamp(z, -B, B);
    return [x, z];
  }

  private groundHeight(x: number, z: number, feetY: number): number {
    let g = 0;
    for (const c of this.map.colliders) {
      if (x > c.x0 - 0.3 && x < c.x1 + 0.3 && z > c.z0 - 0.3 && z < c.z1 + 0.3) {
        if (c.y1 <= feetY + 0.55 && c.y1 > g) g = c.y1;
      }
    }
    return g;
  }

  private losBlocked(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    this.raycaster.set(from, dir);
    this.raycaster.far = dist - 0.4;
    const hits = this.raycaster.intersectObjects(this.map.solids, false);
    return hits.length > 0;
  }

  private spatial(pos: THREE.Vector3, base = 1): { vol: number; pan: number } {
    const dx = pos.x - this.pPos.x, dz = pos.z - this.pPos.z;
    const dist = Math.hypot(dx, dz);
    const vol = clamp(base / (1 + dist * 0.055), 0.02, 1);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    const pan = clamp((dx * rx + dz * rz) / Math.max(1, dist), -1, 1);
    return { vol, pan };
  }

  // ------------------------------------------------------------- effects
  private puffGeoCache = new Map<string, THREE.BoxGeometry>();
  private puffMatCache = new Map<number, THREE.MeshBasicMaterial>();

  private puff(p: THREE.Vector3, color: number, count: number, speed: number, size: number, grav: number, life: number) {
    const gk = size.toFixed(3);
    let geo = this.puffGeoCache.get(gk);
    if (!geo) {
      geo = new THREE.BoxGeometry(size, size, size);
      this.puffGeoCache.set(gk, geo);
    }
    let mat = this.puffMatCache.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
      this.puffMatCache.set(color, mat);
    }
    for (let i = 0; i < count; i++) {
      if (this.particles.length > 260) {
        const old = this.particles.shift()!;
        this.scene.remove(old.mesh);
        this.disposeParticle(old);
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(p);
      const vel = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).multiplyScalar(speed * rand(0.4, 1));
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, life: life * rand(0.6, 1.2), maxLife: life, grav, spin: rand(-6, 6) });
    }
  }

  private impactEffect(p: THREE.Vector3, normal?: THREE.Vector3 | null) {
    this.puff(p, 0xeef3fa, 7, 2.6, 0.09, 8, 0.45);
    this.puff(p, 0xffd9a0, 3, 4.5, 0.05, 12, 0.25);
    if (normal) {
      const s = this.spatial(p, 0.5);
      this.sound.bounce({ vol: s.vol * 0.5, pan: s.pan });
    }
  }

  private spawnTracer(a: THREE.Vector3, b: THREE.Vector3, color: number) {
    const len = a.distanceTo(b);
    if (len < 1) return;
    const geo = new THREE.BoxGeometry(0.035, 0.035, len);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.lookAt(b);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.08, maxLife: 0.08 });
  }

  private flashMuzzle(worldPos: THREE.Vector3) {
    this.muzzleSprite.position.copy(worldPos);
    this.muzzleSprite.visible = true;
    this.muzzleSprite.material.rotation = rand(0, Math.PI);
    const s = rand(0.4, 0.62);
    this.muzzleSprite.scale.set(s, s, 1);
    this.muzzleLight.position.copy(worldPos);
    this.muzzleLight.intensity = 40;
  }

  private explode(pos: THREE.Vector3, fromPlayer: boolean) {
    const s = this.spatial(pos, 1.4);
    this.sound.explosion({ vol: Math.min(1, s.vol + 0.25), pan: s.pan });
    this.puff(pos, 0xffd9a0, 26, 9, 0.16, 7, 0.7);
    this.puff(pos, 0xff7a2a, 18, 6, 0.22, 5, 0.55);
    this.puff(pos, 0x555c66, 14, 3.4, 0.3, -1.2, 1.4);
    this.puff(pos, 0xffffff, 16, 11, 0.1, 10, 0.6);
    // shockwave ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.12, 8, 26),
      new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.position.copy(pos);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    const ringPart = { mesh: ring as unknown as THREE.Mesh, vel: new THREE.Vector3(), life: 0.4, maxLife: 0.4, grav: 0, spin: 0 };
    (ring as unknown as { userData: { shock: boolean } }).userData = { shock: true };
    this.particles.push(ringPart);
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 120;

    const R = 7.5;
    // damage enemies of the thrower
    const throwerTeam = this.opts.team; // only player throws
    for (const b of this.bots) {
      if (!b.alive || b.team === throwerTeam) continue;
      const d = b.pos.clone().setY(1).distanceTo(pos.clone().setY(1));
      if (d < R) {
        const dmg = lerp(105, 22, d / R);
        this.damageBot(b, dmg, fromPlayer, false, { name: 'HE Grenade', armorPen: 0.8 });
        if (b.alive) { b.targetIsPlayer = true; b.state = 'engage'; }
      }
    }
    // self damage
    const pd = new THREE.Vector3(this.pPos.x, 1, this.pPos.z).distanceTo(pos.clone().setY(1));
    if (pd < R && fromPlayer) {
      const dmg = lerp(70, 12, pd / R);
      if (this.hp - dmg <= 0) {
        this.hp = 0;
        this.handleKill(null, 'player', 'HE Grenade', false, true);
      } else {
        this.hp -= dmg;
        this.sound.hurt();
        this.shake = Math.min(1.4, this.shake + 0.5);
      }
    }
    // shake by proximity
    const dist = Math.hypot(pos.x - this.pPos.x, pos.z - this.pPos.z);
    this.shake = Math.min(1.5, this.shake + clamp(1.6 - dist * 0.05, 0, 1));
    this.pushHud(true);
  }

  // ------------------------------------------------------------- main loop
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;

    this.updateSnow(dt);
    this.updateParticles(dt);
    this.updateTracers(dt);

    if (this.phase === 'warmup') {
      this.warmupLeft -= dt;
      if (this.warmupLeft <= 0) {
        this.phase = 'live';
        this.protectionUntil = 0;
        this.ev.onToast('Match live — first to 30 eliminations', 'info');
      }
      this.hudTimer += dt;
      if (this.hudTimer > 0.15) { this.hudTimer = 0; this.pushHud(); }
      this.syncCamera(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.phase === 'over') {
      // gentle idle orbit behind the action
      this.syncCamera(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // live — freeze gameplay while cursor is free (pause / buy)
    if (this.locked) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.endMatch(this.tScore === this.ctScore ? 'DRAW' : this.tScore > this.ctScore ? 'T' : 'CT');
        return;
      }
      this.updatePlayer(dt);
      this.updateBots(dt);
      this.updateNades(dt);
      // auto fire while held
      if (this.mouseDown && this.currentDef().auto) this.tryFire(this.time, false);
      this.bloom = Math.max(0, this.bloom - dt * 3.2);
    }

    // timers that run regardless
    this.hudTimer += dt;
    if (this.hudTimer > 0.1) { this.hudTimer = 0; this.pushHud(); }
    this.scoreTimer += dt;
    if (this.scoreTimer > 2) { this.scoreTimer = 0; this.pushScore(); }
    this.feedTimer += dt;
    if (this.feedTimer > 1) {
      this.feedTimer = 0;
      const before = this.feed.length;
      this.feed = this.feed.filter((f) => this.time - f.t < 7);
      if (this.feed.length !== before) this.ev.onKillFeed([...this.feed]);
    }

    this.syncCamera(dt);
    this.renderer.render(this.scene, this.camera);
  };

  // ------------------------------------------------------------- player
  private updatePlayer(dt: number) {
    if (!this.alive) {
      this.deathT += dt;
      if (this.time >= this.respawnAt) this.spawnPlayer();
      return;
    }

    // reload completion
    if (this.time < this.reloadingUntil) {
      const def = this.currentDef();
      const t = 1 - (this.reloadingUntil - this.time) / def.reloadTime;
      if (this.reloadStages === 0 && t > 0.1) { this.reloadStages = 1; this.sound.reload(0); }
      else if (this.reloadStages === 1 && t > 0.5) { this.reloadStages = 2; this.sound.reload(1); }
      else if (this.reloadStages === 2 && t > 0.85) { this.reloadStages = 3; this.sound.reload(2); }
    } else if (this.reloadStages !== 0 || (this.reloadingUntil !== 0 && this.time >= this.reloadingUntil)) {
      // finish
      if (this.reloadStages !== 0) {
        const def = this.currentDef();
        const a = this.ammo[def.id];
        const need = def.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
        this.reloadStages = 0;
        this.pushHud(true);
      }
      this.reloadingUntil = 0;
    }

    // movement
    const sneaking = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let speed = sneaking ? 2.9 : 5.3;
    if (this.crouched) speed *= 0.52;
    if (this.scoped) speed = 2.1;
    else if (this.focus) speed *= 0.62;
    if (this.time < this.switchingUntil) speed *= 0.85;

    const f = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const r = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = (-sin * f + cos * r);
    let mz = (-cos * f - sin * r);
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx = (mx / ml) * speed; mz = (mz / ml) * speed; }

    const accel = this.onGround ? 14 : 3.5;
    this.pVel.x = lerp(this.pVel.x, mx, Math.min(1, accel * dt));
    this.pVel.z = lerp(this.pVel.z, mz, Math.min(1, accel * dt));

    if (this.keys.has('Space') && this.onGround) {
      this.pVel.y = 6.1;
      this.onGround = false;
      this.sound.jump();
    }
    this.pVel.y -= 15 * dt;

    const height = this.crouched ? 1.3 : 1.8;
    let nx = this.pPos.x + this.pVel.x * dt;
    let nz = this.pPos.z + this.pVel.z * dt;
    [nx, nz] = this.collideCircle(nx, nz, 0.45, this.pPos.y, height);
    this.pPos.x = nx; this.pPos.z = nz;
    this.pPos.y += this.pVel.y * dt;
    const g = this.groundHeight(this.pPos.x, this.pPos.z, this.pPos.y);
    if (this.pPos.y <= g) {
      if (this.wasAirborne && this.pVel.y < -7) {
        this.sound.land();
        this.puff(new THREE.Vector3(this.pPos.x, 0.15, this.pPos.z), 0xeef3fa, 6, 2, 0.08, 8, 0.4);
      }
      this.pPos.y = g;
      this.pVel.y = 0;
      this.onGround = true;
      this.wasAirborne = false;
    } else {
      this.onGround = false;
      if (this.pPos.y - g > 0.5) this.wasAirborne = true;
    }

    // footsteps + bob
    const planar = Math.hypot(this.pVel.x, this.pVel.z);
    if (this.onGround && planar > 0.8) {
      this.stepAcc += planar * dt;
      this.bobPhase += planar * dt * 1.7;
      const stride = sneaking ? 1.5 : 2.3;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        this.sound.footstep(sneaking);
      }
    }

    // decay fx
    this.kick = Math.max(0, this.kick - dt * 6);
    this.knifeT = Math.max(0, this.knifeT - dt * 3.4);
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 900);
    if (this.muzzleLight.intensity <= 0.5) this.muzzleSprite.visible = false;
  }

  // ------------------------------------------------------------- bots
  private updateBots(dt: number) {
    const d = DIFF[this.opts.difficulty];
    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.deathT += dt;
        if (bot.deathT < 1) {
          const t = Math.min(1, bot.deathT * 2.2);
          bot.group.rotation.x = -Math.PI / 2 * t * 0.9;
          bot.group.position.y = bot.pos.y + Math.sin(t * Math.PI) * 0.15;
        }
        if (this.time >= bot.respawnAt) this.placeBotAtSpawn(bot);
        continue;
      }

      // reload finish
      if (bot.reloadingUntil !== 0 && this.time >= bot.reloadingUntil) {
        const def = WEAPONS[bot.weapon];
        const need = def.mag - bot.ammo.mag;
        const take = Math.min(need, bot.ammo.reserve);
        bot.ammo.mag += take; bot.ammo.reserve -= take;
        bot.reloadingUntil = 0;
      }

      // think
      if (this.time >= bot.nextThink) {
        bot.nextThink = this.time + 0.18 + Math.random() * 0.12;
        this.botThink(bot, d);
      }

      // move
      this.botMove(bot, dt);

      // fire
      if (bot.state === 'engage' && this.time >= bot.reactionAt && bot.reloadingUntil === 0) {
        this.botFire(bot, d, dt);
      }

      // animate
      bot.walkPhase += dt * 9;
      const sw = Math.sin(bot.walkPhase) * 0.55;
      bot.legL.rotation.x = sw;
      bot.legR.rotation.x = -sw;
      let dy = bot.targetYaw - bot.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      bot.yaw += dy * Math.min(1, dt * 8);
      bot.group.rotation.y = bot.yaw;
      bot.group.position.copy(bot.pos);
      // tag faces camera automatically (sprite)
    }

    // separation
    for (let i = 0; i < this.bots.length; i++) {
      const a = this.bots[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.bots.length; j++) {
        const b = this.bots[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.6 && dist > 0.01) {
          const push = ((1.6 - dist) / 2) * 0.5;
          const nx = dx / dist, nz = dz / dist;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  private botEye(bot: Bot): THREE.Vector3 {
    return new THREE.Vector3(bot.pos.x, 1.58, bot.pos.z);
  }

  private botThink(bot: Bot, d: (typeof DIFF)[Difficulty]) {
    const eye = this.botEye(bot);
    let bestDist = 70;
    let tPlayer = false;
    let tBot: Bot | null = null;

    // player?
    if (this.alive && this.opts.team !== bot.team) {
      const pEye = new THREE.Vector3(this.pPos.x, this.pPos.y + 1.55, this.pPos.z);
      const dist = eye.distanceTo(pEye);
      if (dist < bestDist && !this.losBlocked(eye, pEye)) {
        bestDist = dist; tPlayer = true; tBot = null;
      }
    }
    // enemy bots
    for (const o of this.bots) {
      if (o === bot || !o.alive || o.team === bot.team) continue;
      const oEye = new THREE.Vector3(o.pos.x, 1.3, o.pos.z);
      const dist = eye.distanceTo(oEye);
      if (dist < bestDist && !this.losBlocked(eye, oEye)) {
        bestDist = dist; tPlayer = false; tBot = o;
      }
    }

    if (tPlayer || tBot) {
      const isNew = bot.state !== 'engage' || bot.targetIsPlayer !== tPlayer || bot.targetBot !== tBot;
      bot.state = 'engage';
      bot.targetIsPlayer = tPlayer;
      bot.targetBot = tBot;
      if (isNew) {
        bot.reactionAt = this.time + rand(d.reactMin, d.reactMax) * (bot.weapon === 'awp' ? 0.8 : 1);
        bot.nextBurstAt = 0;
        bot.burstLeft = 0;
        bot.aimError = rand(0, 1);
      }
      if (this.time > bot.strafeAt) {
        bot.strafeAt = this.time + rand(0.8, 1.9);
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
    } else {
      bot.state = 'patrol';
      bot.targetIsPlayer = false;
      bot.targetBot = null;
      if (bot.pos.distanceTo(bot.waypoint) < 2.5) bot.waypoint.copy(this.randomWaypoint());
    }
  }

  private botMove(bot: Bot, dt: number) {
    let mx = 0, mz = 0;
    const def = WEAPONS[bot.weapon];
    if (bot.state === 'engage') {
      const tp = bot.targetIsPlayer
        ? new THREE.Vector3(this.pPos.x, 0, this.pPos.z)
        : bot.targetBot!.pos;
      const dx = tp.x - bot.pos.x, dz = tp.z - bot.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const nx = dx / dist, nz = dz / dist;
      bot.targetYaw = Math.atan2(-dx, -dz);
      // keep preferred range
      const want = def.id === 'awp' ? 24 : 13;
      let adv = 0;
      if (dist > want + 5) adv = 1;
      else if (dist < want - 5) adv = -1;
      const firing = this.time < bot.nextShotAt + 0.15;
      const spd = bot.speed * (firing && def.id === 'awp' ? 0.1 : 0.75);
      mx = (nx * adv + -nz * bot.strafeDir * 0.9) * spd;
      mz = (nz * adv + nx * bot.strafeDir * 0.9) * spd;
    } else {
      const dx = bot.waypoint.x - bot.pos.x, dz = bot.waypoint.z - bot.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      bot.targetYaw = Math.atan2(-dx, -dz);
      mx = (dx / dist) * bot.speed;
      mz = (dz / dist) * bot.speed;
    }
    let nx = bot.pos.x + mx * dt;
    let nz = bot.pos.z + mz * dt;
    const [cx, cz] = this.collideCircle(nx, nz, 0.45, 0, 1.8);
    // if blocked while patrolling, pick a new waypoint
    if (bot.state === 'patrol' && Math.hypot(cx - bot.pos.x, cz - bot.pos.z) < Math.hypot(mx, mz) * dt * 0.25) {
      bot.waypoint.copy(this.randomWaypoint());
    }
    bot.pos.x = cx; bot.pos.z = cz;
  }

  private botFire(bot: Bot, d: (typeof DIFF)[Difficulty], _dt: number) {
    const def = WEAPONS[bot.weapon];
    // validate target still alive/visible-ish
    if (bot.targetIsPlayer && !this.alive) { bot.state = 'patrol'; return; }
    if (!bot.targetIsPlayer && (!bot.targetBot || !bot.targetBot.alive)) { bot.state = 'patrol'; return; }

    if (bot.ammo.mag <= 0) {
      if (bot.reloadingUntil === 0) {
        bot.reloadingUntil = this.time + def.reloadTime;
        const s = this.spatial(bot.pos, 0.7);
        this.sound.reload(0, s);
      }
      return;
    }
    if (bot.burstLeft <= 0) {
      if (this.time < bot.nextBurstAt) return;
      const awp = def.id === 'awp';
      bot.burstLeft = awp ? 1 : 3 + Math.floor(Math.random() * 3);
      bot.nextBurstAt = this.time + (awp ? rand(1.5, 2.4) : rand(0.45, 1.1));
      return;
    }
    const interval = def.id === 'awp' ? 0.2 : Math.max(0.11, 60 / def.rpm);
    if (this.time < bot.nextShotAt) return;
    bot.nextShotAt = this.time + interval;
    bot.burstLeft--;
    bot.ammo.mag--;
    bot.lastShot = this.time;

    // target point
    const tp = bot.targetIsPlayer
      ? new THREE.Vector3(this.pPos.x, this.pPos.y + (this.crouched ? 0.9 : 1.3), this.pPos.z)
      : new THREE.Vector3(bot.targetBot!.pos.x, 1.25, bot.targetBot!.pos.z);
    const from = new THREE.Vector3();
    bot.gunTip.getWorldPosition(from);

    // hit probability
    const dist = from.distanceTo(tp);
    let p = bot.skill + 0.12;
    p -= dist * (def.id === 'awp' ? 0.004 : 0.009);
    const tMoving = bot.targetIsPlayer
      ? Math.hypot(this.pVel.x, this.pVel.z) > 1.5
      : true;
    if (tMoving) p -= 0.13;
    if (bot.targetIsPlayer && !this.onGround) p -= 0.22;
    if (bot.targetIsPlayer && this.crouched) p -= 0.05;
    if (Math.abs(bot.targetYaw - bot.yaw) > 0.3) p -= 0.15;
    p -= bot.aimError * 0.1;
    p = clamp(p, 0.04, 0.93);

    const hit = Math.random() < p;
    const head = hit && Math.random() < 0.1 + bot.skill * 0.12;

    // fx
    this.flashMuzzle(from);
    const s = this.spatial(bot.pos, 1);
    if (def.id === 'ak47') this.sound.ak(s);
    else if (def.id === 'm4a1s') this.sound.m4(s);
    else if (def.id === 'awp') this.sound.awp(s);
    else this.sound.pistol(s);

    if (hit) {
      this.spawnTracer(from, tp, 0xffd9a0);
      let dmg = def.damage * d.dmg * (head ? 1.8 : 1);
      if (dist > def.range) dmg *= clamp(1 - (dist - def.range) * 0.01, 0.5, 1);
      if (bot.targetIsPlayer) {
        this.puff(tp, 0xc02020, 3, 2, 0.07, 8, 0.3);
        this.damagePlayer(dmg, bot.pos, bot.name, bot, head);
      } else {
        const tb = bot.targetBot!;
        this.puff(tp, 0xa01818, 4, 2.5, 0.08, 8, 0.35);
        let dd = dmg;
        if (tb.armor > 0) {
          dd = dd * (1 - 0.5 * def.armorPen);
          tb.armor = Math.max(0, tb.armor - dd * 0.4);
        }
        tb.hp -= dd;
        if (tb.hp <= 0) this.handleKill(bot, tb, def.name, head, false);
        else {
          // retaliate
          tb.targetBot = bot; tb.targetIsPlayer = false;
          tb.state = 'engage';
          tb.reactionAt = Math.min(tb.reactionAt || Infinity, this.time + 0.4);
        }
      }
    } else {
      const miss = tp.clone().add(new THREE.Vector3(rand(-2.4, 2.4), rand(-1.2, 1.6), rand(-2.4, 2.4)));
      this.spawnTracer(from, miss, 0xffd9a0);
      if (Math.random() < 0.4) this.puff(miss, 0xdfe8f2, 2, 1.5, 0.06, 6, 0.3);
      // cracking past the player
      if (bot.targetIsPlayer && dist < 30) this.sound.pistol({ vol: 0.12, pan: s.pan });
    }
  }

  // ------------------------------------------------------------- grenades
  private updateNades(dt: number) {
    for (let i = this.nadesLive.length - 1; i >= 0; i--) {
      const n = this.nadesLive[i];
      n.fuse -= dt;
      if (n.fuse <= 0) {
        this.scene.remove(n.mesh);
        this.nadesLive.splice(i, 1);
        this.explode(n.pos, n.fromPlayer);
        continue;
      }
      if (this.time - n.lastBeep > clamp(n.fuse * 0.3, 0.08, 0.5)) {
        n.lastBeep = this.time;
        const s = this.spatial(n.pos, 0.6);
        this.sound.beep(s);
      }
      n.vel.y -= 13 * dt;
      n.pos.addScaledVector(n.vel, dt);
      // ground bounce
      const g = this.groundHeight(n.pos.x, n.pos.z, n.pos.y);
      if (n.pos.y < g + 0.11) {
        n.pos.y = g + 0.11;
        if (Math.abs(n.vel.y) > 2) {
          const s = this.spatial(n.pos, 0.7);
          this.sound.bounce(s);
        }
        n.vel.y *= -0.42;
        n.vel.x *= 0.7; n.vel.z *= 0.7;
      }
      // walls
      const B = this.map.bounds;
      if (n.pos.x < -B || n.pos.x > B) { n.pos.x = clamp(n.pos.x, -B, B); n.vel.x *= -0.5; }
      if (n.pos.z < -B || n.pos.z > B) { n.pos.z = clamp(n.pos.z, -B, B); n.vel.z *= -0.5; }
      // simple collider bounce (horizontal push)
      const [cx, cz] = this.collideCircle(n.pos.x, n.pos.z, 0.11, n.pos.y - 0.1, 0.25);
      if (cx !== n.pos.x || cz !== n.pos.z) {
        if (cx !== n.pos.x) n.vel.x *= -0.5;
        if (cz !== n.pos.z) n.vel.z *= -0.5;
        n.pos.x = cx; n.pos.z = cz;
      }
      n.mesh.position.copy(n.pos);
    }
  }

  // ------------------------------------------------------------- ambient fx
  private updateSnow(dt: number) {
    const attr = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const t = this.time;
    for (let i = 0; i < this.snowVel.length; i++) {
      arr[i * 3 + 1] -= this.snowVel[i] * dt;
      arr[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.7;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 42;
        arr[i * 3] = rand(-70, 70);
        arr[i * 3 + 2] = rand(-70, 70);
      }
    }
    attr.needsUpdate = true;
  }

  private disposeParticle(p: Particle) {
    const u = (p.mesh as unknown as { userData: { shock?: boolean } }).userData;
    if (u && u.shock) {
      (p.mesh.geometry as THREE.BufferGeometry).dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
  }

  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.disposeParticle(p);
        this.particles.splice(i, 1);
        continue;
      }
      const mesh = p.mesh as unknown as { userData: { shock?: boolean } };
      if (mesh.userData.shock) {
        const t = 1 - p.life / p.maxLife;
        p.mesh.scale.setScalar(1 + t * 16);
        ((p.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
        continue;
      }
      p.vel.y -= p.grav * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.y += p.spin * 0.7 * dt;
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vel.set(0, 0, 0);
        p.spin = 0;
      }
    }
  }

  private updateTracers(dt: number) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        (t.mesh.material as THREE.Material).dispose();
        (t.mesh.geometry as THREE.BufferGeometry).dispose();
        this.tracers.splice(i, 1);
      } else {
        (t.mesh.material as THREE.MeshBasicMaterial).opacity = (t.life / t.maxLife) * 0.9;
      }
    }
  }

  // ------------------------------------------------------------- camera + gun feel
  private syncCamera(dt: number) {
    const eyeH = this.crouched ? 1.06 : 1.62;
    let camY = this.pPos.y + eyeH;
    let roll = 0;

    if (!this.alive) {
      const t = Math.min(1, this.deathT * 1.6);
      camY = lerp(this.pPos.y + eyeH, this.pPos.y + 0.35, t);
      roll = t * 0.5;
    } else if (this.onGround && Math.hypot(this.pVel.x, this.pVel.z) > 0.8) {
      camY += Math.sin(this.bobPhase * 2) * 0.028;
    }

    this.camera.position.set(this.pPos.x, camY, this.pPos.z);
    let sy = 0, sp = 0;
    if (this.shake > 0.01) {
      sy = rand(-1, 1) * this.shake * 0.02;
      sp = rand(-1, 1) * this.shake * 0.02;
    }
    this.camera.rotation.set(this.pitch + sp, this.yaw + sy, roll);

    // fov
    const targetFov = this.scoped ? WEAPONS.awp.zoomFov : this.focus ? 62 : 75;
    this.camera.fov = lerp(this.camera.fov, targetFov, Math.min(1, dt * 14));
    this.camera.updateProjectionMatrix();

    // gun rig feel
    const moving = Math.hypot(this.pVel.x, this.pVel.z);
    const bobA = this.onGround && moving > 0.8 ? 1 : 0;
    const t = this.time;
    const switching = this.time < this.switchingUntil;
    const reloading = this.time < this.reloadingUntil;
    const gx = 0.26 + Math.sin(this.bobPhase) * 0.008 * bobA;
    let gy = -0.25 + Math.abs(Math.cos(this.bobPhase)) * 0.01 * bobA;
    let gz = -0.5 + this.kick * 0.09;
    let rx = this.kick * 0.16;
    if (switching) { gy -= 0.22; rx -= 0.5; }
    if (reloading) { gy -= 0.09; rx -= 0.45; gz += 0.03; }
    if (this.knifeT > 0) { gz -= this.knifeT * 0.22; rx += this.knifeT * 0.7; }
    if (this.focus) { gx; gy += 0.035; gz -= 0.06; }
    if (this.scoped) gz += 0.3;
    // idle breathing
    gy += Math.sin(t * 1.8) * 0.0018;
    this.gunRig.position.set(gx, gy, gz);
    this.gunRig.rotation.set(rx, this.scoped ? 0 : 0, 0);
    // hide viewmodel when scoped with AWP
    const id = this.currentId();
    this.viewmodels.forEach((vm, key) => {
      vm.group.visible = key === id && !(this.scoped && id === 'awp');
    });
  }

  // ------------------------------------------------------------- react bridge
  private pushHud(force = false) {
    void force;
    const def = this.currentDef();
    const a = this.ammo[def.id] ?? { mag: 0, reserve: 0 };
    const speed = Math.hypot(this.pVel.x, this.pVel.z);
    const spreadPx = clamp((def.spread + this.bloom + speed * 0.22 + (this.onGround ? 0 : 1.2)) * 16, 4, 60);
    const h: HudState = {
      phase: this.phase,
      hp: Math.max(0, Math.ceil(this.hp)),
      maxHp: 100,
      armor: Math.ceil(this.armor),
      helmet: this.helmet,
      alive: this.alive,
      respawnIn: this.alive ? 0 : Math.max(0, this.respawnAt - this.time),
      protection: this.time < this.protectionUntil,
      slot: this.slot,
      primaryId: this.primary,
      secondaryId: this.secondary,
      mag: a.mag,
      reserve: a.reserve,
      reloading: this.time < this.reloadingUntil,
      nades: this.nades,
      money: this.money,
      kills: this.pKills,
      deaths: this.pDeaths,
      headshots: this.pHeadshots,
      tScore: this.tScore,
      ctScore: this.ctScore,
      target: this.target,
      timeLeft: Math.max(0, this.timeLeft),
      scoped: this.scoped,
      focus: this.focus,
      spreadPx,
      lowAmmo: a.mag <= Math.ceil(def.mag * 0.25),
      killerName: this.killerName,
      killerWeapon: this.killerWeapon,
      killerHeadshot: this.killerHs,
      warmupLeft: Math.max(0, this.warmupLeft),
    };
    this.ev.onHUD(h);
  }

  private pushScore() {
    const rows: ScoreRow[] = [{
      name: this.opts.playerName, team: this.opts.team, bot: false,
      kills: this.pKills, deaths: this.pDeaths, headshots: this.pHeadshots,
      money: this.money, ping: 8, alive: this.alive,
    }];
    for (const b of this.bots) {
      rows.push({ name: b.name, team: b.team, bot: true, kills: b.kills, deaths: b.deaths, headshots: b.headshots, money: b.money, ping: b.ping, alive: b.alive });
    }
    rows.sort((x, y) => y.kills - x.kills);
    this.ev.onScoreboard(rows);
  }

  getSnapshot(): { entities: MapEntity[]; nades: Array<{ x: number; z: number }>; colliders: Collider[]; bounds: number } {
    const entities: MapEntity[] = [{
      x: this.pPos.x, z: this.pPos.z, yaw: this.yaw, team: this.opts.team, alive: this.alive, player: true,
    }];
    for (const b of this.bots) {
      entities.push({ x: b.pos.x, z: b.pos.z, yaw: b.yaw, team: b.team, alive: b.alive, player: false });
    }
    return { entities, nades: this.nadesLive.map((n) => ({ x: n.pos.x, z: n.pos.z })), colliders: this.map.colliders, bounds: this.map.bounds };
  }
}

export type { Collider };
