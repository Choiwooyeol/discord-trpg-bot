import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/persistence/db.mjs';
import {Outbox} from '../src/persistence/outbox.mjs';
test('lost Discord reply reconciles without sending again; other party proceeds',async()=>{
  const db=new Store();let calls=0,found=false;
  const discord={async send(channel){calls++;if(channel==='a')throw Error('connection lost');return {id:'b-message'};},async find(){return found?{id:'a-message'}:null;}};
  const box=new Outbox(db,discord);
  try{
    const id=db.enqueue('a','a',{content:'scene A'});db.enqueue('a','a',{content:'next A'});db.enqueue('b','b',{content:'scene B'});
    await box.flush();assert.equal(calls,2);
    await box.flush(Date.now()+120000);assert.equal(calls,2,'uncertain message must not be blindly resent');
    assert.equal(db.db.prepare('SELECT status FROM outbox WHERE id=?').get(id).status,'UNKNOWN');
    found=true;await box.flush(Date.now()+240000);assert.equal(calls,2);
    assert.equal(db.db.prepare('SELECT status FROM outbox WHERE id=?').get(id).status,'SENT');
  }finally{db.close();}
});
test('published snapshots retain old phase and render at most five buttons per row',async()=>{
  const db=new Store();let sent;
  const box=new Outbox(db,{async send(channel,payload,nonce){sent={channel,payload,nonce};return{id:'m'};}});
  try{
    db.enqueue('s','t',{content:'장면',trpgSession:{id:'s',phase:3,status:'CONSENSUS_VOTE',vote:{options:Array.from({length:6},(_,i)=>({label:String(i)}))}}});
    await box.flush();assert.ok(sent.payload.content.includes('[trpg:'));assert.ok(sent.payload.components.every(row=>row.components.length<=5));assert.match(sent.payload.components[0].components[0].custom_id,/s:3:vote:0/);
  }finally{db.close();}
});
test('definitive Discord failure does not block a later message in the same channel', async () => {
  const db = new Store();
  let calls = 0;
  const box = new Outbox(db, {
    async send() {
      calls++;
      if (calls === 1) { const error = Error('forbidden'); error.status = 403; throw error; }
      return { id: 'later-message' };
    }
  });
  try {
    const failed = db.enqueue('s', 'channel', { content: 'old message' });
    const later = db.enqueue('s', 'channel', { content: 'later message' });
    await box.flush();
    await box.flush();
    assert.equal(calls, 2);
    assert.equal(db.db.prepare('SELECT status FROM outbox WHERE id=?').get(failed).status, 'FAILED');
    assert.equal(db.db.prepare('SELECT status FROM outbox WHERE id=?').get(later).status, 'SENT');
  } finally { db.close(); }
});
test('uncertain and retryable predecessors preserve same-channel ordering', async () => {
  const db = new Store();
  try {
    const uncertain = db.enqueue('s', 'channel', { content: 'uncertain' });
    const later = db.enqueue('s', 'channel', { content: 'later' });
    db.delivery(uncertain, 'UNKNOWN', { nextAt: Date.now() + 60000 });
    assert.deepEqual(db.pending().map(item => item.id), [], 'UNKNOWN predecessor blocks later message');
    db.delivery(uncertain, 'FAILED');
    assert.deepEqual(db.pending().map(item => item.id), [later], 'FAILED predecessor is no longer an ordering blocker');
    const retryable = db.enqueue('s', 'channel', { content: 'retryable' });
    const afterRetryable = db.enqueue('s', 'channel', { content: 'after retryable' });
    db.delivery(retryable, 'READY');
    assert.deepEqual(db.pending().map(item => item.id), [later], 'READY predecessor still blocks newer messages');
    assert.deepEqual(db.deliverySummary(), { total: 4, byStatus: { READY: 3, SENDING: 0, UNKNOWN: 0, SENT: 0, FAILED: 1 }, pending: 3 });
    void afterRetryable;
  } finally { db.close(); }
});
test('session updates reuse one Discord panel message', async () => {
  const db = new Store();
  const requests = [];
  let sends = 0;
  const box = new Outbox(db, {
    async send() { sends++; return { id: 'panel-1' }; },
    async request(path, method, payload) { requests.push({ path, method, payload }); return { id: 'panel-1' }; },
    async find() { return undefined; }
  });
  const snapshot = { id: 'session-1', phase: 1, status: 'LOBBY', players: [], choices: [] };
  try {
    db.enqueue('session-1', 'channel', { content: 'first', trpgSession: snapshot });
    db.enqueue('session-1', 'channel', { content: 'second', trpgSession: { ...snapshot, phase: 2 } });
    await box.flush();
    assert.equal(sends, 1);
    await box.flush();
    assert.equal(sends, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'PATCH');
    assert.match(requests[0].path, /\/messages\/panel-1$/);
    assert.equal(db.getValue('outbox.panel.session-1'), 'panel-1');
  } finally { db.close(); }
});
test('history entries are posted once and never replace the control panel', async () => {
  const db = new Store();
  const sent = [];
  const box = new Outbox(db, {
    async send(channel, payload) { sent.push({ channel, payload }); return { id: `message-${sent.length}` }; },
    async request() { throw Error('history should not PATCH a panel'); },
    async find() { return undefined; }
  });
  const snapshot = { id: 'history-session', phase: 1, status: 'EXPLORATION_COLLECTING', players: [], actions: [], choices: [] };
  try {
    db.enqueue('history-session', 'channel', { content: '첫 장면 기록', history: true });
    db.enqueue('history-session', 'channel', { content: '다음 행동을 고르세요.', trpgSession: snapshot });
    await box.flush();
    await box.flush();
    assert.equal(sent.length, 2);
    assert.match(sent[0].payload.content, /첫 장면 기록/);
    assert.equal(sent[0].payload.history, undefined);
    assert.equal(db.getValue('outbox.panel.history-session'), 'message-2');
  } finally { db.close(); }
});
test('deleted session panel falls back to a new POST and replaces its id', async () => {
  const db = new Store();
  let sends = 0;
  const box = new Outbox(db, {
    async send() { sends++; return { id: `panel-${sends}` }; },
    async request(path, method) {
      if (method === 'PATCH') { const error = Error('deleted'); error.status = 404; throw error; }
      return null;
    },
    async find() { return undefined; }
  });
  const snapshot = { id: 'session-2', phase: 1, status: 'LOBBY', players: [], choices: [] };
  try {
    db.setValue('outbox.panel.session-2', 'deleted-panel');
    db.enqueue('session-2', 'channel', { content: 'replacement', trpgSession: snapshot });
    await box.flush();
    assert.equal(sends, 1);
    assert.equal(db.getValue('outbox.panel.session-2'), 'panel-1');
  } finally { db.close(); }
});
