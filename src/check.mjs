import { configFrom } from './config.mjs';
import { Store } from './persistence/db.mjs';
try {
  const c = configFrom();
  const store = new Store(':memory:');
  const check = store.db.prepare('PRAGMA integrity_check').get(); store.close();
  if (check.integrity_check !== 'ok') throw Error('SQLite 검사 실패');
  console.log(`설정/SQLite 검사 통과. AI ${c.aiProvider}, 허용 서버 ${c.guildIds.length}개, 로비 ${c.lobbyIds.length}개. 외부 접속은 수행하지 않았습니다.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
