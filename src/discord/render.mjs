import { CHARACTER_ROLES, validCharacterProfile } from '../game/rules.mjs';
const button = (id, label, style = 2, disabled = false) => ({ type: 2, style, custom_id: id.slice(0, 100), label: String(label).slice(0, 80), disabled });
const validCharacter = player => validCharacterProfile(player.character);
const playerName = (player, index = 0) => {
  const name = String(player?.name ?? '').trim();
  return name || `플레이어 ${index + 1}`;
};
export function sessionGuide(session) {
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
  const actor = session.combat?.order?.[session.combat.turnIndex];
  const footer = session.status === 'COMBAT_TURN' ? `\n현재 턴: ${session.players?.find(p=>p.userId===actor)?.name || actor} · 적 ${session.combat.enemies.map(e=>`${e.id} HP ${e.hp}`).join(', ')}` : '';
  const guide = sessionGuide(session);
  const content = session.status === 'LOBBY'
    ? `${text ? `${String(text).slice(0, 250)}\n\n` : ''}${guide}`.slice(0, 1900)
    : `${String(text ?? '모험 진행 중').slice(0, 1350)}${footer.slice(0, 190)}\n\n${guide}`.slice(0, 1900);
  const id = String(session.id).slice(0, 36), phase = String(session.phase ?? 0), status = String(session.status || 'LOBBY');
  const controls = [];
  if (status === 'PAUSED') controls.push(button(`trpg:${id}:${phase}:resume`, '재개', 1), button(`trpg:${id}:${phase}:endConfirm`, '게임 종료', 4));
  else if (status === 'LOBBY') {
    const players = session.players || [];
    const canStart = players.length >= (session.minPartySize ?? 2) && players.every(p => p.ready && validCharacter(p));
    controls.push(...CHARACTER_ROLES.map(role => button(`trpg:${id}:${phase}:chooseRole:${role.id}`, role.description, 2)));
    controls.push(button(`trpg:${id}:${phase}:ready`, '준비 완료 / 취소', 3), button(`trpg:${id}:${phase}:start`, '모험 시작 (파티장)', 1, !canStart));
  }
  else if (status === 'COMBAT_TURN' && actionControls) controls.push(button(`trpg:${id}:${phase}:attack`, '공격', 4), button(`trpg:${id}:${phase}:defend`, '방어', 2), button(`trpg:${id}:${phase}:help`, '동료 돕기', 2), button(`trpg:${id}:${phase}:item`, '치유 물약', 2));
  else if (status === 'CONSENSUS_VOTE' && actionControls) for (const [index, choice] of (session.vote?.options || []).slice(0, 6).entries()) controls.push(button(`trpg:${id}:${phase}:vote:${index}`, choice.label));
  else if (status === 'EXPLORATION_COLLECTING' && actionControls) for (const [index, choice] of (session.choices || []).slice(0, 4).entries()) controls.push(button(`trpg:${id}:${phase}:inputChoice:${index}`, choice.label));
  if (status !== 'LOBBY' && status !== 'PAUSED' && status !== 'ENDED') controls.push(button(`trpg:${id}:${phase}:pause`, '일시정지', 2), button(`trpg:${id}:${phase}:endConfirm`, '게임 종료', 4));
  controls.push(button(`trpg:${id}:${phase}:helpGuide`, '어떻게 해요?', 2));
  const rows = []; for (let i = 0; i < controls.length; i += 5) rows.push({ type: 1, components: controls.slice(i, i + 5) });
  return { content, allowed_mentions: { parse: [] }, components: rows };
}
