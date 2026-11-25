import { SkillsExtension } from "@modelcontextprotocol/server/ext/skills";
import { SKILL_ENTRIES, SKILL_FILES } from "./skills.generated";

/**
 * Serves the plugin's skills through the MCP Skills extension (SEP-2640). Every user gets the same files, and a
 * deploy changes their digests, so clients may cache them publicly.
 */
export const SKILLS = new SkillsExtension({
  strict: true,
  cacheHint: { ttlMs: 3_600_000, cacheScope: "public" },
  source: {
    list: () => Promise.resolve({ skills: [...SKILL_ENTRIES] }),
    get: (uri) => Promise.resolve(SKILL_ENTRIES.find((skill) => skill.uri === uri)),
    read: (uri) => {
      const text = SKILL_FILES[uri];
      return Promise.resolve(text === undefined ? undefined : { text, mimeType: "text/markdown" });
    },
  },
});
