import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombat,playCombat,currentActor} from '../src/game/combat.mjs';
const party=()=>['a','b'].map(userId=>({userId,name:userId,presence:'active',character:{hp:10,maxHp:10,abilities:{agility:0,strength:1},inventory:{potion:2}}}));
test('initiative stored, enemy round deals damage, defense and potions have actual effects',()=>{
  const players=party(),combat=createCombat({kind:'wolf',count:1},players,()=>12),s={players,combat};
  assert.equal(combat.initiative.length,2);assert.equal(currentActor(combat),'a');
  playCombat(s,'defend',()=>15);assert.equal(currentActor(combat),'b');
  playCombat(s,'help',()=>15);assert.equal(players[0].character.hp,9,'wolf3-defense2');
  playCombat(s,'item',()=>15);assert.equal(players[0].character.hp,10);assert.equal(players[0].character.inventory.potion,1);
});
test('no phantom item usage at full health and no arbitrary enemy templates',()=>{
  const players=party(),s={players,combat:createCombat({kind:'goblin',count:1},players,()=>10)};
  assert.throws(()=>playCombat(s,'item',()=>10),/가득/);assert.equal(players[0].character.inventory.potion,2);
  assert.throws(()=>createCombat({kind:'dragon',count:999},players),/잘못/);
});
