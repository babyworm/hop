import { pathToFileURL } from 'node:url';
import {
  applyKrdict,
  applyStdictSupplement,
  applyUnihan,
  downloadSource,
  parseLibhangul,
  readStdictSupplement,
  sources,
  writeDatabase,
} from './lib/hanja-database.mjs';

export async function buildHanjaDatabase() {
  console.log('Downloading pinned dictionary sources...');
  const [libhangul, unihan, krdict, stdict] = await Promise.all([
    downloadSource(sources.libhangul),
    downloadSource(sources.unihan),
    downloadSource(sources.krdict),
    readStdictSupplement(),
  ]);

  console.log('Parsing libhangul mappings...');
  const { characters, words } = parseLibhangul(libhangul);
  console.log('Applying Unicode Unihan metadata...');
  applyUnihan(characters, unihan);
  console.log('Applying Korean Basic Dictionary metadata...');
  applyKrdict(words, krdict);
  console.log('Applying Standard Korean Language Dictionary supplement...');
  applyStdictSupplement(words, stdict);
  console.log('Writing deterministic JSON shards...');
  return writeDatabase(characters, words);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildHanjaDatabase()
    .then((manifest) => {
      console.log(
        `Hanja database built: ${manifest.characterDatabase.entries} characters, `
        + `${manifest.wordDatabase.entries} words, ${manifest.wordDatabase.candidates} candidates`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}
