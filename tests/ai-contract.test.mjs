import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryDirector } from '../src/ai/story-director.mjs';
import { DemoDirector } from '../src/ai/demo-director.mjs';

class Store {
  constructor() { this.values = new Map(); }
  getValue(k) { return this.values.get(k); }
  setValue(k, v) { this.values.set(k, v); }
  transaction(fn) { return fn(); }
}
const context = { players: [{ userId: 'u1' }, { userId: 'u2' }], actions: { u1: '문을 연다', u2: '주변을 지킨다' }, world: { location: '성문' }, summary: '', recent: [], checks: [] };
function response(value, status = 'completed') { return new Response(JSON.stringify({ status, output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }), { status: 200 }); }
function director(value, config = {}) { return new StoryDirector({ aiKey: 'k', model: 'test', dailyBudget: 1, inputRate: 1, outputRate: 1, ...config }, new Store(), { fetchFn: async () => response(value) }); }
const interpretation = { actions: [{ userId: 'u1', intent: '문을 연다', classification: 'PARALLEL', ability: 'strength', difficulty: 10, group: 'door' }, { userId: 'u2', intent: '주변을 지킨다', classification: 'PARALLEL', ability: null, difficulty: 10, group: 'guard' }], combat: null };
const narration = { narration: '문이 열렸다.', location: '성문 안', facts: ['어두운 복도다'], choices: [{ label: '들어간다', intent: '복도로 들어간다' }, { label: '기다린다', intent: '밖에서 기다린다' }], summary: '성문이 열렸다.' };

test('sends Responses structured strict schema and validates interpretation', async () => {
  let request;
  const d = new StoryDirector({ aiKey: 'k', model: 'test', dailyBudget: 1, inputRate: 1, outputRate: 1 }, new Store(), { fetchFn: async (_, init) => { request = JSON.parse(init.body); return response(interpretation); } });
  assert.deepEqual(await d.interpret(context), interpretation);
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
});

test('narration requests require a detailed consequence-by-consequence scene', async () => {
  let request;
  const d = new StoryDirector({ aiKey: 'k', model: 'test', dailyBudget: 1, inputRate: 1, outputRate: 1 }, new Store(), { fetchFn: async (_, init) => { request = JSON.parse(init.body); return response(narration); } });
  await d.narrate(context);
  assert.match(request.instructions, /NARRATION_DETAIL_REQUIREMENTS/);
  assert.match(request.instructions, /each submitted player action/);
});
test('rejects refusals, incomplete responses, malformed JSON, unknown users and extra fields', async () => {
  const bad = [
    async () => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }), { status: 200 }),
    async () => response(interpretation, 'incomplete'),
    async () => new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{' }] }] }), { status: 200 }),
    async () => response({ ...interpretation, actions: [{ ...interpretation.actions[0], userId: 'intruder' }] }),
    async () => response({ ...interpretation, surprise: true })
  ];
  for (const fetchFn of bad) { const d = new StoryDirector({ aiKey: 'k', model: 'test', dailyBudget: 1, inputRate: 1, outputRate: 1 }, new Store(), { fetchFn }); await assert.rejects(d.interpret(context)); }
});
test('reserves budget atomically and fails closed when exhausted', async () => {
  const store = new Store(); let calls = 0;
  const d = new StoryDirector({ aiKey: 'k', model: 'test', dailyBudget: 0.00001, inputRate: 100, outputRate: 100 }, store, { fetchFn: async () => { calls++; return response(interpretation); } });
  await assert.rejects(d.interpret(context), /budget/);
  assert.equal(calls, 0);
});
test('DemoDirector fulfills offline contracts', async () => {
  const d = new DemoDirector();
  const i = await d.interpret(context); const n = await d.narrate(context);
  assert.equal(i.actions[0].userId, 'u1'); assert.equal(i.combat, null); assert.equal(n.choices.length, 3);
});
test('does not serialize independent party calls', async () => {
  let release; const gate = new Promise(r => { release = r; }); let calls = 0;
  const d = new StoryDirector({ aiKey: 'k', model: 'test', dailyBudget: 1, inputRate: 1, outputRate: 1 }, new Store(), { fetchFn: async () => { calls++; await gate; return response(interpretation); } });
  const a = d.interpret(context); const b = d.interpret({ ...context, actions: { u1: '문을 연다', u2: '문을 연다' } });
  await new Promise(r => setTimeout(r, 5)); assert.equal(calls, 2); release(); await Promise.all([a, b]);
});
