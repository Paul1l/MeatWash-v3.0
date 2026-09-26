// Помещение частного автоклуба: круглая комната с тёмной штукатуркой,
// панелями из тёмного дерева, бетонный пол, тёплый свет сверху.
// Ничего не скачивается: текстуры рисуются на canvas, окружение для
// отражений собирается из простых плоскостей и запекается в PMREM один раз.
import {
  BackSide, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight,
  HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  PMREMGenerator, RepeatWrapping, Scene, SpotLight, SRGBColorSpace, Group, BoxGeometry, PointLight,
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
  ctx.fillStyle = '#7d5433'; ctx.fillRect(0, 0, W, H);
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
    ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(x0, cap + rail, x1 - x0, H - cap - rail * 2.2);
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
  ctx.fillStyle = '#4e4136'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 220; i++) {
    const x = rnd() * W, y = rnd() * H, r = (8 + rnd() * 40) * W / 512, d = rnd() < 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, d ? 'rgba(0,0,0,.16)' : 'rgba(140,120,95,.07)'); g.addColorStop(1, 'rgba(0,0,0,0)');
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
  env.background = new Color('#1a130e');
  const own = [];
  const add = (geometry, color, intensity, setup) => {
    const material = new MeshBasicMaterial({color: new Color(color).multiplyScalar(intensity), side: BackSide});
    const mesh = new Mesh(geometry, material); setup(mesh); env.add(mesh); own.push(geometry, material);
    return mesh;
  };
  add(new CylinderGeometry(9, 9, 7, 32, 1, true), '#3a2b1f', 1, m => m.position.y = 3.5);
  add(new CylinderGeometry(9.02, 9.02, 1.6, 32, 1, true), '#4a3322', 1, m => m.position.y = 0.8);
  add(new CircleGeometry(9, 32), '#221b15', 1, m => { m.rotation.x = -Math.PI / 2; m.material.side = 0; });
  const strip = (x, z, w, l, power, ry = 0) => add(new PlaneGeometry(w, l), '#ffe9cc', power, m => {
    m.position.set(x, 4.6, z); m.rotation.set(Math.PI / 2, 0, ry); m.material.side = 2;
  });
  strip(-0.9, 0, 0.9, 6, 8, 0.15);
  strip(-0.2, 0, 0.3, 6, 6, 0.15);
  strip(1.4, -0.4, 0.4, 5, 5, -0.2);
  // Боковые вертикальные источники: вытягивают блик по борту.
  const tall = (x, z, ry, power) => add(new PlaneGeometry(1.1, 3.2), '#ffdcb0', power, m => {
    m.position.set(x, 2.2, z); m.rotation.y = ry; m.material.side = 2;
  });
  tall(-6.5, -2.5, Math.PI / 2.4, 2.4);
  tall(5.8, 3, -Math.PI / 2.2, 1.4);
  // Передний источник крупнее и ярче: его отражают хромированные фары.
  add(new PlaneGeometry(2.2, 2.4), '#ffdcb0', 3.2, m => { m.position.set(-2, 1.2, -7); m.material.side = 2; });
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
  scene.environmentIntensity = 1.0;
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
    keep(new MeshStandardMaterial({map: wood, roughness: 0.55, metalness: 0, side: BackSide, envMapIntensity: 0.5, dithering: true})),
  );
  panels.position.y = PANEL_HEIGHT / 2; group.add(panels);
  const wall = new Mesh(
    keep(new CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, ROOM_HEIGHT - PANEL_HEIGHT, low ? 48 : 96, 1, true)),
    keep(new MeshStandardMaterial({map: plaster, roughness: 0.95, metalness: 0, side: BackSide, envMapIntensity: 0.2, dithering: true})),
  );
  wall.position.y = PANEL_HEIGHT + (ROOM_HEIGHT - PANEL_HEIGHT) / 2; group.add(wall);
  // Выступ карниза: тонкая полоса ловит свет сверху.
  const rail = new Mesh(
    keep(new CylinderGeometry(ROOM_RADIUS - 0.05, ROOM_RADIUS - 0.05, 0.045, low ? 48 : 96, 1, true)),
    keep(new MeshStandardMaterial({color: '#9a7a4a', roughness: 0.45, metalness: 0.35, side: BackSide})),
  );
  rail.position.y = PANEL_HEIGHT + 0.02; group.add(rail);

  // Пол: тёмный матовый бетон. Карта шероховатости давала блестящие пятна
  // от светильников у стены — пол выглядел светлым, в отличие от кадра hero.
  const floor = new Mesh(
    keep(new CircleGeometry(ROOM_RADIUS, low ? 48 : 96)),
    keep(new MeshStandardMaterial({color: '#171513', roughness: 0.85, metalness: 0, envMapIntensity: 0.3, dithering: true})),
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
  const hemi = new HemisphereLight('#f3e6d6', '#3a2819', 0.4);
  const key = new DirectionalLight('#ffe2bd', 0.9); key.position.set(-4, 6, -3.5);
  const rim = new DirectionalLight('#ffd5a0', 0.9); rim.position.set(3.5, 4, 4.5);
  group.add(hemi, key, rim);
  const washer = (degrees, intensity) => {
    const a = degrees * Math.PI / 180, x = Math.cos(a), z = Math.sin(a);
    const s = new SpotLight('#ffd9b0', intensity, 9, 0.5, 0.75, 1.1);
    s.position.set(x * ROOM_RADIUS * 0.84, ROOM_HEIGHT - 0.15, z * ROOM_RADIUS * 0.84);
    s.target.position.set(x * ROOM_RADIUS, 0.6, z * ROOM_RADIUS);
    group.add(s, s.target);
  };
  washer(51, 20);
  washer(66, 18);
  const top = new SpotLight('#ffe0b8', 14, 10, 0.34, 0.9, 1.1);
  top.position.set(-0.6, ROOM_HEIGHT - 0.3, -2.2); top.target.position.set(0, 0.7, -1.2);
  group.add(top, top.target);
  // Свет, который скользит вдоль левого борта в главе полировки (03 THE REFLECTION):
  // отражение едет по лаку. Есть всегда (яркость 0), чтобы не пересобирать шейдеры.
  const sweep = new PointLight('#fff1dc', 0, 6, 2);
  sweep.position.set(-2.3, 1.45, 1.6);
  group.add(sweep);

  return {
    group,
    sweep,
    top,
    dispose() {
      group.removeFromParent();
      for (const item of disposables) item.dispose();
    },
  };
}
