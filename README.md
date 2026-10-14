# @seydx/win-job

Windows job objects for Node.js. A job holds a process and everything it starts later, so the whole tree can be listed, killed at once, or killed automatically when the process holding the job exits or crashes.

Node already puts each child into a job of its own, but that job lets grandchildren leave it silently. Anything started through `cmd` (`shell: true`), a Go or Python program, or with `detached: true` keeps running after a hard kill of the parent. A job from this package does not let them leave.

Built with [napi-rs](https://napi.rs). Prebuilt binaries for Windows x64 and arm64, no compile step on install. On macOS and Linux the package installs and loads, `supported` is `false` and every method does nothing.

## Installation

```bash
npm install @seydx/win-job
```

## Usage

```ts
import { spawn } from 'node:child_process';
import { Job, supported } from '@seydx/win-job';

// every process this one starts from now on dies with it, grandchildren included
const job = new Job();
job.assign(process.pid);

// or assign a child right after the spawn
const child = spawn('go2rtc.exe');
job.assign(child.pid);

job.pids(); // ids of all running processes in the job
job.terminate(); // kill them all
job.close(); // with killOnClose (the default) this kills them too
```

Options for `new Job(options)`:

| Option | Default | |
|---|---|---|
| `killOnClose` | `true` | Kill all processes in the job once its handle closes, on `close()` or exit of this process. |
| `allowBreakaway` | `false` | Let a process started with `CREATE_BREAKAWAY_FROM_JOB` leave the job. Without it such a start fails with "access denied". |

Keep in mind:

- Processes a child started before `assign()` stay outside the job. Assign this process itself before spawning to be sure.
- The handle is not inherited, so only this process holds the job open. It stays open until `close()` or exit, also when the `Job` object is garbage collected.
- `terminate()` and `close()` with `killOnClose` kill this process too when it is in the job.
- A process started outside the tree, by WMI or the Task Scheduler for example, is never in the job.

See `binding.d.ts` for the documented API.

## Development

```bash
npm install
npm run build        # release build (napi build --platform --release)
npm run build:debug  # debug build
npm run lint         # cargo clippy (Windows target) + eslint
npm test             # process tree tests on Windows, load test elsewhere
```
