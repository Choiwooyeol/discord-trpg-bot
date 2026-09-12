import { randomUUID } from 'node:crypto';
import { transition } from './state-machine.mjs';
import { check, ABILITIES, characterProfile, characterRole, validCharacterProfile } from './rules.mjs';
import { createCombat, currentActor, playCombat } from './combat.mjs';
import { buildContext } from './context.mjs';
import { createCampaignSetup, recentCampaignStarts, chooseOpeningStyle } from './campaigns.mjs';
import { validateCampaign } from '../ai/campaign-contract.mjs';
const active=s=>s.players.filter(p=>p.presence==='active'&&p.ready);
const clean=(v,n=80)=>String(v??'').replace(/[@\r\n]/g,' ').trim().slice(0,n);
export class GameEngine {
  constructor(store,director,config={},options={}) {
    this.store=store;this.director=director;this.config={minPartySize:2,maxPartySize:6,maxActiveSessions:10,maxInputChars:1000,...config};
    this.explorationMs=config.explorationMs??(config.explorationSeconds??45)*1000;
    this.lobbyIdleMs=config.lobbyIdleMs??24*60*60*1000;
    this.consensusMs=config.consensusMs??(config.consensusSeconds??30)*1000;this.combatMs=config.combatMs??(config.combatSeconds??90)*1000;
    this.now=options.now??Date.now;this.roll=options.roll;this.inFlight=new Map();
  }
  create({guildId,threadId,hostId,name,tone='',scenarioId,language,minPartySize=this.config.minPartySize}) {
    minPartySize=Number(minPartySize);
    if(!Number.isInteger(minPartySize)||minPartySize<1||minPartySize>this.config.maxPartySize)throw Error('Invalid min party size.');
    if(this.store.all().filter(s=>s.status!=='ENDED').length>=this.config.maxActiveSessions)throw Error('최대 세션 수에 도달했습니다.');
    const id=randomUUID(), previousGenre=recentCampaignStarts(this.store.all(),guildId)[0]?.genreId;
    const campaign=createCampaignSetup({genre:scenarioId,tone,name:clean(name),language,previousGenre});
    return this.store.create({id,guildId,threadId,hostId,status:'LOBBY',version:0,phase:0,scene:0,phaseStartedAt:this.now(),deadline:null,minPartySize,maxPartySize:this.config.maxPartySize,players:[],actions:{},world:campaign,summary:'',recent:[],choices:[],combat:null});
  }
  _phase(s,status){transition(s,status);s.phaseStartedAt=this.now();}
  _save(s,e,text,job=null) {
    const snapshot=structuredClone(s);
    const historyActions=new Set(['CAMPAIGN_RESULT','RESOLVE','SCENE_RESULT','attack','defend','help','item']);
    const messages=!text?[]:historyActions.has(e?.action)
      ? [{content:text,history:true,trpgSession:snapshot,actionControls:e?.action!=='RESOLVE'}, {content:'현재 행동 현황입니다. 결과 카드의 선택 버튼으로 이어가세요.',trpgSession:snapshot,actionControls:false}]
      : [{content:text,trpgSession:snapshot}];
    this.store.commit(s,s.version,e?.id,e?.action||'SYSTEM',e||{},messages,job);
    return {text:text||'처리했습니다.',session:s};
  }
  _deny(text){return {text};}
  async handle(e) {
    const s=this.store.byThread(e.guildId,e.threadId);
    if(!s||e.sessionId&&e.sessionId!==s.id)return this._deny('진행 중인 세션을 찾지 못했습니다.');
    if(this.store.hasProcessed(e.id))return this._deny('이미 처리된 요청입니다.');
    if(e.phase!==undefined&&Number(e.phase)!==s.phase)return this._deny('이미 지난 장면의 버튼입니다.');
    const a=e.action;let p=s.players.find(p=>p.userId===e.userId);const host=e.userId===s.hostId;
    if(a==='status')return {text:this.describe(s),session:s};
    if(a==='log')return {text:s.recent.join('\n\n')||'아직 확정된 사건이 없습니다.',session:s};
    if(a==='adventureSummary'){
      const facts=(s.world.facts||[]).slice(-8);
      const characters=s.players.map(p=>`${p.name}: ${p.character?.role||'직업 미정'}${p.character?.specialty?` · 특기 ${p.character.specialty}`:''}`).join('\n');
      return {text:[`**${s.world.name} · 모험 요약**`,`장르: ${s.world.genre||'랜덤'} · 장면 ${s.scene}`,`현재 위치: ${s.world.location||'알 수 없음'}`,`현재 목표: ${s.world.objective||s.world.premise||'이야기 속에서 찾아가세요.'}`,s.world.factions?.length?`주요 세력: ${s.world.factions.join(', ')}`:'',facts.length?`최근 단서\n${facts.map(f=>`• ${f}`).join('\n')}`:'',characters?`파티\n${characters}`:''].filter(Boolean).join('\n\n'),session:s};
    }
    if(a==='characterInfo'){
      if(!p)return this._deny('먼저 [참가] 또는 직업 버튼으로 모험에 참가해 주세요.');
      const c=p.character;
      if(!c)return this._deny('먼저 직업 버튼을 눌러 캐릭터를 만들어 주세요.');
      const abilities=c.abilities||{};
      const next=s.status==='LOBBY'?(p.ready?'파티장이 모든 사람을 준비시키면 모험을 시작합니다.':'[준비 완료]를 눌러 모험을 시작할 준비를 마쳐 주세요.'):
        s.status==='PAUSED'?'/재개 후 다음 행동을 입력하세요.':s.status==='ENDED'?'종료된 모험입니다.':'현재 장면의 선택지를 고르거나 자유 행동을 입력하세요.';
      return {text:[`[${c.name||p.name}] ${c.role||'직업 미정'}`,`힘 ${abilities.strength??0} · 민첩 ${abilities.agility??0} · 지식 ${abilities.knowledge??0} · 의지 ${abilities.will??0}`,`HP ${c.hp??10}/${c.maxHp??10} · 물약 ${c.inventory?.potion??0}개`,`특기: ${c.specialty||'없음'}`,`약점: ${c.weakness||'없음'}`,`다음: ${next}`].join('\n'),session:s};
    }
    if(s.status==='ENDED')return this._deny('종료된 모험입니다. 로비에서 새 게임을 시작하세요.');
    if(a==='join'){
      if(s.status!=='LOBBY')return this._deny('시작 전 로비에서만 참가할 수 있습니다.');
      if(p)return this._deny('이미 참가했습니다.');
      if(s.players.length>=this.config.maxPartySize)return this._deny('파티가 가득 찼습니다.');
      s.players.push({userId:e.userId,name:clean(e.name)||e.userId,character:null,ready:false,presence:'active',missed:0,spotlight:[]});
      return this._save(s,e,`${clean(e.name)}님이 참가했어요. 아래 빠른 역할 버튼을 누르거나 /캐릭터에서 자유 직업을 적어 주세요. 이름은 닉네임으로 설정돼요.`);
    }
    if(a==='chooseRole'){
      if(s.status!=='LOBBY')return this._deny('직업은 모험 시작 전 로비에서만 바꿀 수 있습니다.');
      const role=characterProfile(e.value);
      if(!role)return this._deny('아래 빠른 역할 버튼을 누르거나 /캐릭터에서 자유 직업을 적어 주세요.');
      if(!p){
        if(s.players.length>=this.config.maxPartySize)return this._deny('파티가 가득 찼습니다.');
        s.players.push({userId:e.userId,name:clean(e.name)||e.userId,character:null,ready:false,presence:'active',missed:0,spotlight:[]});
        p=s.players.at(-1);
      }
      const previous=p.character;
      p.character={...(previous||{}),name:clean(previous?.name)||p.name,role:role.name,roleId:role.id,specialty:clean(previous?.specialty,120),weakness:clean(previous?.weakness,120),hp:Number(previous?.hp??10),maxHp:Number(previous?.maxHp??10),abilities:{...role.abilities},inventory:previous?.inventory||{potion:2}};
      p.ready=false;
      return this._save(s,e,`${p.name}님은 ${role.name}을(를) 선택했습니다. 이제 [준비 완료]를 눌러 주세요.`);
    }
    if(!p)return this._deny('참가자만 사용할 수 있습니다.');
    if(a==='character'){
      if(s.status!=='LOBBY')return this._deny('캐릭터는 시작 전 로비에서만 변경할 수 있습니다.');
      const c=e.value||{},role=characterProfile(c.role, c.focus) ?? (!String(c.role??'').trim() ? characterRole('warrior') : null);
      if(!role)return this._deny('직업은 두 글자 이상으로 적어 주세요. 전사·도적·마법사 또는 남궁세가 가신, 화성 광산 기술자, 네트러너처럼 자유롭게 쓸 수 있어요.');
      p.character={name:clean(c.name)||p.name,role:role.name,roleId:role.id,specialty:clean(c.specialty,120),weakness:clean(c.weakness,120),hp:10,maxHp:10,abilities:{...role.abilities},inventory:{potion:2}};p.ready=false;
      return this._save(s,e,`${p.character.name} (${role.name}) 생성 · HP 10 · 치유 물약 2개. 이제 [준비 완료]를 눌러 주세요.`);
    }
    if(a==='ready'){
      if(s.status!=='LOBBY'||!p.character)return this._deny('먼저 직업 버튼을 누르거나 /캐릭터로 자유 직업을 만들어 주세요.');
      if(!validCharacterProfile(p.character))return this._deny('직업을 다시 선택하거나 설정해 주세요. /캐릭터에서 자유 직업을 적거나 아래 버튼을 눌러 주세요.');
      p.ready=!p.ready;return this._save(s,e,`${p.name}: ${p.ready?'준비 완료':'준비 취소'}`);
    }
    if(a==='start'){
      if(!host||s.status!=='LOBBY')return this._deny('로비의 파티장만 시작할 수 있습니다.');
      if(s.players.length<s.minPartySize||s.players.some(p=>!p.ready||!p.character))return this._deny(`최소 ${s.minPartySize}명이 필요합니다. 모두 직업을 고르고 [준비 완료]를 눌러 주세요.`);
      if(s.players.some(p=>!validCharacterProfile(p.character)))return this._deny('직업을 다시 선택하거나 설정해 주세요. /캐릭터에서 자유 직업을 적거나 아래 버튼을 눌러 주세요.');
      this._phase(s,'RESOLVING');s.jobId=`${s.id}:campaign`;
      const {genreId,genre,language,tone,requestedName}=s.world;
      const recentStarts=recentCampaignStarts(this.store.all(),s.guildId,s.id);
      const request={seed:randomUUID(),openingStyle:chooseOpeningStyle(recentStarts),world:{genreId,genre,language,tone,requestedName},players:structuredClone(s.players),recentStarts};
      const job={id:s.jobId,sessionId:s.id,scene:0,kind:'CAMPAIGN',status:'PENDING',request,createdAt:this.now()};
      this._save(s,e,language==='en'?'Creating a new world and opening from your party’s characters…':'준비한 캐릭터를 바탕으로 새로운 세계와 첫 사건을 만들고 있어요. 잠시 기다려 주세요.',job);
      return this._run(s.id);
    }
    if(['pause','resume','end'].includes(a)){
      if(!host)return this._deny('파티장만 진행 상태를 변경할 수 있습니다.');
      if(a==='end'){this._phase(s,'ENDED');s.endedAt=this.now();return this._save(s,e,'모험을 종료했습니다. 기록은 설정된 보존기간 뒤 삭제됩니다.');}
      if(a==='pause'){
        if(s.status==='PAUSED')return this._deny('이미 일시정지 상태입니다.');
        s.previousStatus=s.status;s.remainingMs=s.deadline?Math.max(1000,s.deadline-this.now()):null;this._phase(s,'PAUSED');return this._save(s,e,'모험을 일시정지했습니다. /재개로 이어갈 수 있습니다.');
      }
      if(s.status!=='PAUSED')return this._deny('일시정지된 모험만 재개할 수 있습니다.');
      this._phase(s,s.previousStatus||'EXPLORATION_COLLECTING');s.deadline=s.remainingMs?this.now()+s.remainingMs:null;
      const reply=this._save(s,e,'모험을 재개합니다.');if(s.status==='RESOLVING')this._run(s.id);return reply;
    }
    if(a==='leave'){
      if(s.status==='RESOLVING')return this._deny('장면 처리 후 나가거나 먼저 일시정지하세요.');
      if(s.status==='LOBBY')s.players=s.players.filter(x=>x.userId!==e.userId);else {p.presence='away';delete s.actions[e.userId];}
      if(host)s.hostId=s.players.find(x=>x.userId!==e.userId&&x.presence==='active')?.userId||s.hostId;
      if(!s.players.length){this._phase(s,'ENDED');s.endedAt=this.now();}
      else if(!s.players.some(x=>x.presence==='active')&&s.status!=='PAUSED'){s.previousStatus=s.status;this._phase(s,'PAUSED');}
      return this._save(s,e,`${p.name}님이 자리를 비웠습니다. 파티장: ${s.players.find(x=>x.userId===s.hostId)?.name||'없음'}`);
    }
    if(a==='return'){
      if(s.status==='RESOLVING')return this._deny('장면 처리가 끝난 뒤 복귀하세요.');
      p.presence='active';p.missed=0;
      const currentHost=s.players.find(x=>x.userId===s.hostId);
      if(!currentHost||currentHost.presence!=='active')s.hostId=p.userId;
      return this._save(s,e,`${p.name}님이 복귀했습니다. ${s.hostId===p.userId?'새 파티장이 되었습니다.':''}`.trim());
    }
    if(s.status==='PAUSED'||s.status==='RESOLVING')return this._deny('이번 장면은 입력이 마감되었거나 일시정지 중입니다.');
    if(s.status==='CONSENSUS_VOTE'){
      if(a!=='vote'||p.presence!=='active')return this._deny('충돌한 행동 중 하나에 투표하세요.');
      const index=Number(e.value);if(!Number.isInteger(index)||!s.vote.options[index])return this._deny('없는 투표 항목입니다.');
      s.vote.votes[e.userId]=index;this._save(s,e,`${p.name}님 투표 완료.`);
      if(s.vote.hostDecision&&host)return this._select(s,index);
      const counts=s.vote.options.map((_,i)=>Object.values(s.vote.votes).filter(v=>v===i).length),winner=counts.findIndex(n=>n>active(s).length/2);
      if(winner>=0)return this._select(s,winner);
      return {text:'투표를 기록했습니다.',session:s};
    }
    if(s.status==='EXPLORATION_COLLECTING'){
      if(!p.character||!p.ready)return this._deny('준비된 캐릭터가 필요합니다.');
      if(a==='advance'){
        if(!host)return this._deny('파티장만 조기 진행할 수 있습니다.');
        if(!Object.keys(s.actions).length)return this._deny('먼저 행동을 입력하세요.');
        this._save(s,e);return this._begin(s);
      }
      if(a!=='input')return this._deny('자유 행동을 입력하거나 선택지를 누르세요.');
      if(e.receivedAt!=null&&e.receivedAt<s.phaseStartedAt)return this._deny('이미 마감된 장면의 입력입니다.');
      if(s.deadline&&this.now()>=s.deadline){this._begin(s);return this._deny('입력 시간이 마감되었습니다.');}
      const value=String(e.value??'').trim();if(!value||value.startsWith('//'))return {};
      if(value.length>this.config.maxInputChars)return this._deny('행동이 너무 깁니다.');
      p.presence='active';p.missed=0;s.actions[e.userId]={userId:e.userId,value,name:p.name};s.deadline??=this.now()+this.explorationMs;
      this._save(s,e,`${p.name} 행동 접수 (${Object.keys(s.actions).length}/${active(s).length}). 새 입력으로 수정할 수 있습니다.`);
      if(active(s).every(x=>s.actions[x.userId]))return this._begin(s);
      return {text:'행동을 접수했습니다.',session:s};
    }
    if(s.status==='COMBAT_TURN'){
      if(e.receivedAt!=null&&e.receivedAt<s.phaseStartedAt)return this._deny('이미 지난 전투 턴의 입력입니다.');
      if(s.deadline&&this.now()>=s.deadline){this._combat(s,{id:`timeout:${s.id}:${s.phase}`,action:'defend',userId:currentActor(s.combat)});return this._deny('턴 시간이 초과되어 방어했습니다.');}
      if(currentActor(s.combat)!==e.userId||p.presence!=='active')return this._deny('아직 당신의 턴이 아닙니다.');
      let action=a;
      if(a==='input'){const t=String(e.value);action=/공격|때리|베기|attack/i.test(t)?'attack':/방어|막기|defend/i.test(t)?'defend':/돕|도움|help/i.test(t)?'help':/물약|아이템|item/i.test(t)?'item':'';}
      if(!['attack','defend','help','item'].includes(action))return this._deny('공격·방어·돕기·물약 사용을 입력하거나 버튼을 누르세요.');
      return this._combat(s,{...e,action});
    }
    return this._deny('현재 사용할 수 없는 명령입니다.');
  }
  _begin(s){
    this._phase(s,'RESOLVING');s.jobId=`${s.id}:${s.scene}`;
    const job={id:s.jobId,sessionId:s.id,scene:s.scene,status:'PENDING',request:buildContext(s),createdAt:this.now()};
    const actionRecord=Object.values(s.actions).map(action=>`• ${clean(action.name,40)}: ${clean(action.value,180)}`).join('\n');
    this._save(s,{id:`begin:${s.jobId}`,action:'RESOLVE'},`**이번 장면 행동**\n${actionRecord||'행동을 확인하고 있습니다.'}`,job);return this._run(s.id);
  }
  _run(id){
    if(this.inFlight.has(id))return this.inFlight.get(id);
    const task=(async()=>{
      let result,phase;
      do {
        phase=this.store.get(id)?.phase;result=await this._process(id);
        // A resume during an older request needs a fresh run after that request exits.
      } while(this.store.get(id)?.status==='RESOLVING'&&this.store.get(id)?.phase!==phase);
      return result;
    })().finally(()=>{this.inFlight.delete(id);});this.inFlight.set(id,task);return task;
  }
  async _process(id){
    let s=this.store.get(id);if(s?.status!=='RESOLVING')return {text:'처리가 보류되었습니다.'};
    const phase=s.phase,job=this.store.job(s.jobId);
    if(!job){s.previousStatus='RESOLVING';this._phase(s,'PAUSED');return this._save(s,{action:'AI_ERROR'},'저장된 진행 작업을 찾지 못해 일시정지했습니다. 기록을 보존한 채 운영자 점검이 필요합니다.');}
    const current=()=>{const x=this.store.get(id);return x?.status==='RESOLVING'&&x.phase===phase&&x.jobId===job.id?x:null;};
    try{
      if(job.kind==='CAMPAIGN'){
        if(!job.response){
          const generated=validateCampaign(await this.director.campaign(job.request),job.request);
          if(!current())return this._deny('이전 세계 생성 응답을 보류했습니다.');
          job.response=generated;job.status='GENERATED';this.store.saveJob(job);
        }
        s=current();if(!s)return this._deny('이전 세계 생성 응답을 보류했습니다.');
        const generated=validateCampaign(job.response,job.request);
        s.world={...s.world,...structuredClone(generated),openingStyle:job.request.openingStyle,startLocation:generated.location,generatedAt:this.now(),generation:'ai-v1'};
        s.choices=structuredClone(generated.starterChoices);s.summary=generated.premise;s.recent=[generated.opening];s.scene=1;
        this._phase(s,'EXPLORATION_COLLECTING');job.status='DONE';delete job.error;
        return this._save(s,{id:`done:${job.id}`,action:'CAMPAIGN_RESULT'},`**${generated.name}**\n\n${generated.opening}`,job);
      }
      if(job.status==='PENDING'){
        job.interpretation=await this.director.interpret(job.request);if(!current())return this._deny('이전 장면 응답을 보류했습니다.');
        job.status='INTERPRETED';this.store.saveJob(job);
      }
      s=current();if(!s)return this._deny('이전 장면 응답을 보류했습니다.');
      const interpreted=job.interpretation?.actions||[];
      if(!job.selected&&interpreted.some(a=>a.classification==='CONFLICTING')){
        const options=[...new Set(interpreted.filter(a=>a.classification==='CONFLICTING').map(a=>a.intent))].map(intent=>({label:intent.slice(0,70),intent}));
        s.vote={options,votes:{},hostDecision:false};this._phase(s,'CONSENSUS_VOTE');s.deadline=this.now()+this.consensusMs;
        return this._save(s,{action:'CONSENSUS'},'행동이 서로 충돌합니다. 함께 진행할 행동에 투표하세요.',job);
      }
      if(!job.checks){
        job.checks=[];const groups=new Set();
        for(const a of interpreted){
          if(a.classification==='INVALID'||!a.ability)continue;
          if(!ABILITIES.includes(a.ability)||!s.actions[a.userId])throw Error('허용되지 않는 판정');
          const group=interpreted.filter(x=>x.classification==='COOPERATIVE'&&x.group===a.group);let actor=a,bonus=0;
          if(a.classification==='COOPERATIVE'){
            if(groups.has(a.group))continue;groups.add(a.group);
            actor=group.sort((x,y)=>(s.players.find(p=>p.userId===x.userId)?.spotlight?.filter(n=>n>=s.scene-3).length||0)-(s.players.find(p=>p.userId===y.userId)?.spotlight?.filter(n=>n>=s.scene-3).length||0))[0];bonus=Math.min(2,group.length-1);
          }
          const player=s.players.find(p=>p.userId===actor.userId),difficulty=[8,12,16,20].reduce((v,n)=>Math.abs(n-actor.difficulty)<Math.abs(v-actor.difficulty)?n:v,12);
          job.checks.push({userId:actor.userId,intent:actor.intent,result:check({character:player.character,ability:actor.ability,difficulty,bonus,roll:this.roll})});
        }
        job.status='ROLLED';this.store.saveJob(job);
      }
      if(!job.response){
        job.response=await this.director.narrate({...job.request,interpretation:job.interpretation,checks:job.checks});
        if(!current())return this._deny('이전 장면 응답을 보류했습니다.');job.status='NARRATED';this.store.saveJob(job);
      }
      s=current();if(!s)return this._deny('이전 장면 응답을 보류했습니다.');const n=job.response;
      s.world.location=n.location;s.world.facts=[...new Set([...(s.world.facts||[]),...n.facts])].slice(-20);
      s.summary=n.summary.slice(0,3000);s.choices=n.choices;s.recent=[...s.recent,n.narration].slice(-6);
      for(const p of s.players){p.missed=s.actions[p.userId]?0:(p.missed||0)+1;if(p.missed>=3)p.presence='away';p.spotlight=[...(p.spotlight||[]),...job.checks.filter(c=>c.userId===p.userId).map(()=>s.scene)].filter(scene=>scene>=s.scene-3);}
      s.actions={};s.scene++;s.vote=null;
      if(job.interpretation.combat&&active(s).length){s.combat=createCombat(job.interpretation.combat,active(s),this.roll);this._phase(s,'COMBAT_TURN');s.deadline=this.now()+this.combatMs;}
      else this._phase(s,'EXPLORATION_COLLECTING');job.status='DONE';
      const dice=job.checks.map(c=>`${s.players.find(p=>p.userId===c.userId)?.name}: 🎲 ${c.result.die} → ${c.result.total}/${c.result.difficulty} ${c.result.success?'성공':'실패'}`).join('\n');
      return this._save(s,{id:`done:${job.id}`,action:'SCENE_RESULT',checks:job.checks},`${dice}${dice?'\n':''}${n.narration}`,job);
    }catch(error){
      s=current();if(!s)return this._deny('장면 처리를 보류했습니다.');job.error='AI 또는 판정 처리 실패';s.previousStatus='RESOLVING';this._phase(s,'PAUSED');
      const message=job.kind==='CAMPAIGN'
        ? (s.world.language==='en'?'World generation failed; your characters are saved. Check AI access and usage limits, then press Resume to retry (uses another AI request).':'새 세계 생성에 실패해 일시정지했습니다. 캐릭터와 준비 내용은 보존됐어요. AI 로그인·사용 한도를 확인한 뒤 [재개]로 다시 생성하세요. 재시도 시 AI 요청이 추가됩니다.')
        : 'AI 장면 처리에 실패하여 일시정지했습니다. 입력과 확정 주사위는 보존됩니다. 설정/예산을 확인하고 /재개하세요.';
      return this._save(s,{action:'AI_ERROR'},message,job);
    }
  }
  _select(s,index){
    const job=this.store.job(s.jobId),option=s.vote.options[index];job.selected=true;
    if(option){
      job.interpretation.actions=job.interpretation.actions.filter(a=>a.classification!=='CONFLICTING'||a.intent===option.intent);
      const allowed=new Set(job.interpretation.actions.map(a=>a.userId));
      job.request.actions=Object.fromEntries(Object.entries(job.request.actions).filter(([id])=>allowed.has(id)));
    }
    else {job.interpretation={actions:[],combat:null};job.request.actions={};job.request.holdReason='합의가 되지 않아 현 위치에서 안전하게 대기한다.';}
    job.request.interpretation=job.interpretation;
    this._phase(s,'RESOLVING');this._save(s,{action:'VOTE_RESULT'},option?`선택: ${option.intent}`:'합의가 되지 않아 일행은 현 위치를 유지합니다.',job);return this._run(s.id);
  }
  _combat(s,e){
    let result;try{result=playCombat(s,e.action,this.roll);}catch(error){return this._deny(error.message);}
    let text=result.events.map(x=>x.text).join('\n');
    if(result.over==='victory'){s.combat=null;this._phase(s,'EXPLORATION_COLLECTING');text+='\n전투에서 승리했습니다. 다음 행동을 입력하세요.';}
    else if(result.over==='defeat'){s.combat=null;for(const p of s.players)if(p.character)p.character.hp=Math.max(1,p.character.hp);this._phase(s,'EXPLORATION_COLLECTING');s.world.location='안전한 야영지';text+='\n일행은 패퇴해 야영지로 후퇴했습니다. 체력 1로 깨어납니다.';}
    else {this._phase(s,'COMBAT_TURN');s.deadline=this.now()+this.combatMs;}
    s.recent=[...s.recent,text].slice(-6);return this._save(s,{...e,results:result.events},text);
  }
  async tick(){
    const work=[];
    for(const s of this.store.all()){
      if(s.status==='LOBBY'){
        const lastActivity=Number(s.updatedAt??s.createdAt??s.phaseStartedAt??0);
        if(lastActivity>0&&this.now()-lastActivity>=this.lobbyIdleMs){
          this._phase(s,'ENDED');s.endedAt=this.now();
          this._save(s,{id:`lobby-expire:${s.id}:${s.phase}`,action:'LOBBY_EXPIRED'},'오래 활동이 없어 준비 중인 로비를 자동으로 종료했습니다. 새 모험은 로비에서 /게임시작으로 만들 수 있습니다.');
        }
        continue;
      }
      if(s.status==='RESOLVING'){work.push(this._run(s.id));continue;}
      if(!s.deadline||this.now()<s.deadline)continue;
      if(s.status==='EXPLORATION_COLLECTING'&&Object.keys(s.actions).length)work.push(this._begin(s));
      else if(s.status==='CONSENSUS_VOTE'){
        if(!s.vote.hostDecision){s.vote.hostDecision=true;s.deadline=this.now()+this.consensusMs;this._save(s,{action:'HOST_VOTE'},'과반이 없어 파티장이 결정할 차례입니다. 제한 시간 동안 선택이 없으면 대기합니다.');}
        else work.push(this._select(s,-1));
      }else if(s.status==='COMBAT_TURN')this._combat(s,{id:`timeout:${s.id}:${s.phase}`,action:'defend',userId:currentActor(s.combat)});
    }
    await Promise.allSettled(work);
  }
  async recover(){await Promise.allSettled(this.store.all().filter(s=>s.status==='RESOLVING').map(s=>this._run(s.id)));return this.store.all();}
  async idle(){await Promise.allSettled([...this.inFlight.values()]);}
  describe(s){const phase={LOBBY:'모험 준비',EXPLORATION_COLLECTING:'행동 입력 중',CONSENSUS_VOTE:'의견 선택 중',RESOLVING:'장면 정리 중',COMBAT_TURN:'전투 중',PAUSED:'일시정지',ENDED:'종료'}[s.status]||'진행 중';return [`${s.world.name} · ${phase} · 장면 ${s.scene}`,`장소: ${s.world.location}`,`파티장: ${s.players.find(p=>p.userId===s.hostId)?.name||'미참가'}`,...s.players.map(p=>`${p.name} · ${p.character?.role||'직업 선택 중'} · ${p.character?`HP ${p.character.hp??10}/${p.character.maxHp??10}`:'캐릭터 준비 중'} · ${p.ready?'준비 완료':'준비 필요'}`),s.combat?`현재 턴: ${s.players.find(p=>p.userId===currentActor(s.combat))?.name} · 적 ${s.combat.enemies.map(e=>`${e.id} HP${e.hp}`).join(', ')}`:'',s.recent.at(-1)||''].filter(Boolean).join('\n');}
}
