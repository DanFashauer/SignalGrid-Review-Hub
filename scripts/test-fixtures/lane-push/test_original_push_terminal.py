"""Preserved original-push controls and strict-refusal handler UNIT controls.

All original31 test methods/assertions are retained. The hand fixture explicitly
records only the separate generic HOLD dependency; the strict validator, actual
FD8 ownership and refusal publication remain real. The additional four complete
heartbeat integration cases exercise the unmodified generic uncertainty route.
"""
from pathlib import Path
import base64
import errno
import json
import socket
import unittest
from push_result_fixture import PushFixture, PREFIX, sha


class OriginalPushResultControls(unittest.TestCase):
    def fixture(self):
        f = PushFixture(); self.addCleanup(f.close)
        result = f.publish_original()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertTrue(f.receipt.is_file(), 'real original push lacks its durable pre-push receipt')
        self.assertEqual(f.refs(), f.initial_refs, 'the rejecting remote changed a ref')
        self.assertEqual(len(f.rows(f.push_observed)), 1, 'one actual original Git push only')
        self.assertIn('remote rejected', result.stderr.lower())
        return f

    def actual_terminal(self, f):
        self.assertTrue(f.push_path.is_file(), 'original Git result is not durably adjacent to its pre-push receipt')
        record = json.loads(f.push_path.read_bytes())
        expected = f.fixture_terminal()
        for key, value in expected.items():
            self.assertEqual(record.get(key), value, 'actual push-result binding/raw field differs: ' + key)
        self.assertIsNone(record['signal']); self.assertIsNone(record['error'])
        self.assertNotEqual(record['producer_head'], record['base'], 'fixture failed to distinguish producing source from canonical base')
        self.assertNotEqual(record['producer_head'], record['head'], 'delivery commit is not the producing source head')
        return record

    def diagnostic(self, f, result):
        self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
        lines = [line[len(PREFIX):] for line in result.stdout.splitlines() if line.startswith(PREFIX)]
        self.assertEqual(len(lines), 1, 'one typed original-refusal diagnostic required')
        self.assertTrue(f.ref_path.is_file(), 'definite refusal lacks its durable exact GET-ref result')
        value = json.loads(lines[0]); receipt = json.loads(f.receipt.read_bytes())
        expected = {'version': 1, 'kind': 'original-push-refused', 'repository': receipt['repository'],
            'target': receipt['target'], 'original_head': receipt['head'], 'base': receipt['base'],
            'receipt_sha256': sha(f.receipt.read_bytes()), 'push_result_sha256': sha(f.push_path.read_bytes()),
            'ref_readback_sha256': sha(f.ref_path.read_bytes()), 'remote_ref_state': 'ABSENT', 'remote_oid': None,
            'producer_head': f.producer_head, 'producer_source_sha256': f.source_sha,
            'original_push_exit': 1, 'publication_state': 'KNOWN_REFUSED', 'no_replay': True, 'repair_only': True}
        self.assertEqual(value, expected)
        ref = json.loads(f.ref_path.read_bytes())
        self.assertEqual(ref['command'], ['git', 'ls-remote', 'origin', 'refs/heads/' + receipt['target']])
        self.assertEqual(ref['status'], 0); self.assertIsNone(ref['signal']); self.assertIsNone(ref['error'])
        self.assertEqual(ref['stdout'].strip(), '', 'the exact original topic was not observed absent')
        self.assertEqual(ref['receipt_sha256'], sha(f.receipt.read_bytes()))
        self.assertEqual(ref['push_result_sha256'], sha(f.push_path.read_bytes()))
        self.assertNotIn(str(f.root), lines[0], 'private control paths escaped in the public diagnostic')
        return value

    def assert_unknown(self, f):
        before_refs = f.refs(); before_pushes = len(f.rows(f.push_observed))
        result = f.readback()
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertFalse(any(line.startswith(PREFIX) for line in result.stdout.splitlines()))
        self.assertEqual(len(f.rows(f.push_observed)), before_pushes)
        self.assertEqual(f.refs(), before_refs)
        self.assertFalse(any(row[:2] in [['pr', 'create'], ['pr', 'merge']] for row in f.rows(f.gh_log)))
        return result

    def damage(self, f, **changes):
        record = f.fixture_terminal(); record.update(changes)
        f.push_path.write_text(json.dumps(record, separators=(',', ':')) + '\n')
        f.seed_protocol_ref()

    def test_real_remote_refusal_records_exact_original_Git_terminal_before_interpretation(self):
        f = self.fixture(); self.actual_terminal(f)
        before = f.rows(f.before_push); self.assertEqual(len(before), 1)
        self.assertEqual(before[0]['receipt'], f.receipt.read_text())
        self.assertEqual(before[0]['path'], str(f.receipt))

    def test_exact_refusal_is_typed_GET_only_readback_not_an_unconfirmed_PR(self):
        f = self.fixture(); self.actual_terminal(f); f.remember_original()
        self.diagnostic(f, f.readback()); f.assert_original_preserved()
        self.assertEqual(f.refs(), f.initial_refs)
        self.assertEqual(len(f.rows(f.push_observed)), 1)
        self.assertFalse(any(row[:2] in [['pr', 'create'], ['pr', 'merge']] for row in f.rows(f.gh_log)))

    def test_repeated_known_refusal_readback_does_not_flood_GET_or_new_observation_records(self):
        f = self.fixture(); self.actual_terminal(f); f.remember_original()
        for _ in range(3): self.diagnostic(f, f.readback())
        views = [row for row in f.rows(f.gh_log) if row[:2] == ['pr', 'view']]
        self.assertLessEqual(len(views), 1, 'the same immutable refused push was queried again every tick')
        self.assertEqual(len(f.rows(f.ref_observed)), 1, 'the original exact-ref diagnostic was queried again')
        self.assertLessEqual(len(list(f.records.glob(f.receipt.name + '.readback-*'))), 1,
                             'known refusal created unbounded duplicate readback receipts')
        f.assert_original_preserved()

    def test_missing_PR_without_push_terminal_remains_UNKNOWN(self):
        f = self.fixture()
        if f.push_path.exists(): f.push_path.unlink()  # Owned disposable crash-gap fixture only.
        f.remember_original(); self.assert_unknown(f); f.assert_original_preserved()

    def test_partial_original_push_terminal_remains_UNKNOWN(self):
        f = self.fixture(); f.push_path.write_bytes(b'{"version":1,')
        f.remember_original(); self.assert_unknown(f); f.assert_original_preserved()

    def test_foreign_receipt_hash_cannot_supply_definite_refusal(self):
        f = self.fixture(); self.damage(f, receipt_sha256='f' * 64); self.assert_unknown(f)

    def test_foreign_target_cannot_supply_definite_refusal(self):
        f = self.fixture(); self.damage(f, target='lane/mac-mail-20261031-000000Z-bbbbbbbbbbbb'); self.assert_unknown(f)

    def test_foreign_producing_source_head_cannot_supply_definite_refusal(self):
        f = self.fixture(); self.damage(f, producer_head='f' * 40); self.assert_unknown(f)

    def test_foreign_producing_source_bytes_cannot_supply_definite_refusal(self):
        f = self.fixture(); self.damage(f, producer_source_sha256='f' * 64); self.assert_unknown(f)

    def test_signal_or_missing_child_status_is_UNKNOWN_even_with_refusal_text(self):
        f = self.fixture(); self.damage(f, status=None, signal='SIGTERM'); self.assert_unknown(f)

    def test_spawn_error_is_UNKNOWN_even_with_refusal_text(self):
        f = self.fixture(); self.damage(f, error='ETIMEDOUT'); self.assert_unknown(f)

    def test_success_status_plus_refusal_words_is_not_a_definite_refusal(self):
        f = self.fixture(); self.damage(f, status=0); self.assert_unknown(f)

    def test_wrong_command_ref_is_UNKNOWN(self):
        f = self.fixture(); self.damage(f, command=['git', 'push', 'origin', 'HEAD:refs/heads/other']); self.assert_unknown(f)

    def test_changed_captured_stderr_hash_is_UNKNOWN(self):
        f = self.fixture(); self.damage(f, stderr_sha256='f' * 64); self.assert_unknown(f)

    def ref_fixture(self, **changes):
        f = self.fixture(); f.seed_protocol_terminal(); f.ref_path.unlink()
        f.set_ref_reply(**changes)
        return f

    def test_refused_stderr_without_successful_exact_GET_evidence_is_not_no_publication_proof(self):
        f = self.ref_fixture(status=1, stderr='fixture exact GET unavailable')
        f.remember_original(); self.assert_unknown(f); f.assert_original_preserved()

    def test_foreign_exact_GET_ref_cannot_prove_original_topic_absent(self):
        f = self.ref_fixture(stdout='f' * 40 + '\trefs/heads/foreign\n')
        f.remember_original()
        self.assert_unknown(f); f.assert_original_preserved()

    def test_matching_original_head_in_exact_GET_is_not_refusal_absence(self):
        f = self.fixture(); f.seed_protocol_terminal(); r = json.loads(f.receipt.read_bytes())
        out = r['head'] + '\trefs/heads/' + r['target'] + '\n'
        f.ref_path.unlink(); f.set_ref_reply(stdout=out)
        f.remember_original(); self.assert_unknown(f); f.assert_original_preserved()

    def test_foreign_head_in_exact_GET_stays_held_instead_of_claiming_absence(self):
        f = self.fixture(); f.seed_protocol_terminal(); r = json.loads(f.receipt.read_bytes())
        out = 'f' * 40 + '\trefs/heads/' + r['target'] + '\n'
        f.ref_path.unlink(); f.set_ref_reply(stdout=out)
        f.remember_original(); self.assert_unknown(f); f.assert_original_preserved()

    def test_duplicate_or_partial_GET_rows_are_UNKNOWN(self):
        f = self.fixture(); f.seed_protocol_terminal(); out = 'partial-ref-row\npartial-ref-row\n'
        f.ref_path.unlink(); f.set_ref_reply(stdout=out)
        f.remember_original(); self.assert_unknown(f); f.assert_original_preserved()

    def test_GET_bound_to_a_different_push_result_is_UNKNOWN(self):
        f = self.fixture(); f.seed_protocol_terminal(); f.seed_protocol_ref(push_result_sha256='f' * 64)
        f.set_ref_reply(status=1, stderr='fixture exact GET unavailable'); f.remember_original()
        self.assert_unknown(f); f.assert_original_preserved()

    def test_preexisting_adjacent_terminal_is_held_before_any_Git_or_overwrite(self):
        f = PushFixture(); self.addCleanup(f.close)
        original = b'ORIGINAL UNCONFIRMED ADJACENT PUSH RECORD\n'; f.push_path.write_bytes(original)
        before_git = f.rows(f.git_log); before_gh = f.rows(f.gh_log)
        result = f.call([str(Path(__import__('push_result_fixture').NODE)), 'scripts/lane-deliver.mjs',
            'heartbeat', 'mac-lane-tick', 'different observation', '--no-wake', '--receipt', str(f.receipt)])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(f.rows(f.git_log), before_git, 'partial original push evidence was treated as a fresh receipt')
        self.assertEqual(f.rows(f.gh_log), before_gh)
        self.assertEqual(f.push_path.read_bytes(), original); self.assertFalse(f.receipt.exists())


class RefusalRepairHandControls(unittest.TestCase):
    def fixture(self, *, reject='first', hand_outcome='accepted', diagnostic_changes=None):
        f = PushFixture(reject=reject, hand_outcome=hand_outcome); self.addCleanup(f.close)
        result = f.publish_original(); self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        # Isolate the Bash protocol branch from the missing producer recording
        # feature. This fixture record is projected from the actual real-Git
        # result; no production recording or context admission is claimed.
        f.install_readback_protocol_seam(changes=diagnostic_changes)
        f.remember_original()
        return f

    def one_hand(self, f):
        first = f.heartbeat(); second = f.heartbeat()
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        ops = f.hand_ops(); self.assertEqual(len(ops), 1, 'one exact distinct Cloud repair hand was not retained')
        op = ops[0]; self.assertEqual(op['who'], 'cloud lane'); self.assertEqual(op['op'], 'raise')
        self.assertRegex(op['id'], r'^[a-z0-9][a-z0-9-]{0,127}$')
        text = json.dumps(op); receipt = json.loads(f.receipt.read_bytes())
        self.assertIn(receipt['target'], text); self.assertIn(receipt['head'], text)
        self.assertNotIn(str(f.root), text); self.assertNotIn('/Users/', text)
        self.assertEqual(len(f.rows(f.push_observed)), 2, 'one original refusal plus one DIFFERENT hand push only')
        f.assert_original_preserved()
        return op

    def test_qualified_current_owner_can_send_one_distinct_repair_hand(self):
        self.one_hand(self.fixture())

    def test_known_refused_repair_hand_is_consumed_and_never_renamed_or_retried(self):
        self.one_hand(self.fixture(reject='always'))

    def test_UNKNOWN_repair_hand_is_consumed_and_readback_only(self):
        self.one_hand(self.fixture(hand_outcome='unknown'))

    def test_missing_new_hand_parent_terminal_never_authorizes_a_second_hand(self):
        f = self.fixture(); result = f.heartbeat(); self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(f.hand_ops()), 1, 'new source-bound repair hand was never attempted')
        terminals = list(f.records.glob('*.terminal.json'))
        self.assertTrue(terminals, 'different hand lacks an independent parent terminal')
        for path in terminals:
            if not path.name.startswith('tick-'): path.unlink()  # Disposable damage control only.
        f.heartbeat(); self.assertEqual(len(f.hand_ops()), 1); f.assert_original_preserved()

    def test_wrong_original_receipt_diagnostic_does_not_admit_a_hand(self):
        f = self.fixture(diagnostic_changes={'receipt_sha256': 'f' * 64})
        f.heartbeat(); self.assertEqual(f.hand_ops(), []); f.assert_original_preserved()

    def test_wrong_original_push_record_diagnostic_does_not_admit_a_hand(self):
        f = self.fixture(diagnostic_changes={'push_result_sha256': 'f' * 64})
        f.heartbeat(); self.assertEqual(f.hand_ops(), []); f.assert_original_preserved()

    def test_wrong_exact_GET_diagnostic_binding_does_not_admit_a_hand(self):
        f = self.fixture(diagnostic_changes={'ref_readback_sha256': 'f' * 64})
        f.heartbeat(); self.assertEqual(f.hand_ops(), []); f.assert_original_preserved()

    def test_wrong_producing_source_diagnostic_does_not_admit_a_hand(self):
        f = self.fixture(diagnostic_changes={'producer_head': 'f' * 40})
        f.heartbeat(); self.assertEqual(f.hand_ops(), []); f.assert_original_preserved()

    def test_unqualified_legacy_guard_stays_held_without_hand_or_reaping(self):
        f = self.fixture(); lock = f.records / 'tick.lock'; lock.mkdir()
        owner = lock / 'owner'; owner.write_bytes(b'held original legacy evidence\n')
        before = owner.read_bytes(); result = f.heartbeat()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(f.hand_ops(), []); self.assertEqual(len(f.rows(f.push_observed)), 1)
        self.assertTrue(lock.is_dir()); self.assertEqual(owner.read_bytes(), before)
        f.assert_original_preserved()


class ActualNetworkDenial(unittest.TestCase):
    def test_check_profile_denies_actual_network(self):
        sock = socket.socket()
        try:
            with self.assertRaises(OSError) as held:
                sock.connect(('127.0.0.1', 9))
            self.assertIn(held.exception.errno, (errno.EPERM, errno.EACCES),
                          'a refused connection is not proof of kernel network denial')
        finally:
            sock.close()


if __name__ == '__main__':
    unittest.main()
