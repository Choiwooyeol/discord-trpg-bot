import { Store } from './persistence/db.mjs';
import { GameEngine } from './game/engine.mjs';
import { DemoDirector } from './ai/demo-director.mjs';
const store=new Store(),engine=new GameEngine(store,new DemoDirector());
const session=engine.create({guildId:'demo-guild',threadId:'demo-thread',hostId:'alice'});
let seq=0;
const act=(userId,action,value)=>engine.handle({id:`demo-${++seq}`,guildId:session.guildId,threadId:session.threadId,userId,name:userId==='alice'?'아린':'보르',action,value});
try {
  console.log('오프라인 2인 플레이 데모 — Discord/API 접속 및 과금 없음');
  for(const user of ['alice','bob']){await act(user,'join');await act(user,'character',{name:user==='alice'?'아린':'보르',role:user==='alice'?'도적':'전사'});await act(user,'ready');}
  console.log((await act('alice','start')).text);
  console.log('\n아린: 등불 주변을 살핀다');await act('alice','input','등불 주변을 살핀다');
  console.log('보르: 아린을 엄호한다');console.log((await act('bob','input','아린을 엄호한다')).text);
  console.log(`\n저장 확인: 장면 ${store.get(session.id).scene}, 참가자 2명, 이벤트 ${store.events(session.id).length}개`);
} finally {await engine.idle();store.close();}
