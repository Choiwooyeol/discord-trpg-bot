import { configFrom } from './config.mjs';
import { Store } from './persistence/db.mjs';
import { StoryDirector } from './ai/story-director.mjs';
import { GameEngine } from './game/engine.mjs';
import { currentActor } from './game/combat.mjs';

// Exercises several complete scenes without connecting to Discord or touching its SQLite DB.
const config = configFrom(process.env, false);
if (config.aiProvider !== 'codex' && !process.argv.includes('--allow-paid-api')) {
  console.error('API mode requires --allow-paid-api for this check.');
  process.exit(1);
}
const requested = Number(process.argv.find(arg => arg.startsWith('--scenes='))?.slice(9) || 3);
const scenes = Number.isInteger(requested) && requested >= 1 && requested <= 5 ? requested : 3;
const requestedPlayers = Number(process.argv.find(arg => arg.startsWith('--players='))?.slice(10) || 2);
const players = Number.isInteger(requestedPlayers) && requestedPlayers >= 1 && requestedPlayers <= 2 ? requestedPlayers : 2;
const store = new Store(':memory:');
const director = new StoryDirector(config, store);
const engine = new GameEngine(store, director, { minPartySize: players, maxPartySize: players, explorationSeconds: 5, combatSeconds: 5 });
const guildId = 'ai-check-guild', threadId = 'ai-check-thread';
let sequence = 0;
const event = (userId, action, value) => ({ id: `ai-check-${++sequence}`, guildId, threadId, userId, name: userId, action, value, receivedAt: Date.now() });

try {
  engine.create({ guildId, threadId, hostId: 'alice', name: '검증용 모험', tone: '가벼운 판타지', minPartySize: players });
  const party = [['alice', 'warrior'], ['bob', 'mage']].slice(0, players);
  for (const [userId, role] of party) {
    await engine.handle(event(userId, 'chooseRole', role));
    await engine.handle(event(userId, 'ready'));
  }
  await engine.handle(event('alice', 'start'));
  let completed = 0, combats = 0, votes = 0;
  while (completed < scenes) {
    let session = store.byThread(guildId, threadId);
    if (session.status === 'EXPLORATION_COLLECTING') {
      for (const [userId] of party) await engine.handle(event(userId, 'input', `scene ${completed + 1}: inspect the surroundings and find a safe path`));
      await engine.idle();
      session = store.byThread(guildId, threadId);
    }
    if (session.status === 'CONSENSUS_VOTE') {
      votes++;
      for (const [userId] of party) await engine.handle(event(userId, 'vote', '0'));
      await engine.idle();
      continue;
    }
    if (session.status === 'COMBAT_TURN') {
      combats++;
      let turns = 0;
      while (store.byThread(guildId, threadId).status === 'COMBAT_TURN' && turns++ < 20) {
        const current = store.byThread(guildId, threadId);
        await engine.handle(event(currentActor(current.combat), 'attack'));
      }
      if (turns >= 20) throw Error('combat did not finish');
      continue;
    }
    session = store.byThread(guildId, threadId);
    if (session.status !== 'EXPLORATION_COLLECTING' || session.scene < completed + 2) throw Error(`unexpected game state: ${session.status}`);
    completed++;
    console.log(JSON.stringify({ scene: completed, status: session.status, choices: session.choices.length, narrationChars: session.recent?.at(-1)?.length || 0 }));
  }
  console.log(JSON.stringify({ longAiCheckPassed: true, scenes: completed, players, combats, votes, provider: config.aiProvider }));
} catch (error) {
  console.log(JSON.stringify({ longAiCheckPassed: false, error: error instanceof Error ? error.message : 'unknown' }));
  process.exitCode = 1;
} finally {
  director.close();
  store.close();
}
