/**
 * Clears local Miniflare/workerd state before starting the dev server.
 *
 * WHY THIS EXISTS
 * ---------------
 * `wrangler dev` and the Cloudflare Vite plugin both run a real `workerd`
 * process, and they write Durable Object state to `.wrangler/state`. If a
 * `workerd` from a previous session is still alive — which happens routinely
 * when the parent shell is killed but the runtime is not — the next server opens
 * the same SQLite files and you get:
 *
 *   jsg.Error: database is locked: SQLITE_BUSY
 *   SQLite alarm handler canceled with requestScheduledAlarm
 *
 * Rounds then stall and alarms silently do not fire, which looks exactly like a
 * bug in the game. It is not: a single server handles six concurrent full games
 * with zero lock errors, and the failure only appears with an orphaned runtime.
 *
 * The fix is to refuse to start while an orphan holds the state, and to let the
 * caller wipe it deliberately. Never auto-deletes without the flag, so a
 * half-played room is not destroyed by surprise.
 *
 *   node scripts/clean-dev.mjs          # report, refuse if locked
 *   node scripts/clean-dev.mjs --force  # kill orphans, wipe state
 */

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const STATE_DIR = join(process.cwd(), '.wrangler', 'state');
const FORCE = process.argv.includes('--force');

/**
 * Lists processes belonging to THIS project that can own .wrangler/state.
 *
 * Two families matter and ORDER MATTERS:
 *   1. the tool that supervises the runtime (`wrangler dev`, `vite`) — kill first,
 *      or it immediately respawns the runtime you just killed;
 *   2. `workerd.exe` — the runtime actually holding the SQLite handles.
 *
 * Uses PowerShell CIM: `wmic` was removed from Windows 11, so a wmic-based check
 * silently reports "no orphans" while a runtime is very much alive — worse than
 * no check at all.
 */
function queryProcesses(nameFilter) {
  const script = [
    `Get-CimInstance Win32_Process -Filter "Name='${nameFilter}'"`,
    '| Select-Object ProcessId,ParentProcessId,CommandLine',
    '| ConvertTo-Json -Compress',
  ].join(' ');

  let raw;
  try {
    raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.trim() || '[]');
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const cwd = process.cwd().toLowerCase();

  return rows
    .filter((row) => row && typeof row.CommandLine === 'string')
    .filter((row) => row.CommandLine.toLowerCase().includes(cwd))
    .map((row) => ({
      pid: Number(row.ProcessId),
      ppid: Number(row.ParentProcessId),
      command: row.CommandLine,
    }))
    .filter((row) => Number.isFinite(row.pid) && row.pid > 0 && row.pid !== process.pid);
}

/**
 * Supervisors before runtimes. `node.exe` covers `wrangler dev` and Vite; the
 * command-line filter keeps it scoped to this checkout so other projects' dev
 * servers are never touched.
 */
function findOrphanRuntimes() {
  if (process.platform !== 'win32') return [];

  const supervisors = queryProcesses('node.exe').filter((row) =>
    /wrangler|vite/i.test(row.command),
  );
  const runtimes = queryProcesses('workerd.exe');

  // De-dupe by pid, supervisors first.
  const seen = new Set();
  const ordered = [];
  for (const row of [...supervisors, ...runtimes]) {
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    ordered.push(row);
  }
  return ordered;
}

function kill(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

const orphans = findOrphanRuntimes();

if (orphans.length > 0) {
  console.log(`\n  ${orphans.length} leftover dev process(es) still hold .wrangler/state.`);
  console.log('  These cause "database is locked: SQLITE_BUSY" and rounds that never advance.\n');
  for (const { pid, command } of orphans) {
    const kind = /workerd/i.test(command) ? 'workerd' : 'supervisor';
    console.log(`    pid ${pid}  (${kind})`);
  }

  if (!FORCE) {
    console.log('\n  Re-run with --force to kill them and wipe local state:\n');
    console.log('    pnpm exec node scripts/clean-dev.mjs --force\n');
    process.exit(1);
  }

  // Supervisors first: killing a runtime while `wrangler dev` is alive just
  // respawns it, which is why the naive order appeared to "not work".
  let killed = 0;
  for (const { pid, command } of orphans) {
    const label = /workerd/i.test(command) ? 'workerd' : 'supervisor';
    // A supervisor's tree includes its runtime, so a failed child kill after a
    // successful parent kill is expected — report the outcome, not a scary error.
    if (kill(pid)) killed += 1;
    else console.log(`    pid ${pid} (${label}) was already gone`);
  }
  console.log(`\n  Stopped ${killed} process tree(s).`);
}

if (FORCE) {
  if (existsSync(STATE_DIR)) {
    try {
      rmSync(STATE_DIR, { recursive: true, force: true });
      console.log('\n  Local Durable Object state wiped. Rooms from earlier sessions are gone.\n');
    } catch (error) {
      console.error(`\n  Could not wipe .wrangler/state: ${error.message}`);
      console.error(
        '  A runtime is still holding a file. Reboot or close the terminal it lives in.\n',
      );
      process.exit(1);
    }
  } else {
    console.log('\n  No local state to wipe.\n');
  }
} else {
  console.log('\n  No orphaned runtimes. Local state is free to use.\n');
}
