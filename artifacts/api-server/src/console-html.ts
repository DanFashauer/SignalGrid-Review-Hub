// The Trusted Room Entry operational-intelligence console, served inline at
// GET /console. Self-contained (inline CSS/JS, same-origin /api calls) so it
// runs identically in Docker and locally with no static-asset plumbing.
// Brand: SignalGrid warm charcoal + muted teal; decisions in the product's own
// allow / step-up / restrict / deny colors.

export const CONSOLE_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SignalGrid — Trusted Room Entry</title>
<style>
  :root{
    --bg:#14171A;--panel:#191E22;--card:#1E2429;--ink:#F2F0EA;--soft:#AEB4AF;--faint:#7f8781;
    --line:#2A3137;--accent:#74ABA5;--allow:#6FA88C;--stepup:#C29A66;--restrict:#C99B6B;--deny:#C07474;
    --mono:ui-monospace,"IBM Plex Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  }
  @media (prefers-color-scheme:light){:root{
    --bg:#F1EEE7;--panel:#FAF8F3;--card:#FFF;--ink:#1B1F21;--soft:#4C534E;--faint:#767c77;
    --line:#E4DFD3;--accent:#38726D;--allow:#4E7B5E;--stepup:#96703B;--restrict:#8a6a3b;--deny:#8C4B4B;
  }}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
  .wrap{max-width:1180px;margin:0 auto;padding:clamp(1rem,3vw,2rem)}
  header{display:flex;align-items:center;gap:.7rem;border-bottom:1px solid var(--line);padding-bottom:1.1rem;margin-bottom:1.4rem;flex-wrap:wrap}
  .glyph{width:28px;height:28px;border-radius:7px;background:linear-gradient(150deg,var(--accent),color-mix(in srgb,var(--accent) 60%,#000));position:relative;flex:none}
  .glyph::before,.glyph::after{content:"";position:absolute;background:var(--bg)}
  .glyph::before{width:2px;height:58%;left:50%;top:21%;transform:translateX(-50%)}
  .glyph::after{height:2px;width:58%;top:50%;left:21%;transform:translateY(-50%)}
  .brand{font-family:var(--mono);font-weight:600}.brand span{color:var(--accent)}
  .sub{margin-left:auto;font-family:var(--mono);font-size:.66rem;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);border:1px solid var(--line);padding:.28rem .55rem;border-radius:99px}
  h1{font-size:1.15rem;margin:.1rem 0 .2rem}
  .lead{color:var(--soft);font-size:.9rem;margin:0 0 1.3rem;max-width:66ch}
  .grid{display:grid;grid-template-columns:270px 1fr;gap:1.3rem;align-items:start}
  @media (max-width:820px){.grid{grid-template-columns:1fr}}
  .scn{display:flex;flex-direction:column;gap:.5rem}
  .scn h2,.panel h2{font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin:0 0 .3rem}
  button.s{text-align:left;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--faint);border-radius:8px;padding:.6rem .7rem;color:var(--ink);cursor:pointer;font:inherit;transition:border-color .15s,transform .1s}
  button.s:hover{border-left-color:var(--accent)}
  button.s.active{border-left-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--card))}
  button.s .t{font-weight:600;font-size:.86rem}
  button.s .d{font-size:.74rem;color:var(--faint);margin-top:.15rem}
  .out{display:flex;flex-direction:column;gap:1.1rem;min-height:200px}
  .placeholder{color:var(--faint);font-size:.9rem;padding:2rem 0;text-align:center;border:1px dashed var(--line);border-radius:10px}
  .verdict{border-radius:10px;padding:1rem 1.15rem;border:1px solid var(--line);border-left:5px solid var(--tone);background:var(--card)}
  .verdict .row{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
  .pill{font-family:var(--mono);font-size:.66rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:.26rem .55rem;border-radius:99px;color:var(--tone);background:color-mix(in srgb,var(--tone) 15%,transparent);border:1px solid color-mix(in srgb,var(--tone) 32%,transparent)}
  .verdict .why{margin:.6rem 0 0;font-size:.9rem;color:var(--soft)}
  .verdict .sum{margin:.5rem 0 0;font-size:.86rem}
  .codes{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.55rem}
  .code{font-family:var(--mono);font-size:.68rem;padding:.2rem .45rem;border-radius:5px;background:color-mix(in srgb,var(--tone) 12%,transparent);color:var(--tone)}
  .tone-allow{--tone:var(--allow)}.tone-step_up{--tone:var(--stepup)}.tone-restrict{--tone:var(--restrict)}.tone-deny{--tone:var(--deny)}
  .panel{border:1px solid var(--line);border-radius:10px;padding:1rem 1.1rem;background:var(--card)}
  .sig{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.5rem;margin-top:.2rem}
  .s-item{border:1px solid var(--line);border-radius:7px;padding:.45rem .55rem;background:var(--panel)}
  .s-item .k{font-family:var(--mono);font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
  .s-item .v{font-size:.82rem;font-weight:600;margin-top:.15rem}
  .s-item .v.ok{color:var(--allow)}.s-item .v.warn{color:var(--stepup)}.s-item .v.bad{color:var(--deny)}
  .acts{display:flex;flex-direction:column;gap:.5rem;margin-top:.2rem}
  .act{display:flex;align-items:center;gap:.7rem;border:1px solid var(--line);border-radius:8px;padding:.6rem .75rem;background:var(--panel)}
  .act .body{flex:1;min-width:0}
  .act .label{font-weight:600;font-size:.87rem}
  .act .meta{font-size:.74rem;color:var(--faint);margin-top:.1rem}
  .act .target{font-family:var(--mono);font-size:.66rem;color:var(--soft)}
  .disp{font-family:var(--mono);font-size:.62rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:.24rem .48rem;border-radius:99px;white-space:nowrap;color:var(--dt);background:color-mix(in srgb,var(--dt) 14%,transparent);border:1px solid color-mix(in srgb,var(--dt) 30%,transparent)}
  .d-auto{--dt:var(--soft)}.d-applied{--dt:var(--allow)}.d-assist{--dt:var(--stepup)}.d-step_up{--dt:var(--stepup)}.d-blocked{--dt:var(--deny)}
  .confirm{font:inherit;font-size:.74rem;font-weight:600;cursor:pointer;border:1px solid var(--stepup);color:var(--stepup);background:color-mix(in srgb,var(--stepup) 12%,transparent);border-radius:7px;padding:.32rem .6rem}
  .confirm:hover{background:color-mix(in srgb,var(--stepup) 22%,transparent)}
  .lock{font-family:var(--mono);font-size:.6rem;color:var(--faint)}
  footer{margin-top:1.6rem;padding-top:1rem;border-top:1px solid var(--line);font-family:var(--mono);font-size:.66rem;color:var(--faint)}
  a{color:var(--accent)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <span class="glyph"></span>
    <span class="brand">Signal<span>Grid</span></span>
    <span class="sub">Trusted Room Entry · Simulation</span>
  </header>
  <h1>Context-aware trust &amp; orchestration — Phase 1</h1>
  <p class="lead">A synthetic nurse with a managed device approaches a room. SignalGrid runs the real decision core over identity, device posture, custody, badge binding, security baseline and workflow risk — then orchestrates the downstream actions. Sensitive steps (a controlled-room door, a PHI display) are never automatic; they wait for a clinician to confirm.</p>
  <div class="grid">
    <aside class="scn">
      <h2>Scenarios</h2>
      <div id="scenarios"></div>
    </aside>
    <main class="out" id="out">
      <div class="placeholder">Select a scenario to evaluate a room entry.</div>
    </main>
  </div>
  <footer>Synthetic, public-safe fixtures — no real hospital, patient data, or vendor system. SignalGrid is a planner: it never actuates a real device. Decisions shown in the product's allow / step-up / restrict / deny colors.</footer>
</div>
<script>
const $=(s,el=document)=>el.querySelector(s);
let current=null, confirmed=new Set();
async function j(url,opts){const r=await fetch(url,opts);return r.json();}
function sigClass(k,v){
  const bad=['disabled','noncompliant','absent','withdrawn','forced','tampered','drifted','offline','faulted','stale','false'];
  const ok=['enabled','compliant','present','bound','aligned','fresh','docked','nominal','true','supported'];
  const s=String(v).toLowerCase();
  if(bad.some(b=>s.includes(b)))return'bad';
  if(ok.some(o=>s.includes(o)))return'ok';
  return'';
}
async function load(){
  const data=await j('/api/sim/room-entry/scenarios');
  const box=$('#scenarios');box.innerHTML='';
  data.scenarios.forEach(s=>{
    const b=document.createElement('button');b.className='s';b.dataset.id=s.id;
    b.innerHTML='<div class="t">'+s.title+'</div><div class="d">'+s.description+'</div>';
    b.onclick=()=>{current=s.id;confirmed=new Set();document.querySelectorAll('button.s').forEach(x=>x.classList.toggle('active',x.dataset.id===s.id));run();};
    box.appendChild(b);
  });
}
async function run(){
  if(!current)return;
  const data=await j('/api/sim/room-entry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenarioId:current,confirmedActionIds:[...confirmed]})});
  render(data);
}
function render(d){
  const out=$('#out');
  if(d.error){out.innerHTML='<div class="placeholder">'+d.message+'</div>';return;}
  const o=d.decision.outcome, mode=d.plan.mode;
  const codes=(d.decision.reasonCodes||[]).map(c=>'<span class="code">'+c+'</span>').join('');
  const sig=Object.entries(d.signals).map(([k,v])=>{
    const cls=sigClass(k,v);
    return '<div class="s-item"><div class="k">'+k.replace(/([A-Z])/g,' $1').trim()+'</div><div class="v '+cls+'">'+String(v)+'</div></div>';
  }).join('');
  const acts=d.plan.actions.map(a=>{
    const canConfirm=a.disposition==='assist';
    const right=canConfirm
      ? '<button class="confirm" data-act="'+a.id+'">Confirm</button>'
      : (a.requiresConfirmation?'<span class="lock">held</span>':'');
    return '<div class="act"><div class="body"><div class="label">'+a.label+
      (a.sensitive?' &middot; <span class="lock">sensitive</span>':'')+
      '</div><div class="meta"><span class="target">'+a.targetSystem+'</span> — '+a.reason+'</div></div>'+
      '<span class="disp d-'+a.disposition+'">'+a.disposition.replace('_','-')+'</span>'+right+'</div>';
  }).join('');
  out.innerHTML=
    '<div class="verdict tone-'+o+'"><div class="row"><span class="pill">Decision · '+o.replace('_','-')+'</span>'+
      '<span class="pill">Orchestration · '+mode+'</span>'+
      '<span style="font-family:var(--mono);font-size:.7rem;color:var(--faint)">'+d.context.roomId+' · '+d.context.unit+' · '+d.context.sensitivity+'</span></div>'+
      '<p class="why">'+d.decision.explanation+'</p>'+(codes?'<div class="codes">'+codes+'</div>':'')+
      '<p class="sum">'+d.plan.summary+'</p></div>'+
    '<div class="panel"><h2>Signals evaluated</h2><div class="sig">'+sig+'</div></div>'+
    '<div class="panel"><h2>Downstream orchestration</h2><div class="acts">'+acts+'</div></div>';
  out.querySelectorAll('.confirm').forEach(b=>b.onclick=()=>{confirmed.add(b.dataset.act);run();});
}
load();
</script>
</body>
</html>`;
