/* Ordinary disposable-fixture snapshot correctness controls, not a security claim. */
const fs=require('node:fs'),path=require('node:path');
const [sourceFile,root,mode]=process.argv.slice(2),tree=path.join(root,'tree'),target=path.join(tree,'target');
const raw=fs.readFileSync(sourceFile,'utf8'),start=raw.indexOf('function leaseTree(path) {'),end=raw.indexOf('\nfunction leaseContext(f)',start);
if(start<0||end<=start)throw Error('complete actual leaseTree source missing');
const original=fs.lstatSync(target),canary=fs.lstatSync(path.join(root,'canary')),replacement=fs.lstatSync(path.join(root,'replacement'));
const identity=s=>[s.dev,s.ino],equal=(a,b)=>a[0]===b[0]&&a[1]===b[1];
let swapped=false,readFault=false;const descriptors=new Set(),reads=[],events=[],opened=[];
function swap(kind){if(swapped)return;swapped=true;fs.renameSync(target,path.join(root,'preserved-original'));
 if(kind==='symlink')fs.symlinkSync(path.join(root,'canary'),target);else fs.renameSync(path.join(root,'replacement'),target);
 events.push(kind);
}
function lstatSync(p){const info=fs.lstatSync(p);if(p===target&&!swapped){if(mode==='symlink-after-lstat')swap('symlink');else if(mode==='regular-before-open')swap('regular');}return info;}
function openSync(p,flags,...rest){const fd=fs.openSync(p,flags,...rest);descriptors.add(fd);opened.push({path:p,flags,identity:identity(fs.fstatSync(fd))});
 if(p===target&&mode==='regular-after-open'&&!swapped)swap('regular');return fd;}
function closeSync(fd){fs.closeSync(fd);descriptors.delete(fd);}
function readFileSync(file,...args){
 if(typeof file!=='number'){
  // Faithful path-read boundary facade: real open, real descriptor read, exact
  // finally close. This lets the same after-open fault target old and new APIs.
  const fd=openSync(file,fs.constants.O_RDONLY);try{return readFileSync(fd,...args);}finally{closeSync(fd);}
 }
 const id=identity(fs.fstatSync(file));
 if(mode==='read-fault'&&!readFault&&equal(id,identity(original))){readFault=true;throw Error('controlled post-open read fault');}
 reads.push({identity:id,isCanary:equal(id,identity(canary)),isReplacement:equal(id,identity(replacement))});
 return fs.readFileSync(file,...args);
}
let payload;try{
 const leaseTree=new Function('existsSync','lstatSync','readFileSync','readdirSync','join','openSync','closeSync','fstatSync','constants',raw.slice(start,end)+'\nreturn leaseTree;')(
  fs.existsSync,lstatSync,readFileSync,fs.readdirSync,path.join,openSync,closeSync,fs.fstatSync,fs.constants);
 const rows=leaseTree(tree);payload={ok:true,rows};
}catch(error){payload={ok:false,error:String(error&&error.message||error)};}
payload.reads=reads;payload.events=events;payload.opened=opened;payload.unclosedBeforeHarnessCleanup=descriptors.size;
// Harness cleanup cannot hide a source FD leak: count it first, then positively
// close only descriptors opened by this fixture before its original exit.
for(const fd of [...descriptors])closeSync(fd);
console.log(JSON.stringify(payload));
