import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetSourcesCache } from './src/sources-config.ts';

// Isolate configured skill sources (e.g. ~/.agents/sources.json) so tests do not
// inherit the developer machine's GitLab/GitHub source list.
const isolatedStateHome = mkdtempSync(join(tmpdir(), 'skills-cli-test-state-'));
process.env.XDG_STATE_HOME = isolatedStateHome;
resetSourcesCache();
