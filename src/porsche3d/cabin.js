// Салон в работах «Химчистка салона» и «Кондиционер кожи сидений»: грязь и сухая
// кожа в материалах кокпита (кожа, ткань «гусиная лапка», ковёр, торпедо, обивка
// двери). Код вставляется в стандартный шейдер three (onBeforeCompile) этих
// материалов один раз при загрузке: эффект меняет только однородные переменные —
// при показе ничего не компилируется. Пока эффекта нет (uMwCabin.x = 0), ветка
// с шумом не выполняется. Всё процедурное: шум по мировым координатам (м), без текстур.
// Комментарии — здесь, а не в строках GLSL: строки попадают в бандл как есть.
//
// Однородные переменные:
//   uMwCabin  — общая: x — сколько грязи (сухости кожи) до обработки 0..1; y — фронт
//               экстракции химчистки (м, мировой z: перед машины в −Z, волна идёт от
//               торпедо к корме); z — 1: химчистка, 0: кондиционер кожи; w — влажный след 0..1;
//   uMwCabin2 — общая: x — фронт нанесения пены химчистки (м, мировой z, −9 — пены нет);
//               y — сколько кожи прошёл аппликатор 0..1; z — сатин после кондиционера 0..1;
//   uMwDust   — у каждого материала своя: rgb — цвет грязи, a — сколько её на материале;
//   uMwDry    — у каждого материала своя: насколько он «сохнет» в работе с кожей (0 — ткань, ковёр);
//   uMwFoam   — у каждого материала своя: сколько на него ложится пены химчистки.
//
// Химчистка — весь салон: грязь (тонкий слой пыли и пятна погуще, крошки мельче
// сантиметра — гаснут, когда мельче пикселя, тёмные разводы; под грязью матово) → на
// ткань, ковёр и кожу волной от торпедо ложится пена хлопьями с просветами (две
// октавы шума) → фронт экстракции снимает пену вместе с грязью, за ним — влажный
// след, он сохнет.
// Кондиционер — только кожа: сухая, светлая, матовая → средство расходится пятнами,
// как от аппликатора (пятна растут и сливаются по порогу шума, а не волной), свежий
// край блестит сильнее → высыхает в сатин: кожа глубже, мягкий блеск остаётся, пока
// выбрана работа.
import {Color, Vector4} from 'three';
import {NOISE} from './fx.js';

const VERTEX = ['#include <begin_vertex>', '#include <begin_vertex>\nvMwCab=(modelMatrix*vec4(transformed,1.0)).xyz;'];
const FRAGMENT = ['#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if(uMwCabin.x>0.001||uMwCabin.w>0.001||uMwCabin2.x>-8.0){
vec3 p=vMwCab;float px=length(fwidth(p));
float n=mwNoise(p*9.0)*0.6+mwNoise(p.zxy*23.0)*0.4;
float patches=smoothstep(0.3,0.8,n);
float crumbs=step(0.89,mwNoise(p*150.0))*clamp(1.6-px*260.0,0.0,1.0);
float stain=smoothstep(0.55,0.75,mwNoise(p*3.7+3.1));
float s=p.z+0.1*(n-0.5);
float swept=1.0-smoothstep(uMwCabin.y-0.05,uMwCabin.y+0.05,s);
float a=mwNoise(p*7.0)*0.7+mwNoise(p.yzx*17.0)*0.3,lead=uMwCabin2.y*1.15-0.05-a;
float spot=smoothstep(-0.04,0.04,lead);
float done=mix(spot,swept,uMwCabin.z);
float k=uMwCabin.x*(1.0-done);
vec3 base=diffuseColor.rgb;
vec3 dirty=mix(base,uMwDust.rgb,(0.5+0.5*patches)*uMwDust.a);
dirty=mix(dirty,vec3(0.3,0.24,0.17),crumbs*uMwDust.a);
dirty*=1.0-0.55*stain*uMwDust.a;
vec3 dry=mix(base,base*1.5+vec3(0.045,0.04,0.035),uMwDry*(0.7+0.3*n));
diffuseColor.rgb=mix(base,mix(dry,dirty,uMwCabin.z),k);
roughnessFactor=mix(roughnessFactor,1.0,k*mix(uMwDry,uMwDust.a,uMwCabin.z)*0.85);
float fb=mwNoise(p*40.0)*0.65+mwNoise(p.yzx*95.0)*0.35;
float laid=1.0-smoothstep(uMwCabin2.x-0.06,uMwCabin2.x+0.06,p.z+0.12*(n-0.5));
float foam=uMwFoam*(1.0-swept)*laid*smoothstep(0.2,0.36,fb+0.25*n);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.6,0.58,0.55)*(0.78+0.22*fb),foam);
roughnessFactor=mix(roughnessFactor,0.55,foam);
float wet=uMwCabin.w*done*mix(0.55+0.45*(1.0-smoothstep(0.0,0.12,lead)),1.0-smoothstep(0.0,0.22,uMwCabin.y-s),uMwCabin.z)*mix(uMwDry,1.0,uMwCabin.z);
diffuseColor.rgb*=1.0-0.3*wet;
roughnessFactor=mix(roughnessFactor,0.22,wet*0.75);}
diffuseColor.rgb*=1.0-0.2*uMwCabin2.z*uMwDry;
roughnessFactor=mix(roughnessFactor,0.42,uMwCabin2.z*uMwDry);`];

export function createCabinFx() {
  const cabin = {value: new Vector4(0, -9, 1, 0)}, cabin2 = {value: new Vector4(0, 0, 0, 0)};
  // Одна функция на все материалы салона — одна строка в ключе программы: материалы
  // с одинаковыми параметрами делят программу, как и до эффекта.
  function onBeforeCompile(shader) {
    shader.uniforms.uMwCabin = cabin;
    shader.uniforms.uMwCabin2 = cabin2;
    shader.uniforms.uMwDust = {value: this.userData.mwDust};
    shader.uniforms.uMwDry = {value: this.userData.mwDry};
    shader.uniforms.uMwFoam = {value: this.userData.mwFoam};
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMwCab;').replace(...VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 uMwCabin;uniform vec4 uMwCabin2;uniform vec4 uMwDust;uniform float uMwDry;uniform float uMwFoam;varying vec3 vMwCab;${NOISE}`)
      .replace(...FRAGMENT);
  }
  return {
    uniform: cabin,
    uniform2: cabin2,
    // dust — цвет грязи на материале (sRGB, как у цветов материалов; в шейдер — линейный),
    // amount — сколько её, dry — «сохнет» ли он в работе с кожей, foam — сколько пены химчистки.
    patch(material, {dust = '#6f6353', amount = 0.6, dry = 0, foam = 0} = {}) {
      const c = new Color(dust);
      material.userData.mwDust = new Vector4(c.r, c.g, c.b, amount);
      material.userData.mwDry = dry;
      material.userData.mwFoam = foam;
      material.onBeforeCompile = onBeforeCompile;
      return material;
    },
    // amount — грязь/сухость до обработки, front — фронт экстракции (м, z), mode — 1 химчистка /
    // 0 кожа, wet — влажный след; foam — фронт пены (м, z), applied — пройдено аппликатором
    // 0..1, satin — сатин кожи.
    set(amount = 0, front = -9, mode = 1, wet = 0, foam = -9, applied = 0, satin = 0) {
      cabin.value.set(amount, front, mode, wet);
      cabin2.value.set(foam, applied, satin, 0);
    },
  };
}
