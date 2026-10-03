// Дверь водителя: в «Химчистке салона» и «Кондиционере кожи сидений» она открывается
// на петле у передней кромки, камера смотрит в салон через проём. Модель отдаёт дверь
// отдельным узлом (scripts/optimize-3d.mjs, DOOR) — обшивка, корпус и стекло зеркала,
// стекло, рамка окна, молдинг, ручка. Здесь дверь встаёт на петлю, а изнутри к ней
// крепится обивка из материалов кокпита (кожа, подлокотник, ручка, карман, строчка)
// и торцы цвета кузова: у обшивки модели одна сторона, без обивки открытая дверь
// изнутри была бы пустой рамкой. Обивка склеена по материалам — шесть вызовов
// отрисовки, программы шейдеров — те же, что у кокпита.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// angle — на сколько открывается, рад; open / close — время, с.
export const DOOR = {name: 'meatwash-door', angle: 64 * Math.PI / 180, open: 1.15, close: 0.85};

// Размеры двери по обшивке (лак) в мировых координатах, дверь закрыта. Корпус зеркала
// (тоже лак) — снаружи и выше 0,74 м: для пояса и торцов не учитывается.
export function doorBounds(car) {
  const node = car.getObjectByName(DOOR.name);
  if (!node) return null;
  car.updateMatrixWorld(true);
  let skin = null;
  node.traverse(o => { if (o.isMesh && /^(meatwash-oxblood|paint)$/.test(o.material?.name)) skin = o; });
  if (!skin) return null;
  const position = skin.geometry.attributes.position, v = new THREE.Vector3(), points = [];
  for (let i = 0; i < position.count; i++) points.push(v.fromBufferAttribute(position, i).applyMatrix4(skin.matrixWorld).clone());
  const body = points.filter(p => !(p.x < -0.75 && p.y > 0.74));
  const z0 = Math.min(...body.map(p => p.z)), z1 = Math.max(...body.map(p => p.z));
  const y0 = Math.min(...body.map(p => p.y)), y1 = Math.max(...body.map(p => p.y));
  const inner = Math.max(...body.map(p => p.x));
  const rear = body.filter(p => p.z > z1 - 0.04 && p.y > y0 + 0.08 && p.y < y1 - 0.08);
  const outer = rear.length ? Math.min(...rear.map(p => p.x)) : inner - 0.12;
  // Петля — у передней кромки, на 3 см внутрь от наружной поверхности.
  const front = body.filter(p => p.z < z0 + 0.04 && p.y > 0.4 && p.y < 0.8);
  const hinge = front.length ? [Math.min(...front.map(p => p.x)) + 0.03, z0 + 0.035] : [inner - 0.1, z0 + 0.035];
  return {node, z: [z0, z1], y: [y0, y1], inner, outer, hinge};
}

// materials — материалы кокпита {leather, black, edging, metal, thread, jamb}.
export function buildDoor(car, materials) {
  const b = doorBounds(car);
  if (!b || !materials) return null;
  const {node, z: [z0, z1], y: [y0, y1], inner, outer, hinge: [hx, hz]} = b;
  const len = z1 - z0, parts = new Map();
  const add = (material, geometry, x, y, z) => {
    geometry.translate(x, y, z);
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(geometry);
  };
  const box = (material, w, h, d, r, x, y, z) => add(material, new RoundedBoxGeometry(w, h, d, 2, r), x, y, z);
  const zc = (z0 + z1) / 2;
  // Обивка: кожаная панель от низа двери до пояса, по поясу — тёмный кант.
  box(materials.leather, 0.03, y1 - y0 - 0.1, len - 0.07, 0.012, inner + 0.015, (y0 + y1) / 2 - 0.01, zc + 0.01);
  box(materials.black, 0.06, 0.05, len - 0.05, 0.016, inner + 0.03, y1 - 0.035, zc + 0.01);
  // Подлокотник, ручка, карман, строчка — как на обивке 930.
  box(materials.edging, 0.07, 0.05, 0.42, 0.018, inner + 0.05, y0 + 0.31, z0 + len * 0.6);
  box(materials.metal, 0.012, 0.024, 0.15, 0.006, inner + 0.036, y0 + 0.41, z0 + len * 0.33);
  box(materials.black, 0.04, 0.11, len * 0.48, 0.014, inner + 0.035, y0 + 0.13, z0 + len * 0.36);
  for (const y of [y0 + 0.21, y0 + 0.235]) box(materials.thread, 0.004, 0.003, len - 0.16, 0.001, inner + 0.031, y, zc + 0.02);
  // Торцы цвета кузова: задний и нижний — от обшивки до обивки.
  const depth = Math.max(0.04, inner - outer);
  box(materials.jamb, depth, y1 - y0 - 0.06, 0.012, 0.004, (inner + outer) / 2, (y0 + y1) / 2, z1 - 0.012);
  box(materials.jamb, depth, 0.012, len - 0.05, 0.004, (inner + outer) / 2, y0 + 0.012, zc);
  const card = new THREE.Group();
  card.name = 'door-card';
  for (const [material, geometries] of parts) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach(g => g.dispose());
    card.add(new THREE.Mesh(geometry, material));
  }
  const pivot = new THREE.Group();
  pivot.name = 'door-pivot';
  pivot.position.set(hx, 0, hz);
  node.parent.add(pivot);
  pivot.updateMatrixWorld(true);
  pivot.attach(node);
  card.position.set(-hx, 0, -hz);
  pivot.add(card);
  return {
    pivot,
    hinge: [hx, hz],
    // k — открыта на 0..1 (уже сглажено): задняя кромка уходит наружу (−X).
    set(k) { pivot.rotation.y = -DOOR.angle * k; },
  };
}
