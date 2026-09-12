import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryDirector } from '../src/ai/story-director.mjs';
import { Store } from '../src/persistence/db.mjs';
import { configFrom } from '../src/config.mjs';

const context = { players: [{ userId: 'one' }], actions: { one: '문을 살핀다' } };
const answer = { actions: [{ userId: 'one', intent: '문을 살핀다', classification: 'PARALLEL', ability: 'knowledge', difficulty: 10, group: 'door' }], combat: null };

test('Codex configuration needs Discord settings but no API key or rates', () => {
  const env = { AI_PROVIDER: 'codex', DISCORD_BOT_TOKEN: 'bot', DISCORD_ALLOWED_GUILD_IDS: '1296835917146882128', DISCORD_LOBBY_CHANNEL_IDS: '1547957768257015930' };
  const c = configFrom(env);
  assert.equal(c.aiProvider, 'codex');
  assert.equal(c.aiKey, '');
  assert.throws(() => configFrom({ ...env, AI_PROVIDER: 'other' }), /AI_PROVIDER/);
  assert.throws(() => configFrom({ ...env, AI_PROVIDER: 'openai' }), /API/);
  assert.throws(() => configFrom({ ...env, CODEX_DAILY_REQUEST_LIMIT: '-1' }), /CODEX_DAILY_REQUEST_LIMIT/);
});

test('Codex never falls back to the paid API and validates the same game contract', async () => {
  const store = new Store();
  let result = answer, apiCalls = 0;
  const director = new StoryDirector({ aiProvider: 'codex', aiKey: 'present-but-unused', codexDailyLimit: 10 }, store, {
    codexRunner: { generate: async ({ instructions, input, schema }) => {
      assert.match(instructions, /TRPG/); assert.equal(JSON.parse(input).players[0].userId, 'one');
      assert.equal(schema.additionalProperties, false);
      if (result instanceof Error) throw result;
      return result;
    } },
    fetchFn: async () => { apiCalls++; throw Error('paid API must not run'); }
  });
  try {
    assert.deepEqual(await director.interpret(context), answer);
    result = { ...answer, actions: [{ ...answer.actions[0], userId: 'intruder' }] };
    await assert.rejects(director.interpret(context));
    result = Error('subscription login or quota unavailable');
    await assert.rejects(director.interpret(context), /subscription/);
    assert.equal(apiCalls, 0);
  } finally { store.close(); }
});

test('Codex serializes calls and enforces a durable daily request cap', async () => {
  const store = new Store(); let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const runner = { generate: async () => { calls++; if (calls === 1) await gate; return answer; } };
  const c = { aiProvider: 'codex', codexDailyLimit: 2 };
  try {
    const d = new StoryDirector(c, store, { codexRunner: runner });
    const a = d.interpret(context), b = d.interpret(context);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    release(); await Promise.all([a, b]); assert.equal(calls, 2);
    const restarted = new StoryDirector(c, store, { codexRunner: runner });
    await assert.rejects(restarted.interpret(context), /Codex daily request limit/);
    assert.equal(calls, 2);
  } finally { release(); store.close(); }
});
