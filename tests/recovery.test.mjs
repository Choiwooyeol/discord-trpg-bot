import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/persistence/db.mjs';
import {GameEngine} from '../src/game/engine.mjs';
import {DemoDirector} from '../src/ai/demo-director.mjs';
async function setup(store,director,thread='t',clock={now:100000}){
  const engine=new GameEngine(store,director,{}, {now:()=>clock.now,roll:()=>11});let n=0;
  const s=engine.create({guildId:'g',threadId:thread,hostId:'a'});
  const act=(userId,action,value)=>engine.handle({id:`${thread}-${++n}`,guildId:'g',threadId:thread,userId,name:userId,action,value});
  for(const u of ['a','b']){await act(u,'join');await act(u,'character',{name:u,role:'전사'});await act(u,'ready');}
  await act('a','start');return {engine,act,id:s.id,clock};
}
test('last lobby participant leaving releases the active-session slot',async()=>{
  const db=new Store(),engine=new GameEngine(db,new DemoDirector());
  try{
    const s=engine.create({guildId:'g',threadId:'empty',hostId:'a'});
    await engine.handle({id:'join',guildId:'g',threadId:'empty',userId:'a',action:'join'});
    await engine.handle({id:'leave',guildId:'g',threadId:'empty',userId:'a',action:'leave'});
    assert.equal(db.get(s.id).status,'ENDED');
  }finally{db.close();}
});
test('restart from durable ROLLED job reuses dice and actually finishes the scene',async()=>{
  const db=new Store();const director=new DemoDirector();let throws=true,rolls=0,seen;
  director.interpret=async c=>({actions:Object.values(c.actions).map(a=>({userId:a.userId,intent:a.value,classification:'PARALLEL',ability:'knowledge',difficulty:12,group:a.userId})),combat:null});
  const narrator=director.narrate.bind(director);director.narrate=async c=>{seen=c.checks;if(throws)throw Error('timeout');return narrator(c);};
  const x=await setup(db,director);x.engine.roll=()=>{rolls++;return 9;};
  try{
    await x.act('a','input','조사');await x.act('b','input','감시');
    assert.equal(db.get(x.id).status,'PAUSED');assert.equal(rolls,2);assert.equal(db.job(db.get(x.id).jobId).status,'ROLLED');
    const original=structuredClone(seen);throws=false;
    const restarted=new GameEngine(db,director,{}, {now:()=>x.clock.now,roll:()=>{throw Error('must never reroll');}});
    await restarted.handle({id:'resume',guildId:'g',threadId:'t',userId:'a',action:'resume'});await restarted.idle();
    assert.equal(db.get(x.id).status,'EXPLORATION_COLLECTING');assert.equal(db.get(x.id).scene,2);assert.deepEqual(seen,original);
    assert.equal(db.job(db.get(x.id).jobId).status,'DONE');
  }finally{db.close();}
});
test('three independent parties proceed while one AI request is pending',async()=>{
  const db=new Store(),base=new DemoDirector();let release;
  const gate=new Promise(r=>release=r),slow={interpret:async c=>{await gate;return base.interpret(c);},narrate:c=>base.narrate(c)};
  const a=await setup(db,slow,'one'),b=await setup(db,base,'two'),c=await setup(db,base,'three');
  await a.act('a','input','조사');const waiting=a.act('b','input','지원');
  try{
    for(const x of [b,c]){await x.act('a','input','독립 행동');await x.act('b','input','경계');assert.equal(db.get(x.id).scene,2);}
    assert.equal(db.get(a.id).status,'RESOLVING');
  }finally{release();await waiting;db.close();}
});
test('empty exploration is idle; expired combat advances once and old button is stale',async()=>{
  const db=new Store(),director=new DemoDirector();let calls=0;
  const original=director.interpret.bind(director);director.interpret=async c=>{calls++;return {...await original(c),combat:{kind:'wolf',count:1}};};
  const x=await setup(db,director);
  try{
    x.clock.now+=1000000;await x.engine.tick();assert.equal(calls,0);
    await x.act('a','input','늑대를 막는다');await x.act('b','input','전투 준비');
    const before=db.get(x.id);x.clock.now=before.deadline+1;await x.engine.tick();const after=db.get(x.id);
    assert.equal(after.phase,before.phase+1);assert.notEqual(after.combat.turnIndex,before.combat.turnIndex);
    const rejected=await x.engine.handle({id:'old-button',guildId:'g',threadId:'t',userId:'a',action:'attack',phase:before.phase});assert.match(rejected.text,/지난/);
  }finally{db.close();}
});
