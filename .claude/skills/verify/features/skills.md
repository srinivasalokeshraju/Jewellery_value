# Skills

A host that supports the MCP Skills extension (`io.modelcontextprotocol/skills`, SEP-2640) lists the server's skills and loads one into the model when a conversation needs it. The Worker serves the plugin's two skills, `value-jewellery` and `hallmark-reference`, so a person who added only the connector, not the plugin, gets the same guidance. The host checks each file's size and sha256 digest before it loads it.

## Sub-features

- `skills-declare` declares the extension in the server capabilities on `/mcp`.
- `skills-list` lists both skills at `skill://<name>/SKILL.md` with the `name` and `description` from the plugin files.
- `skills-read` serves each `SKILL.md` byte for byte, with a digest the client verifies.
- `skills-refuse` refuses a skill it does not serve with JSON-RPC error `-32602`.
- `skills-cache` sends `ttlMs: 3600000` and `cacheScope: "public"` to a client on protocol 2026-07-28. A 2025-11-25 client gets no cache hint, because that protocol has no field for it.

## How to get to it (user POV)

- A host that supports skills over MCP connects to `/mcp`, calls `skills/list`, asks the person to approve a skill, then fetches it with `skills/get` and `resources/read`.
- The skill files are not in `resources/list`. A host finds them only through `skills/list`.

## Driving it with verify.sh

Preconditions:

- `$V doctor` passes for the current run.

- **Default handshake.** Run `$V skills`. The saved `evidence/NN-skills.json` has `protocol` `"2025-11-25"`, two skills named `hallmark-reference` and `value-jewellery`, each with `files` `1` and `verified` `true`, `unknownSkillCode` `-32602`, and `problems` `[]`.
- **2026 handshake.** Run `$V skills 2026`. The same holds with `protocol` `"2026-07-28"`, `ttlMs` `3600000`, and `cacheScope` `"public"`.
- **Same bytes as the plugin.** Compare each skill's `sha256` in the evidence with `shasum -a 256 plugin/skills/*/SKILL.md`. They match.

## Gotchas

- `src/skills.generated.ts` is a committed copy of `plugin/skills/`. A skill edit without `npm run skills:build` in `server/` still serves the old text, and `server/test/tools/skills.test.ts` fails.
- `skills` exits non-zero and prints the evidence when the extension is missing, an entry is invalid, a file fails verification, or an unknown skill is not refused.
- Whether a host loads these skills is up to the host. Prove that in a real client, not with `skills`. See the duplicate-skill gotcha in [Plugin](./plugin.md).
