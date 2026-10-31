import test from 'node:test';
import assert from 'node:assert/strict';
import {selectEligible} from '../task-selector.mjs';
const scope='scripts/mac/local-brain';
const task=scope=>({id:'a',status:'queued',priority:1,scope,dependencies:[]});
for(let code=0;code<32;code++)test('reject C0 '+code+' in either scope',()=>{
 const bad=scope+'/'+String.fromCharCode(code)+'name';
 assert.throws(()=>selectEligible([],bad),TypeError);
 assert.throws(()=>selectEligible([task(bad)],scope),TypeError);
});
test('ordinary in-scope task remains eligible',()=>{
 const t=task(scope+'/nested');
 assert.deepEqual(selectEligible([t],scope),[t]);
});
