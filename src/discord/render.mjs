import { CHARACTER_ROLES, validCharacterProfile } from '../game/rules.mjs';
const button = (id, label, style = 2, disabled = false) => ({ type: 2, style, custom_id: id.slice(0, 100), label: String(label).slice(0, 80), disabled });
const validCharacter = player => validCharacterProfile(player.character);
const playerName = (player, index = 0) => {
  const name = String(player?.name ?? '').trim();
  return name || `플레이어 ${index + 1}`;
};
export function sessionGuide(session) {
  const english = session.world?.language === 'en';
  if (english) {
    if (session.status === 'LOBBY') {
      const players = session.players || [], minimum = session.minPartySize ?? 2;
      const waiting = players.filter(p => !p.ready || !validCharacter(p));
      return [
        '**Adventure setup — use the controls below**',
        '1. Choose a role or create one with `/캐릭터` → 2. Mark ready → 3. The host starts the adventure.',
        `${session.world?.genre || 'Random'} world · ${session.world?.premise || 'Your first problem will be revealed when the game starts.'}`,
        `\n**Players: ${players.length} · minimum: ${minimum}**`,
        ...players.map((p, index) => `${playerName(p, index).slice(0, 40)}${p.userId === session.hostId ? ' (host)' : ''} · ${validCharacter(p) ? `${p.character.role} · ${p.ready ? '✅ ready' : 'needs to ready up'}` : 'needs a role'}`),
        players.length < minimum ? `\n${minimum - players.length} more player(s) needed.` : waiting.length ? '\nEveryone must choose a role and mark ready.' : '\nEveryone is ready. The host can start the adventure.',
        'Free-form roles, names, specialties, and weaknesses can be set before play with `/캐릭터`.'
      ].join('\n');
    }
    if (session.status === 'EXPLORATION_COLLECTING') {
      const players = session.players || [], actions = session.actions || {};
      const pending = players.filter(p => p.presence !== 'away' && p.ready && !actions[p.userId]);
      const submitted = players.filter(p => p.presence !== 'away' && p.ready && actions[p.userId]);
      const waiting = pending.length ? `Waiting for: ${pending.map(p => playerName(p, players.indexOf(p))).join(', ')}` : submitted.length ? 'Everyone has acted. Preparing the next scene.' : 'Enter an action to begin this scene.';
      const selected = submitted.map(p => `${playerName(p, players.indexOf(p))}: ${String(session.choices?.find(choice => choice.intent === actions[p.userId]?.value)?.label || actions[p.userId]?.value || '').slice(0, 90)}`).join('\n');
      return `Choose an option below or type a free-form action in chat. The bot rolls dice. Start chatter with // .\n${waiting}${selected ? `\n\n**Submitted actions**\n${selected}` : ''}`;
    }
    if (session.status === 'COMBAT_TURN') return 'Only the current player may act: attack, defend, help an ally, or use a potion.';
    if (session.status === 'CONSENSUS_VOTE') return 'The party chose incompatible actions. Vote for the action you want to take.';
    if (session.status === 'RESOLVING') return 'The GM is preparing the next scene from the party’s actions.';
    if (session.status === 'PAUSED') return 'The adventure is paused. The host can resume it.';
    return 'The adventure has ended. Start a new game from the lobby.';
  }
  if (session.status === 'LOBBY') {
    const players = session.players || [], minimum = session.minPartySize ?? 2;
    const waiting = players.filter(p => !p.ready || !validCharacter(p));
    return [
      '**모험 준비 — 아래 버튼부터 눌러 주세요**',
      '① 직업 선택 → ② 준비 완료 → ③ 파티장이 모험 시작',
      '빠른 역할 버튼을 누르거나 /캐릭터로 자유 직업을 작성할 수 있어요.',
      '버튼을 누르면 자동 참가해요. 자유 직업 예: 남궁세가 가신, 화성 광산 기술자, 네트러너.',
      `${session.world?.genre || '랜덤'} 세계 · ${session.world?.premise || '이번 세계의 문제는 시작과 함께 드러납니다.'}`,
      `\n**참가자 ${players.length}명 · 최소 ${minimum}명**`,
      ...players.map((p, index) => `${playerName(p, index).slice(0, 40)}${p.userId === session.hostId ? ' (파티장)' : ''} · ${validCharacter(p) ? `${p.character.role} · ${p.ready ? '✅ 준비 완료' : '준비 버튼을 눌러 주세요'}` : '직업 버튼을 골라 주세요'}`),
      players.length < minimum ? `\n친구 ${minimum - players.length}명이 더 참가하면 시작할 수 있어요.` : waiting.length ? '\n모두 직업을 고르고 준비하면 시작 버튼이 켜져요.' : '\n모두 준비됐어요! 파티장이 [모험 시작]을 눌러 주세요.',
      '자유 직업·이름·특기·약점은 /캐릭터에서 언제든 시작 전에 바꿀 수 있어요.'
    ].join('\n');
  }
  if (session.status === 'EXPLORATION_COLLECTING') {
    const players = session.players || [], actions = session.actions || {};
    const pending = players.filter(p => p.presence !== 'away' && p.ready && !actions[p.userId]);
    const submitted = players.filter(p => p.presence !== 'away' && p.ready && actions[p.userId]);
    const waitingText = pending.length
      ? `아직 행동을 안 낸 사람: ${pending.map((p, index) => playerName(p, players.indexOf(p))).join(', ')}`
      : submitted.length ? '모두 행동을 냈어요. 다음 장면을 준비 중입니다.' : '행동을 입력하면 이번 장면이 시작돼요.';
    const selectedText = submitted.length ? submitted.map((p, index) => {
      const value = String(actions[p.userId]?.value || '').replace(/[\r\n]/g, ' ').trim();
      const label = session.choices?.find(choice => choice.intent === value)?.label || value;
      return `${playerName(p, players.indexOf(p))}: ${String(label).slice(0, 90)}`;
    }).join('\n') : '';
    return `각자 아래 선택지 하나를 누르거나, 채팅에 “등불을 조사한다”처럼 행동을 적어 주세요. 주사위는 봇이 굴려요. 잡담은 //로 시작하세요.\n${waitingText}${selectedText ? `\n\n**선택한 행동**\n${selectedText}` : ''}`;
  }
  if (session.status === 'COMBAT_TURN') return '현재 차례인 사람만 행동을 고르세요. 공격: 적 공격 · 방어: 피해 줄이기 · 동료 돕기: 다음 동료 지원 · 물약: 내 체력 회복';
  if (session.status === 'CONSENSUS_VOTE') return '함께 할 행동이 엇갈렸어요. 각자 원하는 선택지에 투표해 주세요.';
  if (session.status === 'RESOLVING') return '모두의 행동을 바탕으로 다음 장면을 만들고 있어요. 잠시 기다려 주세요.';
  if (session.status === 'PAUSED') return '모험을 쉬고 있어요. 파티장이 [재개]를 누르면 이어집니다.';
  return '모험이 끝났어요. 새로 시작하려면 로비에서 /게임시작을 사용하세요.';
}
export function renderSession(session, text, { actionControls = true } = {}) {
  const english = session.world?.language === 'en';
  const actor = session.combat?.order?.[session.combat.turnIndex];
  const footer = session.status === 'COMBAT_TURN' ? `\n현재 턴: ${session.players?.find(p=>p.userId===actor)?.name || actor} · 적 ${session.combat.enemies.map(e=>`${e.id} HP ${e.hp}`).join(', ')}` : '';
  const guide = sessionGuide(session);
  const content = session.status === 'LOBBY'
    ? `${text ? `${String(text).slice(0, 250)}\n\n` : ''}${guide}`.slice(0, 1900)
    : `${String(text ?? '모험 진행 중').slice(0, 1350)}${footer.slice(0, 190)}\n\n${guide}`.slice(0, 1900);
  const id = String(session.id).slice(0, 36), phase = String(session.phase ?? 0), status = String(session.status || 'LOBBY');
  const controls = [];
  if (status === 'PAUSED') controls.push(button(`trpg:${id}:${phase}:resume`, english ? 'Resume' : '재개', 1), button(`trpg:${id}:${phase}:endConfirm`, english ? 'End game' : '게임 종료', 4));
  else if (status === 'LOBBY') {
    const players = session.players || [];
    const canStart = players.length >= (session.minPartySize ?? 2) && players.every(p => p.ready && validCharacter(p));
    controls.push(...CHARACTER_ROLES.map(role => button(`trpg:${id}:${phase}:chooseRole:${role.id}`, role.description, 2)));
    controls.push(button(`trpg:${id}:${phase}:ready`, english ? 'Ready / cancel' : '준비 완료 / 취소', 3), button(`trpg:${id}:${phase}:start`, english ? 'Start adventure (host)' : '모험 시작 (파티장)', 1, !canStart));
  }
  else if (status === 'COMBAT_TURN' && actionControls) controls.push(button(`trpg:${id}:${phase}:attack`, english ? 'Attack' : '공격', 4), button(`trpg:${id}:${phase}:defend`, english ? 'Defend' : '방어', 2), button(`trpg:${id}:${phase}:help`, english ? 'Help ally' : '동료 돕기', 2), button(`trpg:${id}:${phase}:item`, english ? 'Healing potion' : '치유 물약', 2));
  else if (status === 'CONSENSUS_VOTE' && actionControls) for (const [index, choice] of (session.vote?.options || []).slice(0, 6).entries()) controls.push(button(`trpg:${id}:${phase}:vote:${index}`, choice.label));
  else if (status === 'EXPLORATION_COLLECTING' && actionControls) for (const [index, choice] of (session.choices || []).slice(0, 4).entries()) controls.push(button(`trpg:${id}:${phase}:inputChoice:${index}`, choice.label));
  if (status !== 'LOBBY' && status !== 'PAUSED' && status !== 'ENDED') controls.push(button(`trpg:${id}:${phase}:pause`, english ? 'Pause' : '일시정지', 2), button(`trpg:${id}:${phase}:endConfirm`, english ? 'End game' : '게임 종료', 4));
  controls.push(button(`trpg:${id}:${phase}:helpGuide`, english ? 'How to play' : '어떻게 해요?', 2));
  const rows = []; for (let i = 0; i < controls.length; i += 5) rows.push({ type: 1, components: controls.slice(i, i + 5) });
  return { content, allowed_mentions: { parse: [] }, components: rows };
}
