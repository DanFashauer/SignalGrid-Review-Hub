"""Run31 preserved push and strict-refusal UNIT assertions on current public source."""
from pathlib import Path
import argparse
import json
import os
import shutil
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
    node = args.node.resolve(strict=True)
    git = shutil.which('git')
    if not git:
        raise RuntimeError('The existing local Git executable is required')
    os.environ.update(PUSH_RESULT_SOURCE_ROOT=str(source), SG_CHECK_NODE=str(node),
        SG_CHECK_GIT=str(Path(git).resolve(strict=True)), SG_CHECK_ARTIFACT_ROOT=str(artifacts))
    fixtures = source / 'scripts/test-fixtures'
    sys.path.insert(0, str(fixtures))
    from kernel_network_denial import enforce_network_denial
    enforce_network_denial()
    sys.path.insert(0, str(fixtures / 'lane-push'))
    import raw_capture_fixture_adapter
    raw_capture_fixture_adapter.install()
    # The immutable real socket assertion remains one of these exact 31 tests.
    suite = unittest.defaultTestLoader.loadTestsFromName('test_original_push_terminal')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    summary = {'tests': result.testsRun, 'failures': len(result.failures),
        'errors': len(result.errors), 'skips': len(result.skipped), 'success': result.wasSuccessful(),
        'fixture_only': True, 'not_native_coding_or_delivery': True}
    with (artifacts / 'python-result.json').open('x') as stream:
        json.dump(summary, stream, sort_keys=True); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    return 0 if result.wasSuccessful() and result.testsRun == 31 and not result.skipped else 1


if __name__ == '__main__':
    raise SystemExit(main())
