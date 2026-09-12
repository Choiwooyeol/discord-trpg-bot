import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordClient } from '../src/discord/client.mjs';
import { renderSession } from '../src/discord/render.mjs';

class Socket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 1; this.listeners = {}; Socket.instances.push(this); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, value) { for (const fn of this.listeners[name] || []) fn(value); }
  send(value) { this.sent = [...(this.sent || []), JSON.parse(value)]; }
  close(code = 1000) { this.readyState = 3; this.emit('close', { code }); }
}
const response = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: key => headers[key] }, json: async () => body });

test('REST, command registration, Gateway READY and heartbeat', async () => {
  const calls = []; const fetchFn = async (url, opts = {}) => { calls.push({ url, opts }); if (url.endsWith('/users/@me')) return response({ id: 'bot', bot: true }); if (url.endsWith('/gateway/bot')) return response({ url: 'wss://gateway.discord.gg' }); if (url.includes('/commands')) return response([]); return response({}); };
  const client = new DiscordClient({ token: 'secret', guildIds: ['guild'], lobbyIds: ['lobby'] }, { fetchFn, Socket });
  const events = []; await client.start(event => events.push(event)); const socket = Socket.instances.at(-1);
  socket.emit('message', { data: JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 }, s: null }) });
  assert.equal(socket.sent[0].op, 2); socket.emit('message', { data: JSON.stringify({ op: 0, t: 'READY', s: 1, d: { session_id: 'sid', resume_gateway_url: 'wss://resume' } }) });
  assert.equal(client.ready, true); assert.ok(calls.some(x => x.url.includes('/guilds/guild/commands'))); client.close();
});

test('filters messages and maps button/slash events', async () => {
  const fetchFn = async (url, opts = {}) => url.includes('/callback') || url.includes('/webhooks') ? response({}) : url.endsWith('/users/@me') ? response({ id: 'bot', bot: true }) : url.endsWith('/gateway/bot') ? response({ url: 'wss://gateway' }) : response([]);
  const client = new DiscordClient({ token: 't', guildIds: ['g'], lobbyIds: ['l'] }, { fetchFn, Socket }); const events = []; client.onEvent = e => events.push(e);
  await client.message({ id: 'm', guild_id: 'g', channel_id: 'thread', parent_id: 'l', author: { id: 'u', username: 'U' }, content: '문을 연다' });
  await client.message({ id: 'x', guild_id: 'other', channel_id: 'l', author: { id: 'u' }, content: '무시' });
  assert.equal(events[0].action, 'input'); assert.equal(events[0].value, '문을 연다');
  client.onEvent = e => events.push(e); await client.interaction({ id: 'i', token: 'tok', application_id: 'app', type: 3, guild_id: 'g', channel_id: 'thread', member: { user: { id: 'u', username: 'U' } }, data: { custom_id: 'trpg:session:COMBAT_TURN:attack' } });
  assert.equal(events.at(-1).action, 'attack'); assert.equal(events.at(-1).sessionId, 'session'); assert.equal(events.at(-1).phase, 'COMBAT_TURN');
});

test('session renderer creates bounded, safe controls', () => {
  const rendered = renderSession({ id: 's', phase: 0, status: 'LOBBY', scene: '장면', choices: [], combat: false });
  assert.deepEqual(rendered.allowed_mentions, { parse: [] });
  const controls = rendered.components.flatMap(row => row.components);
  assert.equal(controls.filter(x => x.custom_id.includes(':chooseRole:')).length, 3);
  assert.equal(controls.find(x => x.custom_id.endsWith(':start')).disabled, true);
  assert.ok(rendered.components.every(row => row.components.length <= 5));
  assert.match(rendered.content, /직업 선택 → ② 준비 완료/);
});

test('English sessions render English setup guidance and controls', () => {
  const rendered = renderSession({ id: 'en', phase: 0, status: 'LOBBY', minPartySize: 1, players: [], choices: [], world: { language: 'en', genre: 'Science Fiction', premise: 'a lost signal' } });
  assert.match(rendered.content, /Adventure setup/);
  assert.match(rendered.content, /Science Fiction/);
  assert.ok(rendered.components.flatMap(row => row.components).some(button => button.label === 'Ready / cancel'));
});

test('Korean character options offer named jobs and accept both new and cached option names', async () => {
  const calls = [], events = [];
  const client = new DiscordClient({ token: 't', guildIds: ['g'] }, { fetchFn: async (url, opts) => { calls.push({ url, opts }); return response({}); } });
  client.botId = 'bot';
  const commands = await client.registerCommands();
  const character = commands.find(c => c.name === '캐릭터');
  assert.deepEqual(character.options.map(o => o.name), ['직업', '강점', '이름', '특기', '약점']);
  assert.equal(character.options[0].choices, undefined);
  assert.equal(character.options[1].required, false);
  assert.ok(commands.some(c => c.name === '도움말'));
  client.onEvent = event => { events.push(event); return { text: '확인' }; };
  for (const options of [[{ name: '직업', value: '도적' }], [{ name: 'role', value: '도적' }]]) {
    await client.interaction({ id: `i${events.length}`, token: 'tok', application_id: 'app', type: 2, guild_id: 'g', channel_id: 'thread', member: { nick: '별명', user: { id: 'u', username: 'U' } }, data: { name: '캐릭터', options } });
    assert.equal(events.at(-1).value.role, '도적');
    assert.equal(events.at(-1).name, '별명');
  }
});

test('lobby readiness includes existing invalid roles and respects configured party minimum', () => {
  const session = { id: 's', status: 'LOBBY', phase: 0, minPartySize: 3, hostId: 'a', players: ['a', 'b'].map(userId => ({ userId, name: userId, character: { role: '전사' }, ready: true })) };
  const start = s => renderSession(s).components.flatMap(r => r.components).find(c => c.custom_id.endsWith(':start'));
  assert.equal(start(session).disabled, true);
  session.minPartySize = 2;
  assert.equal(start(session).disabled, false);
  session.players[0].character.role = '1';
  const rendered = renderSession(session);
  assert.equal(start(session).disabled, true);
  assert.match(rendered.content, /a \(파티장\) · 직업 버튼을 골라 주세요/);
});

test('thread messages are forwarded and state-changing button clicks do not create a duplicate reply', async () => {
  const calls = []; const fetchFn = async (url, opts = {}) => { calls.push({ url, opts }); if (url.includes('/callback') || url.includes('/webhooks')) return response({}); return response([]); };
  const client = new DiscordClient({ token: 't', guildIds: ['g'], lobbyIds: ['l'] }, { fetchFn, Socket }); const events = []; client.onEvent = e => { events.push(e); return { session: { id: 's' } }; };
  await client.message({ id: 'thread-msg', guild_id: 'g', channel_id: 'thread', author: { id: 'u', username: 'U' }, content: '행동' });
  assert.equal(events.length, 1);
  await client.interaction({ id: 'i2', token: 'tok', application_id: 'app', type: 3, guild_id: 'g', channel_id: 'thread', member: { user: { id: 'u', username: 'U' } }, data: { custom_id: 'trpg:s:0:attack' } });
  const ack = calls.find(x => x.url.includes('/callback')); assert.equal(JSON.parse(ack.opts.body).type, 6);
  assert.equal(calls.filter(x => x.url.includes('/webhooks/')).length, 0);
});

test('button errors remain private without posting another channel message', async () => {
  const calls = []; const fetchFn = async (url, opts = {}) => { calls.push({ url, opts }); return response({}); };
  const client = new DiscordClient({ token: 't', guildIds: ['g'] }, { fetchFn, Socket });
  client.onEvent = () => ({ text: '지금은 이 버튼을 사용할 수 없어요.' });
  await client.interaction({ id: 'i3', token: 'tok', application_id: 'app', type: 3, guild_id: 'g', channel_id: 'thread', member: { user: { id: 'u', username: 'U' } }, data: { custom_id: 'trpg:s:0:attack' } });
  const ack = calls.find(x => x.url.includes('/callback'));
  const followup = calls.find(x => x.url.endsWith('/webhooks/app/tok'));
  assert.equal(JSON.parse(ack.opts.body).type, 6);
  assert.equal(JSON.parse(followup.opts.body).flags, 64);
});

test('server heartbeat request is answered and session marker nonce stays within Discord limit', async () => {
  const calls = []; const fetchFn = async (url, opts = {}) => { calls.push({ url, opts }); if (url.includes('/messages?')) return response([]); if (url.includes('/users/@me')) return response({ id: 'bot', bot: true }); if (url.includes('/messages/')) return response({ id: 'thread', type: 11 }); return response({ id: 'starter' }); };
  const client = new DiscordClient({ token: 't', guildIds: ['g'], lobbyIds: ['l'] }, { fetchFn, Socket }); client.botId = 'bot';
  const socket = new Socket('wss://gateway/?v=10&encoding=json'); client.ws = socket; await client.packet({ op: 1, d: null, s: 42 }, socket); assert.equal(socket.sent.at(-1).op, 1); assert.equal(socket.sent.at(-1).d, 42);
  await client.createThread('g', 'l', '모험', 'event-with-a-long-id-that-must-be-hashed'); const post = calls.find(x => x.opts.method === 'POST' && x.url.includes('/messages')); assert.ok(JSON.parse(post.opts.body).nonce.length <= 25);
});
