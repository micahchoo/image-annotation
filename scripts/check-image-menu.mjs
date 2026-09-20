import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const vault=process.argv[2]??'marginalian';
const evaluate=code=>execFileSync('obsidian',[`vault=${vault}`,'eval',`code=${code}`],{encoding:'utf8',timeout:15000});
evaluate('globalThis.__regionMenuCheck=null');
evaluate(readFileSync(new URL('./check-image-menu.js',import.meta.url),'utf8'));
let result;
for(let attempt=0;attempt<10;attempt++){
 await new Promise(resolve=>setTimeout(resolve,150));
 const output=evaluate('JSON.stringify(globalThis.__regionMenuCheck)');
 const match=output.match(/=> (\{[^\n]*\})/);
 if(match){result=JSON.parse(match[1]);break;}
}
if(!result)throw new Error('No result. Open a note with a visible image and rerun this check.');
console.log(JSON.stringify(result,null,2));
if(!result.pass)process.exitCode=1;
