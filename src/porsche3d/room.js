// Помещение частного автоклуба: круглая комната с тёмной штукатуркой,
// панелями из тёмного дерева, бетонный пол, тёплый свет сверху.
// Ничего не скачивается: текстуры рисуются на canvas, окружение для
// отражений собирается из простых плоскостей и запекается в PMREM один раз.
import {
  BackSide, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight,
  HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  PMREMGenerator, RepeatWrapping, Scene, SpotLight, SRGBColorSpace, Group, BoxGeometry,
} from 'three';

const ROOM_RADIUS = 7, ROOM_HEIGHT = 5.2, PANEL_HEIGHT = 0.85;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Детерминированный шум: одинаковая картинка при каждом запуске.
function random(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Дерево: вертикальные филёнки с рамками, волокна, латунная полоса по верху.
function woodTexture(low) {
  const W = low ? 512 : 1024, H = low ? 256 : 512;
  const [c, ctx] = canvas(W, H);
  const rnd = random(930);
  ctx.fillStyle = '#2b1a0f'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < W * 0.9; i++) {
    const x = rnd() * W, shade = 26 + rnd() * 22, alpha = 0.06 + rnd() * 0.12;
    ctx.strokeStyle = `rgba(${shade + 30},${shade + 8},${shade - 12},${alpha})`;
    ctx.lineWidth = 0.6 + rnd() * 1.6;
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y <= H; y += H / 8) ctx.lineTo(x + Math.sin(y * 0.02 + i) * 2.5, y);
    ctx.stroke();
  }
  // Две филёнки на повтор: рамка светлее, внутреннее поле темнее.
  const cap = H * 0.07, rail = H * 0.07, stile = W * 0.035;
  for (let k = 0; k < 2; k++) {
    const x0 = k * W / 2 + stile, x1 = (k + 1) * W / 2 - stile;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x0, cap + rail, x1 - x0, H - cap - rail * 2.2);
    ctx.strokeStyle = 'rgba(255,214,160,.10)'; ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 2, cap + rail + 2, x1 - x0 - 4, H - cap - rail * 2.2 - 4);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x0 - 3, cap + rail, 3, H - cap - rail * 2.2);
  }
  // Верхний карниз с тонкой латунной линией (как на кадре hero).
  const g = ctx.createLinearGradient(0, 0, 0, cap);
  g.addColorStop(0, '#b08a4c'); g.addColorStop(0.18, '#6d4e2a'); g.addColorStop(1, '#2a1a0e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, cap);
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, H - rail * 0.6, W, rail * 0.6);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = RepeatWrapping; t.anisotropy = 4;
  return t;
}

// Штукатурка: тёмные пятна, свет сверху растекается по стене.
function plasterTexture(low) {
  const W = low ? 256 : 512, H = low ? 128 : 256;
  const [c, ctx] = canvas(W, H);
  const rnd = random(1975);
  ctx.fillStyle = '#34271d'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 220; i++) {
    const x = rnd() * W, y = rnd() * H, r = 8 + rnd() * 40, d = rnd() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, d ? 'rgba(0,0,0,.16)' : 'rgba(120,90,60,.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace; t.wrapS = RepeatWrapping;
  return t;
}

// Мягкая тень под машиной: общий контур и пятна под колёсами.
// Размытие — через shadowBlur: ctx.filter поддерживается не во всех Safari.
function contactShadow() {
  const W = 256, H = 512, far = 4 * W;
  const [c, ctx] = canvas(W, H);
  const blurred = (blur, alpha, draw) => {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${alpha})`; ctx.shadowBlur = blur; ctx.shadowOffsetX = far;
    ctx.translate(-far, 0); ctx.fillStyle = '#000'; ctx.beginPath(); draw(); ctx.fill();
    ctx.restore();
  };
  blurred(28, 0.7, () => ctx.roundRect ? ctx.roundRect(W * 0.2, H * 0.12, W * 0.6, H * 0.76, 60) : ctx.rect(W * 0.2, H * 0.12, W * 0.6, H * 0.76));
  for (const [x, y] of [[0.19, 0.25], [0.81, 0.25], [0.19, 0.77], [0.81, 0.77]]) {
    blurred(10, 0.85, () => ctx.ellipse(W * x, H * y, W * 0.06, H * 0.07, 0, 0, Math.PI * 2));
  }
  return new CanvasTexture(c);
}

// Окружение для отражений: тёплая комната, длинные софтбоксы над машиной
// (они и дают блики на капоте и крыше), тёмные панели по кругу.
function environment(renderer) {
  const env = new Scene();
  env.background = new Color('#120c09');
  const own = [];
  const add = (geometry, color, intensity, setup) => {
    const material = new MeshBasicMaterial({color: new Color(color).multiplyScalar(intensity), side: BackSide});
    const mesh = new Mesh(geometry, material); setup(mesh); env.add(mesh); own.push(geometry, material);
    return mesh;
  };
  add(new CylinderGeometry(9, 9, 7, 32, 1, true), '#2a1d14', 1, m => m.position.y = 3.5);
  add(new CylinderGeometry(9.02, 9.02, 1.6, 32, 1, true), '#3a2717', 1, m => m.position.y = 0.8);
  add(new CircleGeometry(9, 32), '#1a1410', 1, m => { m.rotation.x = -Math.PI / 2; m.material.side = 0; });
  const strip = (x, z, w, l, power, ry = 0) => add(new PlaneGeometry(w, l), '#ffe9cc', power, m => {
    m.position.set(x, 4.6, z); m.rotation.set(Math.PI / 2, 0, ry); m.material.side = 2;
  });
  strip(-0.9, 0, 0.6, 6, 8, 0.15);
  strip(1.4, -0.4, 0.4, 5, 5, -0.2);
  // Боковые вертикальные источники: вытягивают блик по борту.
  const tall = (x, z, ry, power) => add(new PlaneGeometry(1.1, 3.2), '#ffdcb0', power, m => {
    m.position.set(x, 2.2, z); m.rotation.y = ry; m.material.side = 2;
  });
  tall(-6.5, -2.5, Math.PI / 2.4, 2.4);
  tall(5.8, 3, -Math.PI / 2.2, 1.4);
  tall(-2, -7, 0, 1.6);
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.02, 0.1, 30);
  pmrem.dispose();
  own.forEach(o => o.dispose());
  return target;
}

// Окружение для отражений отдельно от комнаты: mount() делает между ними
// паузу, чтобы ни один шаг не занимал главный поток надолго.
export function buildEnvironment(scene, renderer) {
  const target = environment(renderer);
  scene.environment = target.texture;
  scene.environmentIntensity = 0.9;
  scene.background = new Color('#0b0806');
  return {
    dispose() {
      target.dispose();
      scene.environment = null;
    },
  };
}

export function buildRoom(scene, {low}) {
  const disposables = [];
  const keep = (...items) => { disposables.push(...items); return items[0]; };
  const group = new Group(); group.name = 'room'; scene.add(group);

  // Стена: цилиндр изнутри. Нижний пояс — дерево, выше — штукатурка.
  const perimeter = 2 * Math.PI * ROOM_RADIUS;
  const wood = keep(woodTexture(low)); wood.repeat.set(Math.round(perimeter / 3.2), 1);
  const plaster = keep(plasterTexture(low)); plaster.repeat.set(Math.round(perimeter / 6), 1);
  const panels = new Mesh(
    keep(new CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, PANEL_HEIGHT, low ? 48 : 96, 1, true)),
    keep(new MeshStandardMaterial({map: wood, roughness: 0.55, metalness: 0, side: BackSide, envMapIntensity: 0.35})),
  );
  panels.position.y = PANEL_HEIGHT / 2; group.add(panels);
  const wall = new Mesh(
    keep(new CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, ROOM_HEIGHT - PANEL_HEIGHT, low ? 48 : 96, 1, true)),
    keep(new MeshStandardMaterial({map: plaster, roughness: 0.95, metalness: 0, side: BackSide, envMapIntensity: 0.2})),
  );
  wall.position.y = PANEL_HEIGHT + (ROOM_HEIGHT - PANEL_HEIGHT) / 2; group.add(wall);
  // Выступ карниза: тонкая полоса ловит свет сверху.
  const rail = new Mesh(
    keep(new CylinderGeometry(ROOM_RADIUS - 0.05, ROOM_RADIUS - 0.05, 0.035, low ? 48 : 96, 1, true)),
    keep(new MeshStandardMaterial({color: '#8a6636', roughness: 0.35, metalness: 0.6, side: BackSide})),
  );
  rail.position.y = PANEL_HEIGHT + 0.02; group.add(rail);

  // Пол: тёмный матовый бетон. Карта шероховатости давала блестящие пятна
  // от светильников у стены — пол выглядел светлым, в отличие от кадра hero.
  const floor = new Mesh(
    keep(new CircleGeometry(ROOM_RADIUS, low ? 48 : 96)),
    keep(new MeshStandardMaterial({color: '#17120e', roughness: 0.88, metalness: 0, envMapIntensity: 0.25})),
  );
  floor.rotation.x = -Math.PI / 2; group.add(floor);

  const shadowTexture = keep(contactShadow());
  const shadow = new Mesh(
    keep(new PlaneGeometry(2.3, 4.9)),
    keep(new MeshBasicMaterial({map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.95})),
  );
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004; group.add(shadow);

  // Свет. Тёплый ключевой спереди-слева сверху, контровой сзади-справа,
  // мягкое заполнение; два светильника у стены дают пятна над панелями,
  // как на кадре hero, и один сверху — блик на капоте и крыле.
  const hemi = new HemisphereLight('#f3dcc0', '#1a110b', 0.55);
  const key = new DirectionalLight('#ffe2bd', 1.3); key.position.set(-4, 6, -3.5);
  const rim = new DirectionalLight('#ffd5a0', 0.9); rim.position.set(3.5, 4, 4.5);
  group.add(hemi, key, rim);
  const washer = (degrees, intensity) => {
    const a = degrees * Math.PI / 180, x = Math.cos(a), z = Math.sin(a);
    const s = new SpotLight('#ffc27a', intensity, 9, 0.62, 1, 1.1);
    s.position.set(x * ROOM_RADIUS * 0.84, ROOM_HEIGHT - 0.15, z * ROOM_RADIUS * 0.84);
    s.target.position.set(x * ROOM_RADIUS, 0.6, z * ROOM_RADIUS);
    group.add(s, s.target);
  };
  washer(46, 26);
  washer(58, 22);
  const top = new SpotLight('#ffe0b8', 30, 10, 0.34, 0.9, 1.1);
  top.position.set(-0.6, ROOM_HEIGHT - 0.3, -2.2); top.target.position.set(0, 0.7, -1.2);
  group.add(top, top.target);

  return {
    group,
    dispose() {
      group.removeFromParent();
      for (const item of disposables) item.dispose();
    },
  };
}
