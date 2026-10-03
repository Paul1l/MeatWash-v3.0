// Салон в работах «Химчистка салона» и «Кондиционер кожи сидений»: грязь и сухая
// кожа в материалах кокпита (кожа, ткань «гусиная лапка», ковёр, торпедо, обивка
// двери). Код вставляется в стандартный шейдер three (onBeforeCompile) этих
// материалов один раз при загрузке: эффект меняет только однородные переменные —
// при показе ничего не компилируется. Пока эффекта нет (uMwCabin.x = 0), ветка
// с шумом не выполняется. Всё процедурное: шум по мировым координатам (м), без текстур.
// Комментарии — здесь, а не в строках GLSL: строки попадают в бандл как есть.
//
// Однородные переменные:
//   uMwCabin — общая для всех: x — сколько грязи (сухости) до волны 0..1; y — фронт
//              чистки (м, мировой z: перед машины в −Z, волна идёт от торпедо к корме);
//              z — 1: грязь пятнами (химчистка), 0: ровная сухость кожи (кондиционер);
//              w — влажная полоса за фронтом 0..1;
//   uMwDust  — у каждого материала своя: rgb — цвет грязи, a — сколько её на материале;
//   uMwDry   — у каждого материала своя: насколько он «сохнет» в работе с кожей (0 — ткань, ковёр).
//
// Грязь: тонкий слой пыли везде и пятна погуще (два слоя шума), крошки (редкие точки
// мельче сантиметра, гаснут, когда мельче пикселя) и тёмные разводы; под грязью
// матово. Сухая кожа — светлее, серее и матовая, чуть пятнами. За фронтом —
// влажная тёмная полоса с бликом, она сохнет.
import {Color, Vector4} from 'three';
import {NOISE} from './fx.js';

const VERTEX = ['#include <begin_vertex>', '#include <begin_vertex>\nvMwCab=(modelMatrix*vec4(transformed,1.0)).xyz;'];
const FRAGMENT = ['#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if(uMwCabin.x>0.001||uMwCabin.w>0.001){
vec3 p=vMwCab;float px=length(fwidth(p));
float n=mwNoise(p*9.0)*0.6+mwNoise(p.zxy*23.0)*0.4;
float patches=smoothstep(0.3,0.8,n);
float crumbs=step(0.89,mwNoise(p*150.0))*clamp(1.6-px*260.0,0.0,1.0);
float stain=smoothstep(0.55,0.75,mwNoise(p*3.7+3.1));
float s=p.z+0.1*(n-0.5);
float done=1.0-smoothstep(uMwCabin.y-0.05,uMwCabin.y+0.05,s);
float k=uMwCabin.x*(1.0-done);
vec3 base=diffuseColor.rgb;
vec3 dirty=mix(base,uMwDust.rgb,(0.5+0.5*patches)*uMwDust.a);
dirty=mix(dirty,vec3(0.3,0.24,0.17),crumbs*uMwDust.a);
dirty*=1.0-0.55*stain*uMwDust.a;
vec3 dry=mix(base,base*1.5+vec3(0.045,0.04,0.035),uMwDry*(0.7+0.3*n));
diffuseColor.rgb=mix(base,mix(dry,dirty,uMwCabin.z),k);
roughnessFactor=mix(roughnessFactor,1.0,k*mix(uMwDry,uMwDust.a,uMwCabin.z)*0.85);
float wet=uMwCabin.w*done*(1.0-smoothstep(0.0,0.22,uMwCabin.y-s));
diffuseColor.rgb*=1.0-0.3*wet;
roughnessFactor=mix(roughnessFactor,0.22,wet*0.75);}`];

export function createCabinFx() {
  const cabin = {value: new Vector4(0, -9, 1, 0)};
  // Одна функция на все материалы салона — одна строка в ключе программы: материалы
  // с одинаковыми параметрами делят программу, как и до эффекта.
  function onBeforeCompile(shader) {
    shader.uniforms.uMwCabin = cabin;
    shader.uniforms.uMwDust = {value: this.userData.mwDust};
    shader.uniforms.uMwDry = {value: this.userData.mwDry};
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMwCab;').replace(...VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 uMwCabin;uniform vec4 uMwDust;uniform float uMwDry;varying vec3 vMwCab;${NOISE}`)
      .replace(...FRAGMENT);
  }
  return {
    uniform: cabin,
    // dust — цвет грязи на материале (sRGB, как у цветов материалов; в шейдер — линейный),
    // amount — сколько её, dry — «сохнет» ли он в работе с кожей.
    patch(material, {dust = '#6f6353', amount = 0.6, dry = 0} = {}) {
      const c = new Color(dust);
      material.userData.mwDust = new Vector4(c.r, c.g, c.b, amount);
      material.userData.mwDry = dry;
      material.onBeforeCompile = onBeforeCompile;
      return material;
    },
    // amount — грязь/сухость до фронта, front — фронт (м, z), spots — пятнами (химчистка)
    // или ровно (кожа), wet — влажная полоса.
    set(amount, front, spots, wet) { cabin.value.set(amount, front, spots, wet); },
  };
}
