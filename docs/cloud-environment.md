# Cloud environment

This repository can be developed and verified in a Claude Code cloud session at claude.ai/code. The session builds the server, runs every gate, starts a private Worker, and drives it with the `verify` skill, all on the cloud VM.

Two files in the repository do the work:

| File | Runs | Does |
|---|---|---|
| `.claude/cloud-setup.sh` | once per environment, as root, before Claude Code starts, then cached for about seven days | installs Node from `.node-version` (the image has Node 22) and `lsof` and `ss` |
| `.claude/hooks/session-start.sh` | at the start of every cloud session, from `.claude/settings.json` | puts that Node on `PATH`, runs `npm ci` at the root and in `server/` when a lockfile changed, and copies `server/.dev.vars` from its example |

The hook does nothing outside a cloud session, because it checks `CLAUDE_CODE_REMOTE`.

## Create the environment

Do this once at claude.ai/code. Open the environment selector, then add an environment.

1. **Name:** `jewellery-value`. This environment exists on the owner's account.
2. **Network access:** choose **Limited**, keep **Allow package managers** checked, and put these in **Allowed domains**, one per line:

   ```
   nodejs.org
   api.gold-api.com
   xaus.com
   api.frankfurter.dev
   ```

   `nodejs.org` is for Node 24 in the setup script. The other three are the rate providers that the Worker calls during `verify`. npm and GitHub are already on the default list.
3. **Repositories:** only `srinivasalokeshraju/Jewellery_value`. Hooks do not run in a session with several repositories.
4. **Setup script:** the field below finds the repo's script wherever the clone landed, and skips it on a branch that does not have it yet.

   ```
   #!/bin/bash
   # Runs the repo's own setup script. It installs Node 24, lsof and ss. See docs/cloud-environment.md.
   script="$(find / -maxdepth 5 -path '*/Jewellery_value/.claude/cloud-setup.sh' 2>/dev/null | head -n 1)"
   if [ -n "$script" ]; then bash "$script"; else echo "cloud-setup.sh not found; skipping"; fi
   ```

5. **Environment variables:** none. The Worker's only variable, `VENDOR_KEY`, is a placeholder that the hook copies from `server/.dev.vars.example`. Never put a real secret in this field, because everyone who uses the environment can read it.

## Start a session

Start a session on this repository with the `jewellery-value` environment. The hook prints `session-start: node v24...; root and server deps ready` when it finishes. Then ask Claude to verify, or run the gates and the skill yourself:

```
npm run format:check && npm run lint
(cd server && npm run typecheck && npm test)
node --test plugin-dev/test/*.test.mjs
.claude/skills/verify/scripts/verify.sh up
```

The `verify` skill's [SKILL.md](../.claude/skills/verify/SKILL.md) and its feature map hold the recipes. `verify.sh cards` uses the image's Chrome for Testing through `CHROME_PATH`.

## Limits

- The plugin scenarios in `plugin-dev/test/` run headless `claude` and spend model tokens. Run them only when you ask for them.
- Hooks from `.claude/settings.json` run only in a session with this one repository. A session with several repositories skips them, so run `.claude/hooks/session-start.sh` by hand with `CLAUDE_CODE_REMOTE=true`.
- Deploying the Worker needs Cloudflare credentials and the owner's approval. A cloud session verifies the local Worker only.
