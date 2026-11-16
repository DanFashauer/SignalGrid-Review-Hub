import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {isMainModule as m} from '../../../lib/is-main.mjs';
const u=import.meta.url, p=fileURLToPath(u);
test('#2185: a query or fragment import is never the entry',()=>{
 for (const x of [u+'?case=1',u+'#tag',u+'?a#b',new URL(u+'?case=1'),new URL(u+'#tag')]) assert.equal(m(p,x),false,String(x));
});
test('#2185: ordinary match and refusal controls unchanged',()=>{
 assert.equal(m(p,u),true);
 assert.equal(m(p,new URL(u)),true);
 assert.equal(m(p,u+'?'),true);
 assert.equal(m(p,u+'#'),true);
 for (const a of [undefined,'',p+'.missing']) assert.equal(m(a,u),false);
 assert.equal(m(p,'not a url'),false);
});
