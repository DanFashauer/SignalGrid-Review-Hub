"""Public fixture ABI for the original raw-before-UTF8 assertion contract.

All frozen test methods and assertions are retained, with fixture setup now
parameterized by the public runner. The actual local Git wrapper independently
captures base64 stdout/stderr; this adapter binds those bytes to the raw sidecar
ABI. It does not fabricate a production capture or change an assertion verdict.
"""
from pathlib import Path
import base64
import hashlib
import json
import sys

HERE = Path(__file__).resolve().parent
RED = HERE


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def dump(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()


def raw_value(binding, observed):
    out, err = (base64.b64decode(observed[key], validate=True) for key in ('stdout', 'stderr'))
    return dict(binding, command=['git', *observed['args']], status=observed['status'],
        signal=observed['signal'], error=observed['error'],
        stdout_base64=observed['stdout'], stderr_base64=observed['stderr'],
        stdout_sha256=sha(out), stderr_sha256=sha(err))


def install():
    sys.path.insert(0, str(RED))
    import push_result_fixture as fixture
    cls = fixture.PushFixture
    original_terminal, original_ref, original_reply = cls.fixture_terminal, cls.seed_protocol_ref, cls.set_ref_reply

    def terminal(self):
        expected = original_terminal(self)
        observed = self.rows(self.push_observed)[0]
        binding = {key: expected[key] for key in ['version', 'receipt_sha256', 'repository', 'base',
            'head', 'target', 'producer_head', 'producer_source_sha256']}
        binding['kind'] = 'original-lane-push-terminal-raw'
        wanted = raw_value(binding, observed)
        path = Path(str(self.receipt) + '.push.raw.json')
        if not path.is_file():
            raise AssertionError('actual original raw Git capture was not recorded before UTF-8 parsing')
        raw = path.read_bytes()
        if json.loads(raw) != wanted:
            raise AssertionError('actual raw capture differs from independently observed Git bytes')
        return dict(expected, raw_capture_sha256=sha(raw), utf8_valid=True)

    def ref(self, **changes):
        original_ref(self, **changes)
        path = Path(str(self.receipt) + '.push-ref.json')
        record = json.loads(path.read_bytes())
        receipt = json.loads(self.receipt.read_bytes())
        binding = {'version': 1, 'kind': 'original-lane-push-ref-readback-raw',
            'receipt_sha256': sha(self.receipt.read_bytes()), 'push_result_sha256': sha(self.push_path.read_bytes()),
            'repository': receipt['repository'], 'head': receipt['head'], 'target': receipt['target'],
            'producer_head': self.producer_head, 'producer_source_sha256': self.source_sha}
        wanted = raw_value(binding, self.rows(self.ref_observed)[-1])
        raw = dump(wanted)
        # These are disposable protocol/fault-injection fixtures only. Frozen
        # test methods deliberately replace their own records before assertions.
        Path(str(self.receipt) + '.push-ref.raw.json').write_bytes(raw)
        record.update(raw_capture_sha256=sha(raw), utf8_valid=True)
        path.write_bytes(dump(record))

    def reply(self, **changes):
        # Old frozen tests remove the logical GET proof before injecting an
        # unavailable/foreign reply. Its new raw+terminal pair must both be
        # absent, otherwise they would only exercise partial-capture holding.
        # This removes owned disposable fixture data, NEVER runtime evidence.
        if not self.ref_path.exists():
            raw_path = Path(str(self.receipt) + '.push-ref.raw.json')
            if raw_path.exists():
                raw_path.unlink()
        return original_reply(self, **changes)

    cls.fixture_terminal = terminal
    cls.seed_protocol_ref = ref
    cls.set_ref_reply = reply
