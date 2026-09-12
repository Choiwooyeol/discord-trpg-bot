import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordClient } from '../src/discord/client.mjs';
import { renderSession } from '../src/discord/render.mjs';
import { Application } from '../src/application.mjs';

const response = (body = {}, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => undefined },
  json: async () => body
});

test('registers the character info, diagnostics, and administrator-only solo command', async () => {
  const client = new DiscordClient({ token: 't', guildIds: ['g'] }, { fetchFn: async () => response([]) });
  client.botId = 'bot';
  const commands = await client.registerCommands();
  assert.ok(commands.some(command => command.name === '내캐릭터'));
  assert.ok(commands.some(command => command.name === '게임진단'));
  assert.equal(commands.find(command => command.name === '혼자시작').default_member_permissions, '8');
});

test('maps the new slash commands to application actions', async () => {
  const events = [];
  const client = new DiscordClient({ token: 't', guildIds: ['g'], lobbyIds: ['lobby'] }, {
    fetchFn: async url => url.includes('/callback') || url.includes('/webhooks') ? response({}) : response([])
  });
  client.onEvent = event => { events.push(event); return { text: '확인' }; };
  await client.interaction({ id: 'character-info', token: 'tok', application_id: 'app', type: 2, guild_id: 'g', channel_id: 'thread', member: { user: { id: 'u', username: 'U' } }, data: { name: '내캐릭터', options: [] } });
  await client.interaction({ id: 'diagnostic', token: 'tok2', application_id: 'app', type: 2, guild_id: 'g', channel_id: 'lobby', member: { user: { id: 'u', username: 'U' } }, data: { name: '게임진단', options: [] } });
  await client.interaction({ id: 'solo', token: 'tok3', application_id: 'app', type: 2, guild_id: 'g', channel_id: 'lobby', member: { user: { id: 'u', username: 'U' }, permissions: '8' }, data: { name: '혼자시작', options: [] } });
  assert.equal(events[0].action, 'characterInfo');
  assert.equal(events[1].action, 'gameDiagnostic');
  assert.equal(events[2].action, 'createSolo');
  assert.equal(events[2].isAdministrator, true);
});

test('paused sessions keep resume and game-end controls, and exploration names pending players', () => {
  const paused = renderSession({ id: 's', phase: 3, status: 'PAUSED', players: [] });
  const pausedIds = paused.components.flatMap(row => row.components).map(component => component.custom_id);
  assert.ok(pausedIds.some(id => id.endsWith(':resume')));
  assert.ok(pausedIds.some(id => id.endsWith(':endConfirm')));

  const exploration = renderSession({
    id: 's', phase: 4, status: 'EXPLORATION_COLLECTING',
    players: [{ userId: 'raw-u1', name: '아린', ready: true, presence: 'active' }, { userId: 'raw-u2', name: '보리', ready: true, presence: 'active' }],
    actions: { 'raw-u1': { value: '조사' } }, choices: []
  });
  assert.match(exploration.content, /아직 행동을 안 낸 사람: 보리/);
  assert.match(exploration.content, /아린: 조사/);
  assert.doesNotMatch(exploration.content, /raw-u1|raw-u2/);
});

test('game diagnostic is lobby-only and omits secrets', () => {
  const sessions = [
    { id: 's1', guildId: 'g', threadId: 'thread-1', status: 'LOBBY', hostId: 'u' },
    { id: 's2', guildId: 'g', threadId: 'thread-2', status: 'EXPLORATION_COLLECTING', hostId: 'other', players: [{ userId: 'u', name: 'U' }] },
    { id: 's3', guildId: 'g', threadId: 'thread-3', status: 'ENDED', hostId: 'u' }
  ];
  const store = {
    all: () => sessions,
    getValue: (key, fallback = null) => key === 'health' ? { ready: true, at: Date.now(), token: 'do-not-show' } : key.startsWith('codex-requests:') ? 7 : fallback,
    byThread: () => null
  };
  const app = new Application({ guildIds: ['g'], lobbyIds: ['lobby'] }, store, { handle: async () => ({}) }, {});
  const result = app.gameDiagnostic({ guildId: 'g', threadId: 'lobby', userId: 'u' });
  assert.match(result.text, /봇 연결: 정상/);
  assert.match(result.text, /열린 방: 2개/);
  assert.match(result.text, /thread-1|thread-2/);
  assert.match(result.text, /오늘 Codex 사용: 7회/);
  assert.doesNotMatch(result.text, /do-not-show|token/);
});

test('application re-renders current buttons for every engine result with a session', async () => {
  const session = { id: 's', phase: 0, status: 'EXPLORATION_COLLECTING', scene: 1, players: [], choices: [{ label: '조사', intent: '조사' }] };
  const store = { byThread: () => structuredClone(session) };
  const engine = { handle: async () => ({ text: '현재 안내', session }) };
  const app = new Application({ guildIds: ['g'], lobbyIds: ['lobby'] }, store, engine, {});
  const result = await app.handle({ id: 'status-1', guildId: 'g', threadId: 'thread', userId: 'u', action: 'status' });
  const controls = result.components.flatMap(row => row.components);
  assert.ok(controls.some(component => component.custom_id.includes(':inputChoice:')));
  assert.match(result.text, /현재 안내/);
});
