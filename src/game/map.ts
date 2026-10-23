import * as THREE from 'three';

export interface Collider {
  x0: number; z0: number; x1: number; z1: number; y0: number; y1: number;
}

export interface SpawnPoint { x: number; z: number; yaw: number }

export interface MapData {
  colliders: Collider[];
  /** meshes that block bullets + line of sight */
  solids: THREE.Object3D[];
  ground: THREE.Mesh;
  tSpawns: SpawnPoint[];
  ctSpawns: SpawnPoint[];
  waypoints: THREE.Vector3[];
  bounds: number;
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function snowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#dde6f2';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const v = 215 + Math.random() * 40;
    ctx.fillStyle = `rgba(${v},${v + 4},${Math.min(255, v + 12)},${0.25 + Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4);
  }
  // sparkles
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  return tex;
}

export function buildMap(scene: THREE.Scene): MapData {
  const colliders: Collider[] = [];
  const solids: THREE.Object3D[] = [];
  const BOUNDS = 56;

  const addCollider = (x: number, z: number, w: number, d: number, h: number, y0 = 0) => {
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, y0, y1: y0 + h });
  };

  // ---------------- sky, fog, lights ----------------
  scene.fog = new THREE.Fog(0x8fa3c4, 45, 260);

  const skyGeo = new THREE.SphereGeometry(500, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x0b162e) },
      mid: { value: new THREE.Color(0x39517e) },
      low: { value: new THREE.Color(0xe09c5f) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 c = mix(mid, top, smoothstep(0.12, 0.65, h));
        c = mix(low, c, smoothstep(-0.06, 0.16, h));
        c = mix(vec3(0.16,0.2,0.3), c, smoothstep(-0.4, -0.02, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // low sun glow sprite
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const gtx = glowCanvas.getContext('2d')!;
  const grad = gtx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,220,170,1)');
  grad.addColorStop(0.25, 'rgba(255,190,130,0.7)');
  grad.addColorStop(1, 'rgba(255,170,110,0)');
  gtx.fillStyle = grad;
  gtx.fillRect(0, 0, 128, 128);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), depthWrite: false, fog: false }));
  sun.position.set(-260, 26, -140);
  sun.scale.set(150, 150, 1);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0xbdd0f0, 0x55617a, 0.95);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffd2a0, 1.35);
  dir.position.set(-70, 42, -45);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -75; dir.shadow.camera.right = 75;
  dir.shadow.camera.top = 75; dir.shadow.camera.bottom = -75;
  dir.shadow.camera.far = 260;
  dir.shadow.bias = -0.0008;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x6f8fc4, 0.35);
  fill.position.set(50, 60, 60);
  scene.add(fill);

  // ---------------- ground ----------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(340, 340),
    new THREE.MeshStandardMaterial({ map: snowTexture(), roughness: 0.96, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // icy patches (visual only)
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xa9c9e8, roughness: 0.18, metalness: 0.25 });
  const iceSpots: Array<[number, number, number]> = [[-14, 6, 5], [16, -8, 6], [4, 24, 4], [-6, -26, 5], [30, 20, 4]];
  for (const [x, z, r] of iceSpots) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 22), iceMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    m.receiveShadow = true;
    scene.add(m);
  }

  // ---------------- materials ----------------
  const M = {
    wall: new THREE.MeshStandardMaterial({ color: 0x9db8d4, roughness: 0.85 }),
    wallDark: new THREE.MeshStandardMaterial({ color: 0x5d6f88, roughness: 0.9 }),
    snowCap: new THREE.MeshStandardMaterial({ color: 0xf2f6fc, roughness: 0.95 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a6a3f, roughness: 0.85 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x5e4527, roughness: 0.85 }),
    warehouse: new THREE.MeshStandardMaterial({ color: 0x3d4a61, roughness: 0.7, metalness: 0.3 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x2b3548, roughness: 0.8 }),
    ice: new THREE.MeshStandardMaterial({ color: 0x9fc8e8, roughness: 0.25, metalness: 0.2, transparent: true, opacity: 0.92 }),
    rust: new THREE.MeshStandardMaterial({ color: 0xa4552a, roughness: 0.7, metalness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x707a8a, roughness: 0.5, metalness: 0.6 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 }),
    pine: new THREE.MeshStandardMaterial({ color: 0x2c4a38, roughness: 0.9 }),
    pineSnow: new THREE.MeshStandardMaterial({ color: 0xdfe8f2, roughness: 0.9 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8b95a5, roughness: 0.95 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: 0x221100, emissive: 0xffbe78, emissiveIntensity: 3 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, metalness: 0.5 }),
    tFlag: new THREE.MeshStandardMaterial({ color: 0xd98a2b, roughness: 0.8, side: THREE.DoubleSide }),
    ctFlag: new THREE.MeshStandardMaterial({ color: 0x3d9bd6, roughness: 0.8, side: THREE.DoubleSide }),
  };

  const solid = (mesh: THREE.Object3D) => { solids.push(mesh); scene.add(mesh); return mesh; };

  // ---------------- perimeter ----------------
  const W = 62;
  const wallDefs: Array<[number, number, number, number]> = [
    [0, -W, 128, 2.5], [0, W, 128, 2.5], [-W, 0, 2.5, 128], [W, 0, 2.5, 128],
  ];
  for (const [x, z, w, d] of wallDefs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), M.wall);
    wall.position.set(x, 3.5, z);
    wall.castShadow = wall.receiveShadow = true;
    solid(wall);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w === 2.5 ? 3.4 : w, 0.7, d === 2.5 ? 3.4 : d), M.snowCap);
    cap.position.set(x, 7.3, z);
    scene.add(cap);
    addCollider(x, z, w, d, 7.5);
  }

  // ---------------- helpers ----------------
  const crate = (x: number, z: number, s: number, h?: number, ry = 0) => {
    const height = h ?? s;
    const grp = new THREE.Group();
    const bodyM = new THREE.Mesh(new THREE.BoxGeometry(s, height, s), M.wood);
    bodyM.position.y = height / 2;
    bodyM.castShadow = bodyM.receiveShadow = true;
    grp.add(bodyM);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(s + 0.12, 0.16, s + 0.12), M.snowCap);
    lid.position.y = height + 0.06;
    lid.castShadow = true;
    grp.add(lid);
    // corner frames
    const frame = new THREE.Mesh(new THREE.BoxGeometry(s + 0.06, height * 0.12, s + 0.06), M.woodDark);
    frame.position.y = height * 0.12;
    grp.add(frame);
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    scene.add(grp);
    solids.push(bodyM);
    addCollider(x, z, s, s, height + 0.1);
  };

  const iceWall = (x: number, z: number, w: number, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.35, 1), M.ice);
    m.position.set(x, 0.675, z);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    solid(m);
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    addCollider(x, z, w * c + 1 * s, w * s + 1 * c, 1.35);
  };

  const barrels = (x: number, z: number) => {
    const offs: Array<[number, number]> = [[0, 0], [1.3, 0.4], [0.4, 1.3]];
    for (const [ox, oz] of offs) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.25, 14), M.rust);
      b.position.set(x + ox, 0.625, z + oz);
      b.castShadow = b.receiveShadow = true;
      solid(b);
      addCollider(x + ox, z + oz, 1.2, 1.2, 1.25);
    }
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 14), M.snowCap);
    lid.position.set(x, 1.3, z);
    scene.add(lid);
  };

  const warehouse = (x: number, z: number, w: number, d: number) => {
    const h = 5;
    const bodyM = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.warehouse);
    bodyM.position.set(x, h / 2, z);
    bodyM.castShadow = bodyM.receiveShadow = true;
    solid(bodyM);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.5, d + 1), M.snowCap);
    roof.position.set(x, h + 0.25, z);
    roof.castShadow = true;
    scene.add(roof);
    // door glow strip
    const door = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.4), new THREE.MeshStandardMaterial({ color: 0x10151f, roughness: 0.9 }));
    door.position.set(x, 1.7, z + d / 2 + 0.02);
    if (z < 0) door.rotation.y = Math.PI;
    scene.add(door);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, 0.35), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff9c3c, emissiveIntensity: 1.6 }));
    stripe.position.set(x, h - 0.6, z + d / 2 + 0.02);
    if (z < 0) { stripe.rotation.y = Math.PI; stripe.position.z = z - d / 2 - 0.02; door.position.z = z - d / 2 - 0.02; }
    scene.add(stripe);
    addCollider(x, z, w, d, h + 0.5);
  };

  const tower = (x: number, z: number) => {
    const grp = new THREE.Group();
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]] as Array<[number, number]>) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.6, 0.35), M.woodDark);
      leg.position.set(x + lx, 2.3, z + lz);
      leg.castShadow = true;
      grp.add(leg);
    }
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 3.4), M.wood);
    cabin.position.set(x, 5.8, z);
    cabin.castShadow = true;
    grp.add(cabin);
    solids.push(cabin);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.4, 4), M.snowCap);
    roof.position.set(x, 7.7, z);
    roof.rotation.y = Math.PI / 4;
    grp.add(roof);
    scene.add(grp);
    addCollider(x, z, 3.2, 3.2, 4.6);
  };

  const pine = (x: number, z: number, s: number, collide: boolean) => {
    const grp = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.3 * s, 1.6 * s, 8), M.trunk);
    trunk.position.set(x, 0.8 * s, z);
    trunk.castShadow = true;
    grp.add(trunk);
    if (collide) solids.push(trunk);
    const layers: Array<[number, number, number]> = [[2.3, 2.2, 2.2], [1.75, 1.9, 3.5], [1.2, 1.7, 4.6]];
    layers.forEach(([r, h, y], i) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r * s, h * s, 9), i % 2 ? M.pineSnow : M.pine);
      cone.position.set(x, y * s, z);
      cone.castShadow = true;
      grp.add(cone);
    });
    scene.add(grp);
    if (collide) addCollider(x, z, 0.9 * s, 0.9 * s, 1.6 * s);
  };

  const rock = (x: number, z: number, s: number, collide: boolean) => {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), M.rock);
    m.position.set(x, s * 0.55, z);
    m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(s * 0.7, 8, 6), M.snowCap);
    cap.position.set(x, s * 1.05, z);
    cap.scale.y = 0.45;
    scene.add(cap);
    if (collide) { solids.push(m); addCollider(x, z, s * 1.4, s * 1.4, s * 1.2); }
  };

  const lamp = (x: number, z: number) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.4, 8), M.pole);
    pole.position.set(x, 3.2, z);
    pole.castShadow = true;
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), M.lampGlow);
    bulb.position.set(x, 6.5, z);
    scene.add(bulb);
    const light = new THREE.PointLight(0xffb877, 60, 34, 2);
    light.position.set(x, 6.3, z);
    scene.add(light);
    addCollider(x, z, 0.5, 0.5, 6.4);
  };

  // ---------------- mid layout ----------------
  crate(0, 0, 3, 2.2);
  crate(5.5, 3, 2, 2);
  crate(-5.5, -3, 2, 2);
  crate(3.5, -5.5, 1.15, 1.15);
  crate(-3.5, 5.5, 1.15, 1.15);
  crate(0, 11, 2.4, 2.4);
  crate(0, -11, 2.4, 2.4);
  iceWall(10.5, 0, 6);
  iceWall(-10.5, 0, 6);
  iceWall(0, 20, 5, Math.PI / 2);
  iceWall(0, -20, 5, Math.PI / 2);
  barrels(17, 12);
  barrels(-17, -12);

  // warehouses on the flanks
  warehouse(-27, 0, 12, 9);
  warehouse(27, 0, 12, 9);

  // side-lane cover
  crate(-16, 24, 2, 2);
  crate(16, -24, 2, 2);
  crate(-16, -24, 1.5, 1.5);
  crate(16, 24, 1.5, 1.5);
  iceWall(-16, 32, 4);
  iceWall(16, -32, 4);
  barrels(-36, 14);
  barrels(36, -14);

  // towers
  tower(-42, -42); tower(42, -42); tower(-42, 42); tower(42, 42);

  // inside trees + rocks
  pine(-31, 24, 1.1, true); pine(31, -24, 1.1, true);
  pine(-33, -26, 0.9, true); pine(33, 26, 0.9, true);
  rock(-15, 30, 1.5, true); rock(15, -30, 1.5, true);
  rock(24, 18, 1.1, true); rock(-24, -18, 1.1, true);

  // lamps
  lamp(8, 8); lamp(-8, -8); lamp(8, -8); lamp(-8, 8);
  lamp(0, 38); lamp(0, -38);

  // ---------------- spawn bases ----------------
  const base = (z: number, team: 'T' | 'CT') => {
    const flagMat = team === 'T' ? M.tFlag : M.ctFlag;
    // canopy
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 7), team === 'T' ? M.rust : M.warehouse);
    roof.position.set(0, 4.4, z);
    roof.castShadow = true;
    scene.add(roof);
    const snowTop = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.35, 7.4), M.snowCap);
    snowTop.position.set(0, 4.75, z);
    scene.add(snowTop);
    for (const [px, pz] of [[-4.6, -3], [4.6, -3], [-4.6, 3], [4.6, 3]] as Array<[number, number]>) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.4, 8), M.pole);
      p.position.set(px, 2.2, z + pz);
      scene.add(p);
    }
    // flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 8, 8), M.pole);
    pole.position.set(7.5, 4, z);
    scene.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.9), flagMat);
    flag.position.set(9.2, 6.8, z);
    scene.add(flag);
    // ground ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 6.4, 40),
      new THREE.MeshBasicMaterial({ color: team === 'T' ? 0xd98a2b : 0x3d9bd6, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.03, z);
    scene.add(ring);
    crate(-8, z + 3, 1.6, 1.6);
    crate(8.5, z - 3.5, 2, 2);
  };
  base(49, 'T');
  base(-49, 'CT');

  // ---------------- outside scenery ----------------
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rand(-0.08, 0.08);
    const r = rand(72, 130);
    pine(Math.cos(a) * r, Math.sin(a) * r, rand(1.2, 2.2), false);
  }
  for (let i = 0; i < 18; i++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(70, 120);
    rock(Math.cos(a) * r, Math.sin(a) * r, rand(1.5, 4), false);
  }
  // mountain ring
  const mountMat = new THREE.MeshStandardMaterial({ color: 0xcdd9ea, roughness: 1 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    const r = rand(210, 300);
    const h = rand(70, 130);
    const m = new THREE.Mesh(new THREE.ConeGeometry(rand(50, 85), h, 6), mountMat);
    m.position.set(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r);
    scene.add(m);
  }

  // ---------------- spawns ----------------
  const tSpawns: SpawnPoint[] = [];
  const ctSpawns: SpawnPoint[] = [];
  for (let i = 0; i < 8; i++) {
    const x = -9 + i * 2.6;
    tSpawns.push({ x, z: 47 + (i % 2) * 2.5, yaw: 0 });
    ctSpawns.push({ x: -x, z: -47 - (i % 2) * 2.5, yaw: Math.PI });
  }

  // ---------------- waypoints ----------------
  const waypoints: THREE.Vector3[] = [];
  const blocked = (x: number, z: number) => {
    for (const c of colliders) {
      if (x > c.x0 - 1.4 && x < c.x1 + 1.4 && z > c.z0 - 1.4 && z < c.z1 + 1.4 && c.y0 < 1.2) return true;
    }
    return false;
  };
  for (let x = -48; x <= 48; x += 8) {
    for (let z = -48; z <= 48; z += 8) {
      const jx = x + rand(-2, 2), jz = z + rand(-2, 2);
      if (Math.abs(jx) > 50 || Math.abs(jz) > 50) continue;
      if (blocked(jx, jz)) continue;
      waypoints.push(new THREE.Vector3(jx, 0, jz));
    }
  }

  return { colliders, solids, ground, tSpawns, ctSpawns, waypoints, bounds: BOUNDS };
}
