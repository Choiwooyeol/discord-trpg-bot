import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/persistence/db.mjs';
import { GameEngine } from '../src/game/engine.mjs';
import { DemoDirector } from '../src/ai/demo-director.mjs';
import { Application } from '../src/application.mjs';
import { renderSession } from '../src/discord/render.mjs';

const config = { guildIds: ['guild-1'], lobbyIds: ['lobby-1'], maxActiveSessions: 10, maxPartySize: 6, minPartySize: 2, maxInputChars: 1000 };
function setup() {
  const store = new Store(':memory:');
  const threads = [];
  const discord = { async createThread(guildId, channelId, name, eventId) { const thread = { id: `thread-${threads.length + 1}`, guildId, channelId, name, eventId }; threads.push(thread); return thread; } };
  const engine = new GameEngine(store, new DemoDirector(), config);
  return { store, threads, discord, engine, app: new Application(config, store, engine, discord) };
}
function createEvent(id = 'create-1') { return { id, guildId: 'guild-1', threadId: 'lobby-1', userId: 'host', name: 'Host', action: 'create', value: { tone: 'mystery' } }; }

test('creates one registered thread and ignores unrelated guild/session input', async t => {
  const x = setup(); t.after(() => x.store.close());
  const created = await x.app.handle(createEvent());
  assert.match(created.text, /thread-1/); assert.equal(x.threads.length, 1);
  assert.deepEqual(await x.app.handle({ id: 'other-guild', guildId: 'guild-2', threadId: 'thread-1', userId: 'u', action: 'status' }), { text: '허용되지 않은 서버입니다.' });
  assert.deepEqual(await x.app.handle({ id: 'outside', guildId: 'guild-1', threadId: 'unregistered', userId: 'u', action: 'input', value: '잡담' }), {});
});

test('choice button maps its numeric index to the engine input intent', async t => {
  const x = setup(); t.after(() => x.store.close()); await x.app.handle(createEvent());
  for (const userId of ['host','guest']) {
    const base={guildId:'guild-1',threadId:'thread-1',userId,name:userId};
    if(userId==='guest')await x.app.handle({...base,id:'join-guest',action:'join'});
    await x.app.handle({...base,id:`char-${userId}`,action:'character',value:{name:userId,role:'전사'}});
    await x.app.handle({...base,id:`ready-${userId}`,action:'ready'});
  }
  const session = x.store.byThread('guild-1', 'thread-1'); session.status = 'EXPLORATION_COLLECTING'; session.phase = 3; session.choices = [{ label: '왼쪽', intent: '왼쪽 길' }, { label: '오른쪽', intent: '오른쪽 길' }];
  x.store.commit(session, session.version, 'seed-choice', 'seed', {});
  const current = x.store.byThread('guild-1', 'thread-1');
  await x.app.handle({ id: 'choice-1', guildId: 'guild-1', threadId: 'thread-1', sessionId: current.id, phase: current.phase, userId: 'host', name: 'Host', action: 'inputChoice', value: '1' });
  assert.equal(x.store.byThread('guild-1', 'thread-1').actions.host.value, '오른쪽 길');
});

test('consensus choices render vote buttons carrying an index', async t => {
  const x = setup(); t.after(() => x.store.close());
  const rendered = renderSession({ id: 'session-id', phase: 2, status: 'CONSENSUS_VOTE', vote:{options: [{ label: '첫 번째', intent: 'first' }, { label: '두 번째', intent: 'second' }]} });
  const ids = rendered.components.flatMap(row => row.components).map(component => component.custom_id);
  assert.ok(ids.includes('trpg:session-id:2:vote:0')); assert.ok(ids.includes('trpg:session-id:2:vote:1'));
});

test('game end requires ephemeral confirmation and only the host can confirm', async t => {
  const x = setup(); t.after(() => x.store.close()); await x.app.handle(createEvent());
  const session = x.store.byThread('guild-1', 'thread-1');
  const prompt = await x.app.handle({ id: 'end-prompt', guildId: 'guild-1', threadId: 'thread-1', sessionId: session.id, phase: session.phase, userId: 'host', action: 'endConfirm', value: '' });
  assert.ok(prompt.components?.[0]?.components?.some(component => component.custom_id.endsWith(':end')));
  const rejected = await x.app.handle({ id: 'end-other', guildId: 'guild-1', threadId: 'thread-1', sessionId: session.id, phase: session.phase, userId: 'guest', action: 'end', value: '' });
  assert.match(rejected.text, /종료|파티장/);
  await x.app.handle({ id: 'end-confirmed', guildId: 'guild-1', threadId: 'thread-1', sessionId: session.id, phase: session.phase, userId: 'host', action: 'end', value: '' });
  assert.equal(x.store.byThread('guild-1', 'thread-1').status, 'ENDED');
});

test('same create event is idempotent and does not create a second thread', async t => {
  const x = setup(); t.after(() => x.store.close()); const event = createEvent('same-event');
  await x.app.handle(event); await x.app.handle(event);
  assert.equal(x.threads.length, 1); assert.equal(x.store.all().length, 1);
});

test('new players finish setup through buttons with next steps in each private reply', async t => {
  const x = setup(); t.after(() => x.store.close()); await x.app.handle(createEvent());
  let sequence = 0;
  const act = (userId, action, value) => x.app.handle({ id: `onboarding-${++sequence}`, guildId: 'guild-1', threadId: 'thread-1', userId, name: userId, action, value });
  for (const userId of ['host', 'guest']) {
    const chosen = await act(userId, 'chooseRole', 'warrior');
    assert.match(chosen.text, /준비/);
    assert.ok(chosen.components.flatMap(r => r.components).some(c => c.custom_id.endsWith(':ready')));
    await act(userId, 'ready');
  }
  const status = await act('host', 'status');
  assert.match(status.text, /모두 준비됐어요/);
  assert.doesNotMatch(status.text, /LOBBY/);
  const started = await act('host', 'start');
  assert.match(started.text, /선택지/);
  assert.equal(x.store.byThread('guild-1', 'thread-1').status, 'EXPLORATION_COLLECTING');
  const old = await x.app.handle({ id: 'old-role', guildId: 'guild-1', threadId: 'thread-1', userId: 'host', phase: 0, action: 'chooseRole', value: 'mage' });
  assert.match(old.text, /최신 버튼/);
  assert.ok(old.components.flatMap(r => r.components).some(c => c.custom_id.includes(':inputChoice:')));
  assert.equal(x.store.byThread('guild-1', 'thread-1').players[0].character.role, '전사');
});

test('help works before joining and outside a game without mutating the session', async t => {
  const x = setup(); t.after(() => x.store.close());
  const outside = await x.app.handle({ id: 'help-out', guildId: 'guild-1', threadId: 'lobby-1', userId: 'guest', action: 'helpGuide' });
  assert.match(outside.text, /게임시작/);
  await x.app.handle(createEvent());
  const before = x.store.byThread('guild-1', 'thread-1');
  const inside = await x.app.handle({ id: 'help-in', guildId: 'guild-1', threadId: 'thread-1', userId: 'guest', action: 'helpGuide' });
  assert.match(inside.text, /직업 선택/);
  assert.equal(x.store.byThread('guild-1', 'thread-1').version, before.version);
});

test('lobby lists open games and a blocked creator receives their exact room link', async t => {
  const x = setup(); t.after(() => x.store.close());
  await x.app.handle(createEvent());
  const list = await x.app.handle({ id: 'list-games', guildId: 'guild-1', threadId: 'lobby-1', userId: 'host', action: 'listGames' });
  assert.match(list.text, /<#thread-1>.*준비 중.*내가 파티장/);
  const again = await x.app.handle(createEvent('create-2'));
  assert.match(again.text, /<#thread-1>/);
  assert.match(again.text, /게임종료/);
  assert.equal(x.threads.length, 1);
});

test('capacity error explains how to recover without ending an in-progress game', async t => {
  const x = setup(); t.after(() => x.store.close());
  x.app.config.maxActiveSessions = 1;
  await x.app.handle(createEvent());
  const blocked = await x.app.handle({ ...createEvent('other-create'), userId: 'other-host', name: 'Other' });
  assert.match(blocked.text, /게임목록.*게임종료/);
  assert.equal(x.threads.length, 1);
});

test('lobby cleanup ends only the caller’s unstarted lobbies and frees capacity', async t => {
  const x = setup(); t.after(() => x.store.close());
  await x.app.handle(createEvent());
  const result = await x.app.handle({ id: 'cleanup', guildId: 'guild-1', threadId: 'lobby-1', userId: 'host', action: 'cleanupLobbies' });
  assert.match(result.text, /종료했습니다/);
  assert.equal(x.store.byThread('guild-1', 'thread-1').status, 'ENDED');
});

test('adventure summary exposes goal, factions, facts, and party without changing state', async t => {
  const x = setup(); t.after(() => x.store.close()); await x.app.handle(createEvent());
  const session = x.store.byThread('guild-1', 'thread-1');
  session.world.objective = '신호의 정체를 밝힌다'; session.world.factions = ['관리국']; session.world.facts = ['푸른 신호가 반복된다'];
  x.store.commit(session, session.version, 'summary-seed', 'seed', {});
  const result = await x.app.handle({ id: 'summary', guildId: 'guild-1', threadId: 'thread-1', userId: 'host', action: 'adventureSummary' });
  assert.match(result.text, /현재 목표.*신호의 정체/);
  assert.match(result.text, /주요 세력.*관리국/);
  assert.match(result.text, /최근 단서/);
});

test('only an administrator can create and start a one-player adventure', async t => {
  const x = setup(); t.after(() => x.store.close());
  const base = { id: 'solo-create', guildId: 'guild-1', threadId: 'lobby-1', userId: 'host', name: 'Host', action: 'createSolo', value: { tone: 'solo' } };
  const denied = await x.app.handle({ ...base, isAdministrator: false });
  assert.equal(x.threads.length, 0);
  assert.ok(denied.text.length > 0);

  await x.app.handle({ ...base, id: 'solo-create-admin', isAdministrator: true });
  const session = x.store.byThread('guild-1', 'thread-1');
  assert.equal(session.minPartySize, 1);
  assert.equal(session.players.length, 1);
  await x.app.handle({ id: 'solo-role', guildId: 'guild-1', threadId: 'thread-1', userId: 'host', name: 'Host', action: 'chooseRole', value: 'warrior' });
  await x.app.handle({ id: 'solo-ready', guildId: 'guild-1', threadId: 'thread-1', userId: 'host', name: 'Host', action: 'ready' });
  const started = await x.app.handle({ id: 'solo-start', guildId: 'guild-1', threadId: 'thread-1', userId: 'host', name: 'Host', action: 'start' });
  assert.equal(x.store.byThread('guild-1', 'thread-1').status, 'EXPLORATION_COLLECTING');
  assert.ok(started.components.flatMap(row => row.components).some(component => component.custom_id.includes(':inputChoice:')));
});
