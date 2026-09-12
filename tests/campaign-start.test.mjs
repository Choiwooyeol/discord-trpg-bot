import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/persistence/db.mjs';
import { GameEngine } from '../src/game/engine.mjs';
import { DemoDirector } from '../src/ai/demo-director.mjs';
import { renderSession } from '../src/discord/render.mjs';
import { createCampaignSetup } from '../src/game/campaigns.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
async function lobby(t, director = new DemoDirector(), store = new Store(), threadId = 't', language = 'ko') {
  t.after(() => store.close());
  const engine = new GameEngine(store, director, { minPartySize: 1 });
  const session = engine.create({ guildId: 'g', threadId, hostId: 'u', scenarioId: 'sf', language });
  let sequence = 0;
  const act = (action, value, extra = {}) => engine.handle({ id: `${threadId}:${++sequence}`, guildId: 'g', threadId, userId: 'u', name: '하루', action, value, ...extra });
  await act('join');
  await act('character', { name: '하루', role: '우주선 식물학자', specialty: '종자 복원', weakness: '밀폐 공포' });
  await act('ready');
  return { engine, store, session, act };
}

test('start creates the world from prepared characters and first input continues its canon', async t => {
  const director = new DemoDirector(); let request, nextContext;
  director.campaign = async context => { request = context; return DemoDirector.prototype.campaign.call(director, context); };
  const interpret = director.interpret.bind(director);
  director.interpret = async context => { nextContext = context; return interpret(context); };
  const x = await lobby(t, director);
  assert.equal(request, undefined);
  assert.equal(x.session.world.opening, '');
  const result = await x.act('start');
  assert.equal(request.players[0].character.role, '우주선 식물학자');
  assert.equal(request.players[0].character.specialty, '종자 복원');
  assert.equal(request.world.genreId, 'sf');
  assert.equal(request.world.tone, '');
  assert.equal(result.session.scene, 1);
  assert.equal(result.session.status, 'EXPLORATION_COLLECTING');
  assert.ok(result.session.world.opening.length >= 80);
  assert.equal(x.store.job(result.session.jobId).kind, 'CAMPAIGN');
  const history = x.store.db.prepare('SELECT body FROM outbox').all().map(r => JSON.parse(r.body)).filter(m => m.history);
  assert.equal(history.length, 1);
  assert.ok(history[0].content.includes(result.session.world.opening));
  const buttons = renderSession(history[0].trpgSession, history[0].content).components.flatMap(r => r.components);
  assert.ok(buttons.some(b => b.custom_id.includes(':inputChoice:')));
  await x.act('input', '의뢰를 거절하고 종자 은행으로 간다');
  assert.equal(nextContext.world.opening, result.session.world.opening);
  assert.equal(nextContext.actions.u.value, '의뢰를 거절하고 종자 은행으로 간다');
  assert.equal(x.store.get(x.session.id).scene, 2);
});

test('pending start is durable, deduplicated, and ignores a result after pause', async t => {
  const director = new DemoDirector(); let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  director.campaign = async context => { calls++; await gate; return DemoDirector.prototype.campaign.call(director, context); };
  const x = await lobby(t, director);
  const pending = x.act('start', undefined, { id: 'one-start' }); await turn();
  const resolving = x.store.get(x.session.id);
  assert.equal(resolving.status, 'RESOLVING');
  assert.equal(x.store.job(resolving.jobId).status, 'PENDING');
  assert.match(renderSession(resolving).content, /세계/);
  assert.equal(renderSession(resolving).components.flatMap(r => r.components).some(b => b.custom_id.includes(':inputChoice:')), false);
  await x.act('start', undefined, { id: 'one-start' });
  assert.equal(calls, 1);
  await x.act('pause'); release(); await pending;
  assert.equal(x.store.get(x.session.id).status, 'PAUSED');
  assert.equal(x.store.get(x.session.id).scene, 0);
  await x.act('resume'); await x.engine.idle();
  assert.equal(x.store.get(x.session.id).scene, 1);
});

test('generation failure exposes retry, keeps characters, and never substitutes a canned scene', async t => {
  const director = new DemoDirector();
  director.campaign = async () => { throw Error('unavailable'); };
  const x = await lobby(t, director);
  const result = await x.act('start');
  assert.equal(result.session.status, 'PAUSED');
  assert.equal(result.session.world.opening, '');
  assert.equal(result.session.players[0].character.role, '우주선 식물학자');
  assert.match(result.text, /세계.*실패/);
  director.campaign = DemoDirector.prototype.campaign;
  await x.act('resume'); await x.engine.idle();
  assert.equal(x.store.get(x.session.id).status, 'EXPLORATION_COLLECTING');
});

test('recovery reuses an already generated opening without another AI call', async t => {
  const x = await lobby(t);
  const s = x.store.get(x.session.id);
  const response = await new DemoDirector().campaign({ world: s.world, players: s.players });
  s.status = 'RESOLVING'; s.phase++; s.jobId = `${s.id}:campaign`;
  x.store.commit(s, s.version, 'interrupted-start', 'start', {}, [], { id: s.jobId, sessionId: s.id, kind: 'CAMPAIGN', status: 'GENERATED', request: { world: s.world }, response });
  const restarted = new GameEngine(x.store, { campaign() { throw Error('must reuse persisted result'); } });
  await restarted.recover();
  assert.equal(x.store.get(s.id).world.opening, response.opening);
  assert.equal(x.store.get(s.id).scene, 1);
  assert.equal(x.store.job(s.jobId).status, 'DONE');
});

test('recent starts in the same server are supplied for variation and exact reuse is rejected', async t => {
  const x = await lobby(t);
  const first = await x.act('start');
  await x.act('end');
  let request;
  x.engine.director.campaign = async context => { request = context; return new DemoDirector().campaign(context); };
  const second = x.engine.create({ guildId: 'g', threadId: 'second', hostId: 'u', scenarioId: 'sf' });
  const act = (action, value) => x.engine.handle({ id: `second:${action}`, guildId: 'g', threadId: 'second', userId: 'u', name: '하루', action, value });
  await act('chooseRole', 'warrior'); await act('ready'); await act('start');
  assert.equal(request.recentStarts[0].opening, first.session.world.opening);
  assert.equal(request.recentStarts[0].location, first.session.world.location);
  assert.notEqual(request.openingStyle, first.session.world.openingStyle);
  assert.equal(x.store.get(second.id).status, 'PAUSED');
});

test('resume while the first request is still in flight completes without waiting for tick', async t => {
  const director = new DemoDirector(); let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  director.campaign = async context => { calls++; if (calls === 1) await gate; return DemoDirector.prototype.campaign.call(director, context); };
  const x = await lobby(t, director);
  const pending = x.act('start'); await turn();
  await x.act('pause'); await x.act('resume');
  release(); await pending; await x.engine.idle();
  assert.equal(calls, 2);
  assert.equal(x.store.get(x.session.id).scene, 1);
});

test('ending during generation cannot resurrect the session', async t => {
  const director = new DemoDirector(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  director.campaign = async context => { await gate; return DemoDirector.prototype.campaign.call(director, context); };
  const x = await lobby(t, director);
  const pending = x.act('start'); await turn(); await x.act('end'); release(); await pending;
  assert.equal(x.store.get(x.session.id).status, 'ENDED');
  assert.equal(x.store.get(x.session.id).scene, 0);
});

test('a legacy lobby regenerates its story without feeding the old canned opening to AI', async t => {
  const director = new DemoDirector(); let request;
  director.campaign = async context => { request = context; return DemoDirector.prototype.campaign.call(director, context); };
  const x = await lobby(t, director);
  const legacy = x.store.get(x.session.id);
  delete legacy.world.requestedName;
  Object.assign(legacy.world, { location: '안개에 묻힌 호숫가 마을', opening: '이전 고정 문구', premise: '정해진 실종 사건', tone: '추리', starterChoices: [{ label: '예전 선택', intent: '옛길로 간다' }] });
  x.store.commit(legacy, legacy.version, 'legacy', 'TEST', {});
  const started = await x.act('start');
  assert.equal(request.world.genreId, 'sf');
  assert.equal(request.world.language, 'ko');
  assert.equal(request.world.tone, '추리');
  assert.equal(request.world.opening, undefined);
  assert.notEqual(started.session.world.location, legacy.world.location);
});

test('random genre avoids the last started genre while explicit selections are honored', () => {
  for (let i = 0; i < 20; i++) assert.notEqual(createCampaignSetup({ previousGenre: 'mystery' }).genreId, 'mystery');
  assert.equal(createCampaignSetup({ genre: 'mystery', previousGenre: 'mystery' }).genreId, 'mystery');
  assert.equal(typeof createCampaignSetup({ genre: 'constructor' }).genreId, 'string');
});
