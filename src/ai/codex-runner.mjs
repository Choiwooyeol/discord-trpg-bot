import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const MAX_STDIO_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 90_000;
const TOOLS_DISABLED_NOTICE = 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';
const DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'code_mode', 'code_mode_host', 'apps', 'browser_use',
  'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'in_app_browser', 'hooks',
  'skill_search', 'tool_suggest', 'image_generation', 'view_image', 'plugins', 'remote_plugin',
  'multi_agent', 'shell_snapshot', 'sleep_tool'
];
const ENV_KEYS = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'ComSpec',
  'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'HOMEDRIVE',
  'HOMEPATH', 'HOME', 'LANG', 'LC_ALL', 'TERM'
];

function boundedCollector(limit) {
  let size = 0;
  let overflow = false;
  const chunks = [];
  return {
    add(chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += value.byteLength;
      if (size > limit) overflow = true;
      else chunks.push(value);
    },
    get overflow() { return overflow; },
    text() { return Buffer.concat(chunks).toString('utf8'); }
  };
}

function safeInput(value, name) {
  try { return JSON.stringify(value); }
  catch { throw new TypeError(`${name} must be JSON serializable`); }
}

function hasCompletedEvent(stdout) {
  let completed = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('codex execution failed'); }
    const type = typeof event?.type === 'string' ? event.type : '';
    // 0.154.0 emits this diagnostic even for a text-only run with tools disabled.
    if (type === 'item.completed' && event.item?.type === 'error' && event.item.message === TOOLS_DISABLED_NOTICE) continue;
    if (type === 'turn.completed') completed = true;
    const itemType = event?.item?.type;
    if (!['thread.started', 'turn.started', 'turn.completed', 'item.started', 'item.updated', 'item.completed'].includes(type) ||
      (type.startsWith('item.') && !['agent_message', 'reasoning'].includes(itemType))) {
      throw new Error('codex execution failed');
    }
  }
  return completed;
}

function commandArgs(schemaFile, resultFile, model) {
  const args = [
    'exec', '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--skip-git-repo-check', '--sandbox', 'read-only', '--output-schema', schemaFile,
    '--output-last-message', resultFile,
    '--config', 'project_doc_max_bytes=0', '--config', 'agents.enabled=false',
    '--config', 'forced_login_method=chatgpt', '--config', 'model_provider=openai',
    '--config', 'web_search=disabled', '--config', 'approval_policy=never',
    '--config', 'model_reasoning_effort=low'
  ];
  for (const feature of DISABLED_FEATURES) args.push('--config', `features.${feature}=false`);
  args.push('--config', 'tools.view_image=false');
  if (model) args.push('--model', model);
  return args;
}

function cleanEnv(config) {
  const env = {};
  for (const key of ENV_KEYS) if (process.env[key] !== undefined) env[key] = process.env[key];
  if (config.codexHome) env.CODEX_HOME = resolve(config.codexHome);
  return env;
}

function childFailure(code) {
  if (code === 'timeout') return new Error('codex execution timed out');
  if (code === 'output-limit') return new Error('codex execution output exceeded limit');
  if (code === 'spawn') return new Error('codex process could not be started');
  return new Error('codex execution failed');
}

export class CodexRunner {
  constructor(config = {}, { spawnFn = spawn } = {}) {
    this.config = config;
    this.spawn = spawnFn;
    this.closed = false;
    this.active = new Set();
  }

  close() {
    this.closed = true;
    for (const process of this.active) process.abort();
  }

  async generate({ instructions, input, schema }) {
    if (this.closed) throw new Error('codex runner is closed');
    if (typeof instructions !== 'string' || !instructions) throw new TypeError('instructions must be a non-empty string');
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new TypeError('schema must be an object');
    const inputText = typeof input === 'string' ? input : safeInput(input, 'input');
    const base = resolve(this.config.codexWorkDir || tmpdir());
    const dir = await mkdtemp(join(base, 'codex-runner-'));
    const schemaFile = join(dir, 'schema.json');
    const resultFile = join(dir, 'result.json');
    let record;
    try {
      if (this.closed) throw new Error('codex runner is closed');
      await chmod(dir, 0o700);
      await writeFile(schemaFile, safeInput(schema, 'schema'), { mode: 0o600 });
      await writeFile(resultFile, '', { mode: 0o600 });
      if (this.closed) throw new Error('codex runner is closed');
      const args = commandArgs(schemaFile, resultFile, this.config.codexModel);
      const child = this.spawn(this.config.codexBin || 'codex', [...args, instructions], {
        cwd: dir,
        env: cleanEnv(this.config),
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const stdout = boundedCollector(MAX_STDIO_BYTES);
      const stderr = boundedCollector(MAX_STDIO_BYTES);
      let timer;
      const exit = new Promise((resolveExit, rejectExit) => {
        let settled = false;
        const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
        const abort = (reason = 'closed') => {
          try {
            if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
            else child.kill?.('SIGKILL');
          } catch { /* process may have exited */ }
          finish(rejectExit, reason === 'output-limit' ? childFailure('output-limit') : new Error('codex runner is closed'));
        };
        record = { abort };
        this.active.add(record);
        child.once?.('error', () => finish(rejectExit, childFailure('spawn')));
        child.stdin?.on?.('error', () => record.abort());
        child.once?.('close', (code, signal) => finish(resolveExit, { code, signal }));
        child.stdout?.on?.('data', chunk => {
          stdout.add(chunk);
          if (stdout.overflow) return record.abort('output-limit');
          const text = stdout.text();
          try { hasCompletedEvent(text.slice(0, text.lastIndexOf('\n') + 1)); }
          catch { record.abort('invalid-event'); }
        });
        child.stderr?.on?.('data', chunk => { stderr.add(chunk); if (stderr.overflow) record.abort('output-limit'); });
        timer = setTimeout(() => {
          try {
            if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
            else child.kill?.('SIGKILL');
          } catch { /* process may have exited */ }
          finish(rejectExit, childFailure('timeout'));
        }, this.config.codexTimeoutMs ?? DEFAULT_TIMEOUT_MS);
        child.stdin?.end?.(inputText);
      });
      const result = await exit;
      this.active.delete(record);
      if (stdout.overflow || stderr.overflow) throw childFailure('output-limit');
      if (result.code !== 0 || result.signal) throw childFailure('exit');
      if (!hasCompletedEvent(stdout.text())) throw childFailure('exit');
      let info;
      try { info = await stat(resultFile); } catch { throw childFailure('exit'); }
      if (info.size > MAX_OUTPUT_BYTES) throw childFailure('output-limit');
      let finalValue;
      try { finalValue = JSON.parse(await readFile(resultFile, 'utf8')); }
      catch { throw childFailure('exit'); }
      return finalValue;
    } finally {
      if (record) this.active.delete(record);
      await rm(dir, { recursive: true, force: true, maxRetries:20, retryDelay:100 });
    }
  }
}
