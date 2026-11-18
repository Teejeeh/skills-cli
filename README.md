# skills

The CLI for the open agent skills ecosystem.

Agent skills are reusable instructions that teach coding agents how to perform tasks,
from reviewing code to working with a library. Discover skills at [skills.kwal-it.nl](https://skills.kwal-it.nl).

<!-- agent-list:start -->
Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [75 more](docs/agents.md).
<!-- agent-list:end -->

[![skills.kwal-it.nl](https://skills.kwal-it.nl/b/Teejeeh/skills-cli)](https://skills.kwal-it.nl/Teejeeh/skills-cli)

## Install a Skill

Requires Node.js 22.20 or later. Run this from your project:

```bash
npx skills add vercel-labs/agent-skills
```

Choose the skills and coding agents to install to. Skills are installed to the current
project by default; add `-g` to make them available across projects.

```bash
# Choose one skill and agent
npx skills add vercel-labs/agent-skills --skill web-design-guidelines -a claude-code

# Browse available skills
npx skills find
```

See the [installation reference](docs/commands.md#skills-add) for source formats,
private repositories, and all options.

## Other Commands

| Command                           | Description                      |
| --------------------------------- | -------------------------------- |
| `npx skills find [query]`         | Search for skills                |
| `npx skills list`                 | List installed skills            |
| `npx skills use <source>@<skill>` | Use one skill without installing |
| `npx skills check`                | Check for available updates      |
| `npx skills update [skills...]`   | Update installed skills          |
| `npx skills remove [skills...]`   | Remove installed skills          |
| `npx skills init [name]`          | Create a skill template          |
| `npx skills source add <host>`    | Add a self-hosted GitLab source  |
| `npx skills config agents`        | Set default agents for installs  |

Read the [CLI reference](docs/commands.md) or run `npx skills --help` for examples and options. Experimental commands are listed [below](#experimental-features).

## Self-Hosted GitLab Sources

This fork adds self-hosted GitLab instances as skill sources. GitHub.com is always available as a built-in source.

```bash
# Add, list, and remove sources
npx skills source add gitlab.company.com
npx skills source list
npx skills source remove gitlab.company.com
```

Once a source is added, install skills from it with any of these formats:

```bash
# gl: shorthand uses a configured GitLab source
npx skills add gl:group/repo

# Host in the path (no prompt)
npx skills add gitlab.company.com/group/repo

# Full URL, including subgroups and tree paths
npx skills add https://gitlab.company.com/group/subgroup/repo
npx skills add https://gitlab.company.com/group/repo/-/tree/main/skills/my-skill

# Private repositories
GITLAB_TOKEN=glpat-xxxx npx skills add gl:group/repo
```

If any GitLab source is configured, ambiguous shorthands (`owner/repo` and `gl:owner/repo`) prompt you to pick a host, including GitHub.com. `-y`, agents, and non-TTY sessions skip the prompt: `owner/repo` uses GitHub.com, and `gl:owner/repo` uses the first configured GitLab host. Use a full URL or `host/owner/repo` to pin a host.

Skills are fetched through the GitLab REST API when possible, and the CLI falls back to `git clone` otherwise.

| Variable          | Description                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `GITLAB_TOKEN`    | Personal access token for private GitLab repos (`read_repository` scope)                                      |
| `GL_TOKEN`        | Fallback for `GITLAB_TOKEN`                                                                                   |
| `SKILLS_SITE_URL` | Skills directory origin (default `https://skills.kwal-it.nl`). Use `http://localhost:3000` for local testing. |

## Use a Skill Without Installing

Generate a prompt for a skill, or launch a supported coding agent with it:

```bash
npx skills use vercel-labs/agent-skills@web-design-guidelines --agent claude-code
```

Omit `--agent` to print the prompt instead. See [`skills use`](docs/commands.md#skills-use).

## Experimental Features

<details>
<summary>Commands prefixed with <code>experimental_</code> are previews. Their names, options, and behavior may change or be removed in any release without notice.</summary>

| Command                           | Description                                               |
| --------------------------------- | --------------------------------------------------------- |
| `npx skills experimental_sync`    | Sync skills shipped by npm dependencies into your project |
| `npx skills experimental_install` | Restore project skills recorded in `skills-lock.json`     |

Some npm packages bundle instructions for your agent alongside their code. Sync links them into your project so they update with the dependency, and also installs skill packs declared in `package.json`:

```bash
npm install -D @teejeeh/skills agent-browser
npx skills experimental_sync -y
```

See the [experimental commands reference](docs/commands.md#experimental-commands) for options, the `skills` field, and the [RFC](https://github.com/vercel-labs/skills/issues/2323) behind it.

</details>

## Lock File Content Hash

`skills-lock.json` (version 2) records a `computedHash` for each project skill. The hash covers the files the CLI installs into `.agents/skills/<name>`, so `list`, `check`, and `install --frozen-lockfile` can compare it with what is on disk. Tools that check skills themselves can compute the same value:

1. Collect every file in the skill folder. Leave out `metadata.json` files and the `.git`, `__pycache__`, and `__pypackages__` folders, because the installer does not copy them. A symlink counts as the file or folder it points to. Leave out a symlink that is broken, loops, or points outside the skill folder.
2. Give each file a path relative to the skill folder, with `/` as the separator.
3. For a text file (a file that contains no NUL byte), replace each CRLF with LF. Do not change binary files.
4. Sort the files by the UTF-8 bytes of their paths. Do not use a locale-aware sort.
5. For each file in that order, feed `path`, a NUL byte, the content length in bytes as decimal ASCII, a NUL byte, and the content into one SHA-256. The content length is counted after step 3.
6. The hash is the lowercase hex digest.

Test vectors:

| Files                                        | `computedHash`                                                     |
| -------------------------------------------- | ------------------------------------------------------------------ |
| none                                         | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `SKILL.md` = `# hi\n`                         | `93c36952d8843b33e68ae970ebabcc03e1687c9bb0dd1ecaf357060318952f55` |
| `SKILL.md` = `a\n`, `docs/b.md` = `b\n`        | `b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24` |

The last vector equals `printf 'SKILL.md\0002\000a\ndocs/b.md\0002\000b\n' | sha256sum`.

For a Git source, the entry also records the `commit` the skill came from. `skills install` (with or without `--frozen-lockfile`) fetches that commit, not the latest commit on `ref`, so a restore still matches `computedHash` after the source repository changes. `skills update` moves `commit` forward, and it adds a `commit` to an older entry that has none. The server must allow fetching a commit by its SHA. GitHub and GitLab allow this.

A skill installed with `--rename` is hashed as it is installed: its `SKILL.md` has the new `name` in the frontmatter, so the hash differs from the upstream folder's hash.

A version 1 lock is upgraded when it is read, without network access. An installed skill whose files still match its version 1 hash gets a new hash computed from those files. Any other entry gets an empty hash, because there is nothing trusted to check it against. `skills install` fetches those skills again and records new hashes, and `--frozen-lockfile` fails until that is done.

## Supported Agents

The CLI detects installed agents and lets you choose where skills are installed.
See [all supported agents, installation paths, and compatibility](docs/agents.md).

## Creating Skills

```bash
npx skills init my-skill
```

Edit the generated `SKILL.md` with instructions for your agent.
See [creating and sharing skills](docs/creating-skills.md) for the format and discovery rules.

## Documentation

- [CLI reference](docs/commands.md): installation, command examples, and experimental features
- [Supported agents](docs/agents.md): agent names, skill directories, and compatibility
- [Creating skills](docs/creating-skills.md): frontmatter, repository layouts, and plugins
- [Troubleshooting and configuration](docs/troubleshooting.md): common problems, environment variables, and telemetry
- [Programmatic API](docs/api.md): install and manage skills from your own tools with `import { installSkills } from '@teejeeh/skills'`

## Telemetry

The CLI collects anonymous usage data. Set `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`
to disable telemetry and security-audit requests.
See [what is collected](docs/troubleshooting.md#telemetry).

## Related Links

- [Skills Directory](https://skills.kwal-it.nl)
- [Agent Skills Specification](https://agentskills.io)
- [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills)

## License

This project is licensed under the [MIT License](LICENSE).
