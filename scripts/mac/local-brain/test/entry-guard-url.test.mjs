import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const helper = new URL('../../../lib/is-main.mjs', import.meta.url).href;
const dir = mkdtempSync(join(tmpdir(), 'entry-url-'));
const entry = join(dir, 'entry.mjs');
writeFileSync(entry, `import {isMainModule} from ${JSON.stringify(helper)};
if (isMainModule(process.argv[1], import.meta.url)) {
 console.log('BODY ' + import.meta.url.split('/').pop());
 if (!process.env.NO_REIMPORT) { await import(import.meta.url + '?case=1'); await import(import.meta.url + '#tag'); }
}`);
const runs = (args, env = {}) => execFileSync(process.execPath, args, {env: {...process.env, ...env}, encoding: 'utf8'}).trim().split('\n').filter(Boolean);
test('#2185: re-importing the entry with ?query or #fragment never runs its body again', () => {
 assert.deepEqual(runs([entry]), ['BODY entry.mjs']);
});
test('#2185: ordinary entry runs, and a plain import from another file does not', () => {
 assert.deepEqual(runs([entry], {NO_REIMPORT: '1'}), ['BODY entry.mjs']);
 assert.deepEqual(runs(['--input-type=module', '-e', `await import(${JSON.stringify(new URL('file://' + entry).href)})`]), []);
});
