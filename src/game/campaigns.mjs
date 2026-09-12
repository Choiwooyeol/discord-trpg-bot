import { randomInt } from 'node:crypto';
const GENRES = {
  fantasy: ['판타지', 'Fantasy'], sf: ['SF', 'Science Fiction'],
  martial: ['무협', 'Martial Arts'], cyberpunk: ['사이버펑크', 'Cyberpunk'],
  mystery: ['미스터리', 'Mystery']
};
const legacyGenre = { harbor: 'fantasy', desert: 'fantasy', library: 'mystery', festival: 'fantasy' };
export const CAMPAIGN_GENRES = Object.freeze(Object.entries(GENRES).map(([id, names]) => ({ id, name: names[0] })));
const OPENING_STYLES = [
  'a journey interrupted in transit', 'a competition or public performance',
  'a civic decision with divided participants', 'an unexpected opportunity to make or build something',
  'survival after an environmental disruption', 'a rescue with competing priorities',
  'a celebration with an immediate personal dilemma', 'a workplace crisis with rival solutions',
  'an expedition discovering an unfamiliar place', 'a negotiation over access or shared resources'
];
export function chooseOpeningStyle(recentStarts) {
  const used = new Set(recentStarts.map(start => start.openingStyle));
  const candidates = OPENING_STYLES.filter(style => !used.has(style));
  return candidates[randomInt(candidates.length)];
}

// The lobby chooses a genre only. No story exists until the prepared party starts.
export function createCampaignSetup({ genre, tone, name, language, previousGenre } = {}) {
  const requested = String(genre ?? '').trim().toLowerCase();
  const candidates = Object.keys(GENRES).filter(id => id !== previousGenre);
  const genreId = Object.hasOwn(GENRES, requested) ? requested : Object.hasOwn(legacyGenre, requested) ? legacyGenre[requested] : candidates[randomInt(candidates.length)];
  const locale = String(language ?? '').toLowerCase().startsWith('en') ? 'en' : 'ko';
  const requestedName = String(name || '').trim().slice(0, 80);
  return {
    name: requestedName || (locale === 'en' ? 'New adventure' : '새 모험'), requestedName,
    genre: GENRES[genreId][locale === 'en' ? 1 : 0], genreId, language: locale,
    tone: String(tone || '').trim().slice(0, 200),
    location: '', premise: '', objective: '', factions: [], facts: [], opening: '', starterChoices: []
  };
}
export function recentCampaignStarts(sessions, guildId, excludeId) {
  return sessions.filter(s => s.guildId === guildId && s.id !== excludeId && s.scene > 0 && s.world?.opening)
    .sort((a, b) => (b.world.generatedAt ?? b.createdAt ?? 0) - (a.world.generatedAt ?? a.createdAt ?? 0))
    .slice(0, 5).map(s => ({ genreId: s.world.genreId, openingStyle: s.world.openingStyle, name: s.world.name, location: s.world.startLocation || s.world.location,
      premise: s.world.premise, opening: s.world.opening }));
}
