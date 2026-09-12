import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/persistence/db.mjs';
import { GameEngine } from '../src/game/engine.mjs';
import { configFrom } from '../src/config.mjs';
import { DemoDirector } from '../src/ai/demo-director.mjs';

const demoDirector = new DemoDirector();
const director = { async campaign(context) { return demoDirector.campaign(context); }, async interpret() { return { actions: [], combat: null }; }, async narrate() { return { narration: 'ok', location: '숲', facts: [], choices: [], summary: 'ok' }; } };
const event = (id, userId, action, value) => ({ id, guildId: 'g', threadId: 't', userId, name: userId, action, value });

test('LOBBY_IDLE_HOURS is validated and exposed as milliseconds', () => {
  const c = configFrom({ LOBBY_IDLE_HOURS: '3' }, false);
  assert.equal(c.lobbyIdleMs, 3 * 60 * 60 * 1000);
  assert.throws(() => configFrom({ LOBBY_IDLE_HOURS: '0' }, false), /LOBBY_IDLE_HOURS/);
  assert.throws(() => configFrom({ LOBBY_IDLE_HOURS: '721' }, false), /LOBBY_IDLE_HOURS/);
});

test('tick ends only an idle lobby and records a public expiry message', async () => {
  const store = new Store(':memory:');
  const base = Date.now(); let now = base;
  const engine = new GameEngine(store, director, { lobbyIdleMs: 60_000 }, { now: () => now });
  const session = engine.create({ guildId: 'g', threadId: 't', hostId: 'u1' });
  now = Number(store.get(session.id).updatedAt) + 60_001;
  await engine.tick();
  assert.equal(store.get(session.id).status, 'ENDED');
  assert.match(store.pending().at(-1)?.payload?.content ?? '', /오래 활동/);
  store.close();
});

test('host handoff survives everyone leaving and gives controls to the returning player', async () => {
  const store = new Store(':memory:');
  const engine = new GameEngine(store, director, { minPartySize: 1 });
  engine.create({ guildId: 'g', threadId: 't', hostId: 'a' });
  await engine.handle(event('join-a', 'a', 'join'));
  await engine.handle(event('join-b', 'b', 'join'));
  await engine.handle(event('role-a', 'a', 'chooseRole', 'warrior'));
  await engine.handle(event('role-b', 'b', 'chooseRole', 'rogue'));
  await engine.handle(event('ready-a', 'a', 'ready'));
  await engine.handle(event('ready-b', 'b', 'ready'));
  await engine.handle(event('start', 'a', 'start'));
  await engine.handle(event('leave-a', 'a', 'leave'));
  assert.equal(store.byThread('g', 't').hostId, 'b');
  await engine.handle(event('leave-b', 'b', 'leave'));
  assert.equal(store.byThread('g', 't').status, 'PAUSED');
  const returned = await engine.handle(event('return-a', 'a', 'return'));
  assert.match(returned.text, /새 파티장/);
  assert.equal(store.byThread('g', 't').hostId, 'a');
  const resumed = await engine.handle(event('resume', 'a', 'resume'));
  assert.equal(resumed.session.status, 'EXPLORATION_COLLECTING');
  store.close();
});

test('characterInfo returns a focused Korean character sheet and next step', async () => {
  const store = new Store(':memory:');
  const engine = new GameEngine(store, director);
  engine.create({ guildId: 'g', threadId: 't', hostId: 'a' });
  await engine.handle(event('join', 'a', 'join'));
  await engine.handle(event('role', 'a', 'chooseRole', 'mage'));
  const result = await engine.handle(event('info', 'a', 'characterInfo'));
  assert.match(result.text, /마법사/);
  assert.match(result.text, /힘 0/);
  assert.match(result.text, /HP 10\/10/);
  assert.match(result.text, /다음:/);
  store.close();
});

test('scene-opening text is stored as history instead of becoming the mutable control panel', async () => {
  const store = new Store(':memory:');
  const engine = new GameEngine(store, director, { minPartySize: 1 });
  engine.create({ guildId: 'g', threadId: 't', hostId: 'a', minPartySize: 1 });
  await engine.handle(event('join', 'a', 'join'));
  await engine.handle(event('role', 'a', 'chooseRole', 'warrior'));
  await engine.handle(event('ready', 'a', 'ready'));
  await engine.handle(event('start', 'a', 'start'));
  const messages = store.db.prepare('SELECT body FROM outbox ORDER BY rowid').all().map(row => JSON.parse(row.body));
  assert.ok(messages.some(message => message.history === true));
  assert.ok(messages.some(message => message.trpgSession?.status === 'EXPLORATION_COLLECTING'));
  store.close();
});

test('submitted actions are archived together before the AI resolves a scene', async () => {
  const store = new Store(':memory:');
  const engine = new GameEngine(store, director, { minPartySize: 1 });
  engine.create({ guildId: 'g', threadId: 't', hostId: 'a', minPartySize: 1 });
  await engine.handle(event('join', 'a', 'join'));
  await engine.handle(event('role', 'a', 'chooseRole', 'warrior'));
  await engine.handle(event('ready', 'a', 'ready'));
  await engine.handle(event('start', 'a', 'start'));
  await engine.handle(event('input', 'a', 'input', '등불을 조사한다'));
  const messages = store.db.prepare('SELECT body FROM outbox ORDER BY rowid').all().map(row => JSON.parse(row.body));
  const record = messages.find(message => message.history && String(message.content).includes('이번 장면 행동'));
  assert.match(record.content, /a: 등불을 조사한다/);
  store.close();
});
