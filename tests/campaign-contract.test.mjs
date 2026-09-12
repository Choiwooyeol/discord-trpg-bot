import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/persistence/db.mjs';
import { StoryDirector } from '../src/ai/story-director.mjs';
import { DemoDirector } from '../src/ai/demo-director.mjs';
import { validateCampaign } from '../src/ai/campaign-contract.mjs';

const context = { seed: 'example', world: { genre: 'Science Fiction', language: 'en', tone: '' }, players: [{ name: 'Mira', character: { role: 'Gardener' } }], recentStarts: [] };
test('campaign schema is strict and the Responses request includes party, language, and avoidance context', async t => {
  const store = new Store(); t.after(() => store.close()); let request;
  const campaign = await new DemoDirector().campaign(context);
  const director = new StoryDirector({ aiKey: 'test', model: 'test', dailyBudget: 1, inputRate: 1, outputRate: 1 }, store, { fetchFn: async (_, init) => {
    request = JSON.parse(init.body);
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(campaign) }] }] }));
  } });
  assert.deepEqual(await director.campaign(context), campaign);
  assert.equal(request.text.format.name, 'campaign');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.equal(request.text.format.schema.properties.starterChoices.items.additionalProperties, false);
  assert.deepEqual(JSON.parse(request.input), context);
  assert.match(request.instructions, /recentStarts/);
  assert.match(request.instructions, /PARTY:/);
});

test('invalid, oversized, duplicate choices, and model-authored state changes are rejected', async () => {
  const valid = await new DemoDirector().campaign(context);
  for (const invalid of [null, { ...valid, hp: 99 }, { ...valid, opening: 'too short' }, { ...valid, opening: 'x'.repeat(1101) },
    { ...valid, factions: [] }, { ...valid, facts: ['only one'] }, { ...valid, starterChoices: [valid.starterChoices[0], valid.starterChoices[0]] },
    { ...valid, starterChoices: [{ label: 'x', intent: '' }, valid.starterChoices[1]] }]) assert.throws(() => validateCampaign(invalid), /invalid campaign/);
});

test('campaign generation uses the shared Codex quota and never falls back to the paid API', async t => {
  const store = new Store(); t.after(() => store.close()); let codexCalls = 0, apiCalls = 0;
  const director = new StoryDirector({ aiProvider: 'codex', codexDailyLimit: 1, aiKey: 'present-but-unused' }, store, {
    codexRunner: { async generate() { codexCalls++; throw Error('subscription unavailable'); } },
    fetchFn: async () => { apiCalls++; }
  });
  await assert.rejects(director.campaign(context), /subscription/);
  await assert.rejects(director.campaign(context), /daily request limit/);
  assert.equal(codexCalls, 1); assert.equal(apiCalls, 0);
});
