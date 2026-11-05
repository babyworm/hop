# Third-Party Licenses

HOP source code is licensed under the repository's [MIT license](LICENSE).
Bundled third-party components and data remain subject to their respective
licenses and notices below.

## rhwp

HOP is based on the read-only `rhwp` upstream component.

- License: [MIT](third_party/rhwp/LICENSE)
- Dependency and resource notices:
  [third_party/rhwp/THIRD_PARTY_LICENSES.md](third_party/rhwp/THIRD_PARTY_LICENSES.md)

## Bundled fonts

Bundled font families and their license identifiers are listed in
[assets/fonts/FONTS.md](assets/fonts/FONTS.md).

## Hanja database

The generated Hanja database is not covered by HOP's MIT license.

| Distributed data | Sources | License |
| --- | --- | --- |
| `characters.json`, `readings.json` | libhangul `hanja.txt`, Unicode Unihan 17.0.0 | BSD-3-Clause AND Unicode-3.0 |
| `words-*.json` | libhangul `hanja.txt`, Korean Basic Dictionary, Standard Korean Language Dictionary | CC-BY-SA-2.0-KR; the libhangul-derived portions retain the BSD-3-Clause notice |
| `stdict-20260605.json` | Standard Korean Language Dictionary | CC-BY-SA-2.0-KR |

The complete copyright notices, permission terms, source versions, attribution,
and modification disclosures are in
[apps/studio-host/public/dictionaries/hanja/THIRD_PARTY_NOTICES.md](apps/studio-host/public/dictionaries/hanja/THIRD_PARTY_NOTICES.md).
The generated manifest records the source revisions, hashes, and license
identifiers in
[apps/studio-host/public/dictionaries/hanja/manifest.json](apps/studio-host/public/dictionaries/hanja/manifest.json).
