"""Registered black-box readback regressions against disposable local repositories.

The real delivery CLI and heartbeat caller use local Git/gh fixtures. The tests
preserve the actual HOME and never use a real network service or credentials.
The caller retains failed fixtures below its explicit owned artifact directory.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time
import unittest
import uuid

SOURCE = NODE = ARTIFACTS = None
BASE = 'SignalGrid_Alpha'
T0 = 1793494800000  # 2026-11-01T01:00:00Z; fixture clock only, never quota evidence.
PERIOD = 120 * 60 * 1000
sha = lambda b: hashlib.sha256(b).hexdigest()
enc = lambda x: (json.dumps(x, separators=(',', ':')) + '\n').encode()


def keep(path: Path, raw: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw); f.flush(); os.fsync(f.fileno())


def frame(value):
    body = enc(value).removesuffix(b'\n')
    raw = f'SGRB1 {len(body)} {sha(body)}\n'.encode() + body + b'\n'
    if len(raw) > 4096:
        raise AssertionError('fixture frame exceeds the agreed single-append bound')
    return raw


def frames(raw: bytes):
    out = []; offset = 0
    while offset < len(raw):
        end = raw.find(b'\n', offset)
        if end < 0:
            raise AssertionError('partial journal header')
        m = re.fullmatch(rb'SGRB1 ([1-9][0-9]*|0) ([0-9a-f]{64})', raw[offset:end])
        if not m:
            raise AssertionError('invalid journal header')
        size = int(m[1]); start = end + 1; stop = start + size
        body = raw[start:stop]
        if len(body) != size or raw[stop:stop + 1] != b'\n':
            raise AssertionError('partial journal body')
        if stop + 1 - offset > 4096 or sha(body).encode() != m[2]:
            raise AssertionError('journal bound/checksum differs')
        try:
            value = json.loads(body.decode('utf8', 'strict'))
        except (ValueError, UnicodeError) as error:
            raise AssertionError('journal frame is not exact UTF-8 JSON') from error
        out.append((value, sha(body), raw[offset:stop + 1]))
        offset = stop + 1
    return out


class Fixture:
    def __init__(self, label):
        self.root = ARTIFACTS / (label + '-' + uuid.uuid4().hex)
        self.root.mkdir(mode=0o700, parents=True)
        self.repo = self.root / 'repo'; self.repo.mkdir(mode=0o700)
        self.remote = self.root / 'remote.git'
        self.bin = self.root / 'bin'; self.bin.mkdir(mode=0o700)
        self.receipt = self.root / 'submission.json'
        self.journal = Path(str(self.receipt) + '.readback.journal')
        self.blobs = Path(str(self.receipt) + '.readback-blobs')
        self.calls_file = self.root / 'gh-calls.jsonl'
        self.clock_file = self.root / 'clock.json'
        self.response_file = self.root / 'gh-response.json'
        self.proc = 0; self.children = []
        self.git_binary = shutil.which('git')
        if not self.git_binary:
            raise AssertionError('real installed Git required')
        self.env = {**os.environ, 'PATH': str(self.bin) + ':' + str(Path(NODE).parent) + ':/usr/bin:/bin',
                    'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                    'GIT_TERMINAL_PROMPT': '0', 'SIGNALGRID_LANE': 'mac'}
        for key in list(self.env):
            if key.startswith('GIT_') or key == 'NODE_OPTIONS':
                self.env.pop(key)
        self.env.update({'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'})
        # Preserve the actual HOME; fixtures do not impersonate a private runtime.
        self.env['MED5_CLOCK'] = str(self.clock_file)
        self.clock(T0)
        preload = self.root / 'clock.cjs'
        keep(preload, b"const fs=require('node:fs'),D=Date;const t=JSON.parse(fs.readFileSync(process.env.MED5_CLOCK,'utf8'));globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:[t]))}static now(){return t}};\n")
        self.env['NODE_OPTIONS'] = '--require=' + str(preload)
        self.git(['init', '-q', '-b', BASE])
        self.git(['config', 'user.name', 'MED5 disposable fixture'])
        self.git(['config', 'user.email', 'fixture@example.invalid'])
        (self.repo / 'scripts/lib').mkdir(parents=True)
        selected = [SOURCE / 'scripts/lane-deliver.mjs', SOURCE / 'scripts/mac/lane-tick.sh',
                    SOURCE / 'scripts/mac/build-tick.sh', *sorted((SOURCE / 'scripts/lib').glob('*.mjs'))]
        pins = []
        for origin in selected:
            rel = origin.relative_to(SOURCE); raw = origin.read_bytes()
            keep(self.repo / rel, raw)
            pins.append({'path': str(rel), 'source': str(origin), 'sha256': sha(raw), 'bytes': len(raw)})
        keep(self.root / 'actual-fixture-source-pins.json', enc(pins))
        self.payload_path = 'artifacts/agent-heartbeats/mac-lane-tick.json'
        keep(self.repo / self.payload_path, b'{"result":"fixture original"}\n')
        self.hand_id = 'fixture-build-hand'
        self.hand_path = 'artifacts/raised-hands/' + self.hand_id + '.json'
        keep(self.repo / self.hand_path, enc({'id': self.hand_id, 'status': 'open'}))
        self.git(['add', '.']); self.git(['commit', '-qm', 'disposable fixture original'])
        self.head = self.git(['rev-parse', 'HEAD']).decode().strip()
        self.payload_oid = self.git(['rev-parse', self.head + ':' + self.payload_path]).decode().strip()
        self.hand_oid = self.git(['rev-parse', self.head + ':' + self.hand_path]).decode().strip()
        self.git(['init', '-q', '--bare', str(self.remote)])
        self.git(['remote', 'add', 'origin', str(self.remote)])
        self.git(['fetch', str(self.repo), 'HEAD:refs/heads/' + BASE], cwd=self.remote)
        self.target = 'lane/mac-mail-20261001-000000Z-012345abcdef'
        keep(self.receipt, enc({'version': 1, 'repository': 'fixture/route', 'target': self.target,
                               'head': self.head, 'base': self.head,
                               'blobs': [{'path': self.payload_path, 'oid': self.payload_oid}]}))
        gitshim = '#!' + sys.executable + '\nimport os,sys,json\na=sys.argv[1:]\nif a==["remote","get-url","origin"]:\n print("https://github.com/fixture/route.git");sys.exit(0)\nif any(x in {"push","worktree","branch","checkout","switch","reset","clean","update-ref","commit","merge","add","rm","config"} for x in a):\n with open(' + repr(str(self.root / 'forbidden-git-mutation.jsonl')) + ',"a") as f:f.write(json.dumps(a)+"\\n")\n sys.exit(90)\nos.execv(' + repr(self.git_binary) + ',[' + repr(self.git_binary) + ']+a)\n'
        keep(self.bin / 'git', gitshim.encode()); os.chmod(self.bin / 'git', 0o700)
        ghshim = '''#!NODE_BINARY
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
const root=ROOT_LITERAL,a=process.argv.slice(2);
if(a[0]!=='pr'||a[1]!=='view')throw Error('no mutation or other gh request allowed');
appendFileSync(root+'/gh-calls.jsonl',JSON.stringify({args:a,pid:process.pid})+'\\n');
const r=JSON.parse(readFileSync(root+'/gh-response.json','utf8'));
if(r.barrier){writeFileSync(root+'/ready-'+process.pid,'ready');while(!existsSync(root+'/release'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
await new Promise(resolve=>process.stdout.write(Buffer.from(r.stdout_base64,'base64'),resolve));
await new Promise(resolve=>process.stderr.write(Buffer.from(r.stderr_base64,'base64'),resolve));
if(r.signal)process.kill(process.pid,r.signal);else process.exit(r.status);
'''.replace('NODE_BINARY', str(NODE)).replace('ROOT_LITERAL', json.dumps(str(self.root)))
        keep(self.bin / 'gh', ghshim.encode()); os.chmod(self.bin / 'gh', 0o700)
        self.response(self.pending())
        initialized = self.run([NODE, str(self.repo / 'scripts/lib/lane-attempt-store.mjs'), 'init', str(self.repo)], label='fixture-store-init')
        if initialized.returncode != 0:
            raise AssertionError(initialized.stderr.decode(errors='replace'))
        self.store = Path(initialized.stdout.decode().strip())

    def git(self, args, cwd=None):
        environment = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        environment.update({'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'})
        result = subprocess.run([self.git_binary, *args], cwd=cwd or self.repo,
                                env=environment,
                                capture_output=True)
        if result.returncode:
            raise AssertionError(result.stderr.decode(errors='replace'))
        return result.stdout

    def clock(self, value):
        self.clock_file.write_bytes(enc(value))

    def pending(self, **overrides):
        return {'number': 7, 'state': 'OPEN', 'baseRefName': BASE, 'headRefName': self.target,
                'headRefOid': self.head, 'mergeCommit': None, 'autoMergeRequest': {},
                'createdAt': '2026-10-01T00:00:00Z', 'mergeStateStatus': 'CLEAN',
                'statusCheckRollup': [{'__typename': 'CheckRun', 'status': 'COMPLETED', 'conclusion': 'SUCCESS'}],
                **overrides}

    def response(self, value=None, *, stdout=None, stderr=b'', status=0, signal=None, barrier=False):
        if stdout is None:
            stdout = enc(value)
        self.response_file.write_bytes(enc({'stdout_base64': base64.b64encode(stdout).decode(),
                                           'stderr_base64': base64.b64encode(stderr).decode(),
                                           'status': status, 'signal': signal, 'barrier': barrier}))

    def calls(self):
        return [json.loads(x) for x in self.calls_file.read_bytes().splitlines()] if self.calls_file.exists() else []

    def run(self, args, *, label='readback', extra_env=None):
        self.proc += 1; n = f'{self.proc:04}-{label}'
        keep(self.root / (n + '.intent.json'), enc({'argv': list(map(str, args)), 'fixture_only': True}))
        result = subprocess.run(list(map(str, args)), cwd=self.repo, env={**self.env, **(extra_env or {})}, capture_output=True)
        keep(self.root / (n + '.stdout.raw'), result.stdout); keep(self.root / (n + '.stderr.raw'), result.stderr)
        keep(self.root / (n + '.terminal.json'), enc({'returncode': result.returncode, 'stdout_sha256': sha(result.stdout), 'stderr_sha256': sha(result.stderr)}))
        if (self.root / 'forbidden-git-mutation.jsonl').exists():
            raise AssertionError('readback attempted a forbidden Git mutation; exact request retained')
        return result

    def read(self, *extra, cadence=False, bad_token=False, bad_pid=False, extra_env=None):
        if not cadence:
            return self.run([NODE, self.repo / 'scripts/lane-deliver.mjs', 'readback', self.receipt, *extra], extra_env=extra_env)
        tick = (self.repo / 'scripts/mac/lane-tick.sh').read_text()
        begin = tick.index('# BEGIN OWNED TICK GUARD'); end = tick.index('# END OWNED TICK GUARD', begin)
        block = tick[begin:end + len('# END OWNED TICK GUARD')]
        cli = ' '.join(shlex.quote(str(x)) for x in [NODE, self.repo / 'scripts/lane-deliver.mjs', 'readback', self.receipt])
        token = '00000000000000000000000000000000' if bad_token else '$TICK_OWNER_TOKEN'
        pid = '1' if bad_pid else '$$'
        script = 'set -u\nREPO_ROOT=' + shlex.quote(str(self.repo)) + '\nsay(){ printf "%s\\n" "$1"; }\n' + block + '\n' + cli + ' --pending-cadence "' + token + '" "' + pid + '"\nexit $?\n'
        dest = self.root / ('cadence-' + uuid.uuid4().hex + '.tick.sh'); keep(dest, script.encode())
        return self.run(['/bin/bash', dest], label='owned-cadence', extra_env=extra_env)

    def events(self):
        if not self.journal.is_file():
            raise AssertionError('missing durable MED5 observation journal')
        return frames(self.journal.read_bytes())

    def raw_objects(self):
        if not self.blobs.is_dir():
            raise AssertionError('missing content-addressed MED5 raw evidence directory')
        return {p.name: p.read_bytes() for p in self.blobs.iterdir()}

    def assert_complete_evidence(self, case, count, prior_gets=0):
        events = self.events(); intents = {}; terminals = {}
        for value, body_hash, raw in events:
            case.assertLessEqual(len(raw), 4096); case.assertEqual(value['version'], 1)
            case.assertEqual(value['receipt_sha256'], sha(self.receipt.read_bytes()))
            case.assertIn(value['scope'], ('fresh', 'pending-cadence'))
            case.assertIn('resolved_hand', value); case.assertTrue(value['observation_id'])
            dt.datetime.fromisoformat(value['at'].replace('Z', '+00:00'))
            target = intents if value['kind'] == 'intent' else terminals
            case.assertIn(value['kind'], ('intent', 'terminal'))
            case.assertNotIn(value['observation_id'], target)
            target[value['observation_id']] = (value, body_hash)
        case.assertEqual(len(intents), count); case.assertEqual(len(terminals), count)
        case.assertEqual(set(intents), set(terminals)); case.assertEqual(len(self.calls()), prior_gets + count)
        for ident, (term, _) in terminals.items():
            intent, intent_hash = intents[ident]; case.assertEqual(term['intent_sha256'], intent_hash)
            for key in ('scope', 'resolved_hand', 'receipt_sha256'):
                case.assertEqual(term[key], intent[key])
            for stream in ('stdout', 'stderr'):
                data = (self.blobs / (term[stream + '_sha256'] + '.raw')).read_bytes()
                case.assertEqual(sha(data), term[stream + '_sha256'])
                case.assertEqual(len(data), term[stream + '_bytes'])
            case.assertIn('status', term); case.assertIn('signal', term); case.assertIn('error', term)
        return events

    def rewrite_events(self, update):
        values = [x[0] for x in self.events()]
        update(values)
        # Deliberately malformed fixture histories are new input, never edits to real receipts.
        self.journal.write_bytes(b''.join(frame(x) for x in values))

    def resolved(self):
        value = json.loads(self.receipt.read_text()); value['blobs'] = [{'path': self.hand_path, 'oid': self.hand_oid}]
        self.receipt.write_bytes(enc(value))
        (self.repo / self.hand_path).write_bytes(enc({'id': self.hand_id, 'status': 'resolved', 'resolution': 'disposable repair observed', 'resolvedBy': 'mac', 'resolvedAt': '2026-11-01T01:00:00Z'}))
        self.git(['add', self.hand_path]); self.git(['commit', '-qm', 'disposable current hand resolution'])
        self.git(['fetch', str(self.repo), 'HEAD:refs/heads/' + BASE], cwd=self.remote)
        self.response(self.pending(state='MERGED', autoMergeRequest=None, mergeCommit={'oid': self.head}))


class MED5(unittest.TestCase):
    def fixture(self):
        return Fixture(self.id().split('.')[-1])

    def pending(self, f, result):
        self.assertEqual(result.returncode, 4, result.stderr.decode(errors='replace'))
        self.assertIn(b'pending', result.stdout)
        self.assertNotIn(b'canonical merge verified', result.stdout)

    def held(self, result):
        self.assertEqual(result.returncode, 3, result.stderr.decode(errors='replace'))
        self.assertNotIn(b'canonical merge verified', result.stdout)
        self.assertNotRegex(result.stdout, rb'(?m)^resolved hand [a-f0-9]{40}$')

    def test_old_pending_five_minute_ticks_have_real_120_minute_cadence(self):
        f = self.fixture(); original = f.receipt.read_bytes(); self.pending(f, f.read(cadence=True))
        for minutes in range(5, 120, 5):
            f.clock(T0 + minutes * 60000); r = f.read(cadence=True)
            self.assertEqual(r.returncode, 6); self.assertEqual(len(f.calls()), 1)
        f.clock(T0 + PERIOD); self.pending(f, f.read(cadence=True))
        for minutes in (125, 180, 235):
            f.clock(T0 + minutes * 60000); self.assertEqual(f.read(cadence=True).returncode, 6)
        f.clock(T0 + 2 * PERIOD); self.pending(f, f.read(cadence=True))
        self.assertEqual(f.receipt.read_bytes(), original); f.assert_complete_evidence(self, 3)

    def test_exact_boundary_and_day_rollover_do_not_reset_cadence(self):
        f = self.fixture(); f.clock(T0 + 22 * 3600000); self.pending(f, f.read(cadence=True))
        f.clock(T0 + 22 * 3600000 + PERIOD - 1); self.assertEqual(f.read(cadence=True).returncode, 6)
        f.clock(T0 + 22 * 3600000 + PERIOD); self.pending(f, f.read(cadence=True))
        f.assert_complete_evidence(self, 2)

    def test_changed_due_result_is_fetched_and_not_cached(self):
        f = self.fixture(); self.pending(f, f.read(cadence=True))
        f.response(f.pending(mergeStateStatus='BEHIND'))
        f.clock(T0 + 5 * 60000); self.assertEqual(f.read(cadence=True).returncode, 6)
        f.clock(T0 + PERIOD); r = f.read(cadence=True); self.pending(f, r)
        self.assertIn(b'"merge_state":"BEHIND"', r.stdout)
        f.assert_complete_evidence(self, 2)

    def test_identical_real_gets_deduplicate_raw_but_retain_each_observation(self):
        f = self.fixture(); f.response(f.pending(fixtureNoise='x' * 65536))
        self.pending(f, f.read()); before = f.raw_objects()
        f.clock(T0 + 60000); self.pending(f, f.read()); events = f.assert_complete_evidence(self, 2)
        self.assertEqual(f.raw_objects(), before)
        terms = [x[0] for x in events if x[0]['kind'] == 'terminal']
        self.assertNotEqual(terms[0]['observation_id'], terms[1]['observation_id'])
        self.assertNotEqual(terms[0]['at'], terms[1]['at'])

    def test_legacy_timestamped_evidence_bytes_and_inodes_are_preserved(self):
        f = self.fixture(); old = Path(str(f.receipt) + '.readback-123456-abcdef.json')
        keep(old, b'{"at":"historical","stdout":"old private raw"}\n'); st = old.stat(); raw = old.read_bytes()
        self.pending(f, f.read())
        prefix_files = {p.name for p in f.root.iterdir() if p.name.startswith('submission.json.readback-') and p.suffix == '.json'}
        self.pending(f, f.read())
        self.assertEqual({p.name for p in f.root.iterdir() if p.name.startswith('submission.json.readback-') and p.suffix == '.json'}, prefix_files,
                         'a fresh observation must not create another timestamped JSON copy of the same response')
        self.assertEqual(old.read_bytes(), raw); self.assertEqual((old.stat().st_dev, old.stat().st_ino), (st.st_dev, st.st_ino))
        f.assert_complete_evidence(self, 2)
        self.assertTrue(any(p.name.startswith('submission.json.readback-') and p.suffix == '.json' for p in f.root.iterdir()))

    def test_future_completed_timestamp_holds_before_transport(self):
        f = self.fixture(); self.pending(f, f.read(cadence=True))
        f.clock(T0 - 1); self.held(f.read(cadence=True)); self.assertEqual(len(f.calls()), 1)

    def test_invalid_timestamp_with_valid_frame_checksum_holds(self):
        f = self.fixture(); self.pending(f, f.read(cadence=True))
        f.rewrite_events(lambda a: a[-1].update(at='not-an-instant'))
        self.held(f.read(cadence=True)); self.assertEqual(len(f.calls()), 1)

    def test_missing_terminal_is_unknown_and_never_renews(self):
        f = self.fixture(); self.pending(f, f.read(cadence=True))
        f.rewrite_events(lambda a: a.pop()); original = f.journal.read_bytes()
        f.clock(T0 + 30 * PERIOD); self.held(f.read(cadence=True))
        self.assertEqual(len(f.calls()), 1); self.assertEqual(f.journal.read_bytes(), original)

    def test_partial_journal_tail_holds_default_and_cadence_before_transport(self):
        f = self.fixture(); self.pending(f, f.read())
        with f.journal.open('ab') as out: out.write(b'SGRB1 100 deadbeef'); out.flush(); os.fsync(out.fileno())
        original = f.journal.read_bytes(); self.held(f.read()); self.held(f.read(cadence=True))
        self.assertEqual(len(f.calls()), 1); self.assertEqual(f.journal.read_bytes(), original)

    def test_frame_checksum_damage_holds_without_repairing_evidence(self):
        f = self.fixture(); self.pending(f, f.read())
        f.events()  # Missing protocol support is an assertion failure on the old source.
        raw = f.journal.read_bytes(); checksum_start = raw.index(b' ', raw.index(b' ') + 1) + 1
        flipped = b'0' if raw[checksum_start:checksum_start + 1] != b'0' else b'1'
        f.journal.write_bytes(raw[:checksum_start] + flipped + raw[checksum_start + 1:]); bad = f.journal.read_bytes()
        self.held(f.read()); self.assertEqual(len(f.calls()), 1); self.assertEqual(f.journal.read_bytes(), bad)

    def test_known_failed_get_is_durable_and_only_new_due_observation_runs(self):
        f = self.fixture(); f.response(stdout=b'not available\n', stderr=b'fixture failure\n', status=7)
        self.held(f.read(cadence=True)); f.assert_complete_evidence(self, 1)
        term = [x[0] for x in f.events() if x[0]['kind'] == 'terminal'][0]
        self.assertEqual(term['status'], 7); self.assertIsNone(term['signal']); self.assertIsNone(term['error'])
        f.clock(T0 + 5 * 60000); deferred = f.read(cadence=True)
        self.assertEqual(deferred.returncode, 6); self.assertRegex(deferred.stdout + deferred.stderr, rb'(?i)unavailable|failed')
        self.assertEqual(len(f.calls()), 1)
        f.clock(T0 + PERIOD); f.response(f.pending()); self.pending(f, f.read(cadence=True)); f.assert_complete_evidence(self, 2)

    def test_invalid_utf8_raw_is_exact_before_parse_failure(self):
        f = self.fixture(); f.response(stdout=b'\xff\xfe\n', stderr=b'\x80stderr\n')
        self.held(f.read()); f.assert_complete_evidence(self, 1)
        self.assertEqual((f.blobs / (sha(b'\xff\xfe\n') + '.raw')).read_bytes(), b'\xff\xfe\n')
        self.assertEqual((f.blobs / (sha(b'\x80stderr\n') + '.raw')).read_bytes(), b'\x80stderr\n')

    def test_actual_get_signal_is_recorded_separately_from_exit_code(self):
        f = self.fixture(); f.response(stdout=b'', stderr=b'self-signaled fixture\n', signal='SIGTERM')
        self.held(f.read()); f.assert_complete_evidence(self, 1)
        term = [x[0] for x in f.events() if x[0]['kind'] == 'terminal'][0]
        self.assertIsNone(term['status']); self.assertEqual(term['signal'], 'SIGTERM'); self.assertIsNone(term['error'])

    def test_pending_cadence_requires_real_current_fd8_owner(self):
        f = self.fixture()
        raw = f.read('--pending-cadence', '0' * 32, str(os.getpid())); self.held(raw); self.assertEqual(f.calls(), [])
        self.held(f.read(cadence=True, bad_token=True)); self.held(f.read(cadence=True, bad_pid=True)); self.assertEqual(f.calls(), [])

    def test_default_and_resolved_hand_always_fetch_fresh_without_fd8(self):
        f = self.fixture(); self.pending(f, f.read(cadence=True)); self.pending(f, f.read())
        # Use a separate receipt namespace: changing an original binding must not adopt its prior journal.
        f.receipt = f.root / 'resolved-submission.json'; original = json.loads((f.root / 'submission.json').read_text())
        keep(f.receipt, enc(original)); f.journal = Path(str(f.receipt) + '.readback.journal'); f.blobs = Path(str(f.receipt) + '.readback-blobs')
        f.resolved(); before = len(f.calls()); a = f.read('--resolved-hand', f.hand_id); b = f.read('--resolved-hand', f.hand_id)
        self.assertEqual(a.returncode, 0, a.stderr.decode(errors='replace')); self.assertEqual(b.returncode, 0, b.stderr.decode(errors='replace'))
        self.assertRegex(a.stdout, rb'(?m)^resolved hand [a-f0-9]{40}$'); self.assertEqual(len(f.calls()), before + 2)
        f.assert_complete_evidence(self, 2, prior_gets=before)
        events = f.events(); self.assertEqual(len(events), 4)
        self.assertTrue(all(x[0]['scope'] == 'fresh' and x[0]['resolved_hand'] == f.hand_id for x in events))

    def test_raw_object_damage_holds_and_is_not_overwritten(self):
        f = self.fixture(); self.pending(f, f.read(cadence=True))
        term = [x[0] for x in f.events() if x[0]['kind'] == 'terminal'][0]
        obj = f.blobs / (term['stdout_sha256'] + '.raw'); obj.write_bytes(b'damaged fixture evidence\n')
        self.held(f.read(cadence=True)); self.assertEqual(len(f.calls()), 1); self.assertEqual(obj.read_bytes(), b'damaged fixture evidence\n')

    def test_journal_symlink_cannot_write_another_file(self):
        f = self.fixture(); other = f.root / 'preserved.txt'; keep(other, b'preserve exact fixture body\n')
        st = other.stat(); f.journal.symlink_to(other)
        self.held(f.read()); self.assertEqual(f.calls(), []); self.assertEqual(other.read_bytes(), b'preserve exact fixture body\n')
        self.assertEqual((other.stat().st_dev, other.stat().st_ino), (st.st_dev, st.st_ino))

    def test_two_actual_fresh_children_concurrently_append_complete_frames(self):
        f = self.fixture(); f.response(f.pending(), barrier=True)
        args = [NODE, str(f.repo / 'scripts/lane-deliver.mjs'), 'readback', str(f.receipt)]
        children = []
        for index in range(2):
            keep(f.root / f'concurrent-{index}.intent.json', enc({'argv': args, 'fixture_only': True, 'scope': 'two new independent fresh read-only observations'}))
            children.append(subprocess.Popen(args, cwd=f.repo, env=f.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE))
        reached = False
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if len(list(f.root.glob('ready-*'))) == 2:
                    reached = True; break
                time.sleep(0.01)
        finally:
            keep(f.root / 'release', b'release only these two owned fixture GETs\n')
            terminals = []
            for index, child in enumerate(children):
                out, err = child.communicate()
                keep(f.root / f'concurrent-{index}.stdout.raw', out); keep(f.root / f'concurrent-{index}.stderr.raw', err)
                keep(f.root / f'concurrent-{index}.terminal.json', enc({'pid': child.pid, 'returncode': child.returncode, 'stdout_sha256': sha(out), 'stderr_sha256': sha(err)}))
                terminals.append(child.returncode)
        self.assertTrue(reached, 'two actual gh children must overlap before either responds')
        self.assertEqual(terminals, [4, 4]); f.assert_complete_evidence(self, 2)

    def test_short_single_append_leaves_partial_tail_and_no_get(self):
        f = self.fixture(); preload = f.root / 'short-append.cjs'
        keep(preload, b"const fs=require('node:fs'),o=fs.openSync,w=fs.writeSync,c=fs.closeSync;const targets=new Set();let used=false;fs.openSync=function(...a){const fd=Reflect.apply(o,this,a);if(typeof a[0]==='string'&&a[0].endsWith('.readback.journal'))targets.add(fd);return fd};fs.closeSync=function(fd){targets.delete(fd);return Reflect.apply(c,this,arguments)};fs.writeSync=function(fd,b,...a){if(targets.has(fd)&&!used&&(Buffer.isBuffer(b)||typeof b==='string')&&Buffer.byteLength(b)>12){used=true;return w(fd,Buffer.from(b),0,12,null)}return Reflect.apply(w,this,[fd,b,...a])};require('node:module').syncBuiltinESMExports();\n")
        env = {'NODE_OPTIONS': f.env['NODE_OPTIONS'] + ' --require=' + str(preload)}
        self.held(f.read(extra_env=env)); self.assertEqual(f.calls(), [])
        self.assertTrue(f.journal.exists()); original = f.journal.read_bytes()
        self.assertGreater(len(original), 0); self.held(f.read()); self.assertEqual(f.calls(), []); self.assertEqual(f.journal.read_bytes(), original)

    def test_actual_heartbeat_caller_passes_token_pid_and_handles_defer_without_submission(self):
        f = self.fixture(); tick = (f.repo / 'scripts/mac/lane-tick.sh').read_text()
        start = tick.index('heartbeat() {'); end = tick.index('\n}\n', start) + 3
        self.assertGreater(end, start)
        attempt = '20261001T000000Z-999999'; record = f.store
        keep(record / '.sg-last-heartbeat-attempt', attempt.encode()); keep(record / '.sg-last-heartbeat-result', b'quiet')
        keep(record / ('.sg-heartbeat-' + attempt + '.log'), enc({'attempt': attempt, 'result': 'quiet'}))
        keep(record / ('.sg-heartbeat-' + attempt + '.exit'), b'0\n')
        keep(record / ('.sg-heartbeat-' + attempt + '.submission.json'), f.receipt.read_bytes())
        os.utime(record / '.sg-last-heartbeat-attempt', (1, 1))
        calls = f.root / 'caller-calls.jsonl'
        override = '''node(){ if [ "$1" = scripts/lane-deliver.mjs ] || [ "$1" = "$REPO_ROOT/scripts/lane-deliver.mjs" ]; then "$MED5_REAL_NODE" -e 'require("node:fs").appendFileSync(process.env.MED5_CALLER_LOG,JSON.stringify(process.argv.slice(1))+"\\n")' "$@"; printf '%s\\n' 'readback deferred: next observation not due'; return 6; else "$MED5_REAL_NODE" "$@"; fi; }'''
        script = 'set -u\nprintf "%s\\n" "$$" > "$MED5_CALLER_PID"\nDRY=0\nRESULT=quiet\nQUIET_HEARTBEAT_MIN=120\nSTAMP=20261101T010000Z\nRECORD_DIR=' + shlex.quote(str(record)) + '\nHB_LAST_RESULT="$RECORD_DIR/.sg-last-heartbeat-result"\nHB_LAST_ATTEMPT="$RECORD_DIR/.sg-last-heartbeat-attempt"\nESTATE_RESULT="$RECORD_DIR/.sg-estate-result"\nREPO_ROOT=' + shlex.quote(str(f.repo)) + '\nTICK_LOCK_ROOT="$REPO_ROOT"\nTICK_OWNER_TOKEN=11111111111111111111111111111111\nsay(){ printf "%s\\n" "$1"; }\nappend_unread_state(){ :; }\nappend_raised_hands_state(){ :; }\n' + override + '\n' + tick[start:end] + '\nheartbeat\nRESULT="changed result"\nheartbeat\nRESULT=quiet\nheartbeat\ntrue\n'
        dest = f.root / 'actual-heartbeat-caller.sh'; keep(dest, script.encode())
        bash_pid_file = f.root / 'actual-caller-bash.pid'
        result = f.run(['/bin/bash', dest], extra_env={'MED5_REAL_NODE': NODE, 'MED5_CALLER_LOG': str(calls), 'MED5_CALLER_PID': str(bash_pid_file)})
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        actual = [json.loads(x) for x in calls.read_bytes().splitlines()]
        self.assertEqual(len(actual), 3)
        for call in actual:
            self.assertEqual((f.repo / call[0]).resolve(), f.repo / 'scripts/lane-deliver.mjs')
            self.assertEqual(call[1], 'readback'); self.assertIn('--pending-cadence', call)
            at = call.index('--pending-cadence'); self.assertEqual(call[at + 1], '1' * 32)
            self.assertEqual(call[at + 2], bash_pid_file.read_text().strip())
        self.assertNotIn(b'canonical merge verified', result.stdout); self.assertNotIn(b'heartbeat submitted', result.stdout)
        self.assertNotIn(b'RAISED HAND', result.stdout); self.assertGreaterEqual(result.stdout.count(b'readback deferred'), 3)
        self.assertEqual((record / '.sg-last-heartbeat-attempt').read_bytes(), attempt.encode())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--node', required=True)
    parser.add_argument('--artifact-root', required=True, type=Path)
    parsed, remainder = parser.parse_known_args()
    SOURCE = parsed.source_root.resolve(); NODE = str(Path(parsed.node).resolve()); ARTIFACTS = parsed.artifact_root.resolve()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    unittest.main(argv=[sys.argv[0], *remainder], verbosity=2)
