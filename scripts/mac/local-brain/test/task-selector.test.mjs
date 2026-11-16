import test from 'node:test';
import assert from 'node:assert/strict';
import {selectEligible} from '../task-selector.mjs';
const scope='scripts/mac/local-brain';
test('priority ordered and tie broken by id',()=>{
 const a=[{id:'z',status:'queued',priority:3,scope,dependencies:[]},{id:'a',status:'queued',priority:3,scope,dependencies:[]},{id:'b',status:'queued',priority:8,scope,dependencies:[]}];
 assert.deepEqual(selectEligible(a,scope).map(x=>x.id),['b','a','z']);
});
test('reject blocked and out of scope',()=>{
 assert.deepEqual(selectEligible([{id:'a',status:'blocked',priority:5,scope,dependencies:[]},{id:'b',status:'queued',priority:5,scope:'lib',dependencies:[]}],scope),[]);
});
test('unmet dependency cannot run',()=>{
 assert.deepEqual(selectEligible([{id:'b',status:'queued',priority:2,scope,dependencies:['a']}],scope),[]);
});
test('verified dependency unlocks queued task',()=>{
 const a=[{id:'a',status:'reviewed',priority:1,scope,dependencies:[]},{id:'b',status:'queued',priority:2,scope,dependencies:['a']}];
 assert.deepEqual(selectEligible(a,scope).map(x=>x.id),['b']);
});
test('duplicate IDs refuse to authorize any task',()=>{
 const t={id:'a',status:'queued',priority:5,scope,dependencies:[]};
 assert.throws(()=>selectEligible([t,t],scope));
});
test('malformed input is rejected',()=>{
 assert.throws(()=>selectEligible([{id:'a',status:'queued',priority:NaN,scope,dependencies:[]}],scope));
});
