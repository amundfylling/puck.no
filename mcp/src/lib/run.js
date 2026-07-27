/** Promisified execFile with repo-standard env, timeouts and output caps. */
import { execFile } from 'node:child_process';
import { subprocessEnv } from './config.js';

export class CommandError extends Error {
  constructor(cmd, code, stdout, stderr) {
    super(
      `Command failed (exit ${code}): ${cmd.join(' ')}\n` +
        (stderr ? `--- stderr ---\n${stderr.slice(-2000)}\n` : '') +
        (stdout ? `--- stdout ---\n${stdout.slice(-2000)}` : ''),
    );
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/**
 * Run a command, return { stdout, stderr }. Throws CommandError on non-zero
 * exit. `timeoutMs` defaults to 2 minutes; output is capped at 16 MB.
 */
export function run(cmd, args, { cwd, timeoutMs = 120_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd,
        env: subprocessEnv(),
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new CommandError([cmd, ...args], error.code ?? 'timeout', stdout, stderr));
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}
