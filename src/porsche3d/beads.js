// Керамика: вода на капоте стягивается в круглые бусины и стоит (как на кадре
// cf-bead-macro прежней витрины). Сначала — плоские растёкшиеся пятна воды, затем
// каждое собирается в высокую бусину; бусины остаются, пока выбрана работа. Без
// движения (prefers-reduced-motion) — сразу бусины.
//
// Одна геометрия на все бусины (как капли «Антидождя», drops.js: та же программа
// шейдера, что у стекла фар). Место и наклон — по карте высоты лака сверху
// (surfaceMap по треугольникам капота и крыльев, один раз при загрузке): бусина
// лежит на лаке, а не висит над ним — check:3d проверяет это на обеих моделях.
import {surfaceMap} from './interior.js';
import {random, smooth, waterMesh} from './drops.js';

// Время, с: пятна воды появляются (у каждого своё время) и стягиваются в бусины.
export const BEADS = {land: [0, 0.5], bead: [0.45, 1.5], still: 2};
// Капот и верх крыльев (перед −Z): центр бусины — над лаком, без кромок.
const HOOD = {x: [-0.62, 0.62], z: [-1.95, -0.86]};

export function buildBeads(car, {low = false} = {}) {
  const paint = surfaceMap(car, /^(meatwash-oxblood|paint)$/, {cell: 0.04, minUp: 0.3, box: {x: [-0.8, 0.8], y: [0.5, 1.0], z: [-2.15, -0.7]}});
  if (!paint) return null;
  const top = (x, z) => paint.height(x, z, true);
  // Наклон лака под точкой; null — край, щель или почти отвесно.
  const slope = (x, z, e = 0.012) => {
    const y = top(x, z), xa = top(x - e, z), xb = top(x + e, z), za = top(x, z - e), zb = top(x, z + e);
    if (y == null || xa == null || xb == null || za == null || zb == null) return null;
    const g = {y, gx: (xb - xa) / (2 * e), gz: (zb - za) / (2 * e)};
    // Резкий перепад рядом — кромка капота или щель: бусину туда не ставим.
    return Math.hypot(g.gx, g.gz) < 0.6 && Math.abs(xb + xa - 2 * y) < 0.004 && Math.abs(zb + za - 2 * y) < 0.004 ? g : null;
  };
  // Телефон: бусин меньше, но они крупнее — в узкой области 3D мелкая не читается.
  const rnd = random(2026), want = low ? 130 : 240, size = low ? 1.5 : 1, beads = [];
  for (let attempt = 0; attempt < want * 40 && beads.length < want; attempt++) {
    const x = HOOD.x[0] + rnd() * (HOOD.x[1] - HOOD.x[0]), z = HOOD.z[0] + rnd() * (HOOD.z[1] - HOOD.z[0]);
    const u = rnd(), r = (0.0035 + 0.0065 * u * u) * size;
    const g = slope(x, z);
    if (!g || !slope(x + 2 * r, z) || !slope(x - 2 * r, z) || !slope(x, z + 2 * r) || !slope(x, z - 2 * r)) continue;
    if (beads.some(b => Math.hypot(b.x - x, b.z - z) < (b.r + r) * 2.2)) continue;
    beads.push({x, z, r, g, land: BEADS.land[0] + rnd() * (BEADS.land[1] - BEADS.land[0]), bead: BEADS.bead[0] + rnd() * 0.45, squash: 0.85 + rnd() * 0.3});
  }
  if (!beads.length) return null;
  const water = waterMesh(beads.length, 'ceramic-beads');
  const {mesh, position, normal} = water;
  // Вода на бордовом лаке — тёмно-красная бусина с бликом, а не серая (цвет — та же программа).
  mesh.material.color.set('#3b0a10');
  mesh.material.opacity = 0.62;

  let last = -1;
  // Кадр: t — секунды с начала эффекта; still — сразу итог (бусины).
  function update(t, still = false) {
    t = still ? BEADS.still : Math.min(t, BEADS.still);
    if (t === last) return mesh.visible;
    last = t;
    let any = false;
    beads.forEach((b, i) => {
      const s = smooth(t, b.land, b.land + 0.15), k = smooth(t, b.bead, b.bead + 0.6);
      if (s > 0) any = true;
      // Пятно воды: широкое, плоское, вытянутое; бусина — круглая и высокая.
      const R = b.r * (2.4 - 1.4 * k);
      water.place(i, b.x, b.g.y, b.z, -b.g.gx, 1, -b.g.gz, R * (1 + 0.25 * (1 - k) * b.squash), R * (1 - 0.15 * (1 - k)), b.r * (0.08 + 0.79 * k), s);
    });
    position.needsUpdate = true; normal.needsUpdate = true;
    mesh.visible = any;
    return any;
  }
  update(0);
  mesh.visible = true;
  return {
    mesh,
    count: beads.length,
    update,
    hide() { mesh.visible = false; last = -1; },
    // Для проверок (check:3d): центры, радиус и высота лака под ними.
    sample: () => beads.map(b => ({x: b.x, z: b.z, r: b.r, y: b.g.y})),
    surface: top,
    dispose: water.dispose,
  };
}
