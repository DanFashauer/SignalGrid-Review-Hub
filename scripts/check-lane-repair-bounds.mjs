// FROZEN INDEPENDENT FOLLOW-UP NEGATIVES; UNRUN. Root selects actual admitted RED/GREEN.
// Source copy + disposable Git + the real Bash FD8 guard. Only publication transport
// is replaced by a local argv/ops capture. This is not provider/host containment proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
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
let activeFixtureParent = null;
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
 activeFixtureParent=parent;
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
 if(producer==='objective')put(prefix+'.terminal.json',enc({status:exit,signal:null,error:null,stdout:'original escalation unconfirmed '+secret,stderr:''}));
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
function frozen(id,name,body) { test(id+' '+name,{concurrency:false},()=>{let f,passed=false;activeFixtureParent=null;try{f=fixture();body(f);passed=true;}finally{if(passed&&f)f.clean();else if(f?.parent||activeFixtureParent)console.error('FROZEN FAILURE EVIDENCE RETAINED '+id+' '+(f?.parent||activeFixtureParent));activeFixtureParent=null;}}); }


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
function callerCase(id,name,body) {test(id+' '+name,{concurrency:false},()=>{let f,passed=false;activeFixtureParent=null;try{f=callerFixture();body(f);passed=true;}finally{if(passed&&f)f.clean();else if(f?.parent||activeFixtureParent)console.error('FROZEN FAILURE EVIDENCE RETAINED '+id+' '+(f?.parent||activeFixtureParent));activeFixtureParent=null;}});}
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
 put(file,`import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {mkdirSync,readFileSync,readdirSync,existsSync,writeFileSync,rmSync} from 'node:fs';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';import {deliveryRecordDirectory} from ${JSON.stringify('file://'+join(f.root,'scripts/lib/lane-attempt-store.mjs'))};\nconst ROOT=${JSON.stringify(f.root)},STATE_REL='frozen-state.json',STAMP_REL='node_modules/frozen-objective-stamp.json';\n${text.slice(a,b)}\nconst state=${JSON.stringify(state)};for(let n=0;n<${rounds};n++){const r=emit(state,{write:true,deliver:true});console.log(r.lines.join('\\n'));}\n`);
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


// Follow-up API contract: repair-status is pure read-only and cannot authorize
// another original send. Exit2 means a source-bound normal parent0 and push0;
// exit0 means failed/unknown diagnostic evidence. No DATA record is written.
const CURSOR='repair-drain.cursor';
function requestNames(f) {return readdirSync(f.store).filter(n=>n.endsWith('.repair-request.json')).sort();}
function status(f,o) {return f.cli(['repair-status',f.root,o.producer,o.prefix]);}
function drainCommand(f,suffix='') {return `${quote(process.execPath)} ${quote(join(f.root,MODULE))} drain ${quote(f.root)} "$TICK_OWNER_TOKEN" "$$" ${suffix}`;}
function drain(f,{extra={},suffix='',mustHold=false}={}) {
 const action=drainCommand(f,suffix)+'\n_rc=$?\n'+(mustHold?'[ "$_rc" != 0 ] || exit 89':'[ "$_rc" = 0 ] || exit "$_rc"')+'\nprintf "ORDINARY_TICK_CONTINUES\\n"\n';
 const r=owned(f,action,{extra});acceptOwned(r);assert.match(r.stdout,/ORDINARY_TICK_CONTINUES/,'a repair HOLD does not terminate the ordinary owning tick');return r;
}
function renameOriginal(f,o,prefix) {
 const base=o.prefix.split('/').at(-1);
 for(const name of Object.keys(o.initial).filter(n=>n.startsWith(base+'.')))renameSync(o.prefix+name.slice(base.length),prefix+name.slice(base.length));
 if(o.producer!=='heartbeat') {const intent=JSON.parse(readFileSync(prefix+'.attempt.json','utf8'));intent.receipt=prefix+'.submission.json';writeFileSync(prefix+'.attempt.json',enc(intent));}
 o.prefix=prefix;o.initial=rawFiles(prefix);return o;
}
function uniqueBuild(f,index,{exit=3}={}) {
 const o=original(f,'build',{exit});return renameOriginal(f,o,join(f.store,'hand-'+sha('follow-up-original-'+index)));
}
function changePushStatus(o,statusCode) {
 const rawPath=o.prefix+'.submission.json.push.raw.json',terminalPath=o.prefix+'.submission.json.push.json';
 const raw=JSON.parse(readFileSync(rawPath,'utf8')),terminal=JSON.parse(readFileSync(terminalPath,'utf8'));
 raw.status=statusCode;const bytes=enc(raw);terminal.status=statusCode;terminal.raw_capture_sha256=sha(bytes);
 writeFileSync(rawPath,bytes);writeFileSync(terminalPath,enc(terminal));o.initial=rawFiles(o.prefix);
}
function watchReads(f,{prefixes=[]}={}) {
 const path=join(f.parent,'read-observer-'+(++serial)+'.cjs'),log=join(f.parent,'read-observer-'+serial+'.jsonl');
 put(path,`const fs=require('node:fs'),{syncBuiltinESMExports}=require('node:module');\nconst store=${JSON.stringify(f.store)},prefixes=${JSON.stringify(prefixes)},log=${JSON.stringify(log)};\nconst observe=(process.argv[1]||'').endsWith('/scripts/lib/lane-repair.mjs')&&process.argv[2]==='drain';const append=fs.appendFileSync.bind(fs);let writing=false;const emit=x=>{if(observe&&!writing){writing=true;try{append(log,JSON.stringify({pid:process.pid,ppid:process.ppid,entry:process.argv[1],mode:process.argv[2],...x})+'\\n')}finally{writing=false}}};\nconst rawOpen=fs.openSync;fs.openSync=function(p,...a){const s=String(p);if(s.startsWith(store+'/')&&(prefixes.some(x=>s.startsWith(x+'.'))||s.endsWith('.repair-request.json')))emit({op:'open',path:s});return rawOpen.call(this,p,...a)};\nconst rawReadDir=fs.readdirSync;fs.readdirSync=function(p,...a){if(String(p)===store)emit({op:'readdir'});return rawReadDir.call(this,p,...a)};\nconst rawOpenDir=fs.opendirSync;fs.opendirSync=function(p,...a){const d=rawOpenDir.call(this,p,...a);if(String(p)===store){emit({op:'opendir'});const read=d.readSync;d.readSync=function(...b){const e=read.apply(this,b);emit({op:'dir-entry',name:e?.name??null});return e}}return d};syncBuiltinESMExports();\n`);
 const options=[f.env.NODE_OPTIONS,'--require='+path].filter(Boolean).join(' ');
 return {extra:{NODE_OPTIONS:options},events:()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]};
}
function cursorBytes(f) {const p=join(f.store,CURSOR);assert.ok(existsSync(p),'bounded drain must retain its append-only progress hint');return readFileSync(p);}
function cursorAppendPreserved(before,after) {assert.equal(before.length%512,0,'cursor frame ABI is exactly512 bytes');assert.equal(after.length%512,0,'cursor remains frame aligned');assert.deepEqual(after.subarray(0,before.length),before,'earlier cursor frames never rewritten');}

frozen('BN01','repair-status suppresses only complete source-bound normal0 delivery, without DATA or new work authority',f=>{
 for(const producer of ['heartbeat','build','objective']) {
  const o=original(f,producer,{exit:0}),before=rawFiles(o.prefix),r=status(f,o);
  assert.equal(r.signal,null);assert.equal(r.status,2,'normal parent0 + source-bound exact original receipt/push0 is healthy, not a repair request');
  assert.equal(requestNames(f).length,0,'read-only status writes no repair DATA');assert.equal(f.calls().length,0,'status never publishes or retries');preserved(o.prefix,before);
 }
 noRemoteAttempt(f);
});
frozen('BN02','legacy0, failed parent and refused original push remain diagnostic DATA candidates, never healthy proof',f=>{
 const cases=[original(f,'heartbeat',{exit:0,legacy:true}),original(f,'objective',{exit:3}),original(f,'build',{exit:0})];
 changePushStatus(cases[2],1);
 for(const o of cases){const before=rawFiles(o.prefix),r=status(f,o);assert.equal(r.signal,null);assert.equal(r.status,0,'only complete original normal0/source/push0 proof may suppress diagnostics');preserved(o.prefix,before);}
 assert.equal(requestNames(f).length,0);assert.equal(f.calls().length,0);noRemoteAttempt(f);
});
frozen('BN03','any consumed notice prefix skips original evidence and Git proof before evaluation, using one namespace inventory',f=>{
 const originals=[];
 for(let n=0;n<12;n++) {
  const o=uniqueBuild(f,n),r=request(f,o);put(join(f.store,r.data.id+'.attempt.json'),'partial legacy notice; forever consumed\n');
  // Changed/large original evidence must not matter after this notice was consumed.
  put(o.prefix+'.readback.output',Buffer.alloc(1024*1024,65));o.initial=rawFiles(o.prefix);originals.push(o);
 }
 const watch=watchReads(f,{prefixes:originals.map(o=>o.prefix)}),beforeGit=existsSync(f.gitLog)?readFileSync(f.gitLog,'utf8').trim().split('\n').filter(Boolean).length:0;
 drain(f,{extra:watch.extra});assert.equal(f.calls().length,0);
 const events=watch.events();assert.equal(events.filter(e=>e.op==='open').length,0,'consumed notices require zero original/request proof reads');
 const inventory=events.filter(e=>['readdir','opendir'].includes(e.op));assert.equal(inventory.length,1,'one bounded namespace inventory, reused for every notice fence');
 const newGit=existsSync(f.gitLog)?readFileSync(f.gitLog,'utf8').trim().split('\n').filter(Boolean).slice(beforeGit).map(JSON.parse):[];
 assert.equal(newGit.filter(a=>a.includes('show')).length,0,'consumed history must never re-read committed original producer bodies');
 for(const o of originals)preserved(o.prefix,o.initial);
});
frozen('BN04','32 evaluations bound each drain and a durable round-robin cursor reaches an eligible request behind held history',f=>{
 for(let n=0;n<40;n++)put(join(f.store,'pending-heartbeat-'+n.toString(16).padStart(64,'0')+'.repair-request.json'),enc({version:1}));
 const o=uniqueBuild(f,80),r=request(f,o),watch=watchReads(f);
 drain(f,{extra:watch.extra});assert.equal(f.calls().length,0,'first page cannot scan through more than32 held requests to publish a later row');
 const touched=new Set(watch.events().filter(e=>e.op==='open').map(e=>e.path));assert.ok(touched.size>0&&touched.size<=32,'at most32 distinct request evaluations per drain');
 const before=cursorBytes(f);assert.ok(before.length>0);drain(f);
 oneRepair(f);const after=cursorBytes(f);assert.ok(after.length>before.length,'progress is append-only across actual owned drains');cursorAppendPreserved(before,after);
 assert.equal(f.calls()[0].ops[0].id,r.data.id,'earlier held history cannot starve a distinct later eligible request');preserved(o.prefix,o.initial);
});
frozen('BN05','namespace over65536 entries is an explicit repair HOLD while the actual ordinary tick continues',f=>{
 // Real disposable files exercise the actual inventory limit; no enumeration is mocked.
 for(let n=0;n<65537;n++)writeFileSync(join(f.store,'inventory-'+n.toString(16).padStart(8,'0')),'',{flag:'wx',mode:0o600});
 const watch=watchReads(f),r=drain(f,{extra:watch.extra,mustHold:true});assert.match(r.stderr+r.stdout,/held|hold|bound|inventory|namespace|limit/i,'overbound must not report a quiet empty repair queue');
 assert.equal(f.calls().length,0);const events=watch.events();assert.equal(events.filter(e=>e.op==='readdir').length,0,'bounded inventory cannot first allocate the whole directory via readdir');
 assert.ok(events.filter(e=>e.op==='dir-entry'&&e.name!==null).length<=65537,'inventory stops at the first overbound entry');
 assert.equal(existsSync(join(f.store,CURSOR)),false,'an incomplete inventory must not initialize/reset a progress cursor');
});
frozen('BN06','an unfinished cursor tail holds only repair consumption and is preserved byte exact without reset',f=>{
 const o=uniqueBuild(f,91);request(f,o);drain(f);oneRepair(f);const before=cursorBytes(f);assert.ok(before.length>0);
 const p=join(f.store,CURSOR);writeFileSync(p,Buffer.concat([before,Buffer.from('X')]),{mode:0o600});const damaged=readFileSync(p);
 const next=uniqueBuild(f,92);request(f,next);drain(f,{mustHold:true});oneRepair(f);assert.deepEqual(readFileSync(p),damaged,'partial cursor is never repaired, reset or appended automatically');preserved(next.prefix,next.initial);
});
frozen('BN07','a complete cursor frame with corrupted hash cannot be adopted as round-robin authority or reset',f=>{
 const o=uniqueBuild(f,93);request(f,o);drain(f);oneRepair(f);const p=join(f.store,CURSOR),before=cursorBytes(f);
 assert.ok(before.length>=512);const hex=[...before.toString('utf8').matchAll(/[a-f0-9]{64}/g)].at(-1);assert.ok(hex,'cursor retains a SHA256-shaped integrity field');const damaged=Buffer.from(before),at=hex.index;damaged[at]=damaged[at]===48?49:48;writeFileSync(p,damaged,{mode:0o600});
 const next=uniqueBuild(f,94);request(f,next);drain(f,{mustHold:true});oneRepair(f);assert.deepEqual(readFileSync(p),damaged);preserved(next.prefix,next.initial);
});
frozen('BN08','wrong inherited FD8 cannot append even progress hints or consume a different pending notice',f=>{
 const first=uniqueBuild(f,95);request(f,first);drain(f);oneRepair(f);const before=cursorBytes(f),next=uniqueBuild(f,96);request(f,next);
 drain(f,{suffix:'8<"$FIXTURE_WRONG_GUARD"',mustHold:true});oneRepair(f);assert.deepEqual(cursorBytes(f),before,'actual owner is required before cursor writes as well as notification intent');preserved(next.prefix,next.initial);
});
callerCase('CW13','a previously submitted healthy objective normal0 hand remains consumed without creating repair DATA or uncertainty mail',f=>{
 const o=original(f,'objective',{exit:0}),desired=join(f.store,'objective-'+sha('same-source-escalation'));renameOriginal(f,o,desired);
 const before=rawFiles(o.prefix);acceptOwned(emitObjective(f,{existingState:true,rounds:3}));
 assert.equal(f.originalPublications().length,0,'healthy prior escalation is never resent');
 assert.equal(f.dataRequests().length,0,'known complete source-bound normal0 hand is not a failed/unknown repair candidate');assert.equal(f.repairs().length,0);
 const statuses=f.entries().filter(e=>e.argv[0]==='repair-status');assert.ok(statuses.length>=1,'actual producer consults pure original-evidence status before deciding to queue DATA');
 for(const e of statuses)assert.deepEqual(e.argv.slice(0,4),['repair-status',f.root,'objective',o.prefix]);
 assert.equal(f.entries().filter(e=>e.argv[0]==='request').length,0,'healthy suppression never weakens the unchanged request CLI contract for real failures');preserved(o.prefix,before);
});
