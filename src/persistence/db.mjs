import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(file = ':memory:') {
    this.file = file;
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) { this.db.close(); throw Error('지원하지 않는 DB 버전입니다. 이전 코드로 DB를 열 수 없습니다.'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,thread_id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(guild_id,thread_id));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,session_id TEXT NOT NULL,version INTEGER NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_session ON events(session_id,seq);
      CREATE TABLE IF NOT EXISTS processed(id TEXT PRIMARY KEY,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,channel_id TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'READY',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,message_id TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,body TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); if (result?.then) throw Error('트랜잭션은 동기 함수여야 합니다.'); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(id) { const row = this.db.prepare('SELECT body FROM sessions WHERE id=?').get(id); return row ? JSON.parse(row.body) : null; }
  byThread(guildId, threadId) { const row = this.db.prepare('SELECT body FROM sessions WHERE guild_id=? AND thread_id=?').get(guildId, threadId); return row ? JSON.parse(row.body) : null; }
  all() { return this.db.prepare('SELECT body FROM sessions').all().map(r => JSON.parse(r.body)); }
  create(session) {
    session.version ??= 0; session.createdAt ??= Date.now(); session.updatedAt = Date.now();
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(session.id, session.guildId, session.threadId, session.version, JSON.stringify(session));
    return session;
  }
  hasProcessed(id) { return Boolean(id && this.db.prepare('SELECT 1 FROM processed WHERE id=?').get(id)); }
  commit(session, expectedVersion, eventId, kind, payload, messages = [], job = null) {
    if (this.hasProcessed(eventId)) return false;
    const next = structuredClone(session); next.version = expectedVersion + 1; next.updatedAt = Date.now();
    this.transaction(() => {
      const result = this.db.prepare('UPDATE sessions SET version=?,body=? WHERE id=? AND version=?').run(next.version, JSON.stringify(next), next.id, expectedVersion);
      if (result.changes !== 1) throw Error('세션 버전 충돌');
      if (eventId) this.db.prepare('INSERT INTO processed VALUES(?,?)').run(eventId, Date.now());
      this.db.prepare('INSERT INTO events(session_id,version,kind,body,at) VALUES(?,?,?,?,?)').run(next.id, next.version, kind, JSON.stringify(payload ?? {}), Date.now());
      for (const message of messages) this.enqueue(next.id, next.threadId, message);
      if (job) this.saveJob(job);
    });
    Object.assign(session, next);
    return true;
  }
  events(id, limit = 20) { return this.db.prepare('SELECT kind,body,at,version FROM events WHERE session_id=? ORDER BY seq DESC LIMIT ?').all(id, limit).reverse().map(r => ({ ...r, payload: JSON.parse(r.body), body: JSON.parse(r.body) })); }
  job(id) { const r = this.db.prepare('SELECT body FROM jobs WHERE id=?').get(id); return r ? JSON.parse(r.body) : null; }
  saveJob(job) { if (!job.id) throw Error('job.id required'); this.db.prepare('INSERT INTO jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(job.id, JSON.stringify(job)); }
  jobs() { return this.db.prepare('SELECT body FROM jobs').all().map(r => JSON.parse(r.body)); }
  enqueue(sessionId, channelId, payload) { const id = randomUUID(); this.db.prepare('INSERT INTO outbox(id,session_id,channel_id,body,created_at) VALUES(?,?,?,?,?)').run(id, sessionId, channelId, JSON.stringify(payload), Date.now()); return id; }
  pending(now = Date.now()) { return this.db.prepare("SELECT a.* FROM outbox a WHERE a.status IN ('READY','SENDING','UNKNOWN') AND a.next_at<=? AND NOT EXISTS(SELECT 1 FROM outbox b WHERE b.channel_id=a.channel_id AND b.rowid<a.rowid AND b.status IN ('READY','SENDING','UNKNOWN')) ORDER BY a.rowid LIMIT 50").all(now).map(r => ({ ...r, payload: JSON.parse(r.body) })); }
  delivery(id, status, { messageId = null, nextAt = 0 } = {}) { this.db.prepare('UPDATE outbox SET status=?,message_id=COALESCE(?,message_id),next_at=?,attempts=attempts+1 WHERE id=?').run(status, messageId, nextAt, id); }
  deliverySummary() {
    const rows = this.db.prepare('SELECT status,COUNT(*) AS count FROM outbox GROUP BY status').all();
    const byStatus = { READY: 0, SENDING: 0, UNKNOWN: 0, SENT: 0, FAILED: 0 };
    for (const row of rows) byStatus[row.status] = Number(row.count);
    const pending = ['READY', 'SENDING', 'UNKNOWN'].reduce((sum, status) => sum + (byStatus[status] || 0), 0);
    return { total: rows.reduce((sum, row) => sum + Number(row.count), 0), byStatus, pending };
  }
  getValue(key, fallback = null) { const r = this.db.prepare('SELECT body FROM kv WHERE key=?').get(key); return r ? JSON.parse(r.body) : fallback; }
  setValue(key, value) { this.db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key, JSON.stringify(value)); }
  async backup(directory, retention = 14) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const day = new Date().toISOString().slice(0, 10), file = join(directory, `trpg-${day}.sqlite`);
    await backup(this.db, file);
    const rows = readdirSync(directory).filter(n => /^trpg-\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)).sort();
    for (const name of rows.slice(0, -retention)) unlinkSync(join(directory, name));
    return file;
  }
  prune(days, now = Date.now()) {
    const cutoff = now - days * 86400000;
    this.transaction(() => {
      for (const s of this.all().filter(s => s.status === 'ENDED' && (s.endedAt || s.updatedAt) < cutoff)) {
        for (const table of ['events','outbox']) this.db.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(s.id);
        for (const j of this.jobs().filter(j => j.sessionId === s.id)) this.db.prepare('DELETE FROM jobs WHERE id=?').run(j.id);
        this.db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);
      }
      this.db.prepare('DELETE FROM processed WHERE at<?').run(cutoff);
    });
  }
  close() { this.db.close(); }
}
