import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SKILLS_SITE_URL,
  getSkillsAuditUrl,
  getSkillsSiteUrl,
  getSkillsTelemetryUrl,
  isCustomTelemetryServer,
  isSkillsSiteUrl,
} from './constants.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('skills site URL', () => {
  it('defaults to the public directory', () => {
    expect(getSkillsSiteUrl()).toBe(DEFAULT_SKILLS_SITE_URL);
    expect(getSkillsTelemetryUrl()).toBe(`${DEFAULT_SKILLS_SITE_URL}/t`);
    expect(getSkillsAuditUrl()).toBe(`${DEFAULT_SKILLS_SITE_URL}/audit`);
    expect(isCustomTelemetryServer()).toBe(false);
  });

  it('uses SKILLS_SITE_URL for search, download, telemetry, and audit', () => {
    vi.stubEnv('SKILLS_SITE_URL', 'http://localhost:3000/');
    expect(getSkillsSiteUrl()).toBe('http://localhost:3000');
    expect(getSkillsTelemetryUrl()).toBe('http://localhost:3000/t');
    expect(getSkillsAuditUrl()).toBe('http://localhost:3000/audit');
    expect(isSkillsSiteUrl('http://localhost:3000/p/testpack')).toBe(true);
    expect(isSkillsSiteUrl('https://skills.kwal-it.nl/p/testpack')).toBe(false);
    expect(isCustomTelemetryServer()).toBe(true);
  });
});
