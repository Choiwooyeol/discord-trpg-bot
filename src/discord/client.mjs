import { createHash } from 'node:crypto';
import { CHARACTER_ROLES } from '../game/rules.mjs';
const API = 'https://discord.com/api/v10';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const idOf = x => x?.id ?? x;
const userOf = (member, user) => member?.user || user || {};
const isAdministrator = permissions => {
  try { return (BigInt(permissions ?? 0) & 8n) === 8n; } catch { return false; }
};
const scenarioOption = { type: 3, name: '장르', description: '선택 사항 · 비우면 매번 랜덤 세계를 만듭니다', required: false, choices: [
  { name: '완전 랜덤', value: 'random' }, { name: '판타지', value: 'fantasy' }, { name: 'SF', value: 'sf' },
  { name: '무협', value: 'martial' }, { name: '사이버펑크', value: 'cyberpunk' }, { name: '미스터리', value: 'mystery' }
] };
const languageOption = { type: 3, name: '언어', description: '선택 사항 · 비우면 Discord 언어를 따릅니다', required: false, choices: [{ name: '한국어', value: 'ko' }, { name: 'English', value: 'en' }] };
const commands = [
  { name: '혼자시작', description: '관리자 전용 · 혼자 즐길 1인 모험방을 만듭니다', default_member_permissions: '8', options: [{ type: 3, name: '분위기', description: '선택 사항 · 예: 가벼운 판타지, 으스스한 추리', required: false }, scenarioOption, languageOption] },
  { name: '게임시작', description: '친구들과 놀 새 모험방을 만듭니다', options: [{ type: 3, name: '분위기', description: '선택 사항 · 예: 가벼운 판타지, 으스스한 추리', required: false }, scenarioOption, languageOption] },
  { name: '캐릭터', description: '자유 직업과 이름을 정합니다 · 예: 남궁세가 가신, 네트러너', options: [
    { type: 3, name: '직업', description: '자유롭게 적으세요 · 예: 남궁세가 가신, 화성 광산 기술자', required: true },
    { type: 3, name: '강점', description: '선택 사항 · 주사위에 강한 분야를 정합니다', required: false, choices: [{ name: '전투·힘', value: '전투' }, { name: '탐험·기동', value: '탐험' }, { name: '기술·지식', value: '지식' }, { name: '교섭·의지', value: '교섭' }] },
    { type: 3, name: '이름', description: '비워두면 Discord 닉네임 · 예: 세구', required: false },
    { type: 3, name: '특기', description: '선택 사항 · 예: 발자국 추적', required: false },
    { type: 3, name: '약점', description: '선택 사항 · 예: 어두운 곳을 무서워함', required: false }
  ] },
  { name: '도움말', description: '지금 무엇을 하면 되는지 버튼과 함께 알려 드려요' },
  { name: '게임목록', description: '열린 모험방을 보고, 이전 방으로 돌아갑니다' },
  { name: '내캐릭터', description: '내 캐릭터의 직업·능력치·HP·아이템을 봅니다' },
  { name: '게임진단', description: '봇 연결, 열린 방과 오늘 AI 사용량을 확인합니다' },
  { name: '행동', description: '하고 싶은 행동을 적습니다 · 그냥 채팅으로 적어도 돼요', options: [{ type: 3, name: '내용', description: '예: 등불 주변의 발자국을 조사한다', required: true }] },
  ...[['참가','세션에 참가합니다'],['준비','준비 상태를 바꿉니다'],['시작','모험을 시작합니다'],['진행','현재 장면을 진행합니다'],['게임상태','현재 상태를 봅니다'],['로그','최근 기록을 봅니다'],['나가기','세션에서 나갑니다'],['복귀','세션에 복귀합니다'],['일시정지','세션을 일시정지합니다'],['재개','세션을 재개합니다'],['게임종료','세션을 종료합니다']].map(([name, description]) => ({ name, description }))
];

export class DiscordClient {
  constructor(config, { fetchFn = fetch, Socket = WebSocket } = {}) {
    this.config = { ...config, guildIds: config.guildIds ?? [], lobbyIds: config.lobbyIds ?? [] };
    this.fetch = fetchFn; this.Socket = Socket; this.ready = false; this.stopped = true;
    this.sequence = null; this.sessionId = null; this.resumeUrl = null; this.botId = null;
  }
  headers() { return { Authorization: `Bot ${this.config.token}`, 'Content-Type': 'application/json' }; }
  async request(path, method = 'GET', body, auth = true) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await this.fetch(`${API}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: auth ? this.headers() : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status === 429) {
        let retry = Number(response.headers?.get?.('retry-after'));
        if (!Number.isFinite(retry)) { try { retry = Number((await response.json()).retry_after); } catch {} }
        if (attempt < 3) { await sleep(Math.min(120_000, Math.max(250, (retry || 1) * 1000))); continue; }
      }
      if (!response.ok) { const e = new Error(`Discord HTTP ${response.status}`); e.status = response.status; e.retryable = response.status === 429 || response.status >= 500; throw e; }
      return response.status === 204 ? null : response.json();
    }
  }
  async send(channelId, payload = {}, nonce) {
    const data = { ...payload, content: String(payload.content ?? '').slice(0, 1900), allowed_mentions: { parse: [] }, ...(nonce ? { nonce, enforce_nonce: true } : {}) };
    return this.request(`/channels/${idOf(channelId)}/messages`, 'POST', data);
  }
  async createThread(guildId, channelId, name, eventId) {
    if (!guildId || !this.config.guildIds.map(String).includes(String(guildId))) throw new Error('Guild is not allowed');
    const digest = createHash('sha256').update(String(eventId || `${guildId}:${channelId}:${name}`)).digest('hex').slice(0, 20);
    const marker = `trpg:${digest}`;
    const existing = this.botId ? await this.find(channelId, marker) : undefined;
    if (existing) {
      try { const channel = await this.request(`/channels/${existing.id}`); if (channel?.type === 11) return channel; } catch (error) { if (error.status !== 404) throw error; }
    }
    const starter = existing || await this.send(channelId, { content: `🎲 TRPG 세션을 준비 중입니다… ${marker}` }, marker);
    return this.request(`/channels/${channelId}/messages/${starter.id}/threads`, 'POST', { name: String(name).slice(0, 100), auto_archive_duration: 1440 });
  }
  async find(channelId, marker) {
    let before;
    for (let page = 0; page < 5; page++) {
      const rows = await this.request(`/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`);
      const found = rows.find(m => m.author?.id === this.botId && (m.content || '').includes(marker));
      if (found || rows.length < 100) return found;
      before = rows.at(-1)?.id;
    }
  }
  async registerCommands() {
    const app = this.botId || (await this.request('/users/@me')).id;
    this.botId = app;
    for (const guildId of this.config.guildIds) await this.request(`/applications/${app}/guilds/${guildId}/commands`, 'PUT', commands);
    return commands;
  }
  async start(onEvent) {
    this.onEvent = onEvent; this.stopped = false;
    const me = await this.request('/users/@me'); this.botId = me.id;
    await this.registerCommands();
    const gateway = await this.request('/gateway/bot');
    this.connect(gateway.url);
    return this;
  }
  connect(url) {
    if (this.stopped) return;
    const socket = new this.Socket(`${url.replace(/\/$/, '')}/?v=10&encoding=json`); this.ws = socket;
    socket.addEventListener('message', e => { if (this.ws !== socket) return; try { const result = this.packet(JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString()), socket); result?.catch?.(err => console.error(`Gateway packet: ${err.message}`)); } catch (err) { console.error(err); } });
    socket.addEventListener('close', e => { if (this.ws !== socket) return; this.ready = false; clearInterval(this.heartbeat); clearTimeout(this.firstHeartbeat); if ([4004, 4010, 4011, 4013, 4014].includes(e.code)) { this.fatalError = `Gateway fatal close ${e.code}`; this.stopped = true; return; } if ([4007, 4009].includes(e.code)) { this.sequence = null; this.sessionId = null; this.resumeUrl = null; } this.reconnect(); });
    socket.addEventListener('error', () => { if (this.ws === socket) this.ready = false; });
  }
  reconnect() { if (this.stopped || this.reconnectTimer) return; const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnects || 0, 5)); this.reconnects = (this.reconnects || 0) + 1; this.reconnectTimer = setTimeout(async () => { this.reconnectTimer = null; try { const url = this.resumeUrl || (await this.request('/gateway/bot')).url; this.connect(url); } catch (error) { console.error(`Gateway reconnect: ${error.message}`); this.reconnect(); } }, delay); }
  gateway(op, d) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ op, d })); }
  async packet(p, socket) {
    if (p.s !== null && p.s !== undefined) this.sequence = p.s;
    if (p.op === 1) { this.gateway(1, this.sequence); return; }
    if (p.op === 10) {
      clearInterval(this.heartbeat); this.heartbeatAck = true;
      const interval = p.d.heartbeat_interval;
      const first = interval * Math.random(); clearTimeout(this.firstHeartbeat); this.firstHeartbeat = setTimeout(() => { if (this.ws !== socket) return; this.gateway(1, this.sequence); }, first);
      this.heartbeat = setInterval(() => { if (this.ws !== socket) return clearInterval(this.heartbeat); if (!this.heartbeatAck) return socket.close(); this.heartbeatAck = false; this.gateway(1, this.sequence); }, interval);
      if (this.sessionId && this.sequence !== null) this.gateway(6, { token: this.config.token, session_id: this.sessionId, seq: this.sequence });
      else this.gateway(2, { token: this.config.token, intents: 33281, properties: { os: process.platform, browser: 'discord-trpg-bot', device: 'discord-trpg-bot' } });
      return;
    }
    if (p.op === 11) { this.heartbeatAck = true; return; }
    if (p.op === 7) { socket.close(); return; }
    if (p.op === 9) { this.sessionId = null; this.sequence = null; this.resumeUrl = null; socket.close(); return; }
    if (p.t === 'READY' || p.t === 'RESUMED') { this.ready = true; this.reconnects = 0; if (p.t === 'READY') { this.sessionId = p.d.session_id; this.resumeUrl = p.d.resume_gateway_url; } return; }
    if (p.t === 'MESSAGE_CREATE') return this.message(p.d);
    if (p.t === 'INTERACTION_CREATE') return this.interaction(p.d);
  }
  allowed(guildId) { return Boolean(guildId) && this.config.guildIds.map(String).includes(String(guildId)); }
  emit(event) { return Promise.resolve(this.onEvent?.({ ...event, receivedAt: Date.now() })); }
  async message(m) {
    if (!this.allowed(m.guild_id) || m.author?.bot || m.webhook_id || !m.content?.trim()) return;
    const result = await this.emit({ id: m.id, guildId: m.guild_id, threadId: m.thread?.id || m.channel_id, userId: m.author.id, name: m.member?.nick || m.author.global_name || m.author.username, action: 'input', value: m.content });
    if (result?.text && !result.session) await this.send(m.channel_id, {content:result.text,message_reference:{message_id:m.id,fail_if_not_exists:false}});
    return result;
  }
  async interaction(i) {
    const user = userOf(i.member, i.user), base = { id: i.id, guildId: i.guild_id, threadId: i.channel_id, userId: user.id, name: i.member?.nick || user.global_name || user.username, locale: i.locale || i.guild_locale, isAdministrator: isAdministrator(i.member?.permissions) };
    if (!this.allowed(i.guild_id)) return;
    const callback = `/interactions/${i.id}/${i.token}/callback`;
    // Button clicks update the persistent game panel.  Type 6 acknowledges
    // the click without creating an extra ephemeral copy of that panel.
    const defer = i.type === 3 ? { type: 6 } : { type: 5, data: { flags: 64 } };
    await this.request(callback, 'POST', defer, false);
    let action, value = {};
    if (i.type === 2) {
      const name = i.data?.name; const map = { '혼자시작': 'createSolo', '게임시작': 'create', '캐릭터': 'character', '내캐릭터': 'characterInfo', '게임진단': 'gameDiagnostic', '참가': 'join', '준비': 'ready', '시작': 'start', '진행': 'progress', '행동': 'input', '게임상태': 'status', '로그': 'log', '나가기': 'leave', '복귀': 'resume', '일시정지': 'pause', '재개': 'resume', '게임종료': 'end' };
      action = name === '도움말' ? 'helpGuide' : name === '게임목록' ? 'listGames' : map[name] || name; if (action === 'progress') action = 'advance'; if (action === 'resume') action = name === '복귀' ? 'return' : 'resume';
      const optionNames = { 이름: 'name', 직업: 'role', 강점: 'focus', 특기: 'specialty', 약점: 'weakness', 분위기: 'tone', 장르: 'scenario', 언어: 'language', 내용: 'text' };
      for (const o of i.data?.options || []) value[optionNames[o.name] || o.name] = o.value;
      if (action === 'create' || action === 'createSolo') value = { tone: value.tone, scenario: value.scenario, language: value.language };
      if (action === 'input' && value.text) value = value.text;
    }
    else if (i.type === 3) { const parts = String(i.data?.custom_id || '').split(':'); if (parts.length < 4 || parts[0] !== 'trpg' || parts[1].length > 36) return; action = parts[3]; value = parts.slice(4).join(':'); base.sessionId = parts[1]; base.phase = Number.isNaN(Number(parts[2])) ? parts[2] : Number(parts[2]); }
    else return;
    const result = await this.emit({ ...base, action, value });
    if (i.type === 3) {
      // State changes are published by the outbox.  Errors, confirmation
      // prompts, and explicitly requested transient feedback stay private.
      if ((result?.feedback || !result?.session) && (result?.text || result?.content)) {
        await this.request(`/webhooks/${i.application_id}/${i.token}`, 'POST', { content: String(result.text || result.content).slice(0, 1900), components: result.components || [], flags: 64, allowed_mentions: { parse: [] } }, false);
      }
      return result;
    }
    if (result?.text || result?.content) await this.request(`/webhooks/${i.application_id}/${i.token}/messages/@original`, 'PATCH', { content: String(result.text || result.content).slice(0, 1900), components: result.components || [], allowed_mentions: { parse: [] } }, false);
  }
  close() { this.stopped = true; this.ready = false; clearInterval(this.heartbeat); clearTimeout(this.firstHeartbeat); clearTimeout(this.reconnectTimer); this.ws?.close(); }
}
export const Discord = DiscordClient;
