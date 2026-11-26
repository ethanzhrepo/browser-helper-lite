import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  MAX_SKILL_FILES,
  parseSkillFile,
  serializeSkill,
  SKILL_FILE_BYTES,
  SKILL_FILES_BYTES,
  SkillError,
  type Skill,
  type SkillFile,
  type SkippedFile,
} from './format';

/**
 * A skill's folder, as a list of files: from a zip archive, from a folder on
 * GitHub, or a SKILL.md alone. Turned into a Skill by readSkillFolder.
 */
export interface FolderEntry {
  /** As it is in the archive or the repository: "forum-check/references/a.md". */
  path: string;
  size: number;
  /** Missing for a file that was not downloaded (a script, a picture, one too large). */
  bytes?: Uint8Array;
}

/** Files read as text: documentation, data, templates. */
const TEXT = /\.(md|markdown|mdx|txt|text|rst|adoc|json|jsonl|ndjson|csv|tsv|ya?ml|toml|ini|cfg|conf|xml|html?|css|svg|tex|sql|graphql|gql|env\.example)$/i;
const TEXT_NAMES = /^(license|licence|notice|readme|changelog|authors|copying)(\.[a-z]+)?$/i;
/** Code: never installed, this extension runs none. */
const SCRIPT = /\.(py|pyw|sh|bash|zsh|fish|js|mjs|cjs|jsx|ts|tsx|rb|pl|php|ps1|psm1|bat|cmd|go|rs|java|kt|kts|swift|lua|r|jl|scala|c|cc|cpp|h|hpp|cs|vbs|applescript|exe|dll|so|dylib|wasm|jar)$/i;
const JUNK = /(^|\/)(__MACOSX|\.git|node_modules)(\/|$)|(^|\/)\.[^/]*$/;

/** The largest archive or file read. */
export const MAX_DOWNLOAD_BYTES = 20_000_000;
const MAX_ENTRIES = 500;

const clean = (path: string) => path.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** What a file of the folder is: kept as text, or left out and why. */
export function sortFile(path: string, size: number): SkippedFile['reason'] | 'text' {
  if (path.split('/')[0] === 'scripts' || SCRIPT.test(path)) return 'script';
  if (!TEXT.test(path) && !TEXT_NAMES.test(basename(path))) return 'binary';
  if (size > SKILL_FILE_BYTES) return 'large';
  return 'text';
}

/**
 * The skill in a folder's files. The SKILL.md nearest the top decides where
 * the skill's folder is; its name must be the folder's name, as the format
 * says. `folder` names the folder when the files' paths start inside it (a
 * folder on GitHub). Files outside the skill's folder are not part of it.
 */
export function readSkillFolder(entries: FolderEntry[], folder?: string): Skill {
  const files = entries.map((entry) => ({ ...entry, path: clean(entry.path) })).filter((entry) => entry.path && !entry.path.endsWith('/') && !JUNK.test(entry.path));
  const candidates = files.filter((entry) => basename(entry.path) === 'SKILL.md');
  if (candidates.length === 0) throw new SkillError('noSkillFile');
  const depth = (path: string) => path.split('/').length;
  const top = Math.min(...candidates.map((entry) => depth(entry.path)));
  const nearest = candidates.filter((entry) => depth(entry.path) === top);
  if (nearest.length > 1) throw new SkillError('several', nearest.map((entry) => dirname(entry.path)).join(', '));
  const main = nearest[0]!;
  if (!main.bytes) throw new SkillError('noSkillFile');
  const root = dirname(main.path);
  const fields = parseSkillFile(decode(main.bytes) ?? '');
  const folderName = root ? basename(root) : folder;
  if (folderName && folderName !== fields.name) throw new SkillError('dirName', folderName);

  const kept: SkillFile[] = [];
  const skipped: SkippedFile[] = [];
  let total = 0;
  for (const entry of files) {
    if (entry === main || (root && !entry.path.startsWith(`${root}/`))) continue;
    const path = root ? entry.path.slice(root.length + 1) : entry.path;
    if (!path || path.split('/').includes('..')) continue;
    const size = entry.bytes ? entry.bytes.length : entry.size;
    const sort = sortFile(path, size);
    if (sort !== 'text') {
      skipped.push({ path, reason: sort });
      continue;
    }
    const text = entry.bytes ? decode(entry.bytes) : undefined;
    if (text === undefined) {
      skipped.push({ path, reason: 'binary' });
      continue;
    }
    if (kept.length >= MAX_SKILL_FILES || total + size > SKILL_FILES_BYTES) {
      skipped.push({ path, reason: 'many' });
      continue;
    }
    total += size;
    kept.push({ path, text });
  }
  kept.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { ...fields, ...(kept.length > 0 ? { files: kept } : {}), ...(skipped.length > 0 ? { skipped } : {}) };
}

/** UTF-8 text, or undefined when the bytes are not text. */
function decode(bytes: Uint8Array): string | undefined {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\u0000') ? undefined : text.replace(/^﻿/, '');
  } catch {
    return undefined;
  }
}

const isZip = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** The files of a zip archive, without unpacking more than a skill could hold. */
export function unzipFolder(bytes: Uint8Array): FolderEntry[] {
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new SkillError('tooLarge');
  let unpacked = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        count += 1;
        const name = clean(file.name);
        if (!name || name.split('/').includes('..')) return false;
        // Only what could be kept is unpacked; the rest is listed by name and size.
        const wanted = basename(name) === 'SKILL.md' || sortFile(name.split('/').slice(1).join('/') || name, file.originalSize) === 'text';
        if (!wanted || count > MAX_ENTRIES || unpacked + file.originalSize > MAX_DOWNLOAD_BYTES) return false;
        unpacked += file.originalSize;
        return true;
      },
    });
  } catch {
    throw new SkillError('archive');
  }
  // Verify actual inflated byte length (zip headers can spoof originalSize).
  let actualUnpacked = 0;
  for (const data of Object.values(files)) {
    actualUnpacked += data.byteLength;
    if (actualUnpacked > MAX_DOWNLOAD_BYTES) throw new SkillError('tooLarge');
  }
  const sizes = new Map<string, number>();
  // A second pass that unpacks nothing, for the names and sizes of what was left packed.
  unzipSync(bytes, {
    filter: (file) => {
      sizes.set(file.name, file.originalSize);
      return false;
    },
  });
  return [...sizes].map(([path, size]) => ({ path, size: files[path]?.byteLength ?? size, ...(files[path] ? { bytes: files[path] } : {}) }));
}

/** Reads a skill from a file the user chose: a SKILL.md, or a zip of the skill's folder. */
export async function readSkillUpload(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<Skill> {
  if (file.size > MAX_DOWNLOAD_BYTES) throw new SkillError('tooLarge');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isZip(bytes)) return readSkillFolder(unzipFolder(bytes));
  // A Markdown file alone is the SKILL.md of a folder that is not there: no folder name to check.
  return readSkillFolder([{ path: 'SKILL.md', size: bytes.length, bytes }]);
}

/** A zip of the skill's folder, as the format lays it out: `<name>/SKILL.md` and its files. */
export function zipSkill(skill: Skill): Uint8Array {
  const entries: Record<string, Uint8Array> = { [`${skill.name}/SKILL.md`]: strToU8(serializeSkill(skill)) };
  for (const file of skill.files ?? []) entries[`${skill.name}/${file.path}`] = strToU8(file.text);
  return zipSync(entries, { level: 6 });
}

// ---- From an address ----

/** Where a skill is on GitHub: a repository, a ref, and the path of its folder. */
interface GitHubFolder {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

/**
 * The GitHub folder an address points to: a folder page (/tree/…), the page
 * or the raw file of a SKILL.md, which stands for its folder.
 */
export function githubFolder(address: string): GitHubFolder | undefined {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return undefined;
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (url.hostname === 'github.com' && (parts[2] === 'tree' || parts[2] === 'blob') && parts.length >= 4) {
    const [owner, repo, kind, ref, ...rest] = parts;
    if (kind === 'blob' && rest.at(-1) !== 'SKILL.md') return undefined;
    return { owner: owner!, repo: repo!, ref: ref!, path: (kind === 'blob' ? rest.slice(0, -1) : rest).join('/') };
  }
  if (url.hostname === 'raw.githubusercontent.com' && parts.length >= 4 && parts.at(-1) === 'SKILL.md') {
    const [owner, repo, ref, ...rest] = parts;
    return { owner: owner!, repo: repo!, ref: ref!, path: rest.slice(0, -1).join('/') };
  }
  return undefined;
}

/** The address a skill is fetched from: https, or plain http on this computer. */
export function skillAddress(address: string): URL {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new SkillError('address');
  }
  const local = url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new SkillError('address');
  return url;
}

const FETCH_OPTIONS: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer' };

async function download(url: string, fetchImpl: typeof fetch, headers?: Record<string, string>): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...FETCH_OPTIONS, headers, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new SkillError('fetch');
  }
  if (!response.ok) throw new SkillError('fetch');
  if (Number(response.headers.get('content-length') ?? 0) > MAX_DOWNLOAD_BYTES) throw new SkillError('tooLarge');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD_BYTES) throw new SkillError('tooLarge');
  return bytes;
}

interface GitHubItem {
  type: 'file' | 'dir' | string;
  path: string;
  size: number;
  download_url: string | null;
}

/** The files of a folder on GitHub, through its public API (no sign-in, so public repositories only). */
async function githubEntries(folder: GitHubFolder, fetchImpl: typeof fetch): Promise<FolderEntry[]> {
  const entries: FolderEntry[] = [];
  const list = async (path: string, depth: number): Promise<void> => {
    const api = `https://api.github.com/repos/${encodeURIComponent(folder.owner)}/${encodeURIComponent(folder.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(folder.ref)}`;
    const items = JSON.parse(new TextDecoder().decode(await download(api, fetchImpl, { accept: 'application/vnd.github+json' }))) as GitHubItem[] | GitHubItem;
    if (!Array.isArray(items)) throw new SkillError('noSkillFile');
    for (const item of items) {
      if (entries.length >= MAX_ENTRIES) return;
      const relative = folder.path ? item.path.slice(folder.path.length + 1) : item.path;
      if (item.type === 'dir') {
        if (depth < 4 && !JUNK.test(relative)) await list(item.path, depth + 1);
        continue;
      }
      if (item.type !== 'file') continue;
      const keep = relative === 'SKILL.md' || sortFile(relative, item.size) === 'text';
      entries.push({ path: relative, size: item.size, ...(keep && item.download_url ? { bytes: await download(item.download_url, fetchImpl) } : {}) });
    }
  };
  await list(folder.path, 0);
  return entries;
}

/**
 * Fetches a skill for the user to read before installing it. Nothing is
 * installed here, and no cookies are sent. Takes a folder or a SKILL.md on
 * GitHub, or the address of a SKILL.md or of a zip of the skill's folder.
 */
export async function fetchSkill(address: string, fetchImpl: typeof fetch = fetch): Promise<Skill> {
  const url = skillAddress(address);
  const folder = githubFolder(url.href);
  if (folder) {
    const name = folder.path.split('/').filter(Boolean).at(-1);
    return readSkillFolder(await githubEntries(folder, fetchImpl), name);
  }
  // The page of another file on GitHub: the file itself.
  const blob = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
  const target = url.hostname === 'github.com' && blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}` : url.href;
  const bytes = await download(target, fetchImpl);
  if (isZip(bytes)) return readSkillFolder(unzipFolder(bytes));
  // A SKILL.md alone: its folder is the one its address names.
  const parts = new URL(target).pathname.split('/').filter(Boolean);
  const named = parts.at(-1) === 'SKILL.md' ? parts.at(-2) : undefined;
  return readSkillFolder([{ path: 'SKILL.md', size: bytes.length, bytes }], named && decodeURIComponent(named));
}
