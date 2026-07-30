import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
    getAllSources,
    normalizeHost,
    readSourcesConfigSync,
    resetSourcesCache,
    writeSourcesConfigSync,
    type SourceEntry,
    type SourceType,
} from './sources-config.ts';

const SUPPORTED_TYPES: SourceType[] = ['gitlab'];

export async function runSourceCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'add':
      await sourceAdd(args.slice(1));
      break;
    case 'list':
    case 'ls':
      sourceList();
      break;
    case 'remove':
    case 'rm':
      sourceRemove(args.slice(1));
      break;
    default:
      p.log.error(`Unknown source subcommand: ${subcommand ?? '(none)'}`);
      console.log(
        `\nUsage: skills source <command>\n\n` +
          `  add <host> [--type gitlab]   Add a custom skill source\n` +
          `  list                         List configured sources\n` +
          `  remove <host>                Remove a configured source\n\n` +
          `Examples:\n` +
          `  skills source add gitlab.kwal-it.nl\n` +
          `  skills source add gitlab.company.com --type gitlab\n` +
          `  skills source list\n` +
          `  skills source remove gitlab.kwal-it.nl\n`
      );
      process.exit(1);
  }
}

/** Probes <host>/api/v4/version to check if it's a GitLab instance. */
async function detectSourceType(normalizedHost: string): Promise<SourceType | null> {
  try {
    const res = await fetch(`${normalizedHost}/api/v4/version`, {
      signal: AbortSignal.timeout(5_000),
      headers: { 'User-Agent': 'skills-cli' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    if (typeof body.version === 'string') return 'gitlab';
  } catch {
    // unreachable or not GitLab
  }
  return null;
}

async function sourceAdd(args: string[]): Promise<void> {
  const host = args.find((a) => !a.startsWith('-'));
  if (!host) {
    p.log.error('Usage: skills source add <host> [--type gitlab]');
    process.exit(1);
  }

  const typeIndex = args.indexOf('--type');
  const normalized = normalizeHost(host);

  let type: SourceType;
  if (typeIndex >= 0) {
    const typeArg = args[typeIndex + 1];
    if (!SUPPORTED_TYPES.includes(typeArg as SourceType)) {
      p.log.error(
        `Unsupported source type: ${pc.cyan(typeArg ?? '')}. Supported: ${SUPPORTED_TYPES.join(', ')}`
      );
      process.exit(1);
    }
    type = typeArg as SourceType;
  } else {
    const spinner = p.spinner();
    spinner.start(`Detecting source type for ${pc.cyan(normalized)}...`);
    const detected = await detectSourceType(normalized);
    if (detected) {
      spinner.stop(`Detected: ${pc.green(detected)}`);
      type = detected;
    } else {
      spinner.stop(pc.dim('Could not auto-detect type, defaulting to gitlab'));
      type = 'gitlab';
    }
  }

  const config = readSourcesConfigSync();

  const existing = config.sources.find((s) => s.host === normalized);
  if (existing) {
    p.log.info(`Source already configured: ${pc.cyan(normalized)} (${existing.type})`);
    return;
  }

  config.sources.push({ type, host: normalized } satisfies SourceEntry);
  writeSourcesConfigSync(config);
  resetSourcesCache();

  const hostname = new URL(normalized).hostname;

  p.log.success(`Source added: ${pc.cyan(normalized)} (${type})`);
  console.log();
  console.log(`${pc.dim('You can now use:')} skills add ${pc.cyan(`${hostname}/owner/repo`)}`);
  if (type === 'gitlab') {
    console.log(
      `${pc.dim('For private repos, also set:')} ${pc.cyan('GITLAB_TOKEN')}=${pc.dim('<personal-access-token>')}`
    );
  }
  console.log();
}

function sourceList(): void {
  const sources = getAllSources();
  console.log();
  p.log.step(pc.bold('Configured sources'));
  for (const source of sources) {
    const tag = source.builtin ? pc.dim('built-in') : pc.dim(source.type);
    console.log(`  ${pc.cyan(source.host)}  ${pc.dim('(')}${tag}${pc.dim(')')}`);
  }
  console.log();
}

function sourceRemove(args: string[]): void {
  const host = args.find((a) => !a.startsWith('-'));
  if (!host) {
    p.log.error('Usage: skills source remove <host>');
    process.exit(1);
  }

  const normalized = normalizeHost(host);
  const config = readSourcesConfigSync();
  const idx = config.sources.findIndex((s) => s.host === normalized);
  if (idx < 0) {
    p.log.error(`Source not found: ${pc.cyan(normalized)}`);
    process.exit(1);
  }

  config.sources.splice(idx, 1);
  writeSourcesConfigSync(config);
  resetSourcesCache();

  p.log.success(`Source removed: ${pc.cyan(normalized)}`);
}
