// Салон: кожаный кокпит из v1 (сиденья, приборы, руль, двери) — строится кодом,
// без загрузок; текстуры кожи, ткани и шкал рисуются на canvas. Модель салона
// в исходнике упрощённая: её «ванна» (материал black) в зоне салона вырезается,
// на её место ставится кокпит.
//
// Кокпит описан в координатах v1 (перед в +Z, масштаб 4,4 м по кузову); в v3
// модель развёрнута (перед в −Z) и приведена к 4,29 м по всей длине —
// поэтому группа поворачивается на 180° и масштабируется на V1_TO_V3.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const V1_TO_V3 = 0.971;

// Строится порциями: между шагами (текстуры, сиденья, приборы, склейка)
// поток отдаётся странице — целиком это 0,3–0,5 с одной задачей.
export async function buildInterior(car, pause = () => Promise.resolve()) {
  // Вырезаем упрощённую «ванну» салона из меша black (координаты v1 для проверки).
  let shell = null;
  car.traverse(o => { if (o.isMesh && o.material?.name === 'black') shell = o; });
  const removed = [];
  if (shell) {
    car.updateMatrixWorld(true);
    const g = shell.geometry, position = g.attributes.position, old = g.index, keep = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < (old ? old.count : position.count); i += 3) {
      const ids = [0, 1, 2].map(k => old ? old.getX(i + k) : i + k);
      a.fromBufferAttribute(position, ids[0]).applyMatrix4(shell.matrixWorld);
      b.fromBufferAttribute(position, ids[1]).applyMatrix4(shell.matrixWorld);
      c.fromBufferAttribute(position, ids[2]).applyMatrix4(shell.matrixWorld);
      const x = -(a.x + b.x + c.x) / 3 / V1_TO_V3, y = (a.y + b.y + c.y) / 3 / V1_TO_V3, z = -(a.z + b.z + c.z) / 3 / V1_TO_V3;
      const inCabin = Math.abs(x) < .81 && z > -1.48 && z < .90 && y > .65;
      if (!inCabin) keep.push(...ids);
    }
    const cut = g.clone(); cut.setIndex(keep);
    shell.geometry = cut; removed.push(g);
  }
  await pause();
  // Стекло модели в координатах кокпита (v1): торпедо строится сразу под него.
  const glass = glassMap(car);
  const glassV1 = (x, z) => {
    const y = glass?.height(-x * V1_TO_V3, 0.1 - z * V1_TO_V3);
    return y == null ? null : (y + 0.05) / V1_TO_V3;
  };
  const cockpit = await buildCockpit(pause, glassV1);
  await pause();
  batchInterior(cockpit);
  cockpit.rotation.y = Math.PI;
  cockpit.scale.setScalar(V1_TO_V3);
  // Салон чуть ниже и ближе к корме: так сиденья и приборы стоят по местам кузова v3.
  cockpit.position.set(0, -0.05, 0.1);
  // Торпедо v1 плоское во всю ширину, а лобовое стекло 930 гнутое и к стойкам ниже
  // на 6–10 см: углы торпедо выходили сквозь стекло (до 4 см). Подгоняем кокпит
  // под настоящее стекло модели.
  const fitted = fitUnderGlass(cockpit, car, GLASS_CLEARANCE, glass);
  const textures = new Set(), materials = new Set();
  cockpit.traverse(o => { if (o.material) { materials.add(o.material); for (const v of Object.values(o.material)) if (v?.isTexture) textures.add(v); } });
  return {
    group: cockpit,
    fitted,
    dispose() {
      cockpit.removeFromParent();
      cockpit.traverse(o => o.geometry?.dispose());
      materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
      removed.forEach(g => g.dispose());
    },
  };
}

// Зазор между кокпитом и лобовым стеклом, м: стекло прозрачное и не пишет глубину,
// поэтому всё, что касается его или выходит наружу, видно поверх.
export const GLASS_CLEARANCE = 0.02;

// Стёкла модели сверху в мировых координатах: материал стекла (исходный «glass»
// или заменённый restyle «meatwash-glass»), без почти вертикальных боковых окон —
// сверху на них ничего не опирается. Треугольники разложены по сетке 5 см в
// плоскости XZ: высота над точкой ищется только среди своей ячейки.
export function glassMap(car, cell = 0.05) {
  car.updateMatrixWorld(true);
  const tris = [], p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], n = new THREE.Vector3(), e = new THREE.Vector3();
  car.traverse(o => {
    if (!o.isMesh || !/^(meatwash-)?glass$/.test(o.material?.name || '')) return;
    const position = o.geometry.attributes.position, index = o.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(o.matrixWorld);
      n.subVectors(p[1], p[0]).cross(e.subVectors(p[2], p[0])).normalize();
      if (Math.abs(n.y) > 0.25) tris.push(p.map(q => q.toArray()));
    }
  });
  if (!tris.length) return null;
  const all = tris.flat();
  const minX = Math.min(...all.map(q => q[0])), maxX = Math.max(...all.map(q => q[0]));
  const minZ = Math.min(...all.map(q => q[2])), maxZ = Math.max(...all.map(q => q[2]));
  const cols = Math.ceil((maxX - minX) / cell) + 1, grid = new Map();
  const key = (x, z) => Math.floor((z - minZ) / cell) * cols + Math.floor((x - minX) / cell);
  for (const t of tris) {
    const x0 = Math.min(t[0][0], t[1][0], t[2][0]), x1 = Math.max(t[0][0], t[1][0], t[2][0]);
    const z0 = Math.min(t[0][2], t[1][2], t[2][2]), z1 = Math.max(t[0][2], t[1][2], t[2][2]);
    for (let z = z0; z < z1 + cell; z += cell) for (let x = x0; x < x1 + cell; x += cell) {
      const k = key(Math.min(x, x1), Math.min(z, z1));
      if (!grid.has(k)) grid.set(k, new Set());
      grid.get(k).add(t);
    }
  }
  // Высота стекла над точкой (x, z): нижняя из поверхностей на этой вертикали
  // (у стекла бывает внешняя и внутренняя). null — над точкой стекла нет.
  const height = (x, z) => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return null;
    let best = null;
    for (const [a, b, c] of grid.get(key(x, z)) || []) {
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
      const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      if (best === null || y < best) best = y;
    }
    return best;
  };
  return {height, triangles: tris.length};
}

// Всё в кокпите, что под лобовым стеклом поднимается выше «стекло минус зазор»,
// опускается по вертикали до этой высоты: торпедо у стоек повторяет изгиб стекла.
// Остальная геометрия не меняется. Возвращает число сдвинутых вершин.
export function fitUnderGlass(cockpit, car, clearance = GLASS_CLEARANCE, glass = glassMap(car)) {
  if (!glass) return 0;
  cockpit.updateMatrixWorld(true);
  const v = new THREE.Vector3(), inverse = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let moved = 0;
  cockpit.traverse(o => {
    if (!o.isMesh && !o.isLineSegments) return;
    const g = o.geometry, position = g.attributes.position;
    inverse.copy(o.matrixWorld).invert();
    const touched = new Set();
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld);
      const top = glass.height(v.x, v.z);
      if (top === null || v.y <= top - clearance) continue;
      v.y = top - clearance;
      v.applyMatrix4(inverse);
      position.setXYZ(i, v.x, v.y, v.z);
      touched.add(i); moved++;
    }
    if (!touched.size) return;
    position.needsUpdate = true;
    g.computeBoundingBox(); g.computeBoundingSphere();
    const normal = g.attributes.normal;
    if (!normal) return;
    if (g.index) { g.computeVertexNormals(); return; }
    // Склеенная геометрия без индекса: нормаль сдвинутого треугольника — по его плоскости.
    for (let i = 0; i < position.count; i += 3) {
      if (!touched.has(i) && !touched.has(i + 1) && !touched.has(i + 2)) continue;
      a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
      const n = b.sub(a).cross(c.sub(a)).normalize();
      for (let k = 0; k < 3; k++) normal.setXYZ(i + k, n.x, n.y, n.z);
    }
    normal.needsUpdate = true;
  });
  return moved;
}

// glassV1(x, z) — высота лобового стекла модели над точкой в координатах кокпита (v1),
// null — стекла над точкой нет. По ней полка торпедо кладётся под стекло.
async function buildCockpit(pause, glassV1 = () => null){
 const cockpit=new THREE.Group();cockpit.name='Detailed atelier interior';
 const texture=(type)=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');let seed=931;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};ctx.fillStyle=type==='cloth'?'#746957':'#808080';ctx.fillRect(0,0,256,256);for(let y=0;y<256;y+=2)for(let x=0;x<256;x+=2){const n=rnd();if(type==='cloth'){const warp=((Math.floor(x/8)+Math.floor(y/8))%4)<2;ctx.fillStyle=warp?`rgba(29,27,22,${.25+n*.4})`:`rgba(205,183,147,${.15+n*.3})`;}else ctx.fillStyle=`rgba(${n>.5?'255,255,255':'0,0,0'},${.1+n*.27})`;ctx.fillRect(x,y,1+rnd(),1+rnd());}const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(type==='cloth'?3:5,type==='cloth'?4:5);tex.anisotropy=4;return tex;};
 const grain=texture('leather');await pause();const weave=texture('cloth');weave.colorSpace=THREE.SRGBColorSpace;await pause();
 // Standard, а не Physical, как в v1: без лака разницы не видно, а программа легче.
 const leather=new THREE.MeshStandardMaterial({color:'#362319',roughness:.82,metalness:0,bumpMap:grain,bumpScale:.0013});
 const edging=new THREE.MeshStandardMaterial({color:'#3c291c',roughness:.61});const cloth=new THREE.MeshStandardMaterial({color:'#594736',map:weave,roughness:.95,bumpMap:grain,bumpScale:.0006});
 // Светлее, чем в v1 (#181814): без теней в салоне торпедо сквозь стекло читалось чёрным бруском.
 const black=new THREE.MeshStandardMaterial({color:'#2a231d',roughness:.7,bumpMap:grain,bumpScale:.001});const metal=new THREE.MeshStandardMaterial({color:'#bcb09a',metalness:.84,roughness:.3});const thread=new THREE.MeshStandardMaterial({color:'#856b50',roughness:.9});
 // Торпедо: тёмный винил с лёгким сатиновым бликом (виден через стекло снаружи).
 // Верхняя полка — с текстурой: щели обдува у стекла. Без градиентов canvas:
 // check:3d собирает кокпит в Node с заглушкой холста.
 const dashSoft=new THREE.MeshStandardMaterial({color:'#1a1512',roughness:.56,metalness:0,bumpMap:grain,bumpScale:.0007,envMapIntensity:.55});
 const vent=new THREE.MeshStandardMaterial({color:'#0e0b09',roughness:.85,metalness:0});
 const dashTopMap=(()=>{const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');let seed=1930;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  // Тёмный винил: мелкое слабое зерно (крупное читалось снаружи как песок на полке).
  ctx.fillStyle='#1b1613';ctx.fillRect(0,0,512,128);
  for(let i=0;i<14000;i++){ctx.fillStyle=`rgba(${rnd()>.5?'255,236,210':'0,0,0'},${.015+rnd()*.035})`;ctx.fillRect(rnd()*512,rnd()*128,1,1);}
  // Щели обдува: v≈.80–.88 от задней кромки (строка 0 холста — передняя кромка, flipY).
  for(const [u0,u1] of [[.07,.45],[.55,.93]]){const x0=u0*512,x1=u1*512;ctx.fillStyle='#070504';ctx.fillRect(x0,15,x1-x0,11);ctx.fillStyle='rgba(120,100,80,.3)';for(let x=x0+3;x<x1;x+=6)ctx.fillRect(x,16,1.2,9);ctx.fillStyle='rgba(255,230,200,.1)';ctx.fillRect(x0,26,x1-x0,1);}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;})();
 const dashTop=new THREE.MeshStandardMaterial({color:'#ffffff',map:dashTopMap,roughness:.56,metalness:0,bumpMap:grain,bumpScale:.0005,envMapIntensity:.55,side:THREE.DoubleSide});
 function upholstery(parent,w,h,d,x,y,z,mat){
  const positions=[],uvs=[],indices=[],rows=26,columns=40;
  for(let j=0;j<=rows;j++){
   const t=j/rows,cap=Math.pow(Math.sin(Math.PI*t),.22),taper=1-.10*t;
   for(let i=0;i<=columns;i++){
    const a=i/columns*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
    positions.push(Math.sign(c)*Math.pow(Math.abs(c),.65)*w*.5*cap*taper,(t-.5)*h,Math.sign(s)*Math.pow(Math.abs(s),.7)*d*.5*cap-.015*t*t);
    uvs.push(i/columns,t);
   }
  }
  for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){const a=j*(columns+1)+i,b=a+columns+1;indices.push(a,b,a+1,b,b+1,a+1);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(x,y,z);parent.add(mesh);return mesh;
 }
 function box(parent,w,h,d,r,x,y,z,mat){const mesh=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,r),mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
 function tube(parent,points,r,mat){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(8,points.length*5),r,5,false),mat);parent.add(mesh);return mesh;}
 function stitch(parent,x1,y1,z1,x2,y2,z2,count=26){const points=[];const a=new THREE.Vector3(x1,y1,z1),b=new THREE.Vector3(x2,y2,z2);for(let i=0;i<count;i++){points.push(a.clone().lerp(b,i/count),a.clone().lerp(b,(i+.43)/count));}const line=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:'#988069'}));parent.add(line);}
 box(cockpit,1.35,.065,1.95,.018,0,.39,-.32,black);
 for(const x of [-.36,.36]){
  await pause();
  const seat=new THREE.Group();seat.position.set(x,0,-.24);cockpit.add(seat);
  box(seat,.49,.12,.51,.045,0,.515,-.04,leather);box(seat,.315,.022,.38,.014,0,.583,-.015,cloth);
  for(const sx of [-.203,.203])box(seat,.085,.11,.45,.036,sx,.58,-.04,leather);
  const back=new THREE.Group();back.position.set(0,.59,-.30);back.rotation.x=-.14;seat.add(back);
  upholstery(back,.47,.58,.15,0,.235,0,leather);
  box(back,.285,.35,.014,.018,0,.232,.081,cloth);
  for(let rib=0;rib<9;rib++){const yy=.082+rib*.039;tube(back,[[-.138,yy,.093],[0,yy-.004,.097],[.138,yy,.093]],.0012,edging);}
  for(const sx of [-.19,.19])upholstery(back,.095,.49,.13,sx,.225,.067,leather);
  upholstery(back,.31,.165,.13,0,.525,-.014,leather);
  for(const sx of [-.155,.155])stitch(back,sx,.056,.096,sx,.414,.096,32);
  stitch(back,-.15,.422,.095,.15,.422,.095,26);
  for(const sx of [-.237,.237])tube(seat,[[sx,.57,.14],[sx,.584,-.04],[sx,.565,-.24]],.0022,thread);
  box(seat,.047,.073,.055,.009,-Math.sign(x)*.285,.548,-.035,black);box(seat,.026,.01,.025,.003,-Math.sign(x)*.285,.585,-.032,new THREE.MeshStandardMaterial({color:'#793122',roughness:.6}));
 }
 await pause();
 for(const x of [-.68,.68]){
  box(cockpit,.055,.37,1.24,.024,x,.70,-.21,leather);box(cockpit,.075,.08,1.29,.024,x,.907,-.21,black);
  box(cockpit,.09,.066,.43,.02,x-Math.sign(x)*.05,.71,-.16,edging);
  box(cockpit,.015,.028,.18,.007,x-Math.sign(x)*.086,.80,.14,metal);
  for(const y of [.60,.64,.68])tube(cockpit,[[x-Math.sign(x)*.034,y,-.66],[x-Math.sign(x)*.034,y,.32]],.0017,thread);
  const pin=new THREE.Mesh(new THREE.CylinderGeometry(.004,.004,.04,8),metal);pin.position.set(x,.96,-.58);cockpit.add(pin);
 }
 // Полка торпедо: от панели (z .40) до основания стекла; передняя кромка повторяет
 // кривую основания (у центра z≈.84, у стоек ≈.69), высота — под стекло модели с зазором
 // 4,5 см, к стойкам чуть ниже. Снаружи через стекло видна именно эта тёмная плоскость,
 // а не брусок с освещённой гранью.
 {
  const cols=48,rows=12,xHalf=.64,zRear=.40;
  const zFront=x=>.845-.155*Math.pow(x/xHalf,2);
  const yAt=(x,z)=>{const t=(z-zRear)/(zFront(x)-zRear);let y=.955-.055*t-.03*Math.pow(x/xHalf,2);const g=glassV1(x,z);if(g!=null)y=Math.min(y,g-.045);return y;};
  const grid=(rowsN,point)=>{const pos=[],uv=[],idx=[];for(let j=0;j<=rowsN;j++)for(let i=0;i<=cols;i++){const [x,y,z,u,v]=point(i/cols,j/rowsN);pos.push(x,y,z);uv.push(u,v);}
   for(let j=0;j<rowsN;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+cols+1;idx.push(a,b,a+1,b,b+1,a+1);}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;};
  const top=new THREE.Mesh(grid(rows,(u,v)=>{const x=-xHalf+2*xHalf*u;const z=zRear+(zFront(x)-zRear)*v;return [x,yAt(x,z),z,u,v];}),dashTop);
  // Передний борт полки уходит вниз за кромку кузова: щели между полкой и капотом не видно.
  const skirt=new THREE.Mesh(grid(1,(u,v)=>{const x=-xHalf+2*xHalf*u,z=zFront(x);return [x,yAt(x,z)-.09*v,z+.004*v,u,.98];}),dashTop);
  for(const m of [top,skirt]){m.castShadow=m.receiveShadow=true;cockpit.add(m);}
 }
 // Вертикальная панель к водителю: дефлекторы, магнитола, перчаточный ящик.
 box(cockpit,1.27,.17,.06,.014,0,.87,.41,dashSoft);
 for(const x of [-.08,.08])box(cockpit,.10,.036,.02,.004,x,.905,.374,vent);
 box(cockpit,.19,.045,.02,.004,0,.83,.374,vent);box(cockpit,.014,.014,.012,.004,-.07,.83,.366,metal);box(cockpit,.014,.014,.012,.004,.07,.83,.366,metal);
 box(cockpit,.46,.071,.013,.009,-.37,.84,.373,edging);box(cockpit,.055,.009,.015,.003,-.37,.86,.37,metal);
 // Козырёк приборов перед водителем — невысокий горб над полкой (7–8 см), приборы
 // утоплены под тонкий навес.
 box(cockpit,.50,.11,.22,.035,.25,.975,.44,dashSoft);
 box(cockpit,.52,.022,.085,.009,.25,1.045,.33,dashSoft);
 // Салонное зеркало на стекле и солнцезащитные козырьки под крышей — их видно
 // снаружи в верхней части стекла (ножку зеркала к стеклу подводит fitUnderGlass).
 {
  const mirror=new THREE.Group();mirror.position.set(0,1.15,.41);mirror.rotation.x=-.3;cockpit.add(mirror);
  box(mirror,.21,.055,.022,.008,0,0,0,black);box(mirror,.19,.04,.004,.001,0,0,-.012,metal);
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.05,8),black);stem.position.set(0,1.2,.415);cockpit.add(stem);
  // Козырьки — целиком за верхней кромкой стекла (у стоек она уходит назад до z≈.21 v1):
  // иначе подгонка под стекло гнула бы их внешние углы.
  for(const x of [-.31,.31]){const visor=box(cockpit,.38,.012,.11,.005,x,1.245,.19,dashSoft);visor.rotation.x=-.1;}
 }
 await pause();
 const instruments=new THREE.Group();instruments.position.set(.25,.96,.345);cockpit.add(instruments);
 const gauge=(label,max,needle)=>{const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.fillStyle='#141611';ctx.fillRect(0,0,256,256);ctx.translate(128,128);ctx.strokeStyle='#d5cfb9';ctx.lineWidth=3;for(let i=0;i<=40;i++){const a=(-220+i*7)*Math.PI/180;ctx.beginPath();ctx.moveTo(Math.cos(a)*(i%5===0?86:96),Math.sin(a)*(i%5===0?86:96));ctx.lineTo(Math.cos(a)*107,Math.sin(a)*107);ctx.stroke();}ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='17px Arial';ctx.fillStyle='#d5cfb9';for(let i=0;i<=8;i++){const a=(-220+i*35)*Math.PI/180;ctx.fillText(String(Math.round(i*max/8)),Math.cos(a)*70,Math.sin(a)*70);}ctx.font='12px Arial';ctx.fillText(label,0,44);ctx.rotate(needle);ctx.fillStyle='#d78956';ctx.beginPath();ctx.moveTo(-4,14);ctx.lineTo(0,-88);ctx.lineTo(4,14);ctx.fill();ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fillStyle='#4a493e';ctx.fill();const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide,toneMapped:false});};
 [-.285,-.14,0,.14,.265].forEach((x,i)=>{const r=i===2?.073:.060;const face=new THREE.Mesh(new THREE.CircleGeometry(r,48),gauge(i===2?'RPM x 1000':i===3?'km/h':'BAR',i===2?8:i===3?240:10,.22+i*.41));face.rotation.y=Math.PI;face.position.set(x,0,-.015);instruments.add(face);const ring=new THREE.Mesh(new THREE.TorusGeometry(r+.004,.004,6,48),metal);ring.position.set(x,0,-.017);instruments.add(ring);});
 await pause();
 const wheel=new THREE.Group();wheel.position.set(.34,.93,.205);wheel.rotation.x=-.22;cockpit.add(wheel);
 const rim=new THREE.Mesh(new THREE.TorusGeometry(.155,.014,10,64),black);wheel.add(rim);
 for(const angle of [Math.PI/2,Math.PI*7/6,Math.PI*11/6]){const spoke=box(wheel,.03,.13,.008,.005,Math.cos(angle)*.075,Math.sin(angle)*.075,0,metal);spoke.rotation.z=angle-Math.PI/2;}
 box(wheel,.072,.065,.038,.012,0,0,-.008,black);
 const emblem=new THREE.Mesh(new THREE.CircleGeometry(.017,24),new THREE.MeshStandardMaterial({color:'#aa8555',metalness:.6,roughness:.4,side:THREE.DoubleSide}));emblem.position.z=-.029;wheel.add(emblem);
 box(cockpit,.19,.11,.57,.025,0,.48,.10,edging);
 const boot=new THREE.Mesh(new THREE.CylinderGeometry(.025,.057,.075,16),black);boot.position.set(0,.56,.16);cockpit.add(boot);
 const lever=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.115,12),metal);lever.position.set(0,.64,.16);lever.rotation.x=.16;cockpit.add(lever);
 const knob=new THREE.Mesh(new THREE.SphereGeometry(.027,20,12),black);knob.scale.set(1,1.2,1);knob.position.set(0,.702,.15);cockpit.add(knob);
 for(const x of [-.32,.32]){box(cockpit,.43,.10,.34,.04,x,.51,-.99,leather);box(cockpit,.43,.31,.08,.034,x,.68,-1.18,leather);}
 cockpit.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 return cockpit;
}


// Склеиваем меши кокпита по материалам: десятки деталей — несколько вызовов отрисовки.
function batchInterior(group){
 group.updateMatrixWorld(true);const batches=new Map();
 group.traverse(o=>{if(!o.isMesh||Array.isArray(o.material))return;const key=o.material.uuid;if(!batches.has(key))batches.set(key,[]);batches.get(key).push(o);});
 for(const meshes of batches.values()){
  if(meshes.length<2)continue;
  const geometries=meshes.map(mesh=>{
   const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
   geometry.applyMatrix4(mesh.matrixWorld);
   for(const name of Object.keys(geometry.attributes))if(!['position','normal','uv'].includes(name))geometry.deleteAttribute(name);
   return geometry;
  });
  const merged=mergeGeometries(geometries);geometries.forEach(g=>g.dispose());
  if(!merged)continue;
  const mesh=new THREE.Mesh(merged,meshes[0].material);mesh.castShadow=mesh.receiveShadow=true;
  meshes.forEach(original=>{original.removeFromParent();original.geometry.dispose();});group.add(mesh);
 }
}
