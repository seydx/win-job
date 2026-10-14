import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const [encodedSpec, wait] = process.argv.slice(2);
const spec = encodedSpec ? JSON.parse(Buffer.from(encodedSpec, 'base64').toString()) : {};

function encode(value) {
  return Buffer.from(JSON.stringify(value ?? {})).toString('base64');
}

function firstLine(stream) {
  return once(createInterface({ input: stream }), 'line').then(([line]) => line);
}

async function start(child) {
  const stdio = ['ignore', 'pipe', 'inherit'];
  const proc =
    child.via === 'shell'
      ? spawn(`"${process.execPath}" "${self}" ${encode(child.spec)}`, { shell: true, stdio })
      : spawn(process.execPath, [self, encode(child.spec)], { detached: child.via === 'detached', stdio });
  return { via: child.via, pid: proc.pid, report: JSON.parse(await firstLine(proc.stdout)) };
}

if (wait === '--wait') {
  await firstLine(process.stdin);
}

const children = await Promise.all((spec.children ?? []).map(start));
process.stdout.write(`${JSON.stringify({ pid: process.pid, children })}\n`);
setInterval(() => {}, 1 << 30);
