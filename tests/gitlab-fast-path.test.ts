import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSkillFiles } from '../src/skill-hash.ts';
import { resetSourcesCache, writeSourcesConfigSync } from '../src/sources-config.ts';
import { tryGitLabInstall } from '../src/gitlab.ts';

const HOST = 'https://gitlab.company.com';
const PROJECT = encodeURIComponent('group/repo');
const COMMIT = 'c'.repeat(40);

const SKILL_MD = '---\nname: my-skill\ndescription: A fixture skill\n---\n# My skill\n';
const INTERNAL_MD =
  '---\nname: hidden-skill\ndescription: Internal fixture\nmetadata:\n  internal: true\n---\n# Hidden\n';
const REFERENCE = '# Reference\n';

const tree = [
  { id: 't1', name: 'my-skill', type: 'tree', path: 'skills/my-skill' },
  { id: 'b1', name: 'SKILL.md', type: 'blob', path: 'skills/my-skill/SKILL.md' },
  { id: 'b2', name: 'reference.md', type: 'blob', path: 'skills/my-skill/reference.md' },
  { id: 't2', name: 'hidden-skill', type: 'tree', path: 'skills/hidden-skill' },
  { id: 'b3', name: 'SKILL.md', type: 'blob', path: 'skills/hidden-skill/SKILL.md' },
];

const files: Record<string, string> = {
  'skills/my-skill/SKILL.md': SKILL_MD,
  'skills/my-skill/reference.md': REFERENCE,
  'skills/hidden-skill/SKILL.md': INTERNAL_MD,
};

function mockGitLab(options: { commitOk?: boolean } = {}) {
  const { commitOk = true } = options;
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      const base = `${HOST}/api/v4/projects/${PROJECT}/repository`;
      if (url.startsWith(`${base}/commits/`)) {
        return commitOk
          ? new Response(JSON.stringify({ id: COMMIT }), { status: 200 })
          : new Response('not found', { status: 404 });
      }
      if (url.startsWith(`${base}/tree`)) {
        return new Response(JSON.stringify(tree), { status: 200 });
      }
      if (url.startsWith(`${base}/files/`)) {
        const path = decodeURIComponent(url.slice(`${base}/files/`.length).split('/raw')[0]!);
        const body = files[path];
        return body === undefined
          ? new Response('missing', { status: 404 })
          : new Response(body, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    })
  );
  return requested;
}

describe('tryGitLabInstall', () => {
  beforeEach(() => {
    writeSourcesConfigSync({ version: 1, sources: [{ type: 'gitlab', host: HOST }] });
    resetSourcesCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    writeSourcesConfigSync({ version: 1, sources: [] });
    resetSourcesCache();
  });

  it('pins the tree and file reads to the resolved commit and reports it', async () => {
    const requested = mockGitLab();
    const result = await tryGitLabInstall(`${HOST}/group/repo.git`, {});

    expect(result?.commit).toBe(COMMIT);
    const reads = requested.filter((url) => !url.includes('/repository/commits/'));
    expect(reads.length).toBeGreaterThan(0);
    for (const url of reads) expect(url).toContain(`ref=${COMMIT}`);
  });

  it('records a computedHash of the installed files', async () => {
    mockGitLab();
    const result = await tryGitLabInstall(`${HOST}/group/repo.git`, {});
    const skill = result?.skills.find((s) => s.name === 'my-skill');

    expect(skill?.snapshotHash).toBe(
      hashSkillFiles([
        { path: 'SKILL.md', content: SKILL_MD },
        { path: 'reference.md', content: REFERENCE },
      ])
    );
  });

  it('hides internal skills unless they are requested', async () => {
    mockGitLab();
    const hidden = await tryGitLabInstall(`${HOST}/group/repo.git`, {});
    expect(hidden?.skills.map((s) => s.name)).toEqual(['my-skill']);

    const shown = await tryGitLabInstall(`${HOST}/group/repo.git`, { includeInternal: true });
    expect(shown?.skills.map((s) => s.name).sort()).toEqual(['hidden-skill', 'my-skill']);
  });

  it('falls back to the requested ref without a commit when it cannot be resolved', async () => {
    const requested = mockGitLab({ commitOk: false });
    const result = await tryGitLabInstall(`${HOST}/group/repo.git`, { ref: 'main' });

    expect(result?.commit).toBeUndefined();
    expect(result?.tree.branch).toBe('main');
    expect(
      requested.some((url) => url.includes('/repository/tree') && url.includes('ref=main'))
    ).toBe(true);
  });

  it('ignores hosts that are not configured GitLab sources', async () => {
    mockGitLab();
    await expect(
      tryGitLabInstall('https://gitlab.other.com/group/repo.git', {})
    ).resolves.toBeNull();
  });
});
