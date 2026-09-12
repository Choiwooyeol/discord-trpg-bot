import { configFrom } from './config.mjs';
import { existsSync } from 'node:fs';
import { Store } from './persistence/db.mjs';
const c = configFrom(process.env, false);
if (!existsSync(c.databaseFile)) { console.log('아직 저장된 게임이 없습니다.'); process.exit(0); }
const store = new Store(c.databaseFile);
console.log(JSON.stringify({ health: store.getValue('health'), sessions: store.all().map(s => ({ id:s.id,status:s.status,scene:s.scene,players:s.players.length })), pendingMessages:store.pending().length }, null, 2));
store.close();
