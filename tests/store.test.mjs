import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/persistence/db.mjs';
const session = () => ({ id:'a',guildId:'guild',threadId:'thread',status:'LOBBY',players:[],scene:0,version:0 });
test('commit atomically deduplicates and enqueues; stale writes rejected', () => {
  const db = new Store();
  try {
    const s = db.create(session());
    assert.equal(db.commit(s,0,'evt','JOIN',{},[{content:'hello'}]),true);
    assert.equal(db.commit(s,0,'evt','JOIN',{},[{content:'hello'}]),false);
    assert.equal(db.pending().length,1);
    assert.throws(()=>db.commit(s,0,'other','BAD',{},[{content:'bad'}]),/충돌/);
    assert.equal(db.hasProcessed('other'),false);
    assert.equal(db.events('a').length,1);
  } finally { db.close(); }
});
test('failed message enqueue rolls session and event back', () => {
  const db = new Store();
  try {
    const s = db.create(session()), cyclic={};cyclic.self=cyclic;
    assert.throws(()=>db.commit(s,0,'evt','JOIN',{},[cyclic]));
    assert.equal(db.get('a').version,0);assert.equal(db.events('a').length,0);assert.equal(db.hasProcessed('evt'),false);
  } finally { db.close(); }
});
test('SQLite online backup restores sessions and pending jobs', async () => {
  const dir = mkdtempSync(join(tmpdir(),'trpg-backup-'));
  const db = new Store(join(dir,'source.sqlite'));
  try {
    db.create(session());db.saveJob({id:'job',sessionId:'a',status:'PENDING'});
    const file=await db.backup(join(dir,'backups'));
    const restored=new Store(file);
    try { assert.equal(restored.get('a').threadId,'thread');assert.equal(restored.job('job').status,'PENDING'); }
    finally { restored.close(); }
  } finally { db.close();rmSync(dir,{recursive:true,force:true}); }
});
