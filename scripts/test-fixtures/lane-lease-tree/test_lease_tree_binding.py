"""Ordinary fixture snapshot read-binding regressions; all objects are disposable."""
from pathlib import Path
import errno,json,os,socket,stat,subprocess,tempfile,unittest
HERE=Path(__file__).resolve().parent
SOURCE=Path(os.environ['SG_LEASE_TREE_SOURCE_FILE'])
NODE=os.environ['SG_CHECK_NODE']
ARTIFACT_ROOT=Path(os.environ['SG_CHECK_ARTIFACT_ROOT'])
class OwnedFixtureDirectory:
 def __init__(self,**kw):self.path=tempfile.mkdtemp(dir=ARTIFACT_ROOT,**kw)
 def __enter__(self):return self.path
 def __exit__(self,*_):pass  # Parent retains failures and owns successful cleanup.
class LeaseTreeReadBinding(unittest.TestCase):
 def execute(self,mode):
  with OwnedFixtureDirectory(prefix='sg-lease-tree-binding-')as name:
   root=Path(name);tree=root/'tree';tree.mkdir();(tree/'nested').mkdir()
   (tree/'target').write_bytes(b'A'*24);(root/'replacement').write_bytes(b'B'*24);(root/'canary').write_bytes(b'C'*24)
   (tree/'nested/stable').write_bytes(b'nested fixture')
   os.link(tree/'target',tree/'hardlink');(tree/'existing-symlink').symlink_to(root/'canary')
   canary=(root/'canary').stat();canary_identity=(canary.st_dev,canary.st_ino);canary_raw=(root/'canary').read_bytes()
   expected={}
   for p in [tree,tree/'hardlink',tree/'existing-symlink',tree/'nested',tree/'nested/stable',tree/'target']:
    info=p.lstat();rel='.'if p==tree else'./'+str(p.relative_to(tree));row={'path':rel,'dev':info.st_dev,'ino':info.st_ino,'mode':info.st_mode,'nlink':info.st_nlink}
    if stat.S_ISREG(info.st_mode):row['bytes']=p.read_bytes().hex()
    expected[rel]=row
   (root/'process.intent.json').write_text(json.dumps({'argv':[NODE,str(HERE/'lease_tree_fs_proxy.cjs'),str(SOURCE),str(root),mode],'inherited_fd':'owned disposable fixture descriptor'})+'\n')
   result=subprocess.run([NODE,str(HERE/'lease_tree_fs_proxy.cjs'),str(SOURCE),str(root),mode],capture_output=True,text=True,pass_fds=(int(os.environ['SG_REPAIR_LOCK_FD']),))
   (root/'process.stdout.raw').write_bytes(result.stdout.encode());(root/'process.stderr.raw').write_bytes(result.stderr.encode())
   (root/'process.terminal.json').write_text(json.dumps({'returncode':result.returncode,'signal':-result.returncode if result.returncode<0 else None})+'\n')
   self.assertEqual(result.returncode,0,result.stderr)
   value=json.loads(result.stdout)
   self.assertEqual((root/'canary').read_bytes(),canary_raw);self.assertEqual(((root/'canary').stat().st_dev,(root/'canary').stat().st_ino),canary_identity)
   self.assertEqual(value['unclosedBeforeHarnessCleanup'],0,'source snapshot leaked an owned descriptor')
   return value,expected
 def test_symlink_swap_after_metadata_does_not_read_the_separate_canary(self):
  value,_=self.execute('symlink-after-lstat')
  self.assertEqual(value['events'],['symlink'])
  self.assertFalse(any(r['isCanary']for r in value['reads']),'snapshot followed the post-lstat symlink and read the separate canary')
  self.assertFalse(value['ok'],'a replaced named object must not certify old metadata with new bytes')
 def test_regular_path_swap_before_open_refuses_the_wrong_object(self):
  value,_=self.execute('regular-before-open')
  self.assertEqual(value['events'],['regular'])
  self.assertFalse(any(r['isReplacement']for r in value['reads']),'snapshot read replacement bytes under original metadata')
  self.assertFalse(value['ok'],'regular replacement must be held instead of mixed into old identity')
 def test_post_open_swap_is_refused_or_reads_only_the_exact_original_descriptor(self):
  value,expected=self.execute('regular-after-open')
  self.assertEqual(value['events'],['regular'])
  self.assertFalse(any(r['isCanary']or r['isReplacement']for r in value['reads']))
  if value['ok']:
   actual={row['path']:row for row in value['rows']}
   self.assertEqual(actual['./target']['bytes'],expected['./target']['bytes']);self.assertEqual(actual['./target']['ino'],expected['./target']['ino'])
 def test_stable_recursive_file_hardlink_symlink_and_metadata_match_the_original_contract(self):
  value,expected=self.execute('stable')
  self.assertTrue(value['ok'],value.get('error'))
  self.assertEqual({row['path']:row for row in value['rows']},expected)
  self.assertEqual([row['path']for row in value['rows']],['./existing-symlink','./hardlink','./nested/stable','./nested','./target','.'])
  self.assertFalse(any(r['isCanary']for r in value['reads']));self.assertNotIn('bytes',next(r for r in value['rows']if r['path']=='./existing-symlink'))
  self.assertEqual(next(r for r in value['rows']if r['path']=='./target')['nlink'],2)
 def test_injected_post_open_read_failure_closes_the_owned_descriptor(self):
  value,_=self.execute('read-fault')
  self.assertFalse(value['ok']);self.assertIn('controlled post-open read fault',value['error']);self.assertGreaterEqual(len(value['opened']),1)
def assert_network_denied():
 sock=socket.socket()
 try:
  try:sock.connect(('127.0.0.1',9))
  except OSError as error:
   if error.errno not in{errno.EPERM,errno.EACCES}:raise AssertionError('actual network denial absent')from None
  else:raise AssertionError('network unexpectedly permitted')
 finally:sock.close()
