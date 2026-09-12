import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { configFrom } from './config.mjs';
import { Store } from './persistence/db.mjs';
const c = configFrom(process.env, false);
if (!existsSync(c.databaseFile)) throw Error('백업할 DB가 없습니다.');
const store = new Store(c.databaseFile);
try { console.log(await store.backup(join(dirname(c.databaseFile), 'backups'), c.backupDays)); }
finally { store.close(); }
