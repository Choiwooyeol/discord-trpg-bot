import { randomInt } from 'node:crypto';

export function rollDie(sides = 20, roll = randomInt) {
  const value = Number(roll(1, sides + 1));
  return Math.max(1, Math.min(sides, Number.isFinite(value) ? value : 1));
}

export function d20(modifier = 0, roll = randomInt) {
  const die = rollDie(20, roll);
  return { die, total: die + Number(modifier || 0), natural: die === 20 ? 'critical' : die === 1 ? 'fumble' : null };
}
