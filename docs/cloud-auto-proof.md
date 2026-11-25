# Automatic cloud setup proof

Session started 2026-11-25 17:58 UTC in the `jewellery-value` environment, on `main` at `2ef8fea`
(the merge of PR #38). Nothing was exported, no PATH was changed, and neither
`.claude/cloud-setup.sh` nor `.claude/hooks/session-start.sh` was run by hand.

## Verdict

| Piece | Verdict |
|---|---|
| SessionStart hook `.claude/hooks/session-start.sh` | **ran automatically** |
| Setup script `.claude/cloud-setup.sh` | **did not run** |

**Hook.** Claude Code's own log records the hook at startup with exit code 0 and its line:

```
session-start: node v24.22.3; root and server deps ready; verify with .claude/skills/verify/scripts/verify.sh up
```

Its effects are all present: Node v24 first on PATH, `WRANGLER_SEND_METRICS=false`, both hash
files, and `server/.dev.vars`, all written 17:58:42 to 17:58:49 UTC.

**Setup script, and the exact cause.** The environment's setup-script field did run, but it ran
when the environment's container was built, at 17:42:30 UTC, against a clone of `main` at
`bb14e76`. That commit predates PR #38 (merged 17:56:50 UTC), so `.claude/cloud-setup.sh` did not
exist yet. The wrapper's `find` came up empty and printed its fallback line, kept in
`/root/.claude/environment-manager/setup-script-output`:

```
cloud-setup.sh not found; skipping
```

This session then started in `resume-cached` mode from that container. The environment manager
logged `Fast resume: Environment already configured` / `Skipping initialization script for
faster startup` (event `init_script_skipped`), so the script was not tried again on the new `main`.
No `cloud-setup:` line exists anywhere in the container.

Consequences you can see: `ss` is missing (`iproute2` not installed; `apt` history shows no install
today). `lsof` and `/opt/node24` came from the image, not from the script: `lsof` was installed on
2026-11-20, and `/opt/node24` is a real directory dated 1980, not the symlink the script creates.
Nothing failed because of it, since the image already holds Node 24 and the verify skill used `lsof`.

What would prove the script: a session whose container is built fresh from a `main` that holds
`.claude/cloud-setup.sh`. That needs the cached container to be rebuilt (for example, a change to
the environment's setup script or settings that invalidates the cache). This run cannot tell
whether that happens on its own.

## Step 1: state with nothing exported

| Check | Result | Expected |
|---|---|---|
| `node --version` | `v24.22.3` | v24 |
| `which node` | `/opt/node24/bin/node` | same |
| `echo $PATH` | `/root/.claude/rm-guard/…/refuse:/opt/node24/bin:/nix/…:/opt/node22/bin:…` | `/opt/node24/bin` before `/opt/node22/bin` |
| `echo $WRANGLER_SEND_METRICS` | `false` | `false` |
| `command -v lsof ss` | `/usr/bin/lsof` only; `ss` not found | both |
| `ls /opt` | includes `node24`, `node22`, `env-runner`, `pw-browsers`; no `node-v24.*-linux-x64` | |
| `ls -la /opt/node24` | real directory, `Jan  2  1980` | |
| `node_modules/.session-start.sha256` | present | present |
| `server/node_modules/.session-start.sha256` | present | present |
| `server/.dev.vars` | present | present |

## Step 2: where the lines were searched

Searched `/tmp`, `/var/log`, `/root/.claude`, `/run`, `/opt/env-runner`, and then `/root`,
`/home`, `/var`, `/etc` for `cloud-setup:` and `session-start:`.

- `session-start:` found in `/tmp/claude-code.log` (line 409, `Hook SessionStart:startup … success`)
  and in this session's transcript under `/root/.claude/projects/` (`exitCode 0`, `durationMs 8749`).
- `cloud-setup:` not found anywhere. The setup field's only output is the `cloud-setup.sh not found;
  skipping` line above. The manager logs are `/tmp/environment-manager.out`, `/tmp/env-manager.log`,
  and `/tmp/environment-manager-*.diag.log`.

## Step 3: verify pass, no setup of our own

```
$V up      ok   port 38805 owned by this run's group 457; 4 tools with titles, readOnlyHint, and cards
           up   run 20261125-175941-437 at http://127.0.0.1:38805/mcp
$V doctor  ok   port 38805 owned by this run's group 457; 4 tools with titles, readOnlyHint, and cards
$V call calc_melt_value {gold, 10 g, 22K, IN, INR, non_metal_weight 0} calc-22k-in
           "pure_grams": "9.17"
           9.17 g of pure gold. Melt value 96072.80 INR at spot from gold-api.com, 25 Nov 2026, 17:59 UTC.
$V down    down run 20261125-175941-437
```

After `down`: no `wrangler` or `workerd` process, and port 38805 free.
