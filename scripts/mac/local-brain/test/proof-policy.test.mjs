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
