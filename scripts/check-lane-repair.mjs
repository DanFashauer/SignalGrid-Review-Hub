// Guarded repair DATA and current-owner notification regression checks.
// Source copy + disposable Git + the real Bash FD8 guard. Only publication transport
// is replaced by a local argv/ops capture. This is not provider/host containment proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import control from 'node:test';
import { fileURLToPath } from 'node:url';
import { scratchGit } from './lib/scratch-git.mjs';

const SOURCE = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
assert.ok(SOURCE, 'explicit disposable-source root argument required');
const MODULE = 'scripts/lib/lane-repair.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const enc = x => Buffer.from(JSON.stringify(x) + '\n');
const quote = s => "'" + String(s).replaceAll("'", "'\\''") + "'";
const scrub = ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY',
 'GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_COMMON_DIR','GIT_NAMESPACE','GIT_PREFIX',
 'GIT_CONFIG','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS','GIT_GRAFT_FILE',
 'GIT_IMPLICIT_WORK_TREE','GIT_NO_REPLACE_OBJECTS','GIT_REPLACE_REF_BASE','GIT_SHALLOW_FILE'];
const parentEnv = { ...process.env }; for (const k of scrub) delete parentEnv[k];
// Both are known local executables; no repository hook or model helper is selected.
const GIT = spawnSync('/bin/sh',['-c','command -v git'],{env:parentEnv,encoding:'utf8'}).stdout.trim();
let serial = 0;
function put(p,b) { mkdirSync(dirname(p),{recursive:true}); writeFileSync(p,b,{flag:'wx',mode:0o600,flush:true}); }
function rawFiles(prefix) {
 const d=dirname(prefix),name=prefix.slice(d.length+1),out={};
 for(const n of readdirSync(d).filter(n=>n===name||n.startsWith(name+'.')||name.startsWith('.sg-heartbeat-')&&/^\.sg-last-heartbeat-(attempt|result)$/.test(n)).sort()) {
  const p=join(d,n),s=lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink(),'original evidence must remain regular');
  out[n]={raw:readFileSync(p).toString('hex'),ino:s.ino,dev:s.dev,mode:s.mode,nlink:s.nlink};
 }
 return out;
}
function preserved(prefix,before) {
 const now=rawFiles(prefix);for(const [name,state] of Object.entries(before))assert.deepEqual(now[name],state,'original bytes/inode/mode preserved: '+name);
}
function fixture() {
 // Baseline RED is an intentional behavior assertion, not ERR_MODULE_NOT_FOUND.
 assert.ok(existsSync(join(SOURCE,MODULE)), 'ASSERTFAIL missing bounded repair DATA/FD8 consumer capability at '+MODULE);
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'sg-frozen-repair-v1-'))),root=join(parent,'repo'),bin=join(parent,'bin');
 mkdirSync(root);mkdirSync(bin);
 const env={...parentEnv,PATH:`${bin}:${dirname(process.execPath)}:${dirname(GIT)}:/usr/bin:/bin`,TMPDIR:parent,
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',
  GIT_AUTHOR_NAME:'repair fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',
  GIT_COMMITTER_NAME:'repair fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',SIGNALGRID_LANE:'mac'};
 delete env.NODE_OPTIONS;
 function git(a,cwd=root) {
  const r=scratchGit(cwd,a,{env});
  assert.equal(r.status,0,'disposable Git failed: '+r.stderr);assert.equal(r.signal,null);return r.stdout.trim();
 }
 git(['init','-q','-b','SignalGrid_Alpha']);
 function copyTree(from,to) {
  mkdirSync(to,{recursive:true});
  for(const n of readdirSync(from)) {
   const a=join(from,n),b=join(to,n),s=lstatSync(a);
   assert.ok(!s.isSymbolicLink(),'fixture source cannot redirect through a symlink');
   if(s.isDirectory())copyTree(a,b);else if(s.isFile()&&n.endsWith('.mjs')){copyFileSync(a,b);chmodSync(b,s.mode&0o777);}
  }
 }
 copyTree(join(SOURCE,'scripts/lib'),join(root,'scripts/lib'));
 const tick=readFileSync(join(SOURCE,'scripts/mac/lane-tick.sh'),'utf8');
 const start=tick.indexOf('# BEGIN OWNED TICK GUARD'),finish=tick.indexOf('# END OWNED TICK GUARD',start);
 assert.ok(start>=0&&finish>start,'exact source guard boundaries required');
 const guardBlock=tick.slice(start,finish+'# END OWNED TICK GUARD'.length);
 const cliLog=join(parent,'transport.jsonl'),gitLog=join(parent,'git.jsonl');
 const transport=`import fs from 'node:fs';\nconst a=process.argv.slice(2);let ops=null;\nif(a[0]==='batch')ops=JSON.parse(fs.readFileSync(a[1],'utf8'));\nfs.appendFileSync(process.env.FIXTURE_CLI_LOG,JSON.stringify({args:a,ops})+'\\n');\nif(a[0]!=='batch'){console.error('forbidden original operation');process.exit(99)}\nconst mode=process.env.FIXTURE_TRANSPORT_MODE||'ok';\nif(mode==='signal')process.kill(process.pid,'SIGTERM');\nif(mode==='exit1'){console.error('fixture repair transport unconfirmed');process.exit(1)}\nif(mode==='exit2'){console.error('fixture repair transport refused');process.exit(2)}\nconst receipt=a[a.indexOf('--receipt')+1];if(!receipt)process.exit(98);\nfs.writeFileSync(receipt,JSON.stringify({version:1,fixtureRepair:true,canonical_merge_verified:false})+'\\n',{flag:'wx',mode:0o600,flush:true});\nconsole.log('fixture repair submitted; canonical merge unverified');\n`;
 put(join(root,'scripts/lane-deliver.mjs'),transport);
 put(join(root,'artifacts/agent-heartbeats/mac-lane-tick.json'),'{"result":"original frozen heartbeat"}\n');
 put(join(root,'fixture.txt'),'disposable fixture\n');git(['add','.']);git(['commit','-qm','frozen source-copy fixture']);
 const head=git(['rev-parse','HEAD']);env.FIXTURE_HEAD=head;env.FIXTURE_CLI_LOG=cliLog;
 // Real local Git handles metadata; a remote/network operation is never forwarded.
 put(join(bin,'git'),`#!${process.execPath}\nimport fs from 'node:fs';import{spawnSync}from'node:child_process';const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(gitLog)},JSON.stringify(a)+'\\n');if(a[0]==='remote'&&a[1]==='get-url'){console.log('https://github.com/fixture/route.git');process.exit(0)}if(a.some(x=>['push','fetch','ls-remote','clone'].includes(x))){console.error('fixture forbids remote transport');process.exit(97)}const r=spawnSync(${JSON.stringify(GIT)},a,{stdio:'inherit'});process.exit(r.status??96);\n`);chmodSync(join(bin,'git'),0o755);
 const storeModule=join(root,'scripts/lib/lane-attempt-store.mjs');
 const initialized=spawnSync(process.execPath,[storeModule,'init',root],{cwd:root,env,encoding:'utf8'});
 assert.equal(initialized.status,0,initialized.stderr);
 const store=initialized.stdout.trim();assert.ok(store.startsWith(root+sep+'.git'+sep),'fixture init must stay in disposable common Git directory');
 const f={parent,root,bin,env,head,store,guardBlock,cliLog,gitLog,git,storeModule,transport};
 f.cli=(a,{checkout=root,extra={}}={})=>spawnSync(process.execPath,[join(checkout,MODULE),...a],{cwd:checkout,env:{...env,...extra},encoding:'utf8'});
 f.calls=()=>existsSync(cliLog)?readFileSync(cliLog,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 f.clean=()=>rmSync(parent,{recursive:true,force:true});return f;
}
function original(f,producer,{exit=3,legacy=false,secret='',receipt=true}={}) {
 const attempt=producer==='heartbeat'?'20261031T010000Z-456':sha(producer+'-same-original');
 const prefix=join(f.store,producer==='heartbeat'?'.sg-heartbeat-'+attempt:producer==='build'?'hand-'+attempt:'objective-'+attempt);
 const intent=producer==='heartbeat'?{attempt,result:'unknown original '+secret}:
  producer==='build'?{at:'20261031T010000Z',state:'attempted; pending exact readback',receipt:prefix+'.submission.json'}:
  {at:'2026-10-31T01:00:00Z',escalation:'same-source-escalation',state:'attempted; pending exact readback',receipt:prefix+'.submission.json'};
 if(producer==='heartbeat'){put(prefix+'.log',Buffer.concat([enc(intent),Buffer.from('original transport/GET uncertainty '+secret+'\n')]));put(join(f.store,'.sg-last-heartbeat-attempt'),attempt);put(join(f.store,'.sg-last-heartbeat-result'),intent.result);}
 else put(prefix+'.attempt.json',enc(intent));
 if(producer==='build')put(prefix+'.output','original build hand unconfirmed '+secret+'\n');
 if(producer==='objective')put(prefix+'.terminal.json',enc({status:exit,error:null,stdout:'original escalation unconfirmed '+secret,stderr:''}));
 else put(prefix+'.exit',String(exit)+'\n');
 if(receipt) {
  const r={version:1,at:'2026-10-31T01:00:00Z',repository:'fixture/route',base:f.head,head:f.head,
   target:'lane/mac-mail-20261031-010000Z-0123456789ab',
   ...(legacy?{}:{producer_head:f.head,producer_source_sha256:sha(f.transport)}),
   blobs:[{path:'artifacts/agent-heartbeats/mac-lane-tick.json',oid:f.git(['rev-parse',f.head+':artifacts/agent-heartbeats/mac-lane-tick.json'])}]};
  put(prefix+'.submission.json',enc(r));
  if(!legacy) {
   const binding={version:1,kind:'original-lane-push-terminal',receipt_sha256:sha(enc(r)),repository:r.repository,
    base:r.base,head:r.head,target:r.target,producer_head:r.producer_head,producer_source_sha256:r.producer_source_sha256};
   const command=['git','push','origin','HEAD:refs/heads/'+r.target],stdout=Buffer.from('original topic accepted\n'),stderr=Buffer.alloc(0);
   const b={...binding,kind:binding.kind+'-raw',command,status:0,signal:null,error:null,
    stdout_base64:stdout.toString('base64'),stderr_base64:stderr.toString('base64'),stdout_sha256:sha(stdout),stderr_sha256:sha(stderr)};
   put(prefix+'.submission.json.push.raw.json',enc(b));
   put(prefix+'.submission.json.push.json',enc({...binding,command,status:0,signal:null,error:null,stdout:stdout.toString(),stderr:'',
    stdout_sha256:sha(stdout),stderr_sha256:sha(stderr),raw_capture_sha256:sha(enc(b)),utf8_valid:true}));
  }
 }
 return {producer,prefix,intent,initial:rawFiles(prefix)};
}
function request(f,o,checkout=f.root,extra={}) {
 const before=rawFiles(o.prefix),r=f.cli(['request',checkout,o.producer,o.prefix],{checkout,extra});
 assert.equal(r.status,0,'request must preserve bounded DATA: '+r.stderr+r.stdout);assert.equal(r.signal,null);
 const lines=r.stdout.trim().split('\n');assert.equal(lines.length,1,'request stdout is exactly one absolute DATA path');
 const p=lines[0];assert.ok(p.startsWith(f.store+sep),'request lives only in exact shared store');
 const s=lstatSync(p);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);assert.equal(s.mode&0o777,0o600);
 const raw=readFileSync(p),data=JSON.parse(raw);assert.equal(data.version,1);assert.equal(data.kind,'lane-delivery-repair-request');
 assert.equal(data.producer,o.producer);assert.equal(data.original_attempt.prefix,o.prefix);assert.match(data.original_attempt.intent_sha256,/^[a-f0-9]{64}$/);
 assert.ok(typeof data.id==='string'&&data.id.length>0);assert.equal(data.readback_only,true);
 assert.ok(['SOURCE_BOUND','UNVERIFIED'].includes(data.provenance));assert.ok(Array.isArray(data.evidence)&&data.evidence.length>0);
 const base=o.prefix.split('/').at(-1);
 for(const [name,state] of Object.entries(before)){if(!name.startsWith(base+'.'))continue;const suffix=name.slice(base.length),e=data.evidence.find(e=>e.suffix===suffix);
  assert.ok(e,'DATA binds each original evidence suffix: '+suffix);const bytes=Buffer.from(state.raw,'hex');assert.equal(e.sha256,sha(bytes));assert.equal(e.bytes,bytes.length);
 }
 preserved(o.prefix,before);return {path:p,raw,data};
}
function owned(f,actions,{checkout=f.root,extra={},before=''}={}) {
 const file=join(f.parent,'owned-'+(++serial)+'.sh'),wrong=join(f.parent,'wrong-guard-'+serial);
 put(wrong,'not the actual tick guard\n');
 const script=`set -u\nREPO_ROOT=${quote(checkout)}\nRECORD_DIR=${quote(f.store)}\nsay(){ printf '%s\\n' "$1"; }\n${f.guardBlock}\n${before}\n${actions}\nexit 0\n`;
 put(file,script);
 // Reading a real Bash script preserves actual shell PPID through $(tick-acquire).
 return spawnSync('/bin/bash',[file],{cwd:checkout,env:{...f.env,FIXTURE_WRONG_GUARD:wrong,...extra},encoding:'utf8'});
}
function notifyCommand(f,r,{checkout=f.root,token='"$TICK_OWNER_TOKEN"',pid='"$$"',suffix=''}={}) {
 return `${quote(process.execPath)} ${quote(join(checkout,MODULE))} notify ${quote(checkout)} ${quote(r.path)} ${token} ${pid} ${suffix}`;
}
function acceptOwned(r) { assert.equal(r.status,0,'actual own Bash must close normally: '+r.stderr+r.stdout);assert.equal(r.signal,null); }
function noRemoteAttempt(f) {
 if(!existsSync(f.gitLog))return;
 for(const row of readFileSync(f.gitLog,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse))
  assert.ok(!row.some(a=>['push','fetch','ls-remote','clone'].includes(a)),'request/consumer must not retry or probe original remote operation');
}
function oneRepair(f,count=1) {
 noRemoteAttempt(f);
 const c=f.calls();assert.equal(c.length,count,'exactly the bounded different repair operation');
 for(const row of c){assert.equal(row.args[0],'batch');assert.ok(!row.args.includes('heartbeat')&&!row.args.includes('send')&&!row.args.includes('--auto'));
  assert.ok(Array.isArray(row.ops)&&row.ops.length===1);const op=row.ops[0];assert.equal(op.op,'raise');assert.equal(op.who,'cloud lane');
  assert.ok(typeof op.id==='string'&&op.id.length>0);assert.match(JSON.stringify(op),/unknown|unverified|uncertain/i);
  assert.doesNotMatch(JSON.stringify(op),/no publication|nothing was published|was not published|never published|failed to publish|publication did not occur/i);
 }
 return c;
}
function frozen(id,name,body) { control(id+' '+name,{concurrency:false},()=>{let f;try{f=fixture();body(f);}finally{if(f)f.clean();}}); }

frozen('R01','a source-bound original heartbeat uncertainty becomes immutable DATA without executing a delivery',f=>{
 const o=original(f,'heartbeat'),r=request(f,o);assert.equal(r.data.provenance,'SOURCE_BOUND');assert.equal(f.calls().length,0);noRemoteAttempt(f);
 const before=r.raw,s=lstatSync(r.path);const again=request(f,o);assert.equal(again.path,r.path);assert.deepEqual(again.raw,before);assert.equal(lstatSync(r.path).ino,s.ino);
 preserved(o.prefix,o.initial);
});
frozen('R02','the actual original FD8 owner sends one different Cloud hand and preserves the old heartbeat',f=>{
 const o=original(f,'heartbeat'),r=request(f,o);acceptOwned(owned(f,notifyCommand(f,r)+' || exit $?'));
 const sent=oneRepair(f);assert.notEqual(sent[0].ops[0].id,o.prefix.split('/').at(-1));preserved(o.prefix,o.initial);
});
frozen('R03','a later UTC day and changed diagnostic wording cannot create a second original-attempt notification',f=>{
 const o=original(f,'heartbeat'),r=request(f,o);acceptOwned(owned(f,notifyCommand(f,r)+' || exit $?'));oneRepair(f);
 const clock=join(f.parent,'next-day.mjs');put(clock,`const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-11-02T01:00:00Z']))}static now(){return D.parse('2026-11-02T01:00:00Z')}};`);
 const again=request(f,o,f.root,{NODE_OPTIONS:'--import='+clock,FIXTURE_DIAGNOSTIC:'different category/refusal wording'});assert.equal(again.path,r.path);assert.equal(again.data.id,r.data.id);
 acceptOwned(owned(f,notifyCommand(f,again)+'; :',{extra:{NODE_OPTIONS:'--import='+clock}}));oneRepair(f);preserved(o.prefix,o.initial);
});
frozen('R04','a child with wrong inherited FD8 cannot consume a queued request',f=>{
 const o=original(f,'heartbeat'),r=request(f,o);const action=notifyCommand(f,r,{suffix:'8<"$FIXTURE_WRONG_GUARD"'})+'\n_rc=$?\n[ "$_rc" != 0 ] || exit 81';
 acceptOwned(owned(f,action));assert.equal(f.calls().length,0);preserved(o.prefix,o.initial);
});
frozen('R05','a nested process cannot claim another actual Bash parent PID',f=>{
 const r=request(f,original(f,'heartbeat'));
 const inner=notifyCommand(f,r,{pid:'"$ORIGINAL_SHELL_PID"'})+'; _rc=$?; exit "$_rc"';
 const action='export ORIGINAL_SHELL_PID="$$"\n/bin/bash -c '+quote(inner)+'\n_rc=$?\n[ "$_rc" != 0 ] || exit 82';
 acceptOwned(owned(f,action));assert.equal(f.calls().length,0);
});
frozen('R06','a forged active token cannot consume a request despite actual guard capacity',f=>{
 const r=request(f,original(f,'heartbeat'));const action=notifyCommand(f,r,{token:quote('0'.repeat(32))})+'\n_rc=$?\n[ "$_rc" != 0 ] || exit 83';
 acceptOwned(owned(f,action));assert.equal(f.calls().length,0);
});
frozen('R07','a replaced guard pathname cannot authorize notification or release another namespace',f=>{
 const r=request(f,original(f,'heartbeat')),guard=join(f.store,'tick.guard');
 const before=`mv ${quote(guard)} ${quote(guard+'.original-preserved')}\nprintf 'replacement guard\\n' > ${quote(guard)}`;
 const run=owned(f,notifyCommand(f,r)+'\n_rc=$?\n[ "$_rc" != 0 ] || exit 84',{before});
 assert.equal(run.signal,null);assert.equal(f.calls().length,0);assert.equal(JSON.parse(readFileSync(join(f.store,'tick.slot.json'),'utf8')).state,'OPEN');
 assert.equal(readFileSync(guard,'utf8'),'replacement guard\n');assert.ok(existsSync(guard+'.original-preserved'));
});
frozen('R08','a failed different repair hand remains consumed on a later valid tick',f=>{
 const o=original(f,'heartbeat'),r=request(f,o);acceptOwned(owned(f,notifyCommand(f,r)+'; :',{extra:{FIXTURE_TRANSPORT_MODE:'exit1'}}));oneRepair(f);
 acceptOwned(owned(f,notifyCommand(f,r)+'; :'));oneRepair(f);preserved(o.prefix,o.initial);
});
frozen('R09','a signaled local repair child never creates a replacement notification identity',f=>{
 const o=original(f,'heartbeat'),r=request(f,o);acceptOwned(owned(f,notifyCommand(f,r)+'; :',{extra:{FIXTURE_TRANSPORT_MODE:'signal'}}));oneRepair(f);
 const again=request(f,o);assert.equal(again.path,r.path);acceptOwned(owned(f,notifyCommand(f,again)+'; :'));oneRepair(f);preserved(o.prefix,o.initial);
});
for(const [id,code] of [['R10',1],['R11',2]])frozen(id,'a failed build hand exit'+code+' queues DATA without rerunning its original batch',f=>{
 const o=original(f,'build',{exit:code}),r=request(f,o);assert.equal(f.calls().length,0);preserved(o.prefix,o.initial);
 const cmd=`${quote(process.execPath)} ${quote(join(f.root,MODULE))} drain ${quote(f.root)} "$TICK_OWNER_TOKEN" "$$"`;
 acceptOwned(owned(f,cmd+' || exit $?'));oneRepair(f);preserved(o.prefix,o.initial);assert.equal(readFileSync(o.prefix+'.exit','utf8'),code+'\n');
});
frozen('R12','objective escalation failure queues the same bounded repair without resetting escalation identity',f=>{
 const o=original(f,'objective',{exit:2}),r=request(f,o);assert.equal(f.calls().length,0);acceptOwned(owned(f,notifyCommand(f,r)+' || exit $?'));oneRepair(f);
 preserved(o.prefix,o.initial);assert.equal(JSON.parse(readFileSync(o.prefix+'.attempt.json','utf8')).escalation,'same-source-escalation');
});
frozen('R13','an existing old receipt wins over exit1 and the public message claims uncertainty rather than remote absence',f=>{
 const o=original(f,'build',{exit:1}),r=request(f,o);acceptOwned(owned(f,notifyCommand(f,r)+' || exit $?'));const [c]=oneRepair(f);
 assert.doesNotMatch(JSON.stringify(c.ops),/prepublication refusal|never reached|not transmitted|topic absent/i);preserved(o.prefix,o.initial);
});
frozen('R14','legacy missing producer provenance is recorded UNVERIFIED and is not stamped as current source',f=>{
 const o=original(f,'build',{exit:2,legacy:true}),r=request(f,o);assert.equal(r.data.provenance,'UNVERIFIED');
 const before=readFileSync(o.prefix+'.submission.json');acceptOwned(owned(f,notifyCommand(f,r)+' || exit $?'));oneRepair(f);
 assert.deepEqual(readFileSync(o.prefix+'.submission.json'),before);preserved(o.prefix,o.initial);
});
frozen('R15','untrusted malformed original payload is retained as DATA and cannot become a command or public body',f=>{
 const injected=join(f.parent,'DO_NOT_EXECUTE'),syntheticToken='ghp_'+'0123456789abcdefghijk',secret='/Users/private-person/secret-vault token='+syntheticToken+' $(touch '+injected+')';
 const o=original(f,'objective',{exit:2,legacy:true,secret});writeFileSync(o.prefix+'.submission.json','{"bad":"'+secret.replaceAll('"','\\"')+'"');
 const before=rawFiles(o.prefix),r=request(f,o);assert.equal(r.data.provenance,'UNVERIFIED');assert.equal(f.calls().length,0);
 acceptOwned(owned(f,notifyCommand(f,r)+' || exit $?'));const [c]=oneRepair(f),body=JSON.stringify(c.ops);
 for(const forbidden of ['/Users/private-person','secret-vault',syntheticToken,'DO_NOT_EXECUTE',o.prefix,f.parent])assert.ok(!body.includes(forbidden),'raw private input must not reach public operation: '+forbidden);
 preserved(o.prefix,before);assert.equal(existsSync(injected),false,'untrusted DATA must not execute its shell fragment');
});
frozen('R16','a DATA request is not authority for an unowned direct consumer',f=>{
 const r=request(f,original(f,'heartbeat'));const run=f.cli(['notify',f.root,r.path,'0'.repeat(32),String(process.pid)]);
 assert.notEqual(run.status,0);assert.equal(f.calls().length,0);assert.deepEqual(readFileSync(r.path),r.raw);
});
frozen('R17','primary and linked checkouts consume the same original repair identity only once',f=>{
 const linked=join(f.parent,'linked');f.git(['worktree','add','-q','--detach',linked]);
 const o=original(f,'heartbeat'),r=request(f,o),other=request(f,o,linked);assert.equal(other.path,r.path);assert.equal(other.data.id,r.data.id);
 acceptOwned(owned(f,notifyCommand(f,r)+' || exit $?'));acceptOwned(owned(f,notifyCommand(f,other,{checkout:linked})+'; :',{checkout:linked}));oneRepair(f);preserved(o.prefix,o.initial);
});
frozen('R18','one actual tick drain consumes at most one queued producer request',f=>{
 const originals=['heartbeat','build','objective'].map(p=>original(f,p));for(const o of originals)request(f,o);assert.equal(f.calls().length,0);
 const cmd=`${quote(process.execPath)} ${quote(join(f.root,MODULE))} drain ${quote(f.root)} "$TICK_OWNER_TOKEN" "$$"`;
 acceptOwned(owned(f,cmd+' || exit $?'));oneRepair(f,1);
 acceptOwned(owned(f,cmd+' || exit $?'));oneRepair(f,2);
 acceptOwned(owned(f,cmd+' || exit $?'));const sent=oneRepair(f,3);assert.equal(new Set(sent.map(c=>c.ops[0].id)).size,3);
 acceptOwned(owned(f,cmd+' || exit $?'));oneRepair(f,3);for(const o of originals)preserved(o.prefix,o.initial);
});
