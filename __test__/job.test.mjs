import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Job, supported } from '../index.js';

const windows = process.platform === 'win32';
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

// node children go through libuv's own job, shell children through cmd, which libuv's job lets break away silently
const TREE = {
  children: [{ via: 'node', spec: { children: [{ via: 'node' }, { via: 'shell' }] } }, { via: 'shell', spec: { children: [{ via: 'node' }] } }, { via: 'detached' }],
};

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

async function firstLine(stream) {
  const [line] = await once(createInterface({ input: stream }), 'line');
  return line;
}

function flatten(entry, path = 'root') {
  const out = entry.via === 'shell' ? [{ label: `${path} (cmd)`, pid: entry.pid }] : [];
  out.push({ label: path, pid: entry.report.pid });
  entry.report.children.forEach((child, i) => out.push(...flatten(child, `${path}/${child.via}${i}`)));
  return out;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function survivors(processes, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let left = processes;
  while ((left = left.filter((p) => alive(p.pid))).length && Date.now() < deadline) {
    await sleep(100);
  }
  return left;
}

function cleanup(processes) {
  for (const { pid } of processes) {
    try {
      process.kill(pid);
    } catch {
      // gone
    }
  }
}

function hardKill(pid) {
  execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
}

async function startHolder(mode) {
  const holder = spawn(process.execPath, [fixture('holder.mjs'), mode, encode(TREE)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const report = JSON.parse(await firstLine(holder.stdout));
  return { ...report, tree: flatten(report.root) };
}

async function startTree(job, spec = TREE) {
  const child = spawn(process.execPath, [fixture('tree.mjs'), encode(spec), '--wait'], { stdio: ['pipe', 'pipe', 'inherit'] });
  job.assign(child.pid);
  child.stdin.write('go\n');
  const report = JSON.parse(await firstLine(child.stdout));
  return flatten({ via: 'node', pid: child.pid, report });
}

async function startBreakaway(job) {
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fixture('breakaway.ps1'), process.execPath, fixture('idle.mjs')], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  job?.assign(ps.pid);
  ps.stdin.write('go\n');
  const [kind, value] = (await firstLine(ps.stdout)).trim().split(' ');
  return kind === 'pid' ? { pid: Number(value) } : { error: Number(value) };
}

describe('outside Windows', { skip: windows }, () => {
  it('loads with supported false and a Job that does nothing', () => {
    assert.equal(supported, false);
    const job = new Job({ killOnClose: true, allowBreakaway: true });
    assert.equal(job.assign(process.pid), undefined);
    assert.equal(job.terminate(), undefined);
    assert.deepEqual(job.pids(), []);
    job.close();
    job.close();
  });
});

describe('on Windows', { skip: !windows, timeout: 120_000 }, () => {
  it('reports supported', () => {
    assert.equal(supported, true);
  });

  it('control: without a job a hard kill of the parent leaves processes behind', async (t) => {
    const { holder, tree } = await startHolder('none');
    hardKill(holder);
    const left = await survivors(tree, 5000);
    t.diagnostic(`survivors: ${left.map((p) => p.label).join(', ') || 'none'}`);
    cleanup(left);
    assert.ok(left.length > 0, 'expected processes outside the libuv job');
  });

  for (const mode of ['child', 'self']) {
    it(`a hard kill of the parent kills the whole tree (${mode} assigned)`, async (t) => {
      const { holder, tree, jobPids } = await startHolder(mode);
      const missing = tree.filter((p) => !jobPids.includes(p.pid));
      t.diagnostic(`tree ${tree.length}, job ${jobPids.length}, missing: ${missing.map((p) => p.label).join(', ') || 'none'}`);
      if (mode === 'self') {
        assert.ok(jobPids.includes(holder));
      }
      hardKill(holder);
      const left = await survivors(tree);
      cleanup(left);
      assert.deepEqual(missing, []);
      assert.deepEqual(left, []);
    });
  }

  it('terminate() kills the tree and pids() lists it', async () => {
    const job = new Job();
    const tree = await startTree(job);
    try {
      const pids = job.pids();
      assert.deepEqual(
        tree.filter((p) => !pids.includes(p.pid)),
        [],
      );
      job.terminate();
      assert.deepEqual(await survivors(tree), []);
      assert.deepEqual(job.pids(), []);
    } finally {
      cleanup(tree);
      job.close();
    }
  });

  it('close() kills the tree only with killOnClose', async () => {
    const killing = new Job();
    const killed = await startTree(killing, {});
    killing.close();
    assert.deepEqual(await survivors(killed), []);

    const keeping = new Job({ killOnClose: false });
    const kept = await startTree(keeping, {});
    keeping.close();
    await sleep(500);
    try {
      assert.ok(kept.every((p) => alive(p.pid)));
    } finally {
      cleanup(kept);
    }
  });

  it('lets a process break away only with allowBreakaway', async (t) => {
    const baseline = await startBreakaway();
    if (baseline.error) {
      t.skip(`this environment does not allow breakaway (error ${baseline.error})`);
      return;
    }
    cleanup([baseline]);

    const strict = new Job();
    const refused = await startBreakaway(strict);
    strict.terminate();
    strict.close();
    if (refused.pid) {
      cleanup([refused]);
    }
    assert.equal(refused.error, 5, 'expected access denied');

    const loose = new Job({ allowBreakaway: true });
    const escaped = await startBreakaway(loose);
    try {
      assert.ok(escaped.pid, `breakaway failed with error ${escaped.error}`);
      assert.ok(!loose.pids().includes(escaped.pid));
      loose.terminate();
      await sleep(500);
      assert.ok(alive(escaped.pid));
    } finally {
      cleanup([escaped]);
      loose.close();
    }
  });

  it('fails cleanly on bad input and after close', async () => {
    const job = new Job();
    assert.throws(() => job.assign(0xfffffff0), /assign pid/);

    const [leaf] = await startTree(job, {});
    try {
      job.assign(leaf.pid);
      assert.deepEqual(job.pids(), [leaf.pid]);

      const other = new Job();
      const [stranger] = await startTree(other, {});
      try {
        assert.throws(() => other.assign(leaf.pid), /assign pid/);
      } finally {
        other.terminate();
        other.close();
        cleanup([stranger]);
      }
    } finally {
      job.close();
      cleanup([leaf]);
    }

    job.close();
    assert.throws(() => job.assign(process.pid), /job is closed/);
    assert.throws(() => job.pids(), /job is closed/);
    assert.throws(() => job.terminate(), /job is closed/);
  });
});
