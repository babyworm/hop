import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const upstreamDir = join(repoRoot, 'third_party/rhwp');
export const upstreamLockPath = join(repoRoot, 'config/rhwp-upstream.json');
export const studioOverrideManifestPath = join(repoRoot, 'config/rhwp-studio-overrides.json');
export const upstreamStudioDir = join(upstreamDir, 'rhwp-studio/src');
export const studioHostDir = join(repoRoot, 'apps/studio-host');
export const vendorDir = join(repoRoot, 'apps/studio-host/vendor/rhwp-core');
export const provenancePath = join(vendorDir, 'PROVENANCE.json');
export const cargoRoots = [
  join(repoRoot, 'apps/desktop/src-tauri'),
  join(repoRoot, 'apps/desktop/quicklook/rust'),
];
export const officialUpstreamSource = 'https://github.com/edwardkim/rhwp';

export const generatedArtifactNames = [
  'rhwp_bg.wasm',
  'rhwp.js',
  'rhwp.d.ts',
  'rhwp_bg.wasm.d.ts',
];
export const vendoredArtifactNames = [
  ...generatedArtifactNames,
  'package.json',
  'LICENSE',
];
export const studioMirroredAssetPaths = ['public/images/icon_small_ko_dark.svg'];
export const studioPrivateInputIds = [
  'engine/command',
  'engine/cursor',
  'engine/history',
  'engine/input-handler',
  'styles/dialogs.css',
  'styles/menu-bar.css',
  'ui/context-menu',
];

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? 'pipe',
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${details ? `\n${details}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

export function parsePackageVersion(toml) {
  const packageBlock = toml.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? '';
  const version = packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error('Unable to read rhwp package version from Cargo.toml');
  return version;
}

export function parseRustToolchain(toml) {
  const channel = toml.match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
  if (!channel) throw new Error('Unable to read rhwp Rust toolchain');
  return channel;
}

export function tomlSection(toml, name) {
  const escapedName = escapeRegExp(name);
  const header = toml.match(new RegExp(`^\\[${escapedName}\\][^\\S\\r\\n]*$`, 'm'));
  if (!header || header.index === undefined) return '';
  const contents = toml.slice(header.index + header[0].length).replace(/^\r?\n/, '');
  const nextSection = contents.search(/^\[/m);
  return nextSection === -1 ? contents : contents.slice(0, nextSection);
}

export function cargoLockPackageVersion(lock, packageName) {
  return cargoLockPackageEntries(lock, packageName)[0]?.version;
}

export function cargoLockPackageEntries(lock, packageName) {
  return lock.split(/^\[\[package\]\]\s*$/m).slice(1).flatMap((block) => {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    if (name !== packageName) return [];
    return [{
      version: block.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
      source: block.match(/^source\s*=\s*"([^"]+)"/m)?.[1],
    }];
  });
}

export async function artifactMetadata(path) {
  const bytes = await readFile(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function canonicalTextSha256(path) {
  const text = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
  return createHash('sha256').update(text).digest('hex');
}

export function studioSourceRelativePath(id) {
  return id.endsWith('.css') ? id : `${id}.ts`;
}

export function repoRelativePath(path) {
  return relative(repoRoot, path).replaceAll('\\', '/');
}

export async function buildProvenance(lock) {
  const artifacts = {};
  for (const name of vendoredArtifactNames) {
    artifacts[name] = await artifactMetadata(join(vendorDir, name));
  }
  return {
    schemaVersion: 1,
    source: lock.source,
    version: lock.version,
    tag: lock.tag,
    commit: lock.commit,
    rustToolchain: lock.rustToolchain,
    wasmPackVersion: lock.wasmPackVersion,
    artifacts,
  };
}

export async function buildStudioOverrideBaseline(manifest, upstream) {
  const counterparts = {};
  for (const entry of manifest.overrides) {
    if (entry.strategy !== 'extension' && entry.strategy !== 'fork') continue;
    const relativePath = studioSourceRelativePath(entry.id);
    counterparts[entry.id] = await canonicalTextSha256(join(upstreamStudioDir, relativePath));
  }
  const assets = {};
  for (const relativePath of studioMirroredAssetPaths) {
    assets[relativePath] = (await artifactMetadata(join(upstreamDir, 'rhwp-studio', relativePath))).sha256;
  }
  const privateInputs = {};
  for (const id of studioPrivateInputIds) {
    privateInputs[id] = await canonicalTextSha256(join(upstreamStudioDir, studioSourceRelativePath(id)));
  }
  return {
    version: upstream.version,
    commit: upstream.commit,
    counterparts,
    privateInputs,
    assets,
  };
}

export function changedStudioInputs(previous, next) {
  const changed = [];
  for (const field of ['counterparts', 'privateInputs', 'assets']) {
    const before = previous.upstream?.[field] ?? {};
    const after = next.upstream?.[field] ?? {};
    const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const id of ids) {
      if (before[id] === after[id]) continue;
      if (field === 'assets') changed.push(`asset:${id}`);
      else if (field === 'privateInputs') changed.push(`private-input:${id}`);
      else changed.push(id);
    }
  }
  return changed.sort();
}

export function currentUpstreamCommit() {
  return run('git', ['rev-parse', 'HEAD'], { cwd: upstreamDir });
}

export function assertStableTag(tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Expected a stable release tag such as v0.7.19, received: ${tag}`);
  }
}

export function normalizeGitSource(source) {
  let normalized = source.trim();
  const scpStyle = normalized.match(/^git@([^:]+):(.+)$/);
  if (scpStyle) normalized = `https://${scpStyle[1]}/${scpStyle[2]}`;
  normalized = normalized.replace(/^ssh:\/\/git@/, 'https://');
  return normalized.replace(/\.git\/?$/, '').replace(/\/$/, '');
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function cargoPatchTomlPattern(crateName, patch) {
  const crate = escapeRegExp(crateName);
  const git = escapeRegExp(patch.git);
  const rev = escapeRegExp(patch.rev);
  return new RegExp(
    `${crate}\\s*=\\s*\\{(?=[^}]*git\\s*=\\s*"${git}")(?=[^}]*rev\\s*=\\s*"${rev}")[^}]*\\}`,
  );
}

export function cargoLockHasPatchSource(lock, crateName, patch) {
  return cargoLockPackageEntries(lock, crateName).some(({ source }) => {
    const parsed = source?.match(/^git\+([^?#]+)(?:\?[^#]*)?#([0-9a-f]{40})$/);
    return parsed?.[1] === patch.git && parsed[2] === patch.rev;
  });
}
