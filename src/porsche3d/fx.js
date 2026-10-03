// Эффекты работ в материалах машины: пена мойки (все наружные материалы: лак,
// стёкла, фары, пластик, хром, диски, шины) и очиститель дисков (диски и шины).
// Код вставляется в стандартные шейдеры three (onBeforeCompile) копий материалов —
// «вариантов с эффектами»: машина носит их только пока идёт мойка или очистка дисков,
// в остальное время — обычные материалы без этого кода (большой шейдер с выключенной
// веткой всё равно дороже: на swiftshader +12 % к кадру, на телефонных видеокартах —
// регистры). Варианты собираются при загрузке вместе со всеми (index.js) и один раз
// рисуются вскоре после показа машины — при показе эффекта ничего не компилируется.
// Вариантов немного: стекло фары делит программу со стёклами, прозрачные — в один
// проход, на телефоне без фонарей, наклеек и чёрных панелей; код очистителя — только
// в шейдерах дисков и шин. Всё процедурное: шум по мировым координатам (м), без текстур.
// Комментарии — здесь, а не в строках GLSL: строки попадают в бандл как есть.
//
// Однородные переменные:
//   uMwFoam — x: фронт нанесения пены (м, мировой y), y: фронт смыва (м), z: сползание
//             пены (м), w: пена включена;
//   uMwWash — x: мокрый лак после смыва 0..1, y: пыль на дисках 0..1, z: мокрые колёса 0..1;
//   uMwIron — x: реакция очистителя 0..1, y: сползание и длина подтёков (м), z: фронт
//             смыва (м), w: очиститель включён.
import {Vector4} from 'three';

// Очиститель дисков — только в шейдерах дисков и шин (у остальных материалов этой
// функции нет: меньше кода — быстрее сборка программы при загрузке).
const IRON = `
float mwIronAt(vec3 p,bool tire){
float px=length(fwidth(p)),run=uMwIron.y;vec3 q=vec3(p.x,p.y+run,p.z);
float a=mwNoise(vec3(q.x*60.0,q.y*11.0,q.z*60.0));
float b=mix(0.5,mwNoise(vec3(q.x*150.0,q.y*26.0,q.z*150.0)),clamp(1.6-px*380.0,0.0,1.0));
float thr=mix(0.95,0.47,uMwIron.x);
float spots=tire?0.0:smoothstep(thr,thr+0.16,a*0.7+b*0.3);
float lines=smoothstep(0.6,0.84,mwNoise(vec3(p.x*120.0,p.y*3.0,p.z*120.0)));
float top=tire?0.2:0.14+0.4*mwNoise(vec3(p.x*18.0,7.3,p.z*18.0));
float len=run*(tire?1.1:0.6+0.8*mwNoise(vec3(p.x*41.0,2.1,p.z*41.0)));
float drip=lines*smoothstep(top-len-0.012,top-len+0.012,p.y)*(1.0-smoothstep(top,top+0.02,p.y));
float rinsed=smoothstep(uMwIron.z-0.02,uMwIron.z+0.02,p.y-0.06*lines);
return max(spots,drip*smoothstep(0.2,0.6,uMwIron.x))*(1.0-rinsed);}`;

// Шум по решётке (значения в узлах, гладкая интерполяция) — для вершин и пикселей.
export const NOISE = `
float mwHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float mwNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
return mix(mix(mix(mwHash(i),mwHash(i+vec3(1,0,0)),f.x),mix(mwHash(i+vec3(0,1,0)),mwHash(i+vec3(1,1,0)),f.x),f.y),
mix(mix(mwHash(i+vec3(0,0,1)),mwHash(i+vec3(1,0,1)),f.x),mix(mwHash(i+vec3(0,1,1)),mwHash(i+vec3(1,1,1)),f.x),f.y),f.z);}`;

// Фрагментный шейдер: переменные, шум и функции.
// mwRinsed — смыто ли место фронтом r: выше фронта — да; на бортах узкие струйки
//   (riv) держатся дольше, на горизонтальном (steep → 0) пена сходит ровнее и мягче.
// mwFoamAt — пена в точке: x — покрытие 0..1, y — рельеф пузырей 0..1, z — смыто 0..1.
//   Край фронта неровный (edge), ниже фронта — узкие подтёки (riv — верхушки шума
//   streak: струи 2 см, под острым углом к взгляду мельче пикселя — гаснут к среднему),
//   длиннее, чем дольше пена стоит. Комья — октавы шума, повёрнутые друг относительно друга (без квадратов
//   решётки); октава мельче двух пикселей гаснет (иначе рябь), на телефоне самой
//   мелкой нет. Стоящая пена на бортах сползает вертикальными струями и вверху редеет.
// mwIronAt — очиститель в точке, 0..1: точки растут в пятна, вытянутые вниз, и
//   сползают; с нижних краёв тянутся тонкие подтёки, на шине — только они.
// mwPerturb — рельеф пены: нормаль по экранным производным высоты пузырей (как bumpMap three).
const COMMON = `
uniform vec4 uMwFoam;uniform vec4 uMwWash;uniform vec4 uMwIron;
varying vec3 vMwPos;varying float vMwUp;${NOISE}
float mwRinsed(vec3 p,float r,float edge,float streak,float steep){
float y=p.y+mix(0.03,0.08,steep)*(edge-0.5)-0.26*steep*streak;float w=mix(0.1,0.03,steep);
return smoothstep(r-w,r+w,y);}
vec3 mwFoamAt(vec3 p,float up){
float slide=uMwFoam.z;vec3 q=p+vec3(0.0,slide,0.0);float px=length(fwidth(p));
float edge=mwNoise(vec3(p.x*5.0,0.5,p.z*5.0));
float streak=mix(0.5,mwNoise(vec3(p.x*48.0,q.y*2.2,p.z*48.0)),clamp(1.6-px*120.0,0.0,1.0));
float steep=1.0-abs(up);
float riv=smoothstep(0.64,0.88,streak);
float drip=(0.03+1.4*slide)*riv+0.03*streak;
float applied=smoothstep(uMwFoam.x-0.03,uMwFoam.x+0.03,p.y+0.1*(edge-0.5)+drip);
float rinsed=mwRinsed(p,uMwFoam.y,edge,riv,steep);
vec3 r=mat3(0.8,0.36,-0.48,-0.6,0.48,-0.64,0.0,0.8,0.6)*q;
float f=mwNoise(r*22.0)*0.5+0.25;
f+=(mwNoise(q.zxy*52.0)-0.5)*0.32*clamp(1.6-px*130.0,0.0,1.0);
#ifndef MW_LOW
f+=(mwNoise(r.yzx*120.0)-0.5)*0.2*clamp(1.6-px*300.0,0.0,1.0);
#endif
float sag=min(1.0,slide*10.0);
f=mix(f,0.35+0.6*streak,steep*sag*0.55);
float thin=steep*smoothstep(0.5,0.85,p.y)*sag;
float dens=mix(0.86,1.0,smoothstep(0.3,0.7,f))*(1.0-0.85*thin*smoothstep(0.35,0.7,1.0-f));
return vec3(applied*(1.0-rinsed)*dens,f,rinsed);}
vec3 mwPerturb(vec3 s,vec3 n,float h,float k,float face){
vec3 sx=normalize(dFdx(s)),sy=normalize(dFdy(s)),r1=cross(sy,n),r2=cross(n,sx);float det=dot(sx,r1)*face;
return normalize(abs(det)*n-sign(det)*(dFdx(h)*r1+dFdy(h)*r2)*k);}`;

export const VERTEX_COMMON = '\nvarying vec3 vMwPos;varying float vMwUp;';
export const VERTEX_BEGIN = '\nvMwPos=(modelMatrix*vec4(transformed,1.0)).xyz;vMwUp=normalize(mat3(modelMatrix)*objectNormal).y;';
// Объём пены на лаке (компьютер): вершины приподнимаются по нормали на 0,6–1,8 см
// там, где лежит пена, — силуэт крыши и крыльев становится пухлым.
const VERTEX_FOAM = `
if(uMwFoam.w>0.5){float e=mwNoise(vec3(vMwPos.x*5.0,0.5,vMwPos.z*5.0));
float a=smoothstep(uMwFoam.x-0.03,uMwFoam.x+0.03,vMwPos.y+0.1*(e-0.5));
float r=smoothstep(uMwFoam.y-0.06,uMwFoam.y+0.06,vMwPos.y+0.04*(e-0.5));
float l=mwNoise(vMwPos*18.0+vec3(0.0,uMwFoam.z,0.0));
transformed+=inverse(mat3(modelMatrix))*(normalize(mat3(modelMatrix)*objectNormal)*a*(1.0-r)*(0.006+0.012*l));}`;

// Пена (линейный цвет): тёплый белый, впадины между пузырями темнее. Очиститель —
// тёмный винно-фиолетовый.
const FOAM_COLOR = 'vec3(0.76,0.74,0.7)';
const IRON_COLOR = 'vec3(0.16,0.008,0.045)';

// Вставка после metalnessmap_fragment — материал под пеной и очистителем; role:
// paint (смытый лак мокрый: глубже цвет, ровнее отражение), glass (пена на стекле
// непрозрачна), rim и tire (пыль, которую смывает пена или очиститель; очиститель;
// мокрая шина темнее и с бликом), trim.
function surfaceCode(role) {
  const wheel = role === 'rim' || role === 'tire';
  return `
float mwFoamC=0.0,mwFoamF=0.0;
if(uMwFoam.w>0.5){vec3 mwF=mwFoamAt(vMwPos,vMwUp);mwFoamC=mwF.x;mwFoamF=mwF.y;
${role === 'paint' ? 'float mwWet=mwF.z*uMwWash.x;diffuseColor.rgb*=1.0-0.18*mwWet;roughnessFactor=mix(roughnessFactor,0.07,mwWet);' : ''}
${role === 'glass' ? 'diffuseColor.a=mix(diffuseColor.a,0.96,mwFoamC);' : ''}
diffuseColor.rgb=mix(diffuseColor.rgb,${FOAM_COLOR}*(0.78+0.32*mwFoamF),mwFoamC);
roughnessFactor=mix(roughnessFactor,0.72,mwFoamC);metalnessFactor=mix(metalnessFactor,0.0,mwFoamC);}
${wheel ? `if(uMwWash.y>0.0){float d=uMwWash.y*(0.55+0.45*mwNoise(vMwPos*55.0));
if(uMwFoam.w>0.5)d*=1.0-mwRinsed(vMwPos,uMwFoam.y,0.5,0.0,1.0);
if(uMwIron.w>0.5)d*=1.0-smoothstep(uMwIron.z-0.02,uMwIron.z+0.02,vMwPos.y);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.13,0.105,0.085),d*${role === 'rim' ? '0.6' : '0.35'});
roughnessFactor=mix(roughnessFactor,0.85,d*0.7);metalnessFactor=mix(metalnessFactor,0.2,d*0.6);}
if(uMwIron.w>0.5){float i=mwIronAt(vMwPos,${role === 'tire'});
diffuseColor.rgb=mix(diffuseColor.rgb,${IRON_COLOR},i*0.9);roughnessFactor=mix(roughnessFactor,0.14,i);metalnessFactor=mix(metalnessFactor,0.1,i);}
${role === 'tire' ? 'diffuseColor.rgb*=1.0-0.3*uMwWash.z;roughnessFactor=mix(roughnessFactor,roughnessFactor*0.55,uMwWash.z);' : ''}` : ''}`;
}

const NORMAL_CODE = '\nif(mwFoamC>0.0)normal=mwPerturb(-vViewPosition,normal,mwFoamF*mwFoamC,1.6,faceDirection);';
// Слой лака (clearcoat) под пеной исчезает.
const CLEARCOAT_CODE = '\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat*=1.0-mwFoamC;\n#endif\n';

// Состояние эффектов: значения задаёт index.js (applyEffects), материалы читают их
// как общие однородные переменные.
export function createShaderFx({low = false} = {}) {
  const uniforms = {
    uMwFoam: {value: new Vector4(2, 2, 0, 0)},
    uMwWash: {value: new Vector4(0, 0, 0, 0)},
    uMwIron: {value: new Vector4(0, 0, 2, 0)},
  };
  // Вставить эффекты в материал. extra(shader) — своя правка материала (лак: пыль,
  // риски полировки) поверх общего кода; ей доступны vMwPos, vMwUp и шум.
  function patch(material, role, extra = null) {
    const physical = material.isMeshPhysicalMaterial, volume = role === 'paint' && !low;
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>' + VERTEX_COMMON + (volume ? '\nuniform vec4 uMwFoam;' + NOISE : ''))
        .replace('#include <begin_vertex>', '#include <begin_vertex>' + VERTEX_BEGIN + (volume ? VERTEX_FOAM : ''));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${low ? '\n#define MW_LOW' : ''}${COMMON}${role === 'rim' || role === 'tire' ? IRON : ''}`)
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + surfaceCode(role))
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + NORMAL_CODE);
      if (physical) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>' + CLEARCOAT_CODE);
      extra?.(shader);
    };
    // Своя программа для каждой роли и качества: без пересечений с материалами салона.
    const key = `meatwash-fx-${role}-${low ? 'low' : 'high'}-v1`;
    material.customProgramCacheKey = () => key;
    material.needsUpdate = true;
  }
  return {uniforms, patch};
}
