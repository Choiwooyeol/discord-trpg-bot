import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/persistence/db.mjs';
import { GameEngine } from '../src/game/engine.mjs';

const director = { async interpret() { return { actions: [], combat: null }; }, async narrate() { return { narration: 'ok', location: '숲', facts: [], choices: [], summary: 'ok' }; } };
const event = (id, userId, action, value, name = userId) => ({ id, guildId: 'g', threadId: 't', userId, name, action, value });

test('기존 잘못된 직업도 다시 고를 수 있고 이름과 설정은 보존된다', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const engine = new GameEngine(store, director, { minPartySize: 1 });
  engine.create({ guildId: 'g', threadId: 't', hostId: 'u1' });
  await engine.handle(event('join', 'u1', 'join', undefined, '별명'));
  await engine.handle(event('char', 'u1', 'character', { name: '아린', role: '도적', specialty: '추적', weakness: '겁쟁이' }));
  const legacy = store.byThread('g', 't');
  legacy.players[0].character.role = '1'; legacy.players[0].ready = true;
  store.commit(legacy, legacy.version, 'legacy', 'seed', {});
  assert.match((await engine.handle(event('blocked-start', 'u1', 'start'))).text, /다시 선택/);
  assert.match((await engine.handle(event('blocked-ready', 'u1', 'ready'))).text, /다시 선택/);
  const fixed = await engine.handle(event('fix-role', 'u1', 'chooseRole', 'mage'));
  const player = fixed.session.players[0];
  assert.equal(player.character.role, '마법사');
  assert.equal(player.character.name, '아린');
  assert.equal(player.character.specialty, '추적');
  assert.equal(player.character.weakness, '겁쟁이');
  assert.equal(player.ready, false);
});

test('직업 버튼은 Discord 닉네임으로 자동 참가시키고 두 명이 준비하면 시작된다', async () => {
  const store = new Store(':memory:');
  const engine = new GameEngine(store, director, { minPartySize: 2, maxPartySize: 2 });
  const created = engine.create({ guildId: 'g', threadId: 't', hostId: 'u1' });

  const first = await engine.handle(event('role-1', 'u1', 'chooseRole', 'warrior', '용사'));
  const second = await engine.handle(event('role-2', 'u2', 'chooseRole', 'mage', '마법사친구'));
  assert.equal(first.session.players[0].name, '용사');
  assert.equal(second.session.players[1].character.role, '마법사');
  assert.deepEqual(created.minPartySize, 2);
  assert.deepEqual(created.maxPartySize, 2);

  await engine.handle(event('ready-1', 'u1', 'ready'));
  await engine.handle(event('ready-2', 'u2', 'ready'));
  const started = await engine.handle(event('start', 'u1', 'start'));
  assert.equal(started.session.status, 'EXPLORATION_COLLECTING');
  assert.equal(started.session.scene, 1);
  store.close();
});

test('알 수 없는 역할은 상태를 바꾸지 않고 다시 직업 버튼을 안내한다', async () => {
  const store = new Store(':memory:');
  const engine = new GameEngine(store, director);
  engine.create({ guildId: 'g', threadId: 't', hostId: 'u1' });
  await engine.handle(event('join', 'u1', 'join', undefined, '플레이어'));
  const before = structuredClone(store.byThread('g', 't'));
  const result = await engine.handle(event('invalid', 'u1', 'character', { name: '플레이어', role: '1' }));
  const after = store.byThread('g', 't');
  assert.match(result.text, /전사.*도적.*마법사/);
  assert.deepEqual(after.players, before.players);
  store.close();
});

test('정원 초과와 파티장 아닌 사용자의 시작을 막고 시작 후 직업 변경도 막는다', async () => {
  const store = new Store(':memory:');
  const engine = new GameEngine(store, director, { minPartySize: 2, maxPartySize: 2 });
  engine.create({ guildId: 'g', threadId: 't', hostId: 'u1' });
  await engine.handle(event('role-1', 'u1', 'chooseRole', 'warrior'));
  await engine.handle(event('role-2', 'u2', 'chooseRole', 'rogue'));
  const full = await engine.handle(event('role-3', 'u3', 'chooseRole', 'mage'));
  assert.match(full.text, /가득/);
  await engine.handle(event('ready-1', 'u1', 'ready'));
  await engine.handle(event('ready-2', 'u2', 'ready'));
  assert.match((await engine.handle(event('not-host', 'u2', 'start'))).text, /파티장/);
  await engine.handle(event('start', 'u1', 'start'));
  const changed = await engine.handle(event('late-role', 'u1', 'chooseRole', 'mage'));
  assert.match(changed.text, /시작 전 로비/);
  store.close();
});

test('장르별 캠페인과 자유 직업은 고정 역할 목록 없이 준비 및 시작할 수 있다', async () => {
  const store = new Store(':memory:');
  const engine = new GameEngine(store, director, { minPartySize: 1 });
  const session = engine.create({ guildId: 'g', threadId: 't', hostId: 'u1', scenarioId: 'martial' });
  assert.equal(session.world.genre, '무협');
  assert.ok(session.world.factions.length >= 1);
  assert.equal(session.world.starterChoices.length, 3);

  await engine.handle(event('join-custom', 'u1', 'join', undefined, '소청'));
  const created = await engine.handle(event('custom-character', 'u1', 'character', { name: '소청', role: '남궁세가 3대 가신', focus: '전투', specialty: '검술', weakness: '가문에 진 빚' }));
  const character = created.session.players[0].character;
  assert.equal(character.role, '남궁세가 3대 가신');
  assert.equal(character.roleId, 'custom');
  assert.equal(character.abilities.strength, 3);
  await engine.handle(event('custom-ready', 'u1', 'ready'));
  const started = await engine.handle(event('custom-start', 'u1', 'start'));
  assert.equal(started.session.status, 'EXPLORATION_COLLECTING');
  store.close();
});
