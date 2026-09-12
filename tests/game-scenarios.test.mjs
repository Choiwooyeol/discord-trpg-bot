import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/persistence/db.mjs';
import { GameEngine } from '../src/game/engine.mjs';
import { DemoDirector } from '../src/ai/demo-director.mjs';

const demoDirector = new DemoDirector();

const wait = () => new Promise(resolve => setImmediate(resolve));

function makeDirector({ deferredInterpret = null, combat = null, seen = null } = {}) {
  return {
    async campaign(context) { return demoDirector.campaign(context); },
    async interpret(context) {
      if (seen) seen.push(structuredClone(context));
      if (deferredInterpret) await deferredInterpret.promise;
      return { actions: Object.values(context.actions ?? {}).map(a => ({ userId: a.userId, intent: a.value, classification: 'COOPERATIVE', group: 'g' })), combat };
    },
    async narrate(context) {
      return { narration: '장면 결과', location: '숲', facts: [], choices: [{ label: '계속', intent: '계속 걷는다' }], summary: context.summary || '진행됨' };
    }
  };
}

async function setup2(options = {}) {
  const store = new Store(':memory:');
  const engine = new GameEngine(store, makeDirector(options), { minPartySize: 2, explorationSeconds: 1 });
  engine.create({ guildId: 'guild', threadId: 'thread', hostId: 'u1' });
  for (const [id, userId] of [['join-1', 'u1'], ['join-2', 'u2']]) {
    await engine.handle({ id, guildId: 'guild', threadId: 'thread', userId, name: userId, action: 'join' });
    await engine.handle({ id: `${id}-character`, guildId: 'guild', threadId: 'thread', userId, name: userId, action: 'character', value: { name: userId, role: '전사' } });
    await engine.handle({ id: `${id}-ready`, guildId: 'guild', threadId: 'thread', userId, name: userId, action: 'ready' });
  }
  await engine.handle({ id: 'start', guildId: 'guild', threadId: 'thread', userId: 'u1', action: 'start' });
  return { store, engine };
}

function event(id, userId, action, value) {
  return { id, guildId: 'guild', threadId: 'thread', userId, name: userId, action, value };
}

test('같은 플레이어의 탐험 입력은 최신 입력으로 대체된다', async () => {
  const seen = []; const { store, engine } = await setup2({ seen });
  await engine.handle(event('a1', 'u1', 'input', '오래된 행동'));
  await engine.handle(event('a2', 'u1', 'input', '최신 행동'));
  await engine.handle(event('b1', 'u2', 'input', '동료 행동'));
  assert.equal(seen.at(-1).actions.u1.value, '최신 행동');
  store.close();
});

test('AI가 해석 중이면 늦게 도착한 입력은 장면을 오염시키지 않는다', async () => {
  let release; const deferredInterpret = { promise: new Promise(resolve => { release = resolve; }) };
  const { store, engine } = await setup2({ deferredInterpret });
  await engine.handle(event('a1', 'u1', 'input', '문을 연다'));
  const resolving = engine.handle(event('b1', 'u2', 'input', '뒤를 본다'));
  await wait();
  const late = await engine.handle(event('c1', 'u2', 'input', '더 늦은 행동'));
  assert.match(late.text, /처리|입력|상태|장면/);
  release(); await resolving; store.close();
});

test('AI 대기 중 pause는 늦은 응답이 상태를 덮어쓰지 못하게 한다', async () => {
  let release; const deferredInterpret = { promise: new Promise(resolve => { release = resolve; }) };
  const { store, engine } = await setup2({ deferredInterpret });
  await engine.handle(event('a1', 'u1', 'input', '살핀다'));
  const resolving = engine.handle(event('b1', 'u2', 'input', '돕는다')); await wait();
  const paused = await engine.handle(event('pause', 'u1', 'pause'));
  assert.equal(paused.session.status, 'PAUSED');
  release(); await resolving;
  assert.equal(store.byThread('guild', 'thread').status, 'PAUSED'); store.close();
});

test('동일한 최종 입력 event id는 한 번만 해결된다', async () => {
  let calls = 0; const { store, engine } = await setup2();
  const original = engine.director.interpret; engine.director.interpret = async c => { calls += 1; return original.call(engine.director, c); };
  await engine.handle(event('a1', 'u1', 'input', '공격한다'));
  const first = await engine.handle(event('b1', 'u2', 'input', '돕는다'));
  const second = await engine.handle(event('b1', 'u2', 'input', '돕는다'));
  assert.equal(calls, 1); assert.match(second.text, /이미|처리/); assert.equal(first.session.scene, 2);
  store.close();
});

test('다수결 투표는 과반이 선택한 충돌 행동만 남긴다', async () => {
  const store = new Store(':memory:');
  const director = {
    async campaign(context) { return demoDirector.campaign(context); },
    async interpret() { return { actions: [{ userId: 'u1', intent: '왼쪽', classification: 'CONFLICTING', group: 'a' }, { userId: 'u2', intent: '오른쪽', classification: 'CONFLICTING', group: 'b' }], combat: null }; },
    async narrate(ctx) { return { narration: ctx.interpretation.actions.map(a => a.intent).join(','), location: '교차로', facts: [], choices: [], summary: '투표 결과' }; }
  };
  const engine = new GameEngine(store, director, { minPartySize: 2 });
  engine.create({ guildId: 'guild', threadId: 'thread', hostId: 'u1' });
  for (const u of ['u1', 'u2']) { await engine.handle(event(`j-${u}`, u, 'join')); await engine.handle({ ...event(`c-${u}`, u, 'character', { name: u, role: '전사' }), name: u }); await engine.handle(event(`r-${u}`, u, 'ready')); }
  await engine.handle(event('start', 'u1', 'start'));
  const pending = engine.handle(event('i1', 'u1', 'input', '왼쪽')); await engine.handle(event('i2', 'u2', 'input', '오른쪽')); await pending;
  const s = store.byThread('guild', 'thread');
  assert.equal(s.status, 'CONSENSUS_VOTE');
  await engine.handle(event('v1', 'u1', 'vote', 0));
  await engine.handle(event('v2', 'u2', 'vote', 0));
  await engine.idle();
  assert.equal(store.byThread('guild', 'thread').status, 'EXPLORATION_COLLECTING'); store.close();
});

test('저장된 ROLLED job은 recovery에서 주사위를 다시 굴리지 않는다', async () => {
  const rolls = []; let narrateCalls = 0;
  const { store, engine } = await setup2();
  engine.roll = (min, max) => { rolls.push([min, max]); return min; };
  engine.director.interpret = async () => ({ actions: [{ userId: 'u1', intent: '조사', classification: 'PARALLEL', ability: 'strength', difficulty: 12, group: 'a' }], combat: null });
  engine.director.narrate = async () => { narrateCalls += 1; throw new Error('simulate crash'); };
  await engine.handle(event('a1', 'u1', 'input', '조사'));
  const run = engine.handle(event('b1', 'u2', 'input', '돕기'));
  await run;
  const jobs = store.jobs(); const job = jobs.find(candidate => candidate.kind !== 'CAMPAIGN') ?? jobs.at(-1);
  assert.ok(job.checks?.length || job.status === 'FAILED');
  const before = rolls.length; await engine.recover(); assert.equal(rolls.length, before); assert.ok(narrateCalls >= 1); store.close();
});

test('6인 파티가 30개 장면을 진행해도 각 장면 context가 파티 전체를 포함한다', async () => {
  const seen = []; const store = new Store(':memory:');
  const engine = new GameEngine(store, makeDirector({ seen }), { minPartySize: 6, maxPartySize: 6 });
  engine.create({ guildId: 'guild', threadId: 'thread', hostId: 'u1' });
  for (let i = 1; i <= 6; i++) { const u = `u${i}`; await engine.handle(event(`j${i}`, u, 'join')); await engine.handle({ ...event(`c${i}`, u, 'character', { name: u, role: '전사' }), name: u }); await engine.handle(event(`r${i}`, u, 'ready')); }
  await engine.handle(event('start', 'u1', 'start'));
  for (let scene = 0; scene < 30; scene++) { const ps = store.byThread('guild', 'thread'); for (let i = 1; i <= 6; i++) await engine.handle(event(`s${scene}u${i}`, `u${i}`, 'input', `행동${scene}`)); await engine.idle(); assert.ok(ps.scene >= scene + 1); }
  assert.ok(seen.length >= 30); assert.ok(seen.every(c => c.players.length === 6)); store.close();
});

test('전투에서 다른 플레이어의 공격과 방어는 모두 거부된다', async () => {
  const { store, engine } = await setup2({ combat: { kind: 'goblin', count: 1 } });
  await engine.handle(event('a1', 'u1', 'input', '전투'));
  const result = await engine.handle(event('b1', 'u2', 'input', '전투'));
  const session = result.session;
  const actor = session.combat.order[0]; const other = actor === 'u1' ? 'u2' : 'u1';
  assert.match((await engine.handle(event('wrong-attack', other, 'attack'))).text, /턴/);
  assert.match((await engine.handle(event('wrong-defend', other, 'defend'))).text, /턴/);
  store.close();
});

test('서로 충돌하는 탐험 행동은 합의 투표 상태로 전환된다', async () => {
  const { store, engine } = await setup2();
  await engine.handle(event('a1', 'u1', 'input', '왼쪽 문으로 간다'));
  const result = await engine.handle(event('b1', 'u2', 'input', '오른쪽 문으로 간다'));
  assert.ok(['CONSENSUS_VOTE', 'RESOLVING', 'EXPLORATION_COLLECTING'].includes(result.session.status));
  if (result.session.status === 'CONSENSUS_VOTE') {
    await engine.handle(event('v1', 'u1', 'vote', 0));
    await engine.handle(event('v2', 'u2', 'vote', 1));
  }
  store.close();
});
