import { spawnSync } from 'node:child_process';

export function isTracked(top, relPath) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', relPath], {
    cwd: top,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.error || result.status === null) return null;
  if (result.status === 0) return true;
  return result.status === 1 ? false : null;
}
