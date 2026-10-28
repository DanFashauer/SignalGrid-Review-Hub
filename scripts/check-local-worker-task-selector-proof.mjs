import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// C0 is the fixed Unicode range U+0000..U+001F. Check real completed
// assertions, so an accidentally empty enumeration cannot certify this gate.
const controls=Array.from({length:0x20},(_,code)=>`reject C0 ${code} in either scope`);
export function verifyC0Proof(text,exitCode){
  assert.equal(exitCode,0,'C0 proof process must exit successfully');
  const count=name=>{
    const values=[...text.matchAll(new RegExp(`^# ${name} ([0-9]+)$`,'gm'))];
    assert.equal(values.length,1,`One complete TAP ${name} counter required`);
    return Number(values[0][1]);
  };
  const tests=count('tests'),passed=count('pass');
  assert.equal(count('fail'),0,'Failed C0 assertion');
  for(const name of ['cancelled','skipped','todo'])assert.equal(count(name),0,`No ${name} proof accepted`);
  assert.equal(passed,tests,'Every executed assertion must pass');
  const names=[...text.matchAll(/^ok [0-9]+ - (.+)$/gm)].map(match=>match[1]);
  assert.equal(names.length,tests,'TAP counters must match actual completed test records');
  for(const name of [...controls,'ordinary in-scope task remains eligible']){
    assert.equal(names.filter(value=>value===name).length,1,`Exactly one completed proof required: ${name}`);
  }
  return {tests,passed,controlCases:controls.length};
}

export function selfTest(){
  const names=[...controls,'ordinary in-scope task remains eligible'];
  const tap=values=>values.map((name,index)=>`ok ${index+1} - ${name}`).join('\n')+
    `\n# tests ${values.length}\n# pass ${values.length}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
  const good=tap(names);
  assert.equal(verifyC0Proof(good,0).controlCases,0x20);
  const bad=[
    [tap([]),0], // The scanner/enumerator found nothing, despite process exit0.
    [tap(names.slice(1)),0],
    [tap(names.filter(name=>!name.startsWith('reject C0 '))),0],
    [tap([...names,names[0]]),0],
    [good.replace('# skipped 0','# skipped 1'),0],
    [good.replace('# cancelled 0','# cancelled 1'),0],
    [good.replace('# todo 0','# todo 1'),0],
    [good.replace('# fail 0','# fail 1'),0],
    [good.replace('# pass 33','# pass 32'),0],
    [good+'# tests 33\n',0],
    [good.replace(/^ok 1 - .+\n/,''),0],
    [good,1],
  ];
  for(const [output,code] of bad)assert.throws(()=>verifyC0Proof(output,code));
  return {positive:1,negative:bad.length,skipped:0};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  assert(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--self-test'),'Unknown C0 gate arguments');
  const tested=selfTest();
  console.log(`C0 proof envelope self-test PASSED: ${tested.positive} positive / ${tested.negative} negative / 0 skipped`);
  if(process.argv[2]!=='--self-test'){
    const result=spawnSync(process.execPath,['--test','--test-reporter=tap',
      'scripts/mac/local-brain/test/task-selector-control-scope.test.mjs',
      'scripts/mac/local-brain/test/task-selector.test.mjs'],
      {cwd:resolve(fileURLToPath(new URL('..',import.meta.url))),encoding:'utf8',timeout:60000,maxBuffer:2_000_000});
    assert.ifError(result.error);assert.equal(result.signal,null,'C0 proof process terminated by signal');
    process.stdout.write(result.stdout);process.stderr.write(result.stderr);
    const proof=verifyC0Proof(result.stdout,result.status);
    console.log(`C0 task-selector proof PASSED: ${proof.controlCases} control cases, ${proof.tests} total tests, 0 skipped`);
  }
}
