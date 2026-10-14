import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { Job } from '../../index.js';

const [mode, encodedSpec] = process.argv.slice(2);
const job = mode === 'none' ? undefined : new Job();

if (mode === 'self') {
  job.assign(process.pid);
}

const tree = fileURLToPath(new URL('./tree.mjs', import.meta.url));
const child = spawn(process.execPath, [tree, encodedSpec, ...(mode === 'child' ? ['--wait'] : [])], { stdio: ['pipe', 'pipe', 'inherit'] });

if (mode === 'child') {
  job.assign(child.pid);
  child.stdin.write('go\n');
}

const [line] = await once(createInterface({ input: child.stdout }), 'line');
const root = { via: 'node', pid: child.pid, report: JSON.parse(line) };
process.stdout.write(`${JSON.stringify({ holder: process.pid, root, jobPids: job?.pids() ?? [] })}\n`);
setInterval(() => {}, 1 << 30);
