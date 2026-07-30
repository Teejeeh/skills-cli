import * as p from '@clack/prompts';
import pc from 'picocolors';
import { selectAgentsInteractive } from './add.ts';
import { agents } from './agents.ts';
import { getLastSelectedAgents } from './skill-lock.ts';
import type { AgentType } from './types.ts';

const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

export async function runConfig(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'agents') {
    await configAgents(args.slice(1));
  } else {
    p.log.error(`Unknown config subcommand: ${subcommand}`);
    console.log('Available subcommands: agents');
    process.exit(1);
  }
}

async function configAgents(args: string[]): Promise<void> {
  const isGlobal = args.includes('-g') || args.includes('--global');
  const showList = args.includes('--list') || args.includes('-l');

  if (showList) {
    const current = await getLastSelectedAgents();
    if (!current || current.length === 0) {
      p.log.info('No default agents configured.');
      console.log(pc.dim('Run: skills config agents  to set defaults'));
    } else {
      console.log();
      p.log.step(pc.bold('Default agents'));
      for (const a of current) {
        const config = agents[a as AgentType];
        const label = config?.displayName ?? a;
        console.log(`  ${pc.cyan(label)}`);
      }
      console.log();
    }
    return;
  }

  p.intro(pc.bold('Configure default agents'));

  const selected = await selectAgentsInteractive({ global: isGlobal });

  if (isCancelled(selected)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  const names = (selected as AgentType[]).map((a) => agents[a]?.displayName ?? a);
  p.outro(`Default agents saved: ${pc.cyan(names.join(', '))}`);
}
