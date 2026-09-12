import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/persistence/db.mjs';
import { GameEngine } from '../src/game/engine.mjs';

function director() {
  return {
    async interpret(ctx) { return { actions: Object.values(ctx.actions).map(a => ({ userId: a.userId, intent: a.value, classification: 'COOPERATIVE', group: 'g' })), combat: null }; },
    async narrate(ctx) { return { narration: `결과: ${Object.keys(ctx.actions).length}`, location: '숲', facts: [], choices: [{ label: '계속', intent: '계속 걷는다' }], summary: '숲을 걸었다.' }; }
  };
}

test('여러 참가자가 준비하면 탐험 장면을 시작한다', async () => {
  const store = new Store(':memory:'); const engine = new GameEngine(store, director(), { minPartySize: 2 });
  const s = engine.create({ guildId: 'g', threadId: 't', hostId: 'u1' });
  await engine.handle({ id: '1', guildId: 'g', threadId: 't', userId: 'u1', name: 'A', action: 'join' });
  await engine.handle({ id: '2', guildId: 'g', threadId: 't', userId: 'u2', name: 'B', action: 'join' });
  for (const [id, userId] of [['3', 'u1'], ['4', 'u2']]) await engine.handle({ id, guildId: 'g', threadId: 't', userId, name: userId, action: 'character', value: { name: userId } });
  for (const [id, userId] of [['5', 'u1'], ['6', 'u2']]) await engine.handle({ id, guildId: 'g', threadId: 't', userId, name: userId, action: 'ready' });
  const result = await engine.handle({ id: '7', guildId: 'g', threadId: 't', userId: 'u1', action: 'start' });
  assert.equal(result.session.status, 'EXPLORATION_COLLECTING'); assert.equal(result.session.players.length, 2); store.close();
});

test('탐험 입력은 모든 플레이어 입력 후 한 번만 해결된다', async () => {
  const store = new Store(':memory:'); const engine = new GameEngine(store, director(), { minPartySize: 1 });
  engine.create({ guildId: 'g', threadId: 't', hostId: 'u1' });
  await engine.handle({ id: 'j', guildId: 'g', threadId: 't', userId: 'u1', name: 'A', action: 'join' });
  await engine.handle({ id: 'c', guildId: 'g', threadId: 't', userId: 'u1', name: 'A', action: 'character', value: { name: 'A' } });
  await engine.handle({ id: 'r', guildId: 'g', threadId: 't', userId: 'u1', name: 'A', action: 'ready' });
  await engine.handle({ id: 's', guildId: 'g', threadId: 't', userId: 'u1', action: 'start' });
  const result = await engine.handle({ id: 'i', guildId: 'g', threadId: 't', userId: 'u1', action: 'input', value: '조사한다' });
  assert.match(result.text, /결과/); assert.equal(result.session.actions ? Object.keys(result.session.actions).length : 0, 0); store.close();
});
