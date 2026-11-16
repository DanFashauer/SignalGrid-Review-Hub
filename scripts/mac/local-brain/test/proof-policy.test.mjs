import test from 'node:test';
import assert from 'node:assert/strict';
import {assessProof} from '../proof-policy.mjs';
const scope='scripts/mac/local-brain';
const pass={exitCode:0,tests:2,pass:2,fail:0,skipped:0,command:'node --test',changedFiles:[scope+'/x.mjs']};
test('affirmative evidence is reviewable not automatically merged',()=>assert.equal(assessProof(pass,scope),'review'));
test('zero tests is blocked',()=>assert.equal(assessProof({...pass,tests:0,pass:0},scope),'blocked'));
test('failed or skipped tests block',()=>{assert.equal(assessProof({...pass,fail:1},scope),'blocked');assert.equal(assessProof({...pass,skipped:1},scope),'blocked')});
test('nonzero or unknown exit blocks',()=>{assert.equal(assessProof({...pass,exitCode:1},scope),'blocked');assert.equal(assessProof({...pass,exitCode:null},scope),'blocked')});
test('no source changes or command blocks',()=>{assert.equal(assessProof({...pass,changedFiles:[]},scope),'blocked');assert.equal(assessProof({...pass,command:''},scope),'blocked')});
test('scope escape blocks even with green counts',()=>{assert.equal(assessProof({...pass,changedFiles:['lib/x.mjs']},scope),'blocked');assert.equal(assessProof({...pass,changedFiles:[scope+'/../private.mjs']},scope),'blocked')});

test('every changed file must be in scope regardless of list order',()=>{
 for (const changedFiles of [[scope+'/x.mjs','lib/private.mjs'],['lib/private.mjs',scope+'/x.mjs']]) {
  assert.equal(assessProof({...pass,changedFiles},scope),'blocked');
 }
 assert.equal(assessProof({...pass,changedFiles:[scope+'/x.mjs',scope+'/test/x.test.mjs']},scope),'review');
});

test('whitespace command is not affirmative evidence',()=>{
 assert.equal(assessProof({...pass,command:' \n\t '},scope),'blocked');
});

test('malformed proof or allowed scope is blocked',()=>{
 for (const proof of [null,undefined,[],false,'green']) assert.equal(assessProof(proof,scope),'blocked');
 for (const allowedScope of [null,undefined,{},'', '.', '..',scope+'/..',scope+'//test','/'+scope]) {
  assert.equal(assessProof(pass,allowedScope),'blocked');
 }
});

test('dot segments and malformed changed paths never count as in-scope changes',()=>{
 for (const changedFiles of [[scope+'/./x.mjs'],[scope+'/test//x.mjs'],[scope+'/test\\x.mjs'],[scope+'/test/..']]) {
  assert.equal(assessProof({...pass,changedFiles},scope),'blocked');
 }
});

test('#2182: in-scope changes under the three public agent trees are reviewable',()=>{
 for (const tree of ['.claude/agents','.claude/skills','.claude/commands']) {
  const file = tree==='.claude/skills' ? tree+'/x/SKILL.md' : tree+'/x.md';
  assert.equal(assessProof({...pass,changedFiles:[file]},tree),'review',tree);
  assert.equal(assessProof({...pass,changedFiles:[file]},'.claude'),'blocked','bare .claude is never a scope: '+tree);
 }
});

test('#2182: private, hidden and malformed .claude paths stay blocked',()=>{
 const tree='.claude/agents';
 for (const changedFiles of [['.claude/settings.json'],['.claude/agents/.hidden.md'],['.claude/agents/.private/x.md'],['.claude/agentsx/x.md'],
   ['.claude/agents/../settings.json'],['.claude/agents//x.md'],['.claude/agents\\x.md'],['.github/agents/x.md'],['.agents/x.md'],['x/.claude/agents/x.md'],
   ['.claude/skills/x.md']]) {
  assert.equal(assessProof({...pass,changedFiles},tree),'blocked',JSON.stringify(changedFiles));
 }
 for (const allowedScope of ['.claude','.claude/','.claude/settings','.claude/agents/.x','.github/agents','.claude//agents']) {
  assert.equal(assessProof({...pass,changedFiles:['.claude/agents/x.md']},allowedScope),'blocked',allowedScope);
 }
});

test('#2182: public trees keep every count and command check',()=>{
 const tree='.claude/commands', changedFiles=[tree+'/x.md'];
 for (const bad of [{fail:1},{skipped:1},{exitCode:1},{tests:0,pass:0},{command:' '},{errors:1},{todo:1}]) {
  assert.equal(assessProof({...pass,changedFiles,...bad},tree),'blocked',JSON.stringify(bad));
 }
});
