"""Disposable local-Git/Node/Bash fixture, no live repository or service.

Actual producer code comes from the current public source root. The readback
protocol seam used only by hand tests supplies an explicit fixture observation
of the actual local refused push; the hand traverses the real producer/Git route.
No historical job, private helper, credential, provider or public route is invoked.
"""
from pathlib import Path
import base64
import hashlib
import json
import os
import shutil
import shlex
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
SOURCE = Path(os.environ['PUSH_RESULT_SOURCE_ROOT']).resolve()
NODE, GIT = os.environ['SG_CHECK_NODE'], os.environ['SG_CHECK_GIT']
ARTIFACT_ROOT = Path(os.environ['SG_CHECK_ARTIFACT_ROOT']).resolve()
BASE = 'SignalGrid_Alpha'
PREFIX = 'refused delivery observation '
sha = lambda raw: hashlib.sha256(raw).hexdigest()


class PushFixture:
    def __init__(self, *, reject='first', hand_outcome='accepted'):
        self.root = Path(tempfile.mkdtemp(prefix='sg-original-push-', dir=ARTIFACT_ROOT)).resolve()
        self.repo = self.root / 'repo'; self.repo.mkdir()
        self.remote = self.root / 'remote.git'
        self.bin = self.root / 'bin'; self.bin.mkdir()
        self.git_log = self.root / 'git-calls.jsonl'
        self.gh_log = self.root / 'gh-calls.jsonl'
        self.push_observed = self.root / 'actual-original-Git-results.jsonl'
        self.ref_observed = self.root / 'actual-exact-ref-GET-results.jsonl'
        self.before_push = self.root / 'pre-push-receipt.jsonl'
        self.protocol_calls = self.root / 'readback-protocol-seam.jsonl'
        self.heartbeat_scopes = self.root / 'heartbeat-scopes.jsonl'
        self.hold_callbacks = self.root / 'unit-generic-HOLD-callbacks.log'
        self.protocol_changes = {}
        self.uncertain = False
        # Preserve actual HOME while isolating disposable Git from inherited
        # repository redirection, user configuration and injected Node options.
        self.env = dict(os.environ)
        for key in list(self.env):
            if key.startswith('GIT_') or key in ('NODE_OPTIONS', 'NODE_PATH'):
                del self.env[key]
        self.env.update({'PATH': str(self.bin) + ':' + str(Path(NODE).parent) + ':' + str(Path(GIT).parent) + ':/usr/bin:/bin',
            'TMPDIR': str(self.root), 'LANG': 'C',
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
            'GIT_TERMINAL_PROMPT': '0', 'SIGNALGRID_LANE': 'mac'})
        self.call_number = 0
        self.git(['init', '-q', '-b', BASE])
        for key, value in [('user.name', 'Original push fixture'), ('user.email', 'push@example.invalid'),
                           ('commit.gpgsign', 'false'), ('core.hooksPath', '/dev/null')]:
            self.git(['config', key, value])
        self.file('scripts/lane-deliver.mjs', (SOURCE / 'scripts/lane-deliver.mjs').read_bytes())
        # Copy the current import closure rather than a historical private source.
        for entry in sorted((SOURCE / 'scripts/lib').glob('*.mjs')):
            if entry.is_symlink() or not entry.is_file():
                raise AssertionError('current fixture library must be an ordinary source file')
            self.file('scripts/lib/' + entry.name, entry.read_bytes())
        for name in ['check-lane-messages.mjs', 'check-scheduled-routines.mjs',
                     'check-surface-review-coverage.mjs', 'raised-hands.mjs', 'check-raised-hands.mjs']:
            self.file('scripts/' + name, b'process.exit(0);\n')  # Explicit unrelated gate seam.
        self.file('docs/agent/SURFACE_REVIEW_COVERAGE.md', b'owned gate fixture\n')
        self.file('docs/agent/scheduled-routines.json', json.dumps({'routines': [
            {'id': 'mac-lane-tick', 'heartbeatPath': 'artifacts/agent-heartbeats/mac-lane-tick.json'}]}).encode())
        self.file('artifacts/agent-heartbeats/mac-lane-tick.json', b'{"firedAt":"2026-10-24T07:30:38Z","result":"old fixture"}\n')
        self.file('scripts/raise-hand.mjs', b'''import fs from 'node:fs';import path from 'node:path';
const a=process.argv.slice(2),get=k=>a[a.indexOf(k)+1],id=get('--id');
if(!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id??''))process.exit(2);
const root=process.env.SIGNALGRID_LANE_REPO,dir=path.join(root,'artifacts/raised-hands');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify({id,who:get('--who'),doing:get('--doing'),blocked:get('--blocked'),need:get('--need'),where:get('--where'),domain:get('--domain'),status:'open'})+'\\n',{flag:'wx'});
console.log('wrote artifacts/raised-hands/'+id+'.json');\n''')
        self.git(['add', '.']); self.git(['commit', '-qm', 'owned canonical fixture source'])
        self.base = self.git(['rev-parse', 'HEAD']).strip()
        self.git(['init', '-q', '--bare', str(self.remote)])
        self.git(['remote', 'add', 'origin', str(self.remote)])
        self.git(['push', '-q', 'origin', BASE])
        # Distinguish the producing source HEAD from canonical base and the new
        # delivery commit. No task mutation may confuse these three identities.
        self.file('producer-only-provenance', b'public source fixture; not a delivered artifact\n')
        self.git(['add', '.']); self.git(['commit', '-qm', 'different producing source head'])
        self.producer_head = self.git(['rev-parse', 'HEAD']).strip()
        self.initial_refs = self.refs()
        self._wrappers(hand_outcome)
        hook_count = self.remote / 'fixture-rejection-count'
        hook = '#!/bin/sh\nwhile read old new ref; do\n'
        hook += ' case "$ref" in refs/heads/SignalGrid_Alpha) echo "GH013 canonical branch requires protected PR" >&2; exit 1;; esac\n'
        if reject == 'first':
            hook += ' if [ ! -e ' + json.dumps(str(hook_count)) + ' ]; then printf 1 > ' + json.dumps(str(hook_count)) + '; echo "GH013 fixture remote refused this original push" >&2; exit 1; fi\n'
        elif reject == 'always':
            hook += ' echo "GH013 fixture remote refused this push" >&2; exit 1\n'
        elif reject != 'never':
            raise ValueError('fixture hook mode differs')
        hook += 'done\nexit 0\n'
        path = self.remote / 'hooks/pre-receive'; path.write_text(hook); path.chmod(0o755)
        initialized = self.call([NODE, str(self.repo / 'scripts/lib/lane-attempt-store.mjs'), 'init', str(self.repo)])
        if initialized.returncode:
            raise AssertionError('owned disposable store init failed: ' + initialized.stderr)
        self.records = Path(initialized.stdout.strip())
        self.attempt = '20261031T000000Z-1000'
        self.receipt = self.records / ('.sg-heartbeat-' + self.attempt + '.submission.json')
        self.log = self.records / ('.sg-heartbeat-' + self.attempt + '.log')
        self.exit = self.records / ('.sg-heartbeat-' + self.attempt + '.exit')
        self.pointer = self.records / '.sg-last-heartbeat-attempt'
        self.last = self.records / '.sg-last-heartbeat-result'
        self.source_sha = sha((self.repo / 'scripts/lane-deliver.mjs').read_bytes())

    def call(self, args, *, cwd=None, env=None):
        # The original child is awaited without a timeout or forced signal. All
        # artifacts remain until the public parent verifies the whole suite.
        self.call_number += 1
        prefix = self.root / ('process-%04d' % self.call_number)
        prefix.with_suffix('.intent.json').write_text(json.dumps({'argv': args, 'cwd': str(cwd or self.repo)}) + '\n')
        try:
            result = subprocess.run(args, cwd=cwd or self.repo, env=env or self.env,
                                    capture_output=True)
        except BaseException:
            self.uncertain = True
            raise
        prefix.with_suffix('.stdout.raw').write_bytes(result.stdout)
        prefix.with_suffix('.stderr.raw').write_bytes(result.stderr)
        prefix.with_suffix('.terminal.json').write_text(json.dumps({'returncode': result.returncode,
            'signal': -result.returncode if result.returncode < 0 else None,
            'stdout_sha256': sha(result.stdout), 'stderr_sha256': sha(result.stderr)}) + '\n')
        return subprocess.CompletedProcess(result.args, result.returncode,
            result.stdout.decode('utf-8'), result.stderr.decode('utf-8'))

    def file(self, name, raw):
        path = self.repo / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)

    def git(self, args, cwd=None):
        result = self.call([GIT, '-c', 'core.hooksPath=/dev/null', *args], cwd=cwd)
        if result.returncode:
            raise AssertionError('owned disposable Git failed: ' + result.stderr)
        return result.stdout

    def refs(self):
        return self.git(['for-each-ref', '--format=%(refname) %(objectname)'], cwd=self.remote)

    @staticmethod
    def rows(path):
        return [json.loads(row) for row in path.read_text().splitlines()] if path.exists() else []

    def _wrappers(self, hand_outcome):
        git = f'''#!{NODE}
import {{spawnSync}} from 'node:child_process';import fs from 'node:fs';
const a=process.argv.slice(2);fs.appendFileSync({json.dumps(str(self.git_log))},JSON.stringify(a)+'\\n');
if(a[0]==='remote'&&a[1]==='get-url'&&a[2]==='origin'){{console.log('https://github.com/fixture/route.git');process.exit(0)}}
if(a[0]==='push'){{const p=process.env.FIXTURE_EXPECT_RECEIPT;fs.appendFileSync({json.dumps(str(self.before_push))},JSON.stringify({{path:p??null,receipt:p&&fs.existsSync(p)?fs.readFileSync(p,'utf8'):null}})+'\\n')}}
let r;const override={json.dumps(str(self.root / 'ref-response-override.json'))};
if(a[0]==='ls-remote'&&fs.existsSync(override)){{const v=JSON.parse(fs.readFileSync(override,'utf8'));r={{status:v.status,signal:null,error:null,stdout:Buffer.from(v.stdout??''),stderr:Buffer.from(v.stderr??'')}}}}
else r=spawnSync({json.dumps(GIT)},a,{{encoding:null,maxBuffer:16*1024*1024}});
if(a[0]==='push')fs.appendFileSync({json.dumps(str(self.push_observed))},JSON.stringify({{args:a,status:r.status,signal:r.signal??null,error:r.error?.code??null,stdout:(r.stdout??Buffer.alloc(0)).toString('base64'),stderr:(r.stderr??Buffer.alloc(0)).toString('base64')}})+'\\n');
if(a[0]==='ls-remote')fs.appendFileSync({json.dumps(str(self.ref_observed))},JSON.stringify({{args:a,status:r.status,signal:r.signal??null,error:r.error?.code??null,stdout:(r.stdout??Buffer.alloc(0)).toString('base64'),stderr:(r.stderr??Buffer.alloc(0)).toString('base64')}})+'\\n');
if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);process.exit(r.status??1);
'''
        gh = f'''#!{NODE}
import fs from 'node:fs';const a=process.argv.slice(2);fs.appendFileSync({json.dumps(str(self.gh_log))},JSON.stringify(a)+'\\n');
if(a[0]==='auth'&&a[1]==='status')process.exit(0);
if(a[0]==='pr'&&a[1]==='view'){{console.error('fixture: exact PR not found');process.exit(1)}}
if(a[0]==='pr'&&a[1]==='create'){{if({json.dumps(hand_outcome)}==='unknown'){{console.error('fixture response unavailable');process.exit(1)}}console.log('https://github.com/fixture/route/pull/7');process.exit(0)}}
if(a[0]==='pr'&&a[1]==='merge'&&a.includes('--auto'))process.exit(0);
console.error('forbidden fixture gh mutation');process.exit(9);
'''
        for name, source in [('git', git), ('gh', gh)]:
            path = self.bin / name; path.write_text(source); path.chmod(0o755)

    def publish_original(self):
        # Parent intent is durable before child entry; actual result is retained
        # after wait, without parsing the child's output into a verdict.
        self.log.write_text(json.dumps({'attempt': self.attempt, 'result': 'original source-backed observation'}) + '\n')
        self.pointer.write_text(self.attempt); self.last.write_text('original source-backed observation')
        result = self.call([NODE, 'scripts/lane-deliver.mjs', 'heartbeat', 'mac-lane-tick',
            'original source-backed observation', '--no-wake', '--receipt', str(self.receipt)],
            env=dict(self.env, FIXTURE_EXPECT_RECEIPT=str(self.receipt)))
        with self.log.open('a') as stream: stream.write(result.stdout + result.stderr)
        self.exit.write_text(str(result.returncode) + '\n')
        self.original_result = result
        return result

    @property
    def push_path(self):
        return Path(str(self.receipt) + '.push.json')

    @property
    def ref_path(self):
        return Path(str(self.receipt) + '.push-ref.json')

    def fixture_terminal(self):
        """Explicit test projection of independently observed REAL Git result."""
        receipt = json.loads(self.receipt.read_bytes())
        observed = self.rows(self.push_observed)[0]
        out, err = (base64.b64decode(observed[k]).decode('utf-8') for k in ('stdout', 'stderr'))
        return {'version': 1, 'kind': 'original-lane-push-terminal',
            'receipt_sha256': sha(self.receipt.read_bytes()), 'repository': receipt['repository'],
            'base': receipt['base'], 'head': receipt['head'], 'target': receipt['target'],
            'producer_head': self.producer_head, 'producer_source_sha256': self.source_sha,
            'command': ['git', 'push', 'origin', 'HEAD:refs/heads/' + receipt['target']],
            'status': observed['status'], 'signal': observed['signal'], 'error': observed['error'],
            'stdout': out, 'stderr': err, 'stdout_sha256': sha(out.encode()), 'stderr_sha256': sha(err.encode())}

    def seed_protocol_terminal(self):
        # Used only by malformed-record or isolated Bash protocol tests. This is
        # NOT counted as production terminal recording or actual source success.
        self.push_path.write_text(json.dumps(self.fixture_terminal(), separators=(',', ':')) + '\n')
        self.seed_protocol_ref()

    def seed_protocol_ref(self, **changes):
        # Actual exact local GET, explicitly a disposable fixture observation.
        receipt = json.loads(self.receipt.read_bytes())
        result = self.call(['git', 'ls-remote', 'origin', 'refs/heads/' + receipt['target']])
        if result.returncode:
            raise AssertionError('owned fixture exact-ref readback failed: ' + result.stderr)
        observed = self.rows(self.ref_observed)[-1]
        out, err = (base64.b64decode(observed[k]).decode('utf-8') for k in ('stdout', 'stderr'))
        value = {'version': 1, 'kind': 'original-lane-push-ref-readback',
            'receipt_sha256': sha(self.receipt.read_bytes()), 'push_result_sha256': sha(self.push_path.read_bytes()),
            'repository': receipt['repository'], 'head': receipt['head'], 'target': receipt['target'],
            'producer_head': self.producer_head, 'producer_source_sha256': self.source_sha,
            'command': ['git', *observed['args']], 'status': observed['status'],
            'signal': observed['signal'], 'error': observed['error'], 'stdout': out, 'stderr': err,
            'stdout_sha256': sha(out.encode()), 'stderr_sha256': sha(err.encode())}
        value.update(changes)
        self.ref_path.write_text(json.dumps(value, separators=(',', ':')) + '\n')

    def set_ref_reply(self, *, status=0, stdout='', stderr=''):
        # Explicit faulty-GET response seam; no real remote state is fabricated
        # into accepted proof. Negative cases remove any earlier valid proof.
        (self.root / 'ref-response-override.json').write_text(json.dumps(
            {'status': status, 'stdout': stdout, 'stderr': stderr}))

    def readback(self):
        return self.call([NODE, 'scripts/lane-deliver.mjs', 'readback', str(self.receipt)])

    def remember_original(self):
        self.originals = {path: (path.read_bytes(), path.stat().st_ino)
            for path in self.records.iterdir() if path.is_file() and
            (path.name.startswith('.sg-heartbeat-') or path in (self.pointer, self.last))}

    def assert_original_preserved(self):
        for path, (raw, ino) in self.originals.items():
            if path.read_bytes() != raw or path.stat().st_ino != ino:
                raise AssertionError('original attempt evidence changed: ' + path.name)
        if len([row for row in self.rows(self.git_log) if row[0] == 'push' and
                row[-1] == 'HEAD:refs/heads/' + json.loads(self.receipt.read_bytes())['target']]) != 1:
            raise AssertionError('original push was repeated')

    def install_readback_protocol_seam(self, *, changes=None):
        self.protocol_changes = dict(changes or {})
        self.seed_protocol_terminal()
        record = self.fixture_terminal(); r = json.loads(self.receipt.read_bytes())
        diagnostic = {'version': 1, 'kind': 'original-push-refused', 'repository': r['repository'],
            'target': r['target'], 'original_head': r['head'], 'base': r['base'],
            'receipt_sha256': sha(self.receipt.read_bytes()), 'push_result_sha256': sha(self.push_path.read_bytes()),
            'ref_readback_sha256': sha(self.ref_path.read_bytes()), 'remote_ref_state': 'ABSENT', 'remote_oid': None,
            'producer_head': self.producer_head, 'producer_source_sha256': self.source_sha,
            'original_push_exit': record['status'], 'publication_state': 'KNOWN_REFUSED',
            'no_replay': True, 'repair_only': True}
        diagnostic.update(changes or {})
        payload = self.root / 'typed-refusal-diagnostic.json'; payload.write_text(json.dumps(diagnostic))
        wrapper = '#!/bin/sh\nif [ "$1" = scripts/lane-deliver.mjs ] && [ "$2" = readback ]; then\n'
        wrapper += ' exec ' + json.dumps(NODE) + ' ' + json.dumps(str(self.root / 'readback-protocol-seam.mjs')) + ' "$3"\nfi\nexec ' + json.dumps(NODE) + ' "$@"\n'
        path = self.bin / 'node'; path.write_text(wrapper); path.chmod(0o755)
        js = f'''import fs from 'node:fs';const a=process.argv.slice(2);fs.appendFileSync({json.dumps(str(self.protocol_calls))},JSON.stringify(a)+'\\n');
if(a.length!==1||a[0]!=={json.dumps(str(self.receipt))})process.exit(3);
console.log({json.dumps(PREFIX)}+fs.readFileSync({json.dumps(str(payload))},'utf8'));process.exit(5);
'''
        (self.root / 'readback-protocol-seam.mjs').write_text(js)

    def heartbeat(self, *, isolate_generic_hold=True):
        source = (SOURCE / 'scripts/mac/lane-tick.sh').read_text()
        start = source.index('# ── one tick at a time'); end = source.index('# An UNCHANGED tick', start)
        writer = source.index('tick_record() {'); stop = source.index("# ── the tick's own worktree", writer)
        if min(start, writer) < 0 or end <= start or stop <= writer:
            raise AssertionError('complete actual selected guard/writer/heartbeat regions required')
        producer = source[writer:stop]
        hold_start = producer.index('  _hb_hold() {')
        hold_end = producer.index('\n  }\n', hold_start) + len('\n  }\n')
        hold_original = producer[hold_start:hold_end]
        strict_start = producer.index('  _hb_pending_hand() {')
        strict_end = producer.index('\n  _hb_window=', strict_start)
        strict_original = producer[strict_start:strict_end]
        selected_hold = hold_original
        if isolate_generic_hold:
            # Explicit strict-refusal UNIT boundary. Record this independent
            # dependency callback rather than invoking its separate generic
            # uncertainty-notification feature. No operation counter is filtered.
            selected_hold = ('  _hb_hold() {\n    printf \'%s\\n\' "$1" >> ' +
                shlex.quote(str(self.hold_callbacks)) +
                '\n    say "UNIT generic HOLD notification dependency recorded"\n    return 1\n  }\n')
            producer = producer[:hold_start] + selected_hold + producer[hold_end:]
        current_strict_start = producer.index('  _hb_pending_hand() {')
        current_strict_end = producer.index('\n  _hb_window=', current_strict_start)
        if producer[current_strict_start:current_strict_end] != strict_original:
            raise AssertionError('actual strict validator/publication source changed in fixture isolation')
        scope = {'generic_hold_scope': 'UNIT_RECORDED_DEPENDENCY' if isolate_generic_hold else 'REAL',
            'generic_hold_original_sha256': sha(hold_original.encode()),
            'generic_hold_selected_sha256': sha(selected_hold.encode()),
            'strict_handler_original_sha256': sha(strict_original.encode()),
            'strict_handler_selected_sha256': sha(producer[current_strict_start:current_strict_end].encode()),
            'callback_before': self.hold_callback_count()}
        (self.root / 'actual-generic-HOLD-source.txt').write_text(hold_original)
        # This frozen cohort selects the guard and heartbeat, not the separately
        # tested queued-repair drain between those regions. DRY is reset below
        # before the actual heartbeat and its original refusal-hand assertions.
        script = self.root / 'actual-current-heartbeat.sh'
        script.write_text('set -u\nREPO_ROOT=' + json.dumps(str(self.repo)) + '\nRECORD_DIR=' + json.dumps(str(self.records)) + '\n' +
            'say(){ printf \'%s\\n\' "$1"; }\nDRY=1\n' + source[start:end] + '\n' +
            'DRY=0\nSTAMP=20261031T120000Z\nRESULT="new independent observation"\nQUIET_HEARTBEAT_MIN=120\n' +
            'HB_LAST_RESULT="$RECORD_DIR/.sg-last-heartbeat-result"\nHB_LAST_ATTEMPT="$RECORD_DIR/.sg-last-heartbeat-attempt"\nESTATE_RESULT="$RECORD_DIR/.sg-estate-result"\n' +
            producer + '\nappend_unread_state(){ :; }\nappend_raised_hands_state(){ :; }\nheartbeat\ntrue\n')
        result = self.call(['/bin/bash', str(script)])
        scope['callback_after'] = self.hold_callback_count()
        with self.heartbeat_scopes.open('a') as stream:
            stream.write(json.dumps(scope) + '\n')
        if isolate_generic_hold and self.protocol_changes:
            if scope['callback_after'] - scope['callback_before'] != 1:
                raise AssertionError('strict wrong-witness unit must reject into exactly one recorded HOLD dependency')
        return result

    def hold_callback_count(self):
        return len(self.hold_callbacks.read_text().splitlines()) if self.hold_callbacks.exists() else 0

    def hand_ops(self):
        rows = []
        for path in self.records.glob('*.ops.json'):
            value = json.loads(path.read_bytes())
            if type(value) is list:
                rows.extend(x for x in value if x.get('op') == 'raise')
        return rows

    def close(self):
        # Parent alone removes the owned fixture tree after all 31 original
        # assertions pass and the original Python child exits normally.
        pass
