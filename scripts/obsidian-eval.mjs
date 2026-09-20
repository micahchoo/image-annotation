import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
if(!process.argv[2])throw new Error('Usage: node scripts/obsidian-eval.mjs <script.js> [vault]');
const code=readFileSync(process.argv[2],'utf8');
process.stdout.write(execFileSync('obsidian',[`vault=${process.argv[3]??'marginalian'}`,'eval',`code=${code}`],{encoding:'utf8',timeout:60000}));
