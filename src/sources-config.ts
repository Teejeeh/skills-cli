import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

const AGENTS_DIR = '.agents';
const SOURCES_FILE = 'sources.json';
const CURRENT_VERSION = 1;

export type SourceType = 'gitlab' | 'github';

export interface SourceEntry {
  type: SourceType;
  /** Normalized origin, e.g. "https://gitlab.kwal-it.nl" */
  host: string;
  /** True for sources that are always present and cannot be removed. */
  builtin?: boolean;
}

export const GITHUB_BUILTIN_SOURCE: SourceEntry = {
  type: 'github',
  host: 'https://github.com',
  builtin: true,
};

export interface SourcesConfig {
  version: number;
  sources: SourceEntry[];
}

export function getSourcesConfigPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'skills', SOURCES_FILE);
  }
  return join(homedir(), AGENTS_DIR, SOURCES_FILE);
}

function emptyConfig(): SourcesConfig {
  return { version: CURRENT_VERSION, sources: [] };
}

export function readSourcesConfigSync(): SourcesConfig {
  try {
    const content = readFileSync(getSourcesConfigPath(), 'utf-8');
    const parsed = JSON.parse(content) as SourcesConfig;
    if (typeof parsed.version !== 'number' || !Array.isArray(parsed.sources)) {
      return emptyConfig();
    }
    return parsed;
  } catch {
    return emptyConfig();
  }
}

export function writeSourcesConfigSync(config: SourcesConfig): void {
  const configPath = getSourcesConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/** Normalize a host to include https:// and no trailing slash. */
export function normalizeHost(host: string): string {
  const withProtocol =
    host.startsWith('http://') || host.startsWith('https://') ? host : `https://${host}`;
  return withProtocol.replace(/\/$/, '');
}

let _cachedGitLabSources: SourceEntry[] | null = null;

/** Returns all configured GitLab sources. Result is cached after first call. */
export function getConfiguredGitLabSources(): SourceEntry[] {
  if (_cachedGitLabSources === null) {
    _cachedGitLabSources = readSourcesConfigSync().sources.filter((s) => s.type === 'gitlab');
  }
  return _cachedGitLabSources;
}

/** Returns built-in sources followed by user-configured sources. */
export function getAllSources(): SourceEntry[] {
  return [GITHUB_BUILTIN_SOURCE, ...readSourcesConfigSync().sources];
}

/** For tests only – invalidates the in-process cache. */
export function resetSourcesCache(): void {
  _cachedGitLabSources = null;
}
