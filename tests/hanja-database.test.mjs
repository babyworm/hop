import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseLibhangul } from '../scripts/lib/hanja-source-parsers.mjs';
import { repoRoot } from '../scripts/lib/hanja-database.mjs';
import { verifyHanjaDatabase } from '../scripts/verify-hanja-database.mjs';

test('libhangul word parsing rejects malformed and non-aligned conversion pairs', () => {
  const { words } = parseLibhangul(Buffer.from([
    '학교:學校:학교',
    '창황실색:𢠵怳失色:창황실색',
    '기학:氣:private-use character',
    '눌도:율도[訥島:broken source text',
    '대부동:大阜東洞:length mismatch',
    '버스 정류장:버스停留場:space in lookup key',
  ].join('\n')));

  assert.deepEqual([...words.keys()], ['학교', '창황실색']);
});

test('generated Hanja databases preserve their source and lookup contracts', async () => {
  await verifyHanjaDatabase();
});

test('hashed Hanja JSON assets keep LF bytes on every Git checkout', () => {
  const paths = [
    'apps/studio-host/public/dictionaries/hanja/characters.json',
    'assets/dictionaries/hanja/stdict-20260605.json',
  ];
  const result = spawnSync('git', ['check-attr', 'text', 'eol', '--', ...paths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/u).map((line) => line.split(': ')), [
    [paths[0], 'text', 'set'],
    [paths[0], 'eol', 'lf'],
    [paths[1], 'text', 'set'],
    [paths[1], 'eol', 'lf'],
  ]);
});
