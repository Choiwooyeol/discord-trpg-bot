import { d20 } from './dice.mjs';

export const ABILITIES = ['strength', 'agility', 'knowledge', 'will'];
export const DIFFICULTIES = { easy: 8, normal: 12, hard: 16, extreme: 20 };
export const CHARACTER_ROLES = Object.freeze([
  { id: 'warrior', name: '전사', description: '힘으로 싸우는 전사', abilities: { strength: 3, agility: 1, knowledge: 0, will: 0 } },
  { id: 'rogue', name: '도적', description: '빠르게 움직이는 도적', abilities: { strength: 1, agility: 3, knowledge: 0, will: 0 } },
  { id: 'mage', name: '마법사', description: '지식과 마법을 쓰는 마법사', abilities: { strength: 0, agility: 0, knowledge: 3, will: 1 } },
]);

export function characterRole(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return CHARACTER_ROLES.find(role => role.id === text || role.name === String(value ?? '').trim()) ?? null;
}

const focusAbility = { 전투: 'strength', 힘: 'strength', 탐험: 'agility', 기동: 'agility', 민첩: 'agility', 지식: 'knowledge', 기술: 'knowledge', 교섭: 'will', 의지: 'will' };
export function characterProfile(value, focus) {
  const preset = characterRole(value);
  if (preset) return preset;
  const name = String(value ?? '').replace(/[@\r\n]/g, ' ').trim().slice(0, 60);
  if (name.length < 2 || !/[A-Za-z가-힣]/.test(name)) return null;
  const preferred = focusAbility[String(focus ?? '').trim()] || (/검|무사|전사|경호|전투|기사/.test(name) ? 'strength' : /도둑|정찰|추적|암살|기동|사수/.test(name) ? 'agility' : /해커|기술|학자|의사|마법|연금/.test(name) ? 'knowledge' : 'will');
  const abilities = { strength: 0, agility: 0, knowledge: 0, will: 0 };
  abilities[preferred] = 3;
  const secondary = ({ strength: 'will', agility: 'knowledge', knowledge: 'agility', will: 'strength' })[preferred];
  abilities[secondary] = 1;
  return { id: 'custom', name, description: name, abilities };
}

export function validCharacterProfile(character) {
  if (characterRole(character?.role)) return true;
  if (character?.roleId !== 'custom' || !characterProfile(character?.role)) return false;
  return ABILITIES.every(ability => Number.isFinite(Number(character?.abilities?.[ability])));
}

export function abilityModifier(character, ability) {
  const value = Number(character?.abilities?.[ability] ?? character?.stats?.[ability] ?? 0);
  return Math.max(-1, Math.min(3, Number.isFinite(value) ? value : 0));
}

export function check({ character, ability = 'strength', difficulty = 12, bonus = 0, roll }) {
  const result = d20(abilityModifier(character, ability) + bonus, roll);
  return { ...result, ability, difficulty, success: result.natural === 'critical' || (result.natural !== 'fumble' && result.total >= difficulty) };
}

export function applyDamage(player, amount) {
  if (!player?.character) return;
  const hp = Number(player.character.hp ?? 10);
  player.character.hp = Math.max(0, hp - Math.max(0, Number(amount) || 0));
}

export function applyHealing(player, amount) {
  if (!player?.character) return;
  const hp = Number(player.character.hp ?? 10);
  const max = Number(player.character.maxHp ?? 10);
  player.character.hp = Math.min(max, hp + Math.max(0, Number(amount) || 0));
}
