import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSourcesCache, writeSourcesConfigSync } from '../src/sources-config.ts';

const selectMock = vi.hoisted(() => vi.fn());

vi.mock('@clack/prompts', () => ({
  select: selectMock,
  isCancel: (value: unknown) => typeof value === 'symbol',
  cancel: vi.fn(),
}));

import {
  promptGitLabSourceForInput,
  buildGitLabConnectError,
  isGitLabTlsError,
} from '../src/gitlab.ts';

describe('promptGitLabSourceForInput', () => {
  beforeEach(() => {
    selectMock.mockReset();
    writeSourcesConfigSync({
      version: 1,
      sources: [{ type: 'gitlab', host: 'https://gitlab.company.com' }],
    });
    resetSourcesCache();
  });

  afterEach(() => {
    writeSourcesConfigSync({ version: 1, sources: [] });
    resetSourcesCache();
  });

  it('leaves input unchanged when no GitLab sources are configured', async () => {
    writeSourcesConfigSync({ version: 1, sources: [] });
    resetSourcesCache();

    await expect(promptGitLabSourceForInput('owner/repo', { interactive: true })).resolves.toBe(
      'owner/repo'
    );
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('leaves hostname-qualified GitLab paths unchanged', async () => {
    await expect(
      promptGitLabSourceForInput('gitlab.company.com/owner/repo', { interactive: true })
    ).resolves.toBe('gitlab.company.com/owner/repo');
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('defaults owner/repo to GitHub without prompting when non-interactive', async () => {
    await expect(promptGitLabSourceForInput('owner/repo', { interactive: false })).resolves.toBe(
      'github:owner/repo'
    );
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('expands gl: to the first GitLab host without prompting when non-interactive', async () => {
    await expect(promptGitLabSourceForInput('gl:owner/repo', { interactive: false })).resolves.toBe(
      'https://gitlab.company.com/owner/repo'
    );
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('does not prompt for gl: when only one GitLab source is configured', async () => {
    await expect(promptGitLabSourceForInput('gl:owner/repo', { interactive: true })).resolves.toBe(
      'https://gitlab.company.com/owner/repo'
    );
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('rewrites a GitHub picker choice to an explicit github: prefix', async () => {
    selectMock.mockResolvedValue('https://github.com');

    await expect(promptGitLabSourceForInput('owner/repo', { interactive: true })).resolves.toBe(
      'github:owner/repo'
    );
    expect(selectMock).toHaveBeenCalled();
  });

  it('rewrites a GitLab picker choice to host/owner/repo', async () => {
    selectMock.mockResolvedValue('https://gitlab.company.com');

    await expect(promptGitLabSourceForInput('owner/repo', { interactive: true })).resolves.toBe(
      'gitlab.company.com/owner/repo'
    );
  });
});

describe('GitLab TLS errors', () => {
  it('detects LibreSSL syscall failures', () => {
    expect(
      isGitLabTlsError(
        "fatal: unable to access 'https://gitlab.example.com/owner/repo.git/': LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to gitlab.example.com:443"
      )
    ).toBe(true);
  });

  it('suggests an SSH install URL', () => {
    const message = buildGitLabConnectError(
      'https://gitlab.hchosting.nl/thomas.huisman/skills.git'
    );
    expect(message).toContain('gitlab.hchosting.nl');
    expect(message).toContain('skills add git@gitlab.hchosting.nl:thomas.huisman/skills.git');
  });
});
