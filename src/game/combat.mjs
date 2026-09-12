import { check, applyDamage, applyHealing, abilityModifier } from './rules.mjs';
import { d20 } from './dice.mjs';
const ENEMIES={goblin:{hp:6,damage:2},wolf:{hp:8,damage:3},skeleton:{hp:10,damage:3}};
export function createCombat(proposal,players,roll) {
  if(!ENEMIES[proposal?.kind]||!Number.isInteger(proposal.count)||proposal.count<1||proposal.count>3)throw Error('잘못된 전투 제안');
  const enemies=Array.from({length:proposal.count},(_,i)=>({id:`${proposal.kind}-${i+1}`,kind:proposal.kind,...ENEMIES[proposal.kind]}));
  const initiative=players.filter(p=>p.character?.hp>0&&p.presence==='active').map(p=>({userId:p.userId,...d20(abilityModifier(p.character,'agility'),roll)})).sort((a,b)=>b.total-a.total||a.userId.localeCompare(b.userId));
  return {enemies,initiative,order:initiative.map(p=>p.userId),turnIndex:0,round:1,defending:[],support:0};
}
export function currentActor(combat){return combat?.order[combat.turnIndex];}
export function combatOver(combat){return combat.enemies.every(e=>e.hp<=0);}
export function playCombat(session,action,roll) {
  const c=session.combat,p=session.players.find(p=>p.userId===currentActor(c)),events=[];
  if(!p?.character||p.presence!=='active'||p.character.hp<=0) action='skip';
  if(action==='attack'){
    const enemy=c.enemies.find(e=>e.hp>0),result=check({character:p.character,ability:'strength',difficulty:12,bonus:c.support,roll});c.support=0;
    const damage=result.success?(result.natural==='critical'?4:2):0;enemy.hp=Math.max(0,enemy.hp-damage);
    events.push({actor:p.userId,action,target:enemy.id,result,damage,text:`${p.name} 공격 🎲 ${result.die} → ${result.total}/12 · ${damage} 피해`});
  }else if(action==='defend'){c.defending.push(p.userId);events.push({actor:p.userId,action,text:`${p.name}: 방어 (이번 라운드 피해 -2)`});
  }else if(action==='help'){c.support=Math.min(2,c.support+1);events.push({actor:p.userId,action,text:`${p.name}: 다음 동료의 공격 +1`});
  }else if(action==='item'){
    if(!(p.character.inventory?.potion>0))throw Error('치유 물약이 없습니다.');
    if(p.character.hp>=p.character.maxHp)throw Error('체력이 가득 찼습니다.');
    p.character.inventory.potion--;applyHealing(p,4);events.push({actor:p.userId,action,text:`${p.name}: 물약 1개 사용, 체력 4 회복`});
  }else if(action!=='skip')throw Error('공격/방어/돕기/아이템 중 선택하세요.');
  if(combatOver(c))return {events,over:'victory'};
  c.turnIndex++;
  if(c.turnIndex>=c.order.length){
    c.turnIndex=0;c.round++;
    for(const enemy of c.enemies.filter(e=>e.hp>0)){
      const living=session.players.filter(p=>p.presence==='active'&&p.character?.hp>0);if(!living.length)break;
      const target=living[(c.round-2)%living.length],result=check({ability:'strength',difficulty:12,roll});
      const damage=result.success?Math.max(0,enemy.damage-(c.defending.includes(target.userId)?2:0)):0;
      applyDamage(target,damage);events.push({actor:enemy.id,target:target.userId,result,damage,text:`${enemy.id} → ${target.name}: 🎲 ${result.total}, ${damage} 피해`});
    }
    c.defending=[];
  }
  const living=session.players.filter(p=>p.presence==='active'&&p.character?.hp>0&&c.order.includes(p.userId)).map(p=>p.userId);
  if(!living.length)return {events,over:'defeat'};
  while(!living.includes(currentActor(c)))c.turnIndex=(c.turnIndex+1)%c.order.length;
  return {events,over:null};
}
