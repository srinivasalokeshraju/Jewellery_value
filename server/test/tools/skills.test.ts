import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSkillsModule, SKILLS_MODULE } from "../../scripts/build-skills";
import { buildServer } from "../../src/server";
import { fakeDeps } from "./fakes";

const SERVER = fileURLToPath(new URL("../../", import.meta.url));
const PLUGIN_SKILLS = fileURLToPath(new URL("../../../plugin/skills/", import.meta.url));
const NAMES = ["hallmark-reference", "value-jewellery"];

async function connect() {
  const server = buildServer({ ...fakeDeps(), logUsage: () => {} });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, skills: new SkillsClient(client) };
}

describe("skills over MCP", () => {
  it("is fresh: rebuilding plugin/skills/ gives the committed module", async () => {
    const committed = await readFile(`${SERVER}${SKILLS_MODULE}`, "utf8");
    expect(
      (await buildSkillsModule()) === committed,
      "The skills module is stale. Run `npm run skills:build` in server/ and commit the result.",
    ).toBe(true);
  });

  it("declares the skills extension", async () => {
    const { skills } = await connect();
    expect(skills.supported).toBe(true);
  });

  it("lists every plugin skill with the plugin's name and description", async () => {
    const { skills } = await connect();
    const listing = await skills.list();
    expect(listing.invalid).toEqual([]);
    expect(listing.skills.map((skill) => skill.frontmatter.name).toSorted()).toEqual(NAMES);
    for (const skill of listing.skills) {
      expect(skill.uri).toBe(`skill://${skill.frontmatter.name}/SKILL.md`);
      const source = await readFile(`${PLUGIN_SKILLS}${skill.frontmatter.name}/SKILL.md`, "utf8");
      expect(source).toContain(`description: ${skill.frontmatter.description}`);
    }
  });

  it("serves each SKILL.md byte for byte, with a digest the client verifies", async () => {
    const { skills } = await connect();
    for (const name of NAMES) {
      const { skill } = await skills.get(`skill://${name}/SKILL.md`);
      const file = await skills.read(skill);
      expect(file.verified, name).toBe(true);
      expect(file.text, name).toBe(await readFile(`${PLUGIN_SKILLS}${name}/SKILL.md`, "utf8"));
    }
  });

  it("refuses a skill it does not serve", async () => {
    const { skills } = await connect();
    await expect(skills.get("skill://no-such-skill/SKILL.md")).rejects.toMatchObject({ code: -32602 });
  });
});
