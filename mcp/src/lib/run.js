/** Promisified execFile with repo-standard env, timeouts and output caps. */
import { execFile } from 'node:child_process';
import { subprocessEnv } from './config.js';

export class CommandError extends Error {
  constructor(cmd, code, stdout, stderr, { sensitive = false } = {}) {
    const display = [];
    for (let i = 0; i < cmd.length; i++) {
      display.push(cmd[i]);
      if (cmd[i] === '--command' && i + 1 < cmd.length) {
        display.push('[redacted SQL]');
        i++;
      }
    }
    super(
      `Command failed (exit ${code}): ${display.join(' ')}\n` +
        // Wrangler may echo its SQL (which contains registration PII) in
        // either stream. Keep the raw fields for local diagnostics, but never
        // put them in the Error message returned through the MCP protocol.
        (!sensitive && stderr ? `--- stderr ---\n${stderr.slice(-2000)}\n` : '') +
        (!sensitive && stdout ? `--- stdout ---\n${stdout.slice(-2000)}` : ''),
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
  const sensitive = args.includes('--command') || input != null;
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
          reject(new CommandError([cmd, ...args], error.code ?? 'timeout', stdout, stderr, { sensitive }));
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
