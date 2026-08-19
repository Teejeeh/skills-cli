export const AGENTS_DIR = '.agents';
export const SKILLS_SUBDIR = 'skills';
export const UNIVERSAL_SKILLS_DIR = '.agents/skills';

/** Maximum skill-directory depth searched inside a known container by default. */
export const DEFAULT_SKILL_CONTAINER_DEPTH = 3;

export const DEFAULT_SKILLS_SITE_URL = 'https://skills.kwal-it.nl';
export const DEFAULT_TELEMETRY_URL = `${DEFAULT_SKILLS_SITE_URL}/t`;
export const DEFAULT_AUDIT_URL = `${DEFAULT_SKILLS_SITE_URL}/audit`;

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Public skills directory origin.
 * Override with `SKILLS_SITE_URL` (e.g. `http://localhost:3000`) for local testing.
 * Search, download, telemetry (`/t`), and audit (`/audit`) all use this origin.
 */
export function getSkillsSiteUrl(): string {
  const override = process.env.SKILLS_SITE_URL?.trim();
  return trimTrailingSlash(override || DEFAULT_SKILLS_SITE_URL);
}

/** True when `url` is on the configured skills directory host (including port). */
export function isSkillsSiteUrl(url: string): boolean {
  try {
    return new URL(url).host === new URL(getSkillsSiteUrl()).host;
  } catch {
    return false;
  }
}

export function getSkillsTelemetryUrl(): string {
  return `${getSkillsSiteUrl()}/t`;
}

export function getSkillsAuditUrl(): string {
  return `${getSkillsSiteUrl()}/audit`;
}

/** True when telemetry is pointed at a non-default server. */
export function isCustomTelemetryServer(): boolean {
  return Boolean(process.env.SKILLS_SITE_URL?.trim());
}
