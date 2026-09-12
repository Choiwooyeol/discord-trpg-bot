import { renderSession } from './discord/render.mjs';

export class Application {
  constructor(config, store, engine, discord) {
    this.config = config; this.store = store; this.engine = engine; this.discord = discord;
    this.creating = new Map(); this.inputTimes = new Map(); this.confirmations = new Map();
  }
  async handle(event) {
    if (!this.config.guildIds.includes(event.guildId)) return { text: '허용되지 않은 서버입니다.' };
    if (event.action === 'create') return this.create(event);
    if (event.action === 'createSolo') return this.createSolo(event);
    if (event.action === 'listGames') return this.listGames(event);
    if (event.action === 'gameDiagnostic') return this.gameDiagnostic(event);
    const session = this.store.byThread(event.guildId,event.threadId);
    // Ignore ordinary chatter outside registered game threads.
    if (!session) return event.action === 'input' ? {} : { text: `로비 ${this.config.lobbyIds.map(id => `<#${id}>`).join(', ')}에서 /게임시작을 입력하세요.\n생긴 모험 스레드에 들어가서 직업 선택 → 준비 완료 → 파티장이 모험 시작!` };
    if (event.sessionId && event.sessionId !== session.id) return { text: '다른 게임의 버튼입니다.' };
    if (event.action === 'helpGuide' || event.phase !== undefined && Number(event.phase) !== session.phase) {
      const rendered = renderSession(session, event.action === 'helpGuide' ? '지금 할 일은 아래 안내를 따라 주세요.' : '지난 장면의 버튼이었어요. 아래 최신 버튼을 눌러 주세요.');
      return { ...rendered, text: rendered.content, session, feedback: true };
    }
    if (event.action === 'inputChoice') {
      const index = Number(event.value);
      if (!Number.isInteger(index) || index < 0 || !session.choices?.[index]) return { text: '없는 선택지입니다.' };
      event = { ...event, action:'input', value:session.choices[index].intent };
    }
    if (event.action === 'end' || event.action === 'endConfirm') {
      if (event.userId !== session.hostId) return { text: '파티장만 종료할 수 있습니다.' };
      const key = `${session.id}:${event.userId}`, confirmation = this.confirmations.get(key);
      if (event.action === 'end' && confirmation?.phase === session.phase && confirmation.until > Date.now() && event.phase !== undefined) {
        this.confirmations.delete(key);
      } else {
        this.confirmations.set(key,{phase:session.phase,until:Date.now()+60000});
        return { text:'이 모험을 종료할까요? 이어하기가 불가능해집니다. 기록은 보존기간 후 삭제됩니다.',components:[{type:1,components:[{type:2,style:4,label:'종료 확정',custom_id:`trpg:${session.id}:${session.phase}:end`}]}] };
      }
    }
    if (event.action === 'input') {
      if (typeof event.value !== 'string' || event.value.trim().startsWith('//')) return {};
      if (event.value.length > this.config.maxInputChars) return { text:`행동은 ${this.config.maxInputChars}자 이내로 입력하세요.` };
      const key = `${session.id}:${event.userId}`, last = this.inputTimes.get(key) || 0;
      if (Date.now()-last < 800) return { text:'입력이 너무 빠릅니다. 잠시 뒤 다시 입력하세요.' };
      this.inputTimes.set(key,Date.now());
      for (const [id,at] of this.inputTimes) if (Date.now()-at > 60000) this.inputTimes.delete(id);
    }
    const result = await this.engine.handle(event);
    const current = result?.session ? (this.store.byThread(event.guildId, event.threadId) || result.session) : null;
    if (current) {
      const rendered = renderSession(current, event.action === 'status' && current.status === 'LOBBY' ? undefined : result.text);
      return { ...result, ...rendered, components: result.components ?? rendered.components, text: rendered.content };
    }
    if (event.action === 'status') {
      const rendered = renderSession(session, result.text);
      return { ...result, ...rendered, components: result.components ?? rendered.components, text: rendered.content };
    }
    return result;
  }
  async create(event) {
    if (!this.config.lobbyIds.includes(event.threadId)) return { text:'설정된 TRPG 로비에서 /게임시작을 사용하세요.' };
    if (this.creating.has(event.id)) return this.creating.get(event.id);
    const work=this._create(event).finally(()=>this.creating.delete(event.id));
    this.creating.set(event.id,work); return work;
  }
  async createSolo(event) {
    if (event.isAdministrator !== true) return { text: '혼자 시작은 서버 관리자만 사용할 수 있습니다.' };
    return this.create({ ...event, solo: true });
  }
  async _create(event) {
    const key=`creation:${event.id}`, previous=this.store.getValue(key);
    if (previous?.threadId) return {text:`게임 스레드: <#${previous.threadId}>`};
    if (previous?.status === 'UNKNOWN') return {text:'이전 스레드 생성 결과를 확인할 수 없습니다. 로비에 생긴 스레드를 확인한 뒤 새 명령을 사용하세요.'};
    const active=this.store.all().filter(s=>s.status!=='ENDED');
    const ownLobby=active.find(s=>s.guildId===event.guildId&&s.hostId===event.userId&&s.status==='LOBBY');
    if (ownLobby) return {text:`이미 준비 중인 모험방이 있어요: <#${ownLobby.threadId}>\n이어서 하려면 그 방으로 들어가세요. 새로 하고 싶으면 그 방에서 /게임종료 → 종료 확정을 누르면 됩니다.`};
    // This creation is already in `creating`; count only the other pending creations.
    if (active.length + Math.max(0, this.creating.size - 1) >= this.config.maxActiveSessions) return {text:`열린 모험방이 최대 ${this.config.maxActiveSessions}개예요. /게임목록으로 방을 확인하고, 필요 없는 방의 파티장이 그 방에서 /게임종료 → 종료 확정을 누르면 새로 만들 수 있어요.`};
    this.store.setValue(key,{status:'UNKNOWN'});
    // A persisted UNKNOWN prevents retrying a potentially successful external creation.
    const thread=await this.discord.createThread(event.guildId,event.threadId,`${event.name || '친구들'}의 모험`,event.id);
    const session=this.engine.create({guildId:event.guildId,threadId:thread.id,hostId:event.userId,tone:String(event.value?.tone||'친구들과 즐기는 판타지 모험').slice(0,200),scenarioId:event.value?.scenario,language:event.value?.language||event.locale,minPartySize:event.solo===true?1:this.config.minPartySize});
    this.store.setValue(key,{status:'CREATED',threadId:thread.id,sessionId:session.id});
    await this.engine.handle({...event,id:`${event.id}:join`,threadId:thread.id,action:'join'});
    return {text:`모험을 만들었어요! <#${thread.id}>를 눌러 들어오세요.\n각자 직업 버튼 → 준비 완료 → 파티장이 모험 시작! 이름은 Discord 닉네임으로 자동 설정돼요.`};
  }
  listGames(event) {
    if (!this.config.lobbyIds.includes(event.threadId)) return { text: 'TRPG 로비 채널에서 /게임목록을 사용하세요.' };
    const active=this.store.all().filter(s=>s.guildId===event.guildId&&s.status!=='ENDED');
    if (!active.length) return { text: '열린 모험방이 없어요. /게임시작으로 새 게임을 만들면 됩니다.' };
    const state=s=>s.status==='LOBBY' ? '준비 중' : s.status==='PAUSED' ? '일시정지' : '진행 중';
    return { text:[`**열린 모험방 ${active.length}개**`,...active.map(s=>`<#${s.threadId}> · ${state(s)}${s.hostId===event.userId?' · 내가 파티장':''}`),'내가 파티장인 방을 새로 시작하고 싶으면, 해당 방에서 /게임종료 → 종료 확정을 누르세요.'].join('\n') };
  }

  gameDiagnostic(event) {
    if (!this.config.lobbyIds.includes(event.threadId)) return { text: 'TRPG 로비 채널에서 /게임진단을 사용하세요.' };
    const active = this.store.all().filter(s => String(s.guildId) === String(event.guildId) && s.status !== 'ENDED');
    const mine = active.filter(s => String(s.hostId) === String(event.userId) || (s.players || []).some(p => String(p.userId) === String(event.userId)));
    const health = this.store.getValue('health', {}) || {};
    const requestKey = `codex-requests:${new Date().toISOString().slice(0, 10)}`;
    const codexCount = Number(this.store.getValue(requestKey, 0) || 0);
    const connected = health.ready === true ? '정상' : '확인 필요';
    const checkedAt = Number(health.at);
    const checkedText = Number.isFinite(checkedAt) ? new Date(checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기록 없음';
    const roomText = mine.length ? mine.map(s => `<#${s.threadId}> · ${s.status === 'LOBBY' ? '준비 중' : s.status === 'PAUSED' ? '일시정지' : '진행 중'}`).join('\n') : '내가 참여한 열린 방이 없습니다.';
    return { text: [`**게임 진단**`, `봇 연결: ${connected}`, `마지막 점검: ${checkedText}`, `열린 방: ${active.length}개`, `내 열린 방:`, roomText, `오늘 Codex 사용: ${codexCount}회`].join('\n') };
  }
}
