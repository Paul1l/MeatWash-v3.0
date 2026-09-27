// Капли на капоте (глава 04 THE PROTECTION, работа «Керамическое покрытие»),
// перенесено из v1: капли садятся на лак (по карте высот капота), растут и скатываются
// к переднему краю. Один InstancedMesh — один вызов отрисовки.
//
// Координаты v3: перед в −Z, левый борт в −X. Капот ищется в меше лака по
// положению и нормали треугольников (лак — один меш на весь кузов).
import {
  InstancedMesh, LatheGeometry, MeshPhysicalMaterial, Object3D, ShaderChunk, Vector2, Vector3,
} from 'three';

const smooth = (v, a, b) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };

// Карта высот капота: сетка по x/z, в каждой ячейке — верхняя точка лака и
// нормаль. Один проход по треугольникам (порциями, с паузами) вместо тысяч
// лучей: лучи по 10 тыс. треугольников давали задачи по 70–100 мс.
const GRID = {x0: -0.62, x1: 0.62, z0: -2.02, z1: -0.84, nx: 124, nz: 118};
async function hoodHeights(paint, pause, cancelled) {
  paint.updateMatrixWorld(true);
  const g = paint.geometry, pos = g.attributes.position, index = g.index, m = paint.matrixWorld;
  const {x0, x1, z0, z1, nx, nz} = GRID, dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
  const height = new Float32Array(nx * nz).fill(-1), normals = new Float32Array(nx * nz * 3);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), ab = new Vector3(), ac = new Vector3();
  const count = index ? index.count : pos.count;
  for (let i = 0; i < count; i += 3) {
    if (i && i % 12000 === 0) { await pause(); if (cancelled()) return null; }
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(m); b.fromBufferAttribute(pos, ib).applyMatrix4(m); c.fromBufferAttribute(pos, ic).applyMatrix4(m);
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
    if (cx < x0 - 0.05 || cx > x1 + 0.05 || cz < z0 - 0.05 || cz > z1 + 0.05 || cy < 0.45 || cy > 1.2) continue;
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    const len = n.length(); if (!len) continue; n.divideScalar(len);
    if (Math.abs(n.y) < 0.3) continue;
    if (n.y < 0) n.negate();
    // Ячейки, чьи центры попадают в проекцию треугольника на x/z.
    const minX = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - x0) / dx)), maxX = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / dx));
    const minZ = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - z0) / dz)), maxZ = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / dz));
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(det) < 1e-12) continue;
    for (let iz = minZ; iz <= maxZ; iz++) for (let ix = minX; ix <= maxX; ix++) {
      const px = x0 + (ix + 0.5) * dx, pz = z0 + (iz + 0.5) * dz;
      const l1 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / det;
      const l2 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      const y = l1 * a.y + l2 * b.y + l3 * c.y, k = iz * nx + ix;
      if (y > height[k]) { height[k] = y; normals[k * 3] = n.x; normals[k * 3 + 1] = n.y; normals[k * 3 + 2] = n.z; }
    }
  }
  // Точка на лаке под (x, z) — как попадание луча сверху.
  return (x, z) => {
    const ix = Math.floor((x - x0) / dx), iz = Math.floor((z - z0) / dz);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return null;
    const k = iz * nx + ix;
    if (height[k] < 0) return null;
    return {point: new Vector3(x, height[k], z), normal: new Vector3(normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2])};
  };
}

// Капли раскладываются по карте высот капота; сама карта считается порциями
// с паузами (pause), чтобы не было длинной задачи.
export async function createWater(scene, paint, {low, pause = () => Promise.resolve(), cancelled = () => false}) {
  if (!paint) return {update() {}, dispose() {}, material: null};
  const cast = await hoodHeights(paint, pause, cancelled);
  if (!cast) return null;
  let seed = 11293;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const drops = [];
  const limit = low ? 220 : 380;   // как в v1: 220 капель на телефоне
  for (let attempt = 0; attempt < 1600 && drops.length < limit; attempt++) {
    const x = (rand() - 0.5) * 1.1, z = -(0.88 + rand() * 1.02), r = 0.003 + Math.pow(rand(), 2) * 0.007;
    if (drops.some(d => Math.hypot(d.p.x - x, d.p.z - z) < (d.r + r) * 1.6)) continue;
    const hit = cast(x, z);
    if (!hit || hit.point.y > 1.2 || hit.point.y < 0.5) continue;
    const finish = cast(x + Math.sign(x) * 0.053, Math.max(-1.99, z - 0.42));
    drops.push({p: hit.point, n: hit.normal, end: finish?.point || hit.point.clone().add(new Vector3(0, -0.08, -0.29)), r, delay: rand() * 0.28, angle: rand() * Math.PI * 2, height: 0.75 + rand() * 0.25});
  }

  const profile = [], height = 0.95, radius = (1 + height * height) / (2 * height), center = height - radius, angle = Math.acos(-center / radius);
  // Капля на экране — несколько пикселей: 6 колец × 12 сегментов достаточно
  // (было 14 × 24 — 250 тыс. треугольников на 380 капель, главу 04 тормозило).
  for (let i = 0; i <= 6; i++) { const t = angle * (1 - i / 6); profile.push(new Vector2(radius * Math.sin(t), center + radius * Math.cos(t))); }
  const geometry = new LatheGeometry(profile, low ? 10 : 12);
  // Как в v1 на любом качестве: настоящее преломление лака под каплей
  // (проход transmission в половинном разрешении, только пока капли видны).
  const material = new MeshPhysicalMaterial({color: '#ffffff', metalness: 0, roughness: 0.055, transmission: 1, ior: 1.333, thickness: 1, envMapIntensity: 3.2, specularIntensity: 1.3});
  {
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying float beadDepth;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nbeadDepth=length(instanceMatrix[1].xyz);');
      shader.fragmentShader = 'varying float beadDepth;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_fragment>', ShaderChunk.transmission_fragment.replace('material.thickness = thickness;', 'material.thickness = thickness * beadDepth;'));
    };
    material.customProgramCacheKey = () => 'meatwash-beads-v3';
  }
  const mesh = new InstancedMesh(geometry, material, Math.max(1, drops.length));
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 3; mesh.name = 'water-beads';
  scene.add(mesh);
  const dummy = new Object3D(), up = new Vector3(0, 1, 0);
  let last = -1;
  return {
    material,
    // progress — доля пути сцены (капли на 0.72–0.91), как в v1.
    update(progress) {
      const visible = progress > 0.72 && progress < 0.91 && drops.length > 0;
      mesh.visible = visible;
      if (!visible || progress === last) return;
      last = progress;
      const amount = smooth(progress, 0.724, 0.784), roll = smooth(progress, 0.804, 0.88);
      drops.forEach((d, i) => {
        const grow = smooth(amount, d.delay, 1), slide = smooth(roll, d.delay * 0.6, 0.9);
        const scale = d.r * grow * (1 - smooth(slide, 0.6, 1));
        dummy.position.copy(d.p).lerp(d.end, slide * slide).addScaledVector(d.n, 0.0002);
        dummy.quaternion.setFromUnitVectors(up, d.n); dummy.rotateY(d.angle);
        dummy.scale.set(scale, scale * d.height, scale * (1 + slide * 0.6));
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); mesh.removeFromParent(); mesh.dispose?.(); },
  };
}
