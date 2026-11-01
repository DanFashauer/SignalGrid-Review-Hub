"""Run the preserved five real-filesystem snapshot binding assertions."""
from pathlib import Path
import argparse
import json
import os
import stat
import sys
import unittest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--node', required=True, type=Path)
    parser.add_argument('--artifact-root', required=True, type=Path)
    args = parser.parse_args()
    source = args.source_root.resolve(strict=True)
    if source != Path(__file__).resolve().parent.parent:
        raise RuntimeError('The public runner must use its own current source root')
    artifacts = args.artifact_root.resolve(strict=True)
    info = artifacts.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('A unique owned private fixture directory is required')
    os.environ.update(SG_LEASE_TREE_SOURCE_FILE=str(source / 'scripts/check-lane-delivery.mjs'),
        SG_CHECK_NODE=str(args.node.resolve(strict=True)), SG_CHECK_ARTIFACT_ROOT=str(artifacts))
    # Isolate only this fixture child's Node startup; actual HOME is untouched.
    os.environ.pop('NODE_OPTIONS', None)
    os.environ.pop('NODE_PATH', None)
    fixtures = source / 'scripts/test-fixtures'
    sys.path.insert(0, str(fixtures))
    from kernel_network_denial import enforce_network_denial
    enforce_network_denial()
    sys.path.insert(0, str(fixtures / 'lane-lease-tree'))
    # The original fixture inherited a descriptor solely as parent lifetime
    # plumbing. Its public replacement is an owned disposable file, never the
    # host reservation or a live tick lock. The source proxy does not use it.
    fd = os.open(artifacts / 'fixture-lifetime.fd', os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.environ['SG_REPAIR_LOCK_FD'] = str(fd)
        from test_lease_tree_binding import assert_network_denied
        assert_network_denied()
        suite = unittest.defaultTestLoader.loadTestsFromName('test_lease_tree_binding')
        result = unittest.TextTestRunner(verbosity=2).run(suite)
    finally:
        os.close(fd)
    summary = {'tests': result.testsRun, 'failures': len(result.failures),
        'errors': len(result.errors), 'skips': len(result.skipped), 'success': result.wasSuccessful(),
        'fixture_only': True, 'not_host_admission_or_native_coding': True}
    with (artifacts / 'python-result.json').open('x') as stream:
        json.dump(summary, stream, sort_keys=True); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    return 0 if result.wasSuccessful() and result.testsRun == 5 and not result.skipped else 1


if __name__ == '__main__':
    raise SystemExit(main())
