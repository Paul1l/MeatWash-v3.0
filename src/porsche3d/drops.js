// «Антидождь передней полусферы»: капли на внешней стороне лобового стекла.
// Капли садятся на стекло, собираются в бусины (гидрофобное покрытие) и скатываются
// вниз по стеклу, после чего стекло чистое. Без движения (prefers-reduced-motion)
// капли стоят бусинами — так и видно, что вода на стекле не растекается.
//
// Одна геометрия на все капли — низкополигональные сплюснутые полусферы (40
// треугольников), вершины пересчитываются только на кадрах эффекта. Материал без
// карт, с теми же настройками, что стекло фар (MeshPhysicalMaterial, clearcoat,
// прозрачность): three использует для них одну программу шейдера — при первом
// показе капель ничего не компилируется. Без transmission и постобработки.
// Положение и наклон капель — по карте стекла модели (interior.js glassMap,
// верхняя поверхность): только лобовое стекло, кромки — с запасом.
import {BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Mesh, MeshPhysicalMaterial, Vector3} from 'three';

const SEG = 8;              // сегментов по кругу
const RINGS = [0, 0.62, 0.93];  // высота колец полусферы (доля), верхушка — 1
const LIFT = 0.0015;        // м над стеклом: основание капли не уходит под гнутое стекло
// Время эффекта, с: капли садятся, собираются в бусины, скатываются.
export const DROPS = {
  land: [0, 0.75],          // когда садятся (у каждой своё время)
  bead: [0.85, 1.45],       // растёкшаяся капля стягивается в бусину
  roll: [1.5, 2.4],         // начало скатывания (у каждой своё)
  duration: 4.4,            // к этому времени стекло чистое
  still: 1.5,               // кадр без движения: все капли — бусины
};

// Детерминированный шум: одинаковая картина капель при каждом открытии.
function random(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const smooth = (v, a, b) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };

// Шаблон: единичная полусфера, кольца снизу вверх и верхушка.
function template() {
  const p = [];
  for (const h of RINGS) {
    const r = Math.sqrt(1 - h * h);
    for (let i = 0; i < SEG; i++) { const a = i / SEG * Math.PI * 2; p.push(Math.cos(a) * r, Math.sin(a) * r, h); }
  }
  p.push(0, 0, 1);
  const index = [];
  for (let k = 0; k < RINGS.length - 1; k++) for (let i = 0; i < SEG; i++) {
    const a = k * SEG + i, b = k * SEG + (i + 1) % SEG, c = a + SEG, d = b + SEG;
    index.push(a, b, d, a, d, c);
  }
  const top = RINGS.length * SEG;
  for (let i = 0; i < SEG; i++) index.push((RINGS.length - 1) * SEG + i, (RINGS.length - 1) * SEG + (i + 1) % SEG, top);
  return {p, index, count: p.length / 3};
}

// glass — карта стекла (glassMap): height(x, z, upper). null — стекла нет, капель тоже.
export function buildDrops(glass, {low = false} = {}) {
  if (!glass) return null;
  const top = (x, z) => glass.height(x, z, true);
  // Лобовое стекло: перед кабиной, высота растёт к корме (заднее стекло — наоборот).
  const slope = (x, z, e = 0.01) => {
    const y = top(x, z), xa = top(x - e, z), xb = top(x + e, z), za = top(x, z - e), zb = top(x, z + e);
    if (y == null || xa == null || xb == null || za == null || zb == null) return null;
    return {y, gx: (xb - xa) / (2 * e), gz: (zb - za) / (2 * e)};
  };
  const onWindscreen = (x, z, margin) => {
    const s = slope(x, z);
    if (!s || s.gz < 0.3) return null;
    for (const [dx, dz] of [[margin, 0], [-margin, 0], [0, margin], [0, -margin]]) if (top(x + dx, z + dz) == null) return null;
    return s;
  };

  // Капли: место, размер и время — один раз; бусины крупнее скатываются раньше.
  // Телефон (quality low): капель меньше, но они крупнее — в узкой области 3D
  // капля прежнего размера занимала 1–2 px и почти не читалась.
  const rnd = random(1975), want = low ? 80 : 180, size = low ? 1.6 : 1, drops = [];
  for (let attempt = 0; attempt < want * 40 && drops.length < want; attempt++) {
    const x = -0.66 + rnd() * 1.32, z = -0.74 + rnd() * 0.6;
    const u = rnd(), r = (0.0045 + 0.009 * u * u) * size;
    const g0 = onWindscreen(x, z, 0.03 + r);
    if (!g0) continue;
    if (drops.some(d => Math.hypot(d.x0 - x, d.z0 - z) < (d.r + r) * 1.9)) continue;
    drops.push({
      x0: x, z0: z, r, g0,
      land: DROPS.land[0] + rnd() * (DROPS.land[1] - DROPS.land[0]),
      bead: DROPS.bead[0] + rnd() * 0.2,
      roll: DROPS.roll[1] - (DROPS.roll[1] - DROPS.roll[0]) * Math.min(1, u * 1.2 + rnd() * 0.35),
      acc: 0.22 + 0.4 * u + rnd() * 0.1,
    });
  }
  if (!drops.length) return null;

  const shape = template();
  const n = drops.length, perDrop = shape.count;
  const position = new BufferAttribute(new Float32Array(n * perDrop * 3), 3).setUsage(DynamicDrawUsage);
  const normal = new BufferAttribute(new Float32Array(n * perDrop * 3), 3).setUsage(DynamicDrawUsage);
  const index = [];
  for (let i = 0; i < n; i++) for (const k of shape.index) index.push(i * perDrop + k);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  geometry.setIndex(index);
  // Как стекло фар (restyle в index.js) — та же программа шейдера; вода темнее и плотнее.
  const material = new MeshPhysicalMaterial({
    name: 'meatwash-drops', color: new Color('#1f2629'), metalness: 0, roughness: 0.04,
    transparent: true, opacity: 0.58, envMapIntensity: 2.4, depthWrite: false, clearcoat: 1,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'antirain-drops';
  // Капли — поверх стекла (у стекла renderOrder 2); рамку не считаем: вершины меняются.
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;

  const p = new Vector3(), nrm = new Vector3(), t1 = new Vector3(), t2 = new Vector3(), v = new Vector3(), w = new Vector3();
  // Капля i: центр основания на стекле (x, z), наклон стекла под ней g (slope), радиусы
  // вдоль скатывания (ra) и поперёк (rb), высота h; s = 0 — капли нет (вершины в точке).
  function place(i, x, z, g, ra, rb, h, s) {
    nrm.set(-g.gx, 1, -g.gz).normalize();
    // Вдоль скатывания: проекция «вниз» на плоскость стекла.
    t1.set(0, -1, 0).addScaledVector(nrm, nrm.y).normalize();
    if (!Number.isFinite(t1.x)) t1.set(0, 0, -1);
    t2.crossVectors(nrm, t1).normalize();
    p.set(x, g.y, z).addScaledVector(nrm, LIFT);
    const base = i * perDrop * 3, a = Math.max(1e-5, ra * s), b = Math.max(1e-5, rb * s), c = Math.max(1e-5, h * s);
    for (let k = 0; k < perDrop; k++) {
      const cx = shape.p[k * 3], cy = shape.p[k * 3 + 1], cz = shape.p[k * 3 + 2];
      v.copy(p).addScaledVector(t1, cx * a).addScaledVector(t2, cy * b).addScaledVector(nrm, cz * c);
      // Нормаль эллипсоида (x/a², y/b², z/c²): для точки шаблона — (cx/a, cy/b, cz/c) в осях капли.
      w.copy(t1).multiplyScalar(cx / a).addScaledVector(t2, cy / b).addScaledVector(nrm, cz / c).normalize();
      position.array[base + k * 3] = v.x; position.array[base + k * 3 + 1] = v.y; position.array[base + k * 3 + 2] = v.z;
      normal.array[base + k * 3] = w.x; normal.array[base + k * 3 + 1] = w.y; normal.array[base + k * 3 + 2] = w.z;
    }
  }

  // Скатывание считается по шагам (не дольше 1/30 с): капля идёт по самому крутому
  // спуску стекла и ускоряется; у кромки уходит со стекла. Наклон стекла под каплей
  // хранится (g) — на кадр уходит один поиск по карте стекла на шаг, а не на вершину.
  let last = -1, lastStill = false;
  const state = drops.map(() => ({x: 0, z: 0, g: null, v: 0, gone: 0, flat: false}));
  function reset() {
    drops.forEach((d, i) => Object.assign(state[i], {x: d.x0, z: d.z0, g: d.g0, v: 0, gone: 0, flat: false}));
  }
  function roll(t, dt) {
    for (let i = 0; i < n; i++) {
      const d = drops[i], st = state[i];
      if (t < d.roll || st.gone >= 1) continue;
      if (st.gone > 0 || t > DROPS.duration - 0.25) { st.gone = Math.min(1, st.gone + dt / 0.14); continue; }
      st.v += d.acc * dt;
      const g = st.g, grad = Math.hypot(g.gx, g.gz);
      if (grad < 1e-3) { st.gone = 1e-3; continue; }
      const step = st.v * dt / Math.sqrt(1 + grad * grad), dx = -g.gx / grad, dz = -g.gz / grad;
      const nx = st.x + dx * step, nz = st.z + dz * step, next = slope(nx, nz);
      // Впереди кромка стекла — капля уходит с него.
      const edge = 0.012 + d.r;
      if (!next || next.gz < 0.3 || top(nx + dx * edge, nz + dz * edge) == null) { st.gone = 1e-3; continue; }
      st.x = nx; st.z = nz; st.g = next;
    }
  }
  // Кадр эффекта: t — секунды с начала; still — без движения (бусины на местах).
  function update(t, still = false) {
    if (still) {
      if (lastStill) return mesh.visible;
      reset(); t = DROPS.still;
    } else {
      if (t === last && !lastStill) return mesh.visible;
      if (lastStill || last < 0 || t < last) { reset(); last = 0; }
      for (let from = last; from < t;) { const to = Math.min(t, from + 1 / 30); roll(to, to - from); from = to; }
      last = t;
    }
    lastStill = still;
    let any = false;
    for (let i = 0; i < n; i++) {
      const d = drops[i], st = state[i];
      const landed = smooth(t, d.land, d.land + 0.18), bead = smooth(t, d.bead, d.bead + 0.45);
      const s = landed * (1 - smooth(st.gone, 0, 1)) * (st.gone >= 1 ? 0 : 1);
      if (s > 0) any = true;
      // Капли нет и вершины уже сведены в точку — пересчитывать нечего.
      if (s === 0 && st.flat) continue;
      st.flat = s === 0;
      // Растёкшаяся капля широкая и плоская, бусина — уже и выше; на ходу вытягивается.
      const R = d.r * (1 - 0.3 * bead), stretch = Math.min(0.55, st.v * 1.4);
      place(i, st.x, st.z, st.g, R * (1 + stretch), R * (1 - 0.2 * stretch), d.r * (0.22 + 0.6 * bead), s);
    }
    position.needsUpdate = true; normal.needsUpdate = true;
    mesh.visible = any;
    return any;
  }

  // Первый кадр сцены рисует капли нулевого размера: программа шейдера та же, что у
  // стекла фар, кадр ничего не показывает; потом капли скрыты до работы «Антидождь».
  update(0);
  mesh.visible = true;
  return {
    mesh,
    count: n,
    update,
    hide() { mesh.visible = false; last = -1; lastStill = false; },
    // Для проверок (check:3d): центры капель, радиус и высота стекла под ними.
    sample: () => drops.map(d => ({x: d.x0, z: d.z0, r: d.r, y: top(d.x0, d.z0)})),
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
