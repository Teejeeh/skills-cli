/**
 * Self-hosted GitLab adapter.
 *
 * Uses sources configured via `skills source add` to authenticate against
 * self-hosted GitLab instances without requiring a .well-known configuration.
 * Falls back to GitHub when no GitLab sources are configured.
 *
 * Usage:
 *   skills source add gitlab.company.com
 *   GITLAB_TOKEN=glpat-xxx skills add gl:owner/repo
 *
 * The fast-path uses the GitLab REST API (/api/v4) with PRIVATE-TOKEN header
 * auth to list and fetch SKILL.md files without a git clone, mirroring the
 * GitHub blob fast-path. Falls back to git clone when the API is unavailable.
 */

import * as p from '@clack/prompts';
import {
  computeSnapshotHash,
  toSkillSlug,
  type BlobInstallResult,
  type BlobSkill,
  type RepoTree,
  type SkillSnapshotFile,
  type TreeEntry,
} from './blob.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { isInternalSkill } from './skills.ts';
import { getConfiguredGitLabSources, GITHUB_BUILTIN_SOURCE } from './sources-config.ts';
import type { ParsedSource } from './types.ts';

/**
 * Returns the first configured GitLab host from sources-config.json,
 * normalized to include a protocol and no trailing slash.
 * Returns null when no GitLab sources are configured.
 */
export function getGitLabHost(): string | null {
  return getConfiguredGitLabSources()[0]?.host ?? null;
}

/**
 * Returns the hostname portion of the first configured GitLab host
 * (e.g. "gitlab.company.com"). Returns null when no sources are configured.
 */
export function getGitLabHostname(): string | null {
  const host = getGitLabHost();
  if (!host) return null;
  try {
    return new URL(host).hostname;
  } catch {
    return null;
  }
}

/**
 * Returns the GitLab access token from the environment.
 * Checks GITLAB_TOKEN first, then GL_TOKEN as a fallback.
 */
export function getGitLabToken(): string | null {
  return process.env.GITLAB_TOKEN ?? process.env.GL_TOKEN ?? null;
}

/**
 * Returns true when the given URL's hostname matches any configured GitLab source.
 */
export function isSelfHostedGitLab(url: string): boolean {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const urlHostname = parsed.hostname;
    return getConfiguredGitLabSources().some((s) => {
      try {
        return new URL(s.host).hostname === urlHostname;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Inject a GitLab access token into an HTTPS clone URL using OAuth2 token auth.
 *
 * Transforms:
 *   https://gitlab.company.com/owner/repo.git
 * Into:
 *   https://oauth2:<token>@gitlab.company.com/owner/repo.git
 *
 * Returns the original URL unchanged if it is not an HTTPS URL or if
 * token injection fails for any reason.
 */
export function injectGitLabToken(url: string, token: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return url;
    // The URL constructor percent-encodes the password automatically
    parsed.username = 'oauth2';
    parsed.password = token;
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Build a human-readable error message when cloning a self-hosted GitLab
 * repository fails due to an authentication error.
 */
export function buildGitLabAuthError(url: string): string {
  const host = getGitLabHost() ?? url;
  const hasToken = !!getGitLabToken();
  if (hasToken) {
    return (
      `Authentication failed for ${url}.\n` +
      `  - Verify that GITLAB_TOKEN has the 'read_repository' scope\n` +
      `  - Check that the token has not expired\n` +
      `  - Ensure the token grants access to the repository at ${host}`
    );
  }
  return (
    `Authentication failed for ${url}.\n` +
    `  - Set GITLAB_TOKEN to a personal access token with 'read_repository' scope\n` +
    `  - Example: GITLAB_TOKEN=glpat-xxxx skills add gl:owner/repo\n` +
    `  - Create a token at ${host}/-/user_settings/personal_access_tokens`
  );
}

export function isGitLabTlsError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('ssl_error_syscall') ||
    lower.includes('ssl certificate') ||
    lower.includes('ssl routines') ||
    lower.includes('unexpected eof') ||
    (lower.includes('tls') && lower.includes('handshake'))
  );
}

/** Human-readable error when HTTPS to a configured GitLab host cannot complete TLS. */
export function buildGitLabConnectError(url: string): string {
  let hostname = 'the GitLab host';
  let sshHint = 'git@<host>:<owner>/<repo>.git';
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    hostname = parsed.hostname;
    const path = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
    if (path.includes('/')) {
      sshHint = `git@${hostname}:${path}.git`;
    }
  } catch {
    // keep defaults
  }
  return (
    `Could not complete an HTTPS connection to ${hostname}.\n` +
    `  Port 443 accepted the TCP connection, but the TLS handshake failed.\n` +
    `  - Check that GitLab is serving HTTPS on this host (certificate / reverse proxy)\n` +
    `  - If SSH works, install with:\n` +
    `      skills add ${sshHint}\n` +
    `  - If you meant GitHub instead:\n` +
    `      skills add github:owner/repo`
  );
}

// ─── Source parser integration ──────────────────────────────────────────────

/**
 * Expand a `gl:owner/repo` shorthand to a full URL for the first configured
 * GitLab source.  Throws when no sources are configured.
 * Returns null when the input does not start with "gl:".
 */
export function expandGlShorthand(input: string): string | null {
  const match = input.match(/^gl:(.+)$/);
  if (!match) return null;
  const host = getGitLabHost();
  if (!host) {
    throw new Error(
      'No GitLab source configured. Run:\n' +
        '  skills source add <host>\n' +
        'Example: skills source add gitlab.company.com'
    );
  }
  return `${host}/${match[1]!}`;
}

/**
 * When GitLab sources are configured, redirect bare owner/repo (and
 * owner/repo@skill) shorthands — as well as protocol-less hostname inputs —
 * to the matching GitLab instance instead of defaulting to GitHub.
 *
 * Returns `{ redirectUrl, skillFilter? }` to re-parse, or null when no
 * GitLab source is configured or the input is not a bare shorthand.
 */
export function redirectOwnerRepoToGitLab(
  input: string
): { redirectUrl: string; skillFilter?: string } | null {
  // Protocol-less hostname: e.g. "gitlab.kwal-it.nl/owner/repo"
  if (!input.includes(':')) {
    for (const source of getConfiguredGitLabSources()) {
      try {
        const sourceHostname = new URL(source.host).hostname;
        if (input.startsWith(`${sourceHostname}/`)) {
          return { redirectUrl: `https://${input}` };
        }
      } catch {
        // skip malformed entry
      }
    }
  }

  const host = getGitLabHost();
  if (!host || input.includes(':') || input.startsWith('.') || input.startsWith('/')) return null;

  // owner/repo@skill-name shorthand
  const atMatch = input.match(/^([^/]+)\/([^/@]+)@(.+)$/);
  if (atMatch) {
    return { redirectUrl: `${host}/${atMatch[1]!}/${atMatch[2]!}`, skillFilter: atMatch[3]! };
  }

  // owner/repo[/subpath] shorthand
  const plain = input.match(/^([^/]+)\/([^/]+)(?:\/(.+?))?\/?$/);
  if (plain) {
    const url = plain[3]
      ? `${host}/${plain[1]!}/${plain[2]!}/-/tree/HEAD/${plain[3]!}`
      : `${host}/${plain[1]!}/${plain[2]!}`;
    return { redirectUrl: url };
  }

  return null;
}

/**
 * Detect a plain HTTPS URL pointing at a configured self-hosted GitLab host
 * and parse it into a `ParsedSource` directly.
 *
 * Must run before `isWellKnownUrl` so those URLs are not misidentified as
 * well-known skill endpoints.
 *
 * Returns null when the hostname doesn't match any configured source, or
 * the URL is not a valid repo path.
 */
export function matchSelfHostedGitLabUrl(input: string, fragmentRef?: string): ParsedSource | null {
  if (!input.startsWith('http://') && !input.startsWith('https://')) return null;
  try {
    const parsed = new URL(input);
    const urlHostname = parsed.hostname;

    const candidateHostnames: string[] = [];
    for (const source of getConfiguredGitLabSources()) {
      try {
        const h = new URL(source.host).hostname;
        if (!candidateHostnames.includes(h)) candidateHostnames.push(h);
      } catch {
        // skip malformed entry
      }
    }

    if (!candidateHostnames.includes(urlHostname)) return null;

    const repoPath = parsed.pathname
      .slice(1)
      .replace(/\.git$/, '')
      .replace(/\/$/, '');
    if (!repoPath.includes('/')) return null;
    return {
      type: 'gitlab',
      url: `${parsed.origin}/${repoPath}.git`,
      ...(fragmentRef ? { ref: fragmentRef } : {}),
    };
  } catch {
    return null;
  }
}

// ─── GitLab REST API fast path ────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000;

export interface GitLabTreeEntry {
  id: string;
  name: string;
  type: 'blob' | 'tree';
  path: string;
  mode: string;
}

/**
 * Extract the URL-encoded project path (e.g. "owner/repo") from a GitLab
 * clone URL. Returns null for malformed or single-segment paths.
 */
export function parseGitLabProjectPath(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const path = parsed.pathname
      .slice(1)
      .replace(/\.git$/, '')
      .replace(/\/$/, '');
    return path.includes('/') ? path : null;
  } catch {
    return null;
  }
}

/**
 * Fetch all repository tree entries via the GitLab REST API.
 * Handles pagination automatically (max 100 items per page).
 * Authenticates with PRIVATE-TOKEN header when a token is supplied.
 */
export async function fetchGitLabRepoTree(
  host: string,
  projectPath: string,
  ref: string,
  token: string | null
): Promise<GitLabTreeEntry[] | null> {
  const encodedPath = encodeURIComponent(projectPath);
  const allEntries: GitLabTreeEntry[] = [];
  let page = 1;

  while (true) {
    const url =
      `${host}/api/v4/projects/${encodedPath}/repository/tree` +
      `?recursive=true&per_page=100&ref=${encodeURIComponent(ref)}&page=${page}`;

    const headers: Record<string, string> = { 'User-Agent': 'skills-cli' };
    if (token) headers['PRIVATE-TOKEN'] = token;

    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;

      const entries = (await res.json()) as GitLabTreeEntry[];
      allEntries.push(...entries);

      const nextPage = res.headers.get('x-next-page');
      if (!nextPage || entries.length === 0) break;
      page = parseInt(nextPage, 10);
    } catch {
      return null;
    }
  }

  return allEntries;
}

/**
 * Resolve `ref` (branch, tag, or HEAD) to a full commit SHA via the GitLab REST API.
 * Returns null when the API is unreachable or the ref is unknown.
 */
export async function fetchGitLabCommitSha(
  host: string,
  projectPath: string,
  ref: string,
  token: string | null
): Promise<string | null> {
  const encodedPath = encodeURIComponent(projectPath);
  const url = `${host}/api/v4/projects/${encodedPath}/repository/commits/${encodeURIComponent(ref)}`;
  const headers: Record<string, string> = { 'User-Agent': 'skills-cli' };
  if (token) headers['PRIVATE-TOKEN'] = token;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'string' && /^[0-9a-f]{40}$/i.test(body.id) ? body.id : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the raw content of a single file via the GitLab REST API.
 *
 * Uses /api/v4/projects/:id/repository/files/:path/raw with PRIVATE-TOKEN
 * header authentication. This works for both public and private repositories,
 * unlike the /-/raw/ web URL which ignores header-based tokens for private
 * repos and requires session cookies or a query-param token instead.
 */
export async function fetchGitLabFileContent(
  host: string,
  projectPath: string,
  filePath: string,
  ref: string,
  token: string | null
): Promise<string | null> {
  const encodedPath = encodeURIComponent(projectPath);
  const encodedFile = encodeURIComponent(filePath);
  const url =
    `${host}/api/v4/projects/${encodedPath}/repository/files/${encodedFile}/raw` +
    `?ref=${encodeURIComponent(ref)}`;

  const headers: Record<string, string> = { 'User-Agent': 'skills-cli' };
  if (token) headers['PRIVATE-TOKEN'] = token;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Attempt to install skills from a self-hosted GitLab repository via the
 * GitLab REST API, avoiding a full git clone.
 *
 * Mirrors the GitHub blob fast-path in blob.ts:
 *  1. Fetch the full repository tree via /api/v4/projects/:id/repository/tree
 *  2. Locate SKILL.md files (filtered by subpath/skillFilter)
 *  3. Fetch each file's content via /api/v4/projects/:id/repository/files/:path/raw
 *  4. Return in-memory BlobSkill instances for installation
 *
 * Returns null when:
 * - GITLAB_HOST is not set or the URL hostname does not match
 * - The API is unreachable or returns an error (caller falls back to git clone)
 * - No skills are found
 */
export async function tryGitLabInstall(
  cloneUrl: string,
  options: {
    subpath?: string;
    skillFilter?: string;
    ref?: string;
    includeInternal?: boolean;
  }
): Promise<BlobInstallResult | null> {
  if (!isSelfHostedGitLab(cloneUrl)) return null;

  const host = getGitLabHost()!;
  const token = getGitLabToken();
  const projectPath = parseGitLabProjectPath(cloneUrl);
  if (!projectPath) return null;

  const requestedRef = options.ref ?? 'HEAD';
  // Pin every read to one commit so the tree and file contents agree, and so the
  // lock entry can record the commit (lock v2 restores fetch exactly that commit).
  const commit = await fetchGitLabCommitSha(host, projectPath, requestedRef, token);
  const ref = commit ?? requestedRef;

  const tree = await fetchGitLabRepoTree(host, projectPath, ref, token);
  if (!tree) return null;

  // Find SKILL.md files, optionally scoped to a subpath
  const skillMdPaths = tree
    .filter((e) => e.type === 'blob' && e.name === 'SKILL.md')
    .map((e) => e.path)
    .filter((p) =>
      options.subpath
        ? p === `${options.subpath}/SKILL.md` || p.startsWith(`${options.subpath}/`)
        : true
    );

  if (skillMdPaths.length === 0) return null;

  const skillResults = await Promise.all(
    skillMdPaths.map(async (skillMdPath): Promise<BlobSkill | null> => {
      const content = await fetchGitLabFileContent(host, projectPath, skillMdPath, ref, token);
      if (!content) return null;

      const { data } = parseFrontmatter(content);
      const rawName = data.name ? String(data.name) : null;
      const rawDesc = data.description ? String(data.description) : null;
      if (!rawName || !rawDesc) return null;
      if (isInternalSkill(data.metadata) && !options.includeInternal) return null;

      const slug = toSkillSlug(rawName);
      if (options.skillFilter && toSkillSlug(options.skillFilter) !== slug) return null;

      // Collect all files that belong to this skill's directory
      const isRootLevel = skillMdPath === 'SKILL.md';
      const skillDir = isRootLevel
        ? ''
        : skillMdPath.slice(0, skillMdPath.length - '/SKILL.md'.length);

      const siblingPaths = isRootLevel
        ? [skillMdPath]
        : tree
            .filter(
              (e) =>
                e.type === 'blob' && (e.path === skillMdPath || e.path.startsWith(skillDir + '/'))
            )
            .map((e) => e.path);

      // Fetch all sibling files in parallel; bail out if any fetch fails
      const fileEntries = await Promise.all(
        siblingPaths.map(async (filePath): Promise<SkillSnapshotFile | null> => {
          const fileContent =
            filePath === skillMdPath
              ? content
              : await fetchGitLabFileContent(host, projectPath, filePath, ref, token);
          if (fileContent === null) return null;
          const relativePath = isRootLevel ? filePath : filePath.slice(skillDir.length + 1);
          return { path: relativePath, contents: fileContent };
        })
      );

      if (fileEntries.some((f) => f === null)) return null;

      return {
        name: slug,
        description: rawDesc,
        path: slug,
        rawContent: content,
        metadata: data.metadata as Record<string, unknown> | undefined,
        files: fileEntries as SkillSnapshotFile[],
        snapshotHash: computeSnapshotHash(fileEntries as SkillSnapshotFile[]),
        repoPath: skillMdPath,
      };
    })
  );

  const skills = skillResults.filter((s): s is BlobSkill => s !== null);
  if (skills.length === 0) return null;

  const repoTree: RepoTree = {
    sha: ref,
    branch: requestedRef,
    tree: tree.map((e): TreeEntry => ({ path: e.path, type: e.type, sha: e.id })),
  };
  return { skills, tree: repoTree, ...(commit && { commit }) };
}

// ─── Source selection prompt ─────────────────────────────────────────────────

export interface PromptGitLabSourceOptions {
  /** When false, skip the picker and use GitHub (or the first GitLab host for `gl:`). */
  interactive?: boolean;
}

function rewriteToSelectedHost(input: string, host: string, isGlShorthand: boolean): string {
  if (host === GITHUB_BUILTIN_SOURCE.host) {
    const rest = isGlShorthand ? input.slice(3) : input;
    return `github:${rest}`;
  }
  if (isGlShorthand) {
    return `${host}/${input.slice(3)}`;
  }
  // bare owner/repo — turn into a protocol-less host/path so the existing
  // redirectOwnerRepoToGitLab path in parseSource handles it correctly
  return `${new URL(host).hostname}/${input}`;
}

/**
 * When GitLab sources are configured and the input is an ambiguous shorthand
 * (`owner/repo` or `gl:owner/repo`), prompt the user to pick a host.
 * Returns the input unchanged in all other cases.
 */
export async function promptGitLabSourceForInput(
  input: string,
  options: PromptGitLabSourceOptions = {}
): Promise<string> {
  const sources = getConfiguredGitLabSources();
  if (sources.length === 0) return input;

  const isGlShorthand = input.startsWith('gl:');
  const isBareShorthand =
    !input.includes(':') &&
    !input.startsWith('.') &&
    !input.startsWith('/') &&
    /^([^/]+)\/([^/]+)/.test(input) &&
    !sources.some((s) => {
      try {
        return input.startsWith(new URL(s.host).hostname + '/');
      } catch {
        return false;
      }
    });

  if (!isGlShorthand && !isBareShorthand) return input;

  const interactive = options.interactive ?? Boolean(process.stdin.isTTY);

  // Non-interactive (`-y`, agents, CI): GitHub is the labeled default for
  // owner/repo. `gl:` means GitLab, so use the first configured GitLab host.
  if (!interactive) {
    if (isGlShorthand) {
      const host = getGitLabHost();
      return host ? `${host}/${input.slice(3)}` : input;
    }
    return `github:${input}`;
  }

  // `gl:owner/repo` with a single GitLab source is unambiguous.
  if (isGlShorthand && sources.length === 1) {
    return `${sources[0]!.host}/${input.slice(3)}`;
  }

  const gitlabOptions = sources.map((s) => ({ value: s.host, label: s.host }));
  const selectOptions = isGlShorthand
    ? gitlabOptions
    : [
        ...gitlabOptions,
        { value: GITHUB_BUILTIN_SOURCE.host, label: `${GITHUB_BUILTIN_SOURCE.host}  (default)` },
      ];

  const selected = await p.select({
    message: 'Which source?',
    options: selectOptions,
    initialValue: isGlShorthand ? sources[0]!.host : GITHUB_BUILTIN_SOURCE.host,
  });

  if (p.isCancel(selected)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  return rewriteToSelectedHost(input, selected as string, isGlShorthand);
}
