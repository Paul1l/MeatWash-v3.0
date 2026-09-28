// Импорт модуля из dist/js в Node для проверок. Файлы сайта — ES-модули без
// package.json с "type": "module", поэтому грузим их как data: URL; относительные
// импорты (./data.js и т. п.) подставляются так же, рекурсивно.
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';

async function inline(file,seen=new Map()){
 if(seen.has(file))return seen.get(file);
 let source=await readFile(file,'utf8');
 const imports=[...source.matchAll(/(\bfrom\s*)(['"])(\.\/[^'"]+)\2/g)];
 for(const [whole,pre,quote,path] of imports){
  const url=await inline(resolve(dirname(file),path),seen);
  source=source.replace(whole,`${pre}${quote}${url}${quote}`);
 }
 const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');
 seen.set(file,url);
 return url;
}

export async function importDist(file){return import(await inline(file));}
