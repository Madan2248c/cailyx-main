#!/usr/bin/env node
/**
 * `npm run railway:plan` / `railway:apply` → `railway config <plan|apply> …`,
 * working on every machine.
 *
 * On Windows with Volta, `railway config` fails ("requires Railway CLI
 * 5.42.1 or newer", or "node returned non-JSON output"): the CLI checks its
 * own version by running `$_ --version`, and evaluates railway.ts with a
 * multi-line `node -e` — and Volta's `railway`/`node` shims can't take
 * either. So on Windows this runs the real railway.exe, with `_` pointing at
 * it and the real node.exe first on PATH. Elsewhere it just runs `railway`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

function realRailway() {
  if (process.platform !== 'win32') return 'railway';
  try {
    // Volta reports the package folder; the binary lives inside it.
    const pkg = execFileSync('volta', ['which', 'railway'], { encoding: 'utf8' }).trim();
    const exe = join(dirname(pkg), 'node_modules', '@railway', 'cli', 'bin', 'railway.exe');
    if (existsSync(exe)) return exe;
  } catch {
    // No Volta: fall through to a railway.exe on PATH.
  }
  return 'railway.exe';
}

const railway = realRailway();
const env = {
  ...process.env,
  _: railway,
  // The node running this script is the real binary even when launched via a
  // Volta shim, so the CLI's `node -e` evaluation uses it.
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
};

const result = spawnSync(railway, ['config', ...process.argv.slice(2)], { stdio: 'inherit', env });
if (result.error) {
  console.error(`Could not run ${railway}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
