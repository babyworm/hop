import test from 'node:test';
import { verifyHanjaDatabase } from '../scripts/verify-hanja-database.mjs';

test('generated Hanja databases preserve their source and lookup contracts', async () => {
  await verifyHanjaDatabase();
});
