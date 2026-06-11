# Claude environment bootstrap

Makes the Claude Code tooling this project was built with reproducible in any
fresh environment (new container, new machine, new session).

## What's here

- `gsd-bundle/` — complete GSD (get-shit-done) v1.42.3 full install: framework
  (`get-shit-done/`), 67 `/gsd-*` skills, 33 agents, 12 hooks, plus the
  settings fragment that wires hooks + statusline. Captured file-for-file from
  GSD's own install manifest.
- `install.sh` — copies the bundle into `~/.claude` and merges hook/statusline
  settings (idempotent).
- `merge-settings.py` — helper used by `install.sh`.

## Usage

In a fresh environment, run once:

```bash
bash .claude-bootstrap/install.sh
```

then restart the Claude session so the `/gsd-*` skills and hooks load.
Best wired into the environment's setup script so it happens automatically.

## What does NOT need installing

Project-level skills — `/council`, `/design-system`, `/ui-styling`, `/brand`,
`/design`, `/slides`, `/banner-design`, `/ui-ux-pro-max` — live in
`.claude/skills/` inside this repo and are picked up automatically.

## Updating GSD

Run `/gsd-update` (the bundled manifest tells the updater what's installed),
then re-capture: copy the files listed in `~/.claude/gsd-file-manifest.json`
back into `gsd-bundle/` and commit.
