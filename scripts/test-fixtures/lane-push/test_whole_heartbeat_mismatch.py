"""Four complete-heartbeat controls for rejected refusal-diagnostic witnesses.

The generic HOLD function and its actual current module are unmodified. The
explicit local-GH protocol seam changes only the untrusted diagnostic input;
actual local Git, FD8 ownership, repair publication and evidence remain real.
"""
import errno
import json
import re
import socket
import unittest
from push_result_fixture import PushFixture, sha


class WholeHeartbeatMismatchIntegration(unittest.TestCase):
    def whole_case(self, changes):
        # Verify the actual inherited kernel profile, never a refused service or
        # a mock OSError. These controls run only in owned local fixtures.
        sock = socket.socket()
        try:
            with self.assertRaises(OSError) as denied:
                sock.connect(('127.0.0.1', 9))
            self.assertIn(denied.exception.errno, (errno.EPERM, errno.EACCES))
        finally:
            sock.close()
        f = PushFixture(); self.addCleanup(f.close)
        original = f.publish_original()
        self.assertEqual(original.returncode, 1, original.stdout + original.stderr)
        self.assertEqual(len(f.rows(f.push_observed)), 1)
        f.install_readback_protocol_seam(changes=changes)
        f.remember_original()
        first = f.heartbeat(isolate_generic_hold=False)
        second = f.heartbeat(isolate_generic_hold=False)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        scopes = f.rows(f.heartbeat_scopes)
        self.assertEqual(len(scopes), 2)
        self.assertEqual([row['generic_hold_scope'] for row in scopes], ['REAL', 'REAL'])
        self.assertTrue(all(row['generic_hold_original_sha256'] == row['generic_hold_selected_sha256'] for row in scopes),
                        'whole-heartbeat coverage must not substitute the generic HOLD body')
        self.assertEqual(f.hold_callback_count(), 0, 'unit notification seam must never run in this integration cohort')
        operations = []
        for path in sorted(f.records.glob('*.ops.json')):
            value = json.loads(path.read_bytes())
            self.assertIsInstance(value, list)
            operations.extend(value)  # Count every op, including any unexpected non-raise.
        self.assertEqual(f.hand_ops(), operations, 'the original raise projection must omit no operation in this cohort')
        self.assertEqual(len(operations), 1, 'all emitted operations count: one distinct uncertainty notice only')
        op = operations[0]
        self.assertEqual(op['op'], 'raise'); self.assertEqual(op['who'], 'cloud lane')
        self.assertEqual(op['id'], 'pending-heartbeat-' + sha(f.attempt.encode()),
                         'the original attempt determines the stable identity on both actual ticks')
        self.assertEqual(op['doing'], 'protected lane delivery source inspection')
        self.assertIn('remains unverified', op['blocked'])
        self.assertEqual(len(re.findall(r'Private evidence reference ([a-f0-9]{64})\.', op['blocked'])), 1)
        self.assertIn('grants no execution, landing or retry authority', op['need'])
        body = json.dumps(op)
        self.assertNotRegex(body, r'(?i)source[- ]bound|known.refus|topic.{0,20}absent|no publication|never published|was not published|original Git push refused')
        for private in (str(f.root), str(f.receipt), str(f.push_path), str(f.ref_path), '/Users/'):
            self.assertNotIn(private, body, 'raw private fixture evidence must not become a public operation')
        receipt = json.loads(f.receipt.read_bytes())
        self.assertNotIn(receipt['target'], body, 'untrusted refusal witness cannot become a source-bound absence claim')
        self.assertNotIn(receipt['head'], body)
        pushes = f.rows(f.push_observed)
        self.assertEqual(len(pushes), 2, 'one original attempt plus one DIFFERENT repair publication only')
        self.assertNotEqual(pushes[0]['args'][-1], pushes[1]['args'][-1])
        self.assertEqual(sum(row['args'][-1] == 'HEAD:refs/heads/' + receipt['target'] for row in pushes), 1)
        f.assert_original_preserved()

    def test_wrong_original_receipt_witness_allows_only_one_unverified_uncertainty_notice(self):
        self.whole_case({'receipt_sha256': 'f' * 64})

    def test_wrong_original_push_witness_allows_only_one_unverified_uncertainty_notice(self):
        self.whole_case({'push_result_sha256': 'f' * 64})

    def test_wrong_exact_GET_witness_allows_only_one_unverified_uncertainty_notice(self):
        self.whole_case({'ref_readback_sha256': 'f' * 64})

    def test_wrong_producer_witness_allows_only_one_unverified_uncertainty_notice(self):
        self.whole_case({'producer_head': 'f' * 40})
