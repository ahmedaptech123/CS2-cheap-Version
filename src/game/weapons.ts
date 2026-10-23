import * as THREE from 'three';

export type WeaponId = 'ak47' | 'm4a1s' | 'awp' | 'glock' | 'usps' | 'deagle' | 'knife';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: 1 | 2 | 3;
  damage: number;
  headshotMult: number;
  rpm: number;
  mag: number;
  reserve: number;
  reloadTime: number;
  /** base spread in degrees */
  spread: number;
  auto: boolean;
  price: number;
  kick: number;
  armorPen: number; // 0..1 — fraction of damage preserved through armor
  zoomFov: number; // 0 = none
  range: number; // falloff start (m)
  desc: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 1, damage: 33, headshotMult: 3.2, rpm: 600,
    mag: 30, reserve: 90, reloadTime: 2.5, spread: 0.85, auto: true, price: 2500,
    kick: 1.0, armorPen: 0.8, zoomFov: 0, range: 24,
    desc: 'Terrorist rifle. Devastating power, wild spray.',
  },
  m4a1s: {
    id: 'm4a1s', name: 'M4A1-S', slot: 1, damage: 31, headshotMult: 3.0, rpm: 666,
    mag: 25, reserve: 75, reloadTime: 2.4, spread: 0.62, auto: true, price: 2900,
    kick: 0.72, armorPen: 0.72, zoomFov: 0, range: 26,
    desc: 'CT suppressed rifle. Laser-accurate, whisper-quiet.',
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 1, damage: 112, headshotMult: 2, rpm: 41,
    mag: 5, reserve: 15, reloadTime: 3.4, spread: 7.0, auto: false, price: 4750,
    kick: 3.2, armorPen: 1.0, zoomFov: 18, range: 80,
    desc: 'Bolt-action beast. One shot, one elimination — while scoped.',
  },
  glock: {
    id: 'glock', name: 'Glock-18', slot: 2, damage: 24, headshotMult: 2.2, rpm: 420,
    mag: 20, reserve: 60, reloadTime: 2.0, spread: 0.8, auto: false, price: 0,
    kick: 0.5, armorPen: 0.5, zoomFov: 0, range: 18,
    desc: 'Standard T sidearm. Big mag, honest damage.',
  },
  usps: {
    id: 'usps', name: 'USP-S', slot: 2, damage: 27, headshotMult: 2.6, rpm: 400,
    mag: 12, reserve: 36, reloadTime: 2.1, spread: 0.55, auto: false, price: 0,
    kick: 0.45, armorPen: 0.55, zoomFov: 0, range: 20,
    desc: 'Standard CT sidearm. Suppressed precision.',
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 2, damage: 53, headshotMult: 3.4, rpm: 260,
    mag: 7, reserve: 35, reloadTime: 2.2, spread: 0.7, auto: false, price: 700,
    kick: 1.4, armorPen: 0.9, zoomFov: 0, range: 26,
    desc: 'Hand cannon. Deletes helmets at any range.',
  },
  knife: {
    id: 'knife', name: 'Tactical Knife', slot: 3, damage: 55, headshotMult: 1.6, rpm: 110,
    mag: 0, reserve: 0, reloadTime: 0, spread: 0, auto: false, price: 0,
    kick: 0, armorPen: 1.0, zoomFov: 0, range: 2.6,
    desc: 'Silent and personal. +$600 per backstab bonus.',
  },
};

export const PRIMARY_DEFAULT: Record<'T' | 'CT', WeaponId> = { T: 'ak47', CT: 'm4a1s' };
export const SECONDARY_DEFAULT: Record<'T' | 'CT', WeaponId> = { T: 'glock', CT: 'usps' };

// ---------------------------------------------------------------------------
// Procedural view-model construction (guns point down -Z from the camera)
// ---------------------------------------------------------------------------

const MAT = {
  black: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.45, metalness: 0.75 }),
  gunmetal: new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.4, metalness: 0.8 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8f97a3, roughness: 0.3, metalness: 0.9 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a4a1f, roughness: 0.8, metalness: 0.05 }),
  bakelite: new THREE.MeshStandardMaterial({ color: 0x9c4d1a, roughness: 0.65, metalness: 0.1 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.2 }),
  tan: new THREE.MeshStandardMaterial({ color: 0xb89a68, roughness: 0.7, metalness: 0.1 }),
  green: new THREE.MeshStandardMaterial({ color: 0x4e6142, roughness: 0.65, metalness: 0.15 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.9, metalness: 0 }),
  blade: new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.22, metalness: 0.95 }),
  redDot: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2211, emissiveIntensity: 2.4 }),
  sight: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5, metalness: 0.6 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

function cyl(r: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, axis: 'z' | 'x' | 'y' = 'z', r2?: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2 ?? r, r, len, 14), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

function hands(g: THREE.Group, gripZ: number, foreZ: number) {
  // right hand on grip, left hand under handguard
  const r = box(0.075, 0.09, 0.1, MAT.glove, 0.015, -0.115, gripZ, 0.25);
  const l = box(0.07, 0.08, 0.11, MAT.glove, -0.01, -0.1, foreZ, 0);
  g.add(r, l);
}

export interface ViewModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
}

function finish(g: THREE.Group, muzzleZ: number): ViewModel {
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.015, muzzleZ);
  g.add(muzzle);
  return { group: g, muzzle };
}

function buildAK(): ViewModel {
  const g = new THREE.Group();
  g.add(box(0.075, 0.095, 0.46, MAT.black, 0, 0, -0.12)); // receiver
  g.add(box(0.06, 0.02, 0.4, MAT.gunmetal, 0, 0.055, -0.12)); // top cover
  g.add(box(0.085, 0.08, 0.24, MAT.wood, 0, -0.01, -0.45)); // handguard
  g.add(cyl(0.013, 0.3, MAT.black, 0, 0.02, -0.55)); // barrel
  g.add(cyl(0.021, 0.08, MAT.black, 0, 0.02, -0.72)); // muzzle brake
  g.add(box(0.075, 0.115, 0.3, MAT.wood, 0, -0.035, 0.22)); // stock
  g.add(box(0.06, 0.13, 0.065, MAT.wood, 0, -0.115, 0.03, 0.3)); // grip
  g.add(box(0.058, 0.2, 0.095, MAT.bakelite, 0, -0.14, -0.2, -0.42)); // curved mag
  g.add(box(0.012, 0.05, 0.012, MAT.sight, 0, 0.05, -0.62)); // front post
  g.add(box(0.05, 0.03, 0.03, MAT.sight, 0, 0.065, -0.04)); // rear sight
  g.add(box(0.02, 0.02, 0.06, MAT.steel, 0.05, 0.02, -0.05)); // charging handle
  hands(g, 0.03, -0.42);
  return finish(g, -0.78);
}

function buildM4(): ViewModel {
  const g = new THREE.Group();
  g.add(box(0.072, 0.095, 0.42, MAT.gunmetal, 0, 0, -0.1)); // receiver
  g.add(box(0.055, 0.025, 0.38, MAT.black, 0, 0.058, -0.12)); // rail
  g.add(cyl(0.03, 0.3, MAT.black, 0, 0.005, -0.5)); // suppressor
  g.add(box(0.078, 0.085, 0.2, MAT.polymer, 0, -0.005, -0.3)); // handguard
  g.add(box(0.062, 0.105, 0.26, MAT.polymer, 0, -0.03, 0.24)); // stock
  g.add(box(0.02, 0.12, 0.05, MAT.black, 0, -0.04, 0.385)); // buttpad
  g.add(box(0.055, 0.12, 0.06, MAT.polymer, 0, -0.11, 0.04, 0.32)); // grip
  g.add(box(0.055, 0.17, 0.08, MAT.tan, 0, -0.13, -0.18, -0.18)); // mag
  g.add(box(0.05, 0.045, 0.09, MAT.black, 0, 0.095, -0.08)); // red-dot housing
  g.add(cyl(0.006, 0.095, MAT.redDot, 0, 0.095, -0.08)); // red dot
  g.add(box(0.012, 0.045, 0.012, MAT.sight, 0, 0.075, -0.42)); // front sight
  g.add(cyl(0.008, 0.05, MAT.steel, 0.045, -0.02, 0.1, 'x')); // selector
  hands(g, 0.04, -0.3);
  return finish(g, -0.68);
}

function buildAWP(): ViewModel {
  const g = new THREE.Group();
  g.add(box(0.072, 0.1, 0.52, MAT.green, 0, 0, -0.14)); // body
  g.add(box(0.07, 0.12, 0.3, MAT.green, 0, -0.04, 0.26)); // stock
  g.add(box(0.03, 0.05, 0.1, MAT.black, 0, -0.02, 0.12)); // thumbhole gap illusion
  g.add(cyl(0.013, 0.55, MAT.black, 0, 0.02, -0.6)); // long barrel
  g.add(cyl(0.022, 0.1, MAT.black, 0, 0.02, -0.88)); // muzzle
  g.add(cyl(0.036, 0.24, MAT.black, 0, 0.1, -0.1)); // scope tube
  g.add(box(0.02, 0.05, 0.03, MAT.black, 0, 0.055, -0.02)); // mounts
  g.add(box(0.02, 0.05, 0.03, MAT.black, 0, 0.055, -0.18));
  g.add(cyl(0.04, 0.03, MAT.sight, 0, 0.1, -0.225)); // objective bell
  g.add(cyl(0.008, 0.07, MAT.steel, 0.055, 0.02, 0.02, 'x')); // bolt handle
  g.add(box(0.055, 0.13, 0.07, MAT.green, 0, -0.11, -0.16, -0.1)); // mag
  g.add(box(0.055, 0.12, 0.06, MAT.green, 0, -0.11, 0.05, 0.3)); // grip
  hands(g, 0.05, -0.34);
  return finish(g, -0.95);
}

function buildPistol(suppressed: boolean, big: boolean): ViewModel {
  const g = new THREE.Group();
  const s = big ? 1.18 : 1;
  const slideMat = big ? MAT.steel : MAT.black;
  g.add(box(0.052 * s, 0.06 * s, 0.22 * s, slideMat, 0, 0.01, -0.1)); // slide
  g.add(box(0.046 * s, 0.05 * s, 0.04, MAT.polymer, 0, 0.005, 0.02)); // rear
  g.add(box(0.048 * s, 0.13 * s, 0.06 * s, MAT.polymer, 0, -0.085, 0.045, 0.22)); // grip
  g.add(box(0.012, 0.03, 0.012, MAT.sight, 0, 0.055, -0.19)); // front sight
  g.add(box(0.04, 0.025, 0.02, MAT.sight, 0, 0.05, 0.0)); // rear sight
  if (suppressed) g.add(cyl(0.02, 0.14, MAT.black, 0, 0.015, -0.27)); // can
  else g.add(cyl(0.011, 0.05, MAT.gunmetal, 0, 0.015, -0.22)); // barrel tip
  const r = box(0.075, 0.1, 0.1, MAT.glove, 0.01, -0.12, 0.05, 0.2);
  g.add(r);
  return finish(g, suppressed ? -0.36 : -0.26);
}

function buildKnife(): ViewModel {
  const g = new THREE.Group();
  g.add(box(0.02, 0.05, 0.3, MAT.blade, 0, 0.0, -0.25)); // blade
  g.add(box(0.022, 0.052, 0.06, MAT.steel, 0, 0.0, -0.09)); // ricasso
  g.add(box(0.05, 0.07, 0.03, MAT.black, 0, -0.005, -0.075)); // guard
  g.add(box(0.04, 0.075, 0.14, MAT.polymer, 0, -0.02, 0.01)); // handle
  g.add(box(0.075, 0.1, 0.1, MAT.glove, 0.01, -0.1, 0.03, 0.3)); // fist
  return finish(g, -0.4);
}

export function buildViewModel(id: WeaponId): ViewModel {
  switch (id) {
    case 'ak47': return buildAK();
    case 'm4a1s': return buildM4();
    case 'awp': return buildAWP();
    case 'glock': return buildPistol(false, false);
    case 'usps': return buildPistol(true, false);
    case 'deagle': return buildPistol(false, true);
    case 'knife': return buildKnife();
  }
}

/** Cheap gun mesh attached to bot models. */
export function buildBotGun(id: WeaponId): { group: THREE.Group; muzzle: THREE.Object3D } {
  const g = new THREE.Group();
  if (id === 'knife') {
    g.add(box(0.04, 0.06, 0.34, MAT.blade, 0, 0, -0.2));
  } else {
    const long = id === 'awp';
    const len = long ? 0.95 : id === 'ak47' || id === 'm4a1s' ? 0.8 : 0.34;
    g.add(box(0.08, 0.11, len * 0.55, MAT.black, 0, 0, -len * 0.2));
    g.add(cyl(0.02, len * 0.5, MAT.gunmetal, 0, 0.02, -len * 0.65));
    if (id === 'ak47') g.add(box(0.09, 0.09, 0.22, MAT.wood, 0, -0.01, -0.35));
    if (id === 'm4a1s') g.add(cyl(0.035, 0.28, MAT.black, 0, 0.01, -0.55));
    if (id === 'awp') g.add(cyl(0.04, 0.22, MAT.black, 0, 0.09, -0.15));
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, id === 'awp' ? -1.0 : id === 'knife' ? -0.4 : -0.75);
  g.add(muzzle);
  return { group: g, muzzle };
}
