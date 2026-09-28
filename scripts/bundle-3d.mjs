// Сборка 3D-гаража: src/porsche3d → dist/js/porsche3d.bundle.js.
// Бандл самодостаточен (three, GLTFLoader, декодер Meshopt внутри), importmap
// не нужен. Страница грузит его только import() по нажатию «Открыть 3D-гараж».
// Правка в src/porsche3d без пересборки на сайт не попадает — это ловит
// npm run check:3d.
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLE = resolve(root, 'dist/js/porsche3d.bundle.js');

export function bundle3d(outfile = BUNDLE) {
  return build({
    entryPoints: [resolve(root, 'src/porsche3d/index.js')],
    outfile,
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020', 'safari15'],
    legalComments: 'linked',
    banner: {js: '/*! MEATWASH porsche3d: three.js (MIT), декодер meshoptimizer (MIT) — vendor/LICENSE-THREE.txt, vendor/LICENSE-MESHOPT.txt */'},
    logLevel: 'warning',
    metafile: true,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(root, 'scripts/bundle-3d.mjs')) {
  const result = await bundle3d();
  const out = Object.entries(result.metafile.outputs).find(([name]) => name.endsWith('.bundle.js'));
  console.log(`porsche3d.bundle.js собран: ${out[1].bytes} байт`);
}
