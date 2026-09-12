import { configFrom } from './config.mjs';
import { Store } from './persistence/db.mjs';
import { StoryDirector } from './ai/story-director.mjs';

// Uses synthetic players and an in-memory database. No Discord messages.
const config = configFrom(process.env, false);
if (config.aiProvider !== 'codex' && !process.argv.includes('--allow-paid-api')) {
  console.error('API mode requires --allow-paid-api for this check.');
  process.exit(1);
}
const store = new Store(':memory:');
const usage = [];
const director = new StoryDirector(config, store, {
  fetchFn: async (url, options) => {
    const response = await fetch(url, options);
    const data = await response.clone().json().catch(() => ({}));
    if (!response.ok) {
      const code = String(data.error?.code || data.error?.type || 'unknown');
      console.log(JSON.stringify({ apiStatus: response.status, code: /^[a-z0-9_]+$/i.test(code) ? code : 'unknown' }));
    } else usage.push(data.usage);
    return response;
  }
});
const context = {
  players: [{ userId: 'test-alice' }, { userId: 'test-bob' }],
  actions: { 'test-alice': '성문의 표식을 살펴본다', 'test-bob': '주변을 경계한다' },
  world: { location: '오래된 성문', facts: ['문은 닫혀 있고 눈에 보이는 적은 없다.'] },
  summary: '', recent: [], checks: []
};
try {
  const interpretation = await director.interpret(context);
  console.log(JSON.stringify({ interpretationValid: true, actions: interpretation.actions.length }));
  const narration = await director.narrate({ ...context, actions: {}, checks: [] });
  console.log(JSON.stringify({ narrationValid: true, choices: narration.choices.length, provider: config.aiProvider, model: config.aiProvider === 'codex' ? (config.codexModel || 'Codex default') : config.model, usage }));
} catch {
  console.log(JSON.stringify({ aiSmokePassed: false }));
  process.exitCode = 1;
} finally { director.close(); store.close(); }
