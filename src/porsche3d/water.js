// Капли на капоте (глава 04 THE PROTECTION, работа «Керамическое покрытие»),
// перенесено из v1: капли садятся на лак по лучам сверху, растут и скатываются
// к переднему краю. Один InstancedMesh — один вызов отрисовки.
//
// Координаты v3: перед в −Z, левый борт в −X. Капот ищется в меше лака по
// положению и нормали треугольников (лак — один меш на весь кузов).
import {
  BufferGeometry, Float32BufferAttribute, InstancedMesh, LatheGeometry, Mesh,
  MeshPhysicalMaterial, Object3D, Raycaster, ShaderChunk, Vector2, Vector3,
} from 'three';

const smooth = (v, a, b) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };

// Треугольники капота: верх передней части кузова.
function hoodSurface(paint) {
  paint.updateMatrixWorld(true);
  const g = paint.geometry, pos = g.attributes.position, index = g.index;
  const m = paint.matrixWorld;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), ab = new Vector3(), ac = new Vector3();
  const out = [];
  const count = index ? index.count : pos.count;
  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(m); b.fromBufferAttribute(pos, ib).applyMatrix4(m); c.fromBufferAttribute(pos, ic).applyMatrix4(m);
    const x = (a.x + b.x + c.x) / 3, y = (a.y + b.y + c.y) / 3, z = (a.z + b.z + c.z) / 3;
    if (Math.abs(x) > 0.62 || z < -2.02 || z > -0.84 || y < 0.45 || y > 1.2) continue;
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
    if (Math.abs(n.y) < 0.3) continue;
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(out, 3));
  geometry.computeVertexNormals();
  return new Mesh(geometry);
}

export function createWater(scene, paint, {low}) {
  if (!paint) return {update() {}, dispose() {}, material: null};
  const hood = hoodSurface(paint);
  hood.updateMatrixWorld(true);
  let seed = 11293;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ray = new Raycaster(), down = new Vector3(0, -1, 0), drops = [];
  const cast = (x, z) => { ray.set(new Vector3(x, 3, z), down); return ray.intersectObject(hood, false)[0]; };
  const limit = low ? 220 : 380;   // как в v1: 220 капель на телефоне
  for (let attempt = 0; attempt < 1600 && drops.length < limit; attempt++) {
    const x = (rand() - 0.5) * 1.1, z = -(0.88 + rand() * 1.02), r = 0.003 + Math.pow(rand(), 2) * 0.007;
    if (drops.some(d => Math.hypot(d.p.x - x, d.p.z - z) < (d.r + r) * 1.6)) continue;
    const hit = cast(x, z);
    if (!hit || hit.point.y > 1.2 || hit.point.y < 0.5) continue;
    const finish = cast(x + Math.sign(x) * 0.053, Math.max(-1.99, z - 0.42));
    const normal = hit.face.normal.clone().normalize();
    if (normal.y < 0) normal.negate();
    drops.push({p: hit.point, n: normal, end: finish?.point || hit.point.clone().add(new Vector3(0, -0.08, -0.29)), r, delay: rand() * 0.28, angle: rand() * Math.PI * 2, height: 0.75 + rand() * 0.25});
  }
  hood.geometry.dispose();

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
