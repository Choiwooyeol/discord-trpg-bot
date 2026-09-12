import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFrom } from './config.mjs';
import { Store } from './persistence/db.mjs';
import { Outbox } from './persistence/outbox.mjs';
import { GameEngine } from './game/engine.mjs';
import { StoryDirector } from './ai/story-director.mjs';
import { DiscordClient } from './discord/client.mjs';
import { Application } from './application.mjs';

process.umask(0o077);
const config=configFrom();
const lock=createServer(socket=>socket.end());
const port=44000+createHash('sha256').update(config.databaseFile.toLowerCase()).digest().readUInt16BE(0)%10000;
await new Promise((resolve,reject)=>{lock.once('error',()=>reject(Error('이 DB의 봇이 이미 실행 중이거나 잠금 포트가 사용 중입니다.')));lock.listen(port,'127.0.0.1',resolve);});
const store=new Store(config.databaseFile),director=new StoryDirector(config,store),engine=new GameEngine(store,director,config);
const discord=new DiscordClient(config),outbox=new Outbox(store,discord),app=new Application(config,store,engine,discord);
store.setValue('health',{at:Date.now(),ready:false});
let stopped=false,tickBusy=false,gameBusy=false,maintenanceBusy=false,lastError='',timer,maintenanceTimer;
const inflight=new Set();
async function alert(error) {
  const message=error?.message?.startsWith('Discord HTTP') ? error.message : '처리 오류가 발생했습니다. 게임 상태는 DB에서 복구됩니다.';
  console.error(message);
  if (lastError===message) return; lastError=message;
  if (config.alertChannel) await discord.send(config.alertChannel,{content:`⚠️ TRPG 봇: ${message}`}).catch(()=>{});
}
async function tick() {
  if(stopped||tickBusy)return; tickBusy=true;
  try {
    store.setValue('health',{at:Date.now(),ready:discord.ready,release:fileURLToPath(new URL('..',import.meta.url))});
    if(discord.fatalError) { console.error(discord.fatalError); await shutdown(1); return; }
    if(discord.ready) {
      if(!gameBusy){gameBusy=true;const work=engine.tick().catch(alert).finally(()=>{gameBusy=false;inflight.delete(work);});inflight.add(work);}
      await outbox.flush();
    }
  } catch(error) { await alert(error); }
  finally {tickBusy=false;}
}
async function maintenance() {
  if(stopped||maintenanceBusy)return;maintenanceBusy=true;
  try {
    const day=new Date().toISOString().slice(0,10);
    if(store.getValue('backup-day')!==day) {await store.backup(join(dirname(config.databaseFile),'backups'),config.backupDays);store.setValue('backup-day',day);store.prune(config.retentionDays);}
  } catch(error) {await alert(error);} finally {maintenanceBusy=false;}
}
async function shutdown(code=0) {
  if(stopped)return;stopped=true;clearInterval(timer);clearInterval(maintenanceTimer);discord.close();director.close();
  await Promise.allSettled([...inflight]);
  // Resolution requests have a bounded timeout; unresolved jobs remain durable on process exit.
  store.setValue('health',{at:Date.now(),ready:false});
  lock.close();process.exit(code);
}
try {
  await discord.start(event=>{
    if(stopped)return Promise.resolve({text:'봇이 재시작 중입니다.'});
    const work=app.handle(event).catch(async error=>{await alert(error);return {text:'처리하지 못했습니다. /게임상태에서 현재 상태를 확인하세요.'};}).finally(()=>inflight.delete(work));
    inflight.add(work);return work;
  });
  const recovery=engine.recover().catch(alert).finally(()=>inflight.delete(recovery));inflight.add(recovery);
  console.log('TRPG 시작: Discord Gateway 연결 대기 중.');
  timer=setInterval(tick,2000);maintenanceTimer=setInterval(maintenance,60000);
  await tick(); await maintenance();
} catch(error) {await alert(error);await shutdown(1);}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>shutdown());
