// Producer repair wiring and original-attempt preservation regression checks.
// Source copy + disposable Git + the real Bash FD8 guard. Only publication transport
// is replaced by a local argv/ops capture. This is not provider/host containment proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import control from 'node:test';
import { fileURLToPath } from 'node:url';
import { scratchGit, scratchGitEnv } from './lib/scratch-git.mjs';

const SOURCE = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
assert.ok(SOURCE, 'explicit disposable-source root argument required');
const MODULE = 'scripts/lib/lane-repair.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const enc = x => Buffer.from(JSON.stringify(x) + '\n');
const quote = s => "'" + String(s).replaceAll("'", "'\\''") + "'";
const parentEnv = scratchGitEnv(process.env);
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
// Owner order 2026-11-01: a refused original (exit 1/2) is moved under refused/, byte-identical, and retried.
function setAside(f,before) {
 const moved=readdirSync(join(f.store,'refused'));
 for(const [name,state] of Object.entries(before)){const dot=name.indexOf('.',1),m=moved.filter(x=>x===name.slice(0,dot)+'.refused-1'+name.slice(dot));assert.equal(m.length,1,'refused evidence kept aside: '+name);assert.equal(readFileSync(join(f.store,'refused',m[0])).toString('hex'),state.raw);}
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
 put(join(bin,'git'),`#!${process.execPath}\nimport fs from 'node:fs';import{spawnSync}from'node:child_process';const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(gitLog)},JSON.stringify(a)+'\\n');if(a[0]==='remote'&&a[1]==='get-url'){console.log('https://github.com/fixture/route.git');process.exit(0)}if(a[0]==='ls-remote'&&process.env.FIXTURE_LS_REMOTE==='absent')process.exit(0);if(a.some(x=>['push','fetch','ls-remote','clone'].includes(x))){console.error('fixture forbids remote transport');process.exit(97)}const r=spawnSync(${JSON.stringify(GIT)},a,{stdio:'inherit'});process.exit(r.status??96);\n`);chmodSync(join(bin,'git'),0o755);
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
  assert.ok(!row.some(a=>['push','fetch','clone'].includes(a)),'request/consumer must not retry or probe original remote operation');
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


// Only external delivery is doubled. CLI entry logging observes the actual
// original producer terminal at the instant the real repair module is invoked.
const BLOCKER='same frozen source-backed build blocker';
function callerFixture() {
 const f=fixture(),trace=join(f.parent,'repair-entries.jsonl'),preload=join(f.parent,'module-entry-observer.cjs');
 for(const rel of ['scripts/mac/lane-tick.sh','scripts/mac/build-tick.sh','scripts/objective-loop.mjs']){
  const path=join(f.root,rel);mkdirSync(dirname(path),{recursive:true});copyFileSync(join(SOURCE,rel),path);
 }
 f.env.FIXTURE_ORIGINAL_HAND='build-'+sha(BLOCKER);
 const transport=`import fs from 'node:fs';\nconst a=process.argv.slice(2),ops=a[0]==='batch'?JSON.parse(fs.readFileSync(a[1],'utf8')):null;\nfs.appendFileSync(process.env.FIXTURE_CLI_LOG,JSON.stringify({args:a,ops})+'\\n');\nif(a[0]==='readback'){console.error('original canonical readback is unverified');process.exit(Number(process.env.FIXTURE_ORIGINAL_READBACK_EXIT||3));}\nconst original=a[0]==='send'||a[0]==='heartbeat'||a[0]==='batch'&&ops[0]?.id===process.env.FIXTURE_ORIGINAL_HAND;\nconst receipt=a[a.indexOf('--receipt')+1];\nif(receipt)fs.writeFileSync(receipt,JSON.stringify({version:1,at:'2026-10-31T01:00:00Z',repository:'fixture/route',base:process.env.FIXTURE_HEAD,head:process.env.FIXTURE_HEAD,target:'lane/mac-mail-20261031-010000Z-0123456789ab',blobs:[{path:'artifacts/agent-heartbeats/mac-lane-tick.json',oid:process.env.FIXTURE_PAYLOAD_OID}]})+'\\n',{flag:'wx',mode:0o600,flush:true});\nif(original){console.error('original publication fixture unconfirmed');process.exit(Number(process.env.FIXTURE_ORIGINAL_EXIT||0));}\nif(a[0]!=='batch'){console.error('forbidden publication operation');process.exit(99);}\nconsole.log('one distinct fixture repair submitted; canonical merge unverified');\n`;
 writeFileSync(join(f.root,'scripts/lane-deliver.mjs'),transport,{mode:0o600});
 f.git(['add','scripts']);f.git(['commit','-qm','exact caller source and publication fixture']);
 f.head=f.git(['rev-parse','HEAD']);f.transport=transport;f.env.FIXTURE_HEAD=f.head;
 f.env.FIXTURE_PAYLOAD_OID=f.git(['rev-parse',f.head+':artifacts/agent-heartbeats/mac-lane-tick.json']);
 put(preload,`const fs=require('node:fs');if((process.argv[1]||'').endsWith('/scripts/lib/lane-repair.mjs')){const a=process.argv.slice(2),prefix=a[0]==='request'?a[3]:null;const read=p=>{try{return fs.readFileSync(p,'utf8')}catch{return null}};fs.appendFileSync(process.env.FIXTURE_REPAIR_TRACE,JSON.stringify({argv:a,pid:process.pid,ppid:process.ppid,original_exit:prefix?read(prefix+'.exit'):null,original_terminal:prefix?read(prefix+'.terminal.json'):null,original_intent:prefix?read(prefix+'.attempt.json'):null,heartbeat_log:prefix?read(prefix+'.log'):null})+'\\n');}\n`);
 f.env.NODE_OPTIONS='--require='+preload;f.env.FIXTURE_REPAIR_TRACE=trace;
 f.entries=()=>existsSync(trace)?readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 f.dataRequests=()=>{const found=[];function visit(dir){for(const n of readdirSync(dir)){const file=join(dir,n),st=lstatSync(file);if(st.isDirectory()&&!st.isSymbolicLink())visit(file);else if(st.isFile()&&!st.isSymbolicLink()&&n.endsWith('.json')){try{const value=JSON.parse(readFileSync(file,'utf8'));if(value.kind==='lane-delivery-repair-request')found.push({path:file,value});}catch{}}}}visit(f.store);return found;};
 f.originalPublications=()=>f.calls().filter(c=>['heartbeat','send'].includes(c.args[0])||c.args[0]==='batch'&&c.ops[0]?.id===f.env.FIXTURE_ORIGINAL_HAND);
 f.repairs=()=>f.calls().filter(c=>c.args[0]==='batch'&&c.ops[0]?.id!==f.env.FIXTURE_ORIGINAL_HAND);
 return f;
}
function callerCase(id,name,body) {control(id+' '+name,{concurrency:false},()=>{let f;try{f=callerFixture();body(f);}finally{if(f)f.clean();}});}
function sourceFunction(file,start,end) {
 const text=readFileSync(join(SOURCE,file),'utf8'),a=text.indexOf(start),b=text.indexOf(end,a);
 assert.ok(a>=0&&b>a,'source function boundaries required: '+file);return text.slice(a,b);
}
function heartbeatScript(f,body) {
 const text=readFileSync(join(SOURCE,'scripts/mac/lane-tick.sh'),'utf8'),a=text.indexOf('heartbeat() {'),b=text.indexOf('\n}\n',a)+3;
 assert.ok(a>=0&&b>a);return `DRY=0\nRESULT=quiet\nQUIET_HEARTBEAT_MIN=120\nSTAMP=20261101T010000Z\nHB_LAST_RESULT=${quote(join(f.store,'.sg-last-heartbeat-result'))}\nHB_LAST_ATTEMPT=${quote(join(f.store,'.sg-last-heartbeat-attempt'))}\nESTATE_RESULT=${quote(join(f.store,'.sg-estate-result'))}\nappend_unread_state(){ :; }\nappend_raised_hands_state(){ :; }\n${text.slice(a,b)}\n${body}`;
}
function runBuild(f,body,{extra={}}={}) {
 const source=sourceFunction('scripts/mac/build-tick.sh','raise_hand() {','\nfail() {');
 const cache=join(f.parent,'build-cache');if(!existsSync(cache))mkdirSync(cache);
 const file=join(f.parent,'build-caller-'+(++serial)+'.sh');put(file,`set -u\nREPO_ROOT=${quote(f.root)}\nCACHE=${quote(cache)}\nRUN_LOG=\nSTAMP=20261101T010000Z\nDRY=0\nsay(){ printf '%s\\n' "$1"; }\n${source}\n${body}\nexit 0\n`);
 return spawnSync('/bin/bash',[file],{cwd:f.root,env:{...f.env,...extra},encoding:'utf8'});
}
function emitObjective(f,{existingState=false,rounds=1}={}) {
 const text=readFileSync(join(SOURCE,'scripts/objective-loop.mjs'),'utf8'),a=text.indexOf('function emit(state, { write, deliver }) {'),b=text.indexOf('\n// ── --check:',a);
 assert.ok(a>=0&&b>a,'actual emit source boundaries required');
 const escalation={id:'same-source-escalation',clears:'cloud',asks:'source-backed repair remains needed'};
 const state={decisionAddress:'same frozen decision',derivedAt:'2026-11-01T01:00:00Z',derivedAtCommit:f.head,queue:[],escalations:[escalation],criteria:[],tasks:[],verdict:'building'};
 if(existingState)put(join(f.root,'frozen-state.json'),enc(state));
 const file=join(f.parent,'objective-caller-'+(++serial)+'.mjs');
 put(file,`import {createHash,randomBytes} from 'node:crypto';import {spawnSync} from 'node:child_process';import {mkdirSync,readFileSync,readdirSync,renameSync,existsSync,writeFileSync,rmSync} from 'node:fs';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';import {deliveryRecordDirectory,setAsideRefusedAttempt} from ${JSON.stringify('file://'+join(f.root,'scripts/lib/lane-attempt-store.mjs'))};\nconst ROOT=${JSON.stringify(f.root)},STATE_REL='frozen-state.json',STAMP_REL='node_modules/frozen-objective-stamp.json';\n${text.slice(a,b)}\nconst state=${JSON.stringify(state)};for(let n=0;n<${rounds};n++){const r=emit(state,{write:true,deliver:true});console.log(r.lines.join('\\n'));}\n`);
 return spawnSync(process.execPath,[file],{cwd:f.root,env:f.env,encoding:'utf8'});
}
function exactRequest(f,o,{atLeast=1}={}) {
 const rows=f.entries().filter(e=>e.argv[0]==='request');assert.ok(rows.length>=atLeast,'real producer must invoke repair DATA request');
 for(const e of rows){assert.deepEqual(e.argv.slice(0,4),['request',f.root,o.producer,o.prefix]);
  if(o.producer==='objective'){const terminal=JSON.parse(e.original_terminal);assert.ok(Number.isInteger(terminal.status),'actual objective parent terminal must precede request');}
  else assert.ok(/^[0-9]+\n$/.test(e.original_exit??''),'actual independent parent exit must precede request');
 }
 const records=f.dataRequests();assert.equal(records.length,1,'one immutable request identity for the consumed original');
 assert.equal(records[0].value.producer,o.producer);assert.equal(records[0].value.original_attempt.prefix,o.prefix);assert.equal(records[0].value.readback_only,true);return rows;
}
function oneDifferentRepair(f,o) {
 const rows=f.repairs();assert.equal(rows.length,1,'only one distinct Cloud repair notification');const op=rows[0].ops[0];assert.equal(op.who,'cloud lane');
 assert.notEqual(op.id,f.env.FIXTURE_ORIGINAL_HAND);assert.match(JSON.stringify(op),/uncertain|unknown|unverified/i);
 assert.ok(!JSON.stringify(op).includes(o.prefix));assert.equal(f.originalPublications().length,0,'old heartbeat/batch/send must never be replayed');
 preserved(o.prefix,o.initial);return rows;
}

callerCase('CW01','heartbeat HOLD records and notifies its valid original prefix under actual FD8',f=>{
 const o=original(f,'heartbeat',{exit:3});utimesSync(join(f.store,'.sg-last-heartbeat-attempt'),new Date(0),new Date(0));
 acceptOwned(owned(f,heartbeatScript(f,'heartbeat || :')));exactRequest(f,o);oneDifferentRepair(f,o);
 const notices=f.entries().filter(e=>e.argv[0]==='notify');assert.equal(notices.length,1,'held heartbeat requests one actual owned notification');
 assert.equal(notices[0].ppid,Number(notices[0].argv[4]),'notify PID is the actual calling Bash parent');
});
callerCase('CW02','repeated heartbeat HOLD does not repeat the original send or a consumed repair notice',f=>{
 const o=original(f,'heartbeat',{exit:3});utimesSync(join(f.store,'.sg-last-heartbeat-attempt'),new Date(0),new Date(0));
 acceptOwned(owned(f,heartbeatScript(f,'heartbeat || :\nRESULT="different observation wording"\nheartbeat || :\nRESULT=quiet\nheartbeat || :')));
 exactRequest(f,o);oneDifferentRepair(f,o);assert.ok(f.calls().some(c=>c.args[0]==='readback'),'old original uses readback only');
});
for(const [id,status] of [['CW03',1],['CW04',2]])callerCase(id,'prior build exit'+status+' published nothing: it is set aside and the hand is sent again once',f=>{
 f.env.FIXTURE_LS_REMOTE='absent'; // readback: the original target ref is absent, so nothing was published
 const cause=sha(BLOCKER),o=original(f,'build',{exit:status,legacy:true});
 // Existing source derives this exact blocker identity before the failing branch.
 const desired=join(f.store,'hand-'+cause);for(const suffix of Object.keys(o.initial).filter(n=>n.startsWith(o.prefix.split('/').at(-1)+'.')).map(n=>n.slice(o.prefix.split('/').at(-1).length)))renameSync(o.prefix+suffix,desired+suffix);
 const prior=JSON.parse(readFileSync(desired+'.attempt.json','utf8'));prior.receipt=desired+'.submission.json';writeFileSync(desired+'.attempt.json',enc(prior));
 o.prefix=desired;o.initial=rawFiles(desired);
 acceptOwned(runBuild(f,`raise_hand ${quote(BLOCKER)}\nraise_hand ${quote(BLOCKER)}\nraise_hand ${quote(BLOCKER)}`));
 assert.equal(f.calls().filter(c=>c.args[0]==='batch').length,1,'the refused hand is retried exactly once, then the new attempt is held');assert.equal(f.entries().filter(e=>['notify','drain'].includes(e.argv[0])).length,0,'build DATA producer cannot invent FD8 ownership');setAside(f,o.initial);
});
callerCase('CW05','prior refused objective (exit2) is set aside and sent again once despite appearing submitted',f=>{
 f.env.FIXTURE_LS_REMOTE='absent';
 const o=original(f,'objective',{exit:2,legacy:true}),desired=join(f.store,'objective-'+sha('same-source-escalation')),base=o.prefix.split('/').at(-1);
 for(const name of Object.keys(o.initial).filter(n=>n.startsWith(base+'.')))renameSync(o.prefix+name.slice(base.length),desired+name.slice(base.length));
 const intent=JSON.parse(readFileSync(desired+'.attempt.json','utf8'));intent.receipt=desired+'.submission.json';writeFileSync(desired+'.attempt.json',enc(intent));o.prefix=desired;o.initial=rawFiles(desired);
 acceptOwned(emitObjective(f,{existingState:true,rounds:3}));
 assert.equal(f.originalPublications().length,1,'a refused escalation is retried exactly once');assert.equal(f.entries().filter(e=>['notify','drain'].includes(e.argv[0])).length,0);setAside(f,o.initial);
 assert.equal(JSON.parse(readFileSync(o.prefix+'.attempt.json','utf8')).escalation,'same-source-escalation');
});
callerCase('CW06','a fresh build batch refused with exit1 records its terminal, queues no DATA, and is retried by the next raise',f=>{
 const prefix=join(f.store,'hand-'+sha(BLOCKER));
 acceptOwned(runBuild(f,`raise_hand ${quote(BLOCKER)}\nraise_hand ${quote(BLOCKER)}`,{extra:{FIXTURE_ORIGINAL_EXIT:'1',FIXTURE_LS_REMOTE:'absent'}}));
 assert.equal(f.originalPublications().length,2,'a refused hand is retried, never consumed');assert.equal(f.repairs().length,0);
 assert.equal(f.entries().filter(e=>e.argv[0]==='request').length,0,'a refused hand needs no repair DATA');
 assert.equal(readFileSync(prefix+'.exit','utf8'),'1\n');assert.ok(existsSync(join(f.store,'refused','hand-'+sha(BLOCKER)+'.refused-1.exit')),'the first attempt is kept aside');
 const retry=JSON.parse(readFileSync(prefix+'.attempt.json','utf8')).retryOf;assert.equal(retry.attempt,'hand-'+sha(BLOCKER));assert.equal(retry.exit,1);assert.equal(retry.setAsideAs,'refused/hand-'+sha(BLOCKER)+'.refused-1');assert.ok(retry.stamp,'the retry chain names its original attempt, exit and stamp');
});
callerCase('CW07','a fresh objective send failure records its actual terminal before the same-ID repair request',f=>{
 const prefix=join(f.store,'objective-'+sha('same-source-escalation'));f.env.FIXTURE_ORIGINAL_EXIT='3';acceptOwned(emitObjective(f,{rounds:2}));
 exactRequest(f,{producer:'objective',prefix});assert.equal(f.originalPublications().length,1,'fresh original send is attempted once');assert.equal(f.repairs().length,0);
 for(const e of f.entries().filter(e=>e.argv[0]==='request'))assert.equal(JSON.parse(e.original_terminal).status,3,'actual objective parent terminal precedes request');
 assert.equal(JSON.parse(readFileSync(prefix+'.attempt.json','utf8')).escalation,'same-source-escalation');
});
callerCase('CW08','a new unattended normal build hand targets Cloud source inspection without human merge/retry instructions',f=>{
 acceptOwned(runBuild(f,`raise_hand ${quote(BLOCKER)}`));const rows=f.originalPublications();assert.equal(rows.length,1);assert.equal(rows[0].args[0],'batch');
 const op=rows[0].ops[0];assert.equal(op.who,'cloud lane');assert.match(op.need,/source|inspect/i);assert.match(op.need,/protected|review|checks|CI/);
 assert.doesNotMatch(op.need,/person on the Mac|owner.*merge|Dan.*merge|delete.{0,40}claim|claim.{0,40}delet|row should be retried|retry (?:the )?(?:row|task|claim)/i);
 assert.equal(f.repairs().length,0,'a submitted fresh normal hand does not manufacture a repair notice');
});
callerCase('CW09','actual lane tick startup drains one queued request exactly once under its real FD8 owner',f=>{
 const o=original(f,'build',{exit:2,legacy:true});request(f,o);
 const text=readFileSync(join(SOURCE,'scripts/mac/lane-tick.sh'),'utf8'),a=text.indexOf('# Resolve once before use_tick_worktree'),b=text.indexOf('# An UNCHANGED tick',a);assert.ok(a>=0&&b>a);
 const script=join(f.parent,'startup-caller.sh');put(script,`set -u\nDRY=0\nREPO_ROOT=${quote(f.root)}\nsay(){ printf '%s\\n' "$1"; }\n${text.slice(a,b)}\nexit 0\n`);
 const first=spawnSync('/bin/bash',[script],{cwd:f.root,env:f.env,encoding:'utf8'});acceptOwned(first);
 const drains=f.entries().filter(e=>e.argv[0]==='drain');assert.equal(drains.length,1,'actual startup invokes one drain');assert.equal(drains[0].ppid,Number(drains[0].argv[3]));oneDifferentRepair(f,o);
 const second=spawnSync('/bin/bash',[script],{cwd:f.root,env:f.env,encoding:'utf8'});acceptOwned(second);assert.equal(f.entries().filter(e=>e.argv[0]==='drain').length,2);oneDifferentRepair(f,o);
});
callerCase('CW10','generic successful readback without exact resolved blob never renews an original build episode',f=>{
 const o=original(f,'build',{exit:0,legacy:true}),desired=join(f.store,'hand-'+sha(BLOCKER)),base=o.prefix.split('/').at(-1);
 for(const name of Object.keys(o.initial).filter(n=>n.startsWith(base+'.')))renameSync(o.prefix+name.slice(base.length),desired+name.slice(base.length));
 const intent=JSON.parse(readFileSync(desired+'.attempt.json','utf8'));intent.receipt=desired+'.submission.json';writeFileSync(desired+'.attempt.json',enc(intent));o.prefix=desired;o.initial=rawFiles(desired);
 acceptOwned(runBuild(f,`raise_hand ${quote(BLOCKER)}\nraise_hand ${quote(BLOCKER)}`,{extra:{FIXTURE_ORIGINAL_READBACK_EXIT:'0'}}));
 assert.equal(f.originalPublications().length,0,'exit0 without exact current cleared-hand identity cannot issue another original hand');assert.equal(f.repairs().length,0);preserved(o.prefix,o.initial);
});

// New independently discovered gap: legacy exit1/2 alone is not a
// producing-source-bound proof that publication did not occur. Ten minutes, a
// changed result or a new tick owner cannot clear that original uncertainty.
for(const [id,status] of [['CW11',1],['CW12',2]])callerCase(id,'legacy missing heartbeat receipt after exit'+status+' remains HELD with DATA instead of a new heartbeat',f=>{
 const o=original(f,'heartbeat',{exit:status,legacy:true,receipt:false});
 utimesSync(join(f.store,'.sg-last-heartbeat-attempt'),new Date(0),new Date(0));
 acceptOwned(owned(f,heartbeatScript(f,'heartbeat || :\nRESULT="different outcome does not clear missing provenance"\nheartbeat || :')));
 exactRequest(f,o);const records=f.dataRequests();assert.equal(records[0].value.provenance,'UNVERIFIED');
 assert.equal(f.originalPublications().length,0,'legacy exit1/2 and elapsed ten minutes never prove no original publication');
 oneDifferentRepair(f,o);assert.equal(existsSync(o.prefix+'.submission.json'),false,'missing old receipt is never synthesized or adopted');
 assert.equal(readFileSync(join(f.store,'.sg-last-heartbeat-attempt'),'utf8'),o.intent.attempt,'old unknown pointer remains unchanged');
 preserved(o.prefix,o.initial);
});
