import assert from 'node:assert/strict';
import { configFrom } from './config.mjs';
import { Store } from './persistence/db.mjs';
import { StoryDirector } from './ai/story-director.mjs';
import { GameEngine } from './game/engine.mjs';

// Live AI smoke: isolated sessions/outbox, no Discord connection or game DB writes.
// Three openings and one resolved action use at most five AI requests.
const config = configFrom();
const store = new Store(':memory:');
const director = new StoryDirector(config, store);
const engine = new GameEngine(store, director, { ...config, maxActiveSessions: 3, minPartySize: 1 });
try {
  const cases = [
    { genre: 'mystery', language: 'ko', name: '하루', role: '퇴직한 무대 마술사', specialty: '소품 감정', weakness: '빚' },
    { genre: 'mystery', language: 'ko', name: '하루', role: '퇴직한 무대 마술사', specialty: '소품 감정', weakness: '빚' },
    { genre: 'cyberpunk', language: 'en', name: 'Mira', role: 'Rooftop gardener', specialty: 'Rare seed restoration', weakness: 'Corporate debt' }
  ];
  for (const [index, setup] of cases.entries()) {
    const threadId = `smoke-${index}`;
    const session = engine.create({ guildId: 'isolated-smoke', threadId, hostId: 'tester', scenarioId: setup.genre, language: setup.language });
    let sequence = 0;
    const act = (action, value) => engine.handle({ id: `${threadId}:${++sequence}`, guildId: 'isolated-smoke', threadId, userId: 'tester', name: setup.name, action, value });
    await act('join'); await act('character', setup); await act('ready');
    const started = await act('start');
    assert.equal(started.session?.status, 'EXPLORATION_COLLECTING', started.text);
    const world = started.session.world;
    assert.ok(world.opening.includes(setup.name), 'opening should involve the prepared character');
    assert.ok(setup.language === 'ko' ? /[가-힣]/.test(world.opening) : !/[가-힣]/.test(world.opening), 'opening language');
    console.log(JSON.stringify({ case: index + 1, genre: world.genre, openingStyle: world.openingStyle, name: world.name, location: world.location, premise: world.premise, opening: world.opening, choices: world.starterChoices }));
    if (index === 0) {
      const next = await act('input', '지금 제안은 거절하고 내 소품 감정 기술로 돈을 벌 수 있는 사람을 찾아 말을 건다.');
      assert.equal(next.session?.scene, 2, next.text);
      assert.equal(next.session.world.opening, world.opening);
      console.log(JSON.stringify({ continuation: next.text, status: next.session.status }));
    }
    await act('end');
    assert.equal(store.get(session.id).status, 'ENDED');
  }
  console.log('PASS: three live AI openings, repeated-genre variation, character/language checks, and first-action continuation. No Discord messages sent.');
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  director.close(); await engine.idle(); store.close();
}
