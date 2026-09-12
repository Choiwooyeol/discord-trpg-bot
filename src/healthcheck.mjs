import { DatabaseSync } from 'node:sqlite';
import { configFrom } from './config.mjs';
const c = configFrom(process.env, false);
try {
  const db = new DatabaseSync(c.databaseFile, { readOnly: true });
  const row = db.prepare("SELECT body FROM kv WHERE key='health'").get();
  const health = row ? JSON.parse(row.body) : null; db.close();
  if (!health?.ready || Date.now()-health.at > 20000 || (process.env.TRPG_RELEASE && health.release !== process.env.TRPG_RELEASE)) process.exitCode=1;
} catch { process.exitCode=1; }
