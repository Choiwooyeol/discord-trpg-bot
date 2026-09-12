import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodexRunner } from '../src/ai/codex-runner.mjs';

function fakeSpawn({ result = { ok: true }, rawOutput, stdout = '{"type":"turn.completed"}\n', stderr = '', code = 0, delay = 0 } = {}) {
  let seen;
  const spawnFn = (bin, args, options) => {
    seen = { bin, args, options };
    const child = new EventEmitter();
    child.kill = () => { seen.killed = true; return true; };
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end(value) { child.input = value; } };
    setTimeout(async () => {
      try {
        const resultPath = args[args.indexOf('--output-last-message') + 1];
        if (code === 0 && !stdout.includes('turn.failed') && !stdout.includes('tool-execution')) await writeFile(resultPath, rawOutput ?? JSON.stringify(result));
        child.stdout.emit('data', stdout); child.stderr.emit('data', stderr); child.emit('close', code, null);
      } catch { /* timeout cleanup can remove the private directory first */ }
    }, delay);
    return child;
  };
  return { spawnFn, seen: () => seen };
}

test('runs isolated codex exec and returns bounded JSON output', async () => {
  const fake = fakeSpawn();
  const runner = new CodexRunner({ codexHome: 'C:/private-codex' }, { spawnFn: fake.spawnFn });
  const value = await runner.generate({ instructions: 'fixed instruction', input: { prompt: 'untrusted --model x' }, schema: { type: 'object' } });
  assert.deepEqual(value, { ok: true });
  const call = fake.seen();
  assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  assert.equal(call.args.at(-1), 'fixed instruction');
  assert.ok(call.args.includes('--json')); assert.ok(call.args.includes('--ephemeral'));
  assert.ok(call.args.includes('--config')); assert.ok(call.args.includes('agents.enabled=false'));
  assert.equal(call.options.env.OPENAI_API_KEY, undefined);
  assert.equal(call.options.env.CODEX_API_KEY, undefined);
  assert.equal(call.options.env.CODEX_HOME, resolve('C:/private-codex'));
  assert.equal(call.options.cwd.startsWith(tmpdir()), true);
  assert.equal(call.options.cwd.includes('codex-runner-'), true);
  assert.equal(call.options.cwd && (await readdir(call.options.cwd).catch(() => null)), null);
});

test('rejects malformed, failed, tool, nonzero, and oversized executions', async t => {
  const cases = [
    { stdout: 'not json\n' },
    { stdout: '{"type":"turn.failed"}\n' },
    { stdout: '{"type":"tool-execution.started"}\n' },
    { stdout: '{"type":"item.started","item":{"type":"command_execution"}}\n{"type":"turn.completed"}\n' },
    { stdout: '{"type":"item.completed","item":{"type":"file_change"}}\n{"type":"turn.completed"}\n' },
    { rawOutput: '{broken JSON' },
    { result: { text: 'x'.repeat(65536) } },
    { code: 1 },
    { stdout: 'x'.repeat(1024 * 1024 + 1) }
  ];
  for (const options of cases) {
    const fake = fakeSpawn(options);
    const runner = new CodexRunner({ codexTimeoutMs: 100 }, { spawnFn: fake.spawnFn });
    await assert.rejects(runner.generate({ instructions: 'i', input: {}, schema: {} }));
  }
});

test('close stops an in-flight call, rejects later work, and cleans up', async () => {
  const fake = fakeSpawn({ delay: 100 });
  const runner = new CodexRunner({}, { spawnFn: fake.spawnFn });
  const pending = runner.generate({ instructions: 'i', input: '{"actions":[]}', schema: {} });
  while (!fake.seen()) await new Promise(resolve => setImmediate(resolve));
  runner.close();
  await assert.rejects(pending, /closed/);
  assert.equal(fake.seen().killed, true);
  await assert.rejects(runner.generate({ instructions: 'i', input: {}, schema: {} }), /closed/);
  assert.equal(await readdir(fake.seen().options.cwd).catch(() => null), null);
});

test('times out and cleans up temporary directory', async () => {
  const fake = fakeSpawn({ delay: 100 });
  const runner = new CodexRunner({ codexTimeoutMs: 5 }, { spawnFn: fake.spawnFn });
  await assert.rejects(runner.generate({ instructions: 'i', input: {}, schema: {} }), /timed out/);
});

test('does not expose inherited secret environment variables', async () => {
  const oldKey = process.env.OPENAI_API_KEY, oldToken = process.env.DISCORD_BOT_TOKEN;
  process.env.OPENAI_API_KEY = 'secret'; process.env.DISCORD_BOT_TOKEN = 'discord-secret';
  try {
    const fake = fakeSpawn();
    await new CodexRunner({}, { spawnFn: fake.spawnFn }).generate({ instructions: 'i', input: {}, schema: {} });
    assert.equal(fake.seen().options.env.OPENAI_API_KEY, undefined);
    assert.equal(fake.seen().options.env.DISCORD_BOT_TOKEN, undefined);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldToken === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = oldToken;
  }
});

test('only the exact pinned CLI tools-disabled notice is tolerated', async () => {
  const notice = { type: 'item.completed', item: { type: 'error', message: 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.' } };
  const fake = fakeSpawn({ stdout: JSON.stringify(notice) + '\n{"type":"turn.completed"}\n' });
  assert.deepEqual(await new CodexRunner({}, { spawnFn: fake.spawnFn }).generate({ instructions: 'i', input: {}, schema: {} }), { ok:true });
  notice.item.message = 'Authentication or quota failure';
  const failed = fakeSpawn({ stdout: JSON.stringify(notice) + '\n{"type":"turn.completed"}\n' });
  await assert.rejects(new CodexRunner({}, { spawnFn: failed.spawnFn }).generate({ instructions: 'i', input: {}, schema: {} }));
});
