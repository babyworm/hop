import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractStdictSupplement } from './lib/stdict-supplement.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultOutput = join(repoRoot, 'assets/dictionaries/hanja/stdict-20260605.json');

export async function writeStdictSupplement(sourceDirectory, outputPath = defaultOutput) {
  const supplement = await extractStdictSupplement(resolve(sourceDirectory));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(supplement)}\n`);
  return supplement;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sourceDirectory = process.argv[2];
  if (!sourceDirectory) {
    console.error('usage: node scripts/extract-stdict-hanja-supplement.mjs <stdict-xml-directory> [output-file]');
    process.exitCode = 1;
  } else {
    writeStdictSupplement(sourceDirectory, process.argv[3] ? resolve(process.argv[3]) : defaultOutput)
      .then((supplement) => console.log(
        `Standard Dictionary supplement written: ${supplement.pairs.length} safe Hangul-Hanja pairs`,
      ))
      .catch((error) => {
        console.error(error instanceof Error ? error.stack : error);
        process.exitCode = 1;
      });
  }
}
