import {build} from 'esbuild';
import {mkdir,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/main.ts'],bundle:true,external:['obsidian'],format:'cjs',platform:'browser',target:'es2022',outfile:'dist/main.js',sourcemap:false});
for (const name of ['manifest.json','styles.css']) await copyFile(name,`dist/${name}`);
