import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import { createHash } from "node:crypto";

// The MCP client behind .claude/skills/verify/scripts/verify.sh. It prints one JSON document to stdout.
//   doctor <mcp url>               list the tools and check each one's title, readOnlyHint, and card
//   call <mcp url> <tool> <json>   call one tool and print what a host receives
//   skills <mcp url> [2026]        list and read every skill as a host does; 2026 pins protocol 2026-07-28

const EXPECTED_TOOLS = ["calc_melt_value", "convert_weight", "get_metal_rate", "list_supported"];

function usage(): never {
  console.error(
    "usage: npx tsx scripts/verify-mcp.ts doctor <mcp url>\n       npx tsx scripts/verify-mcp.ts call <mcp url> <tool> '<json args>'\n       npx tsx scripts/verify-mcp.ts skills <mcp url> [2026]",
  );
  process.exit(2);
}

async function connect(url: string, pin2026 = false): Promise<Client> {
  const client = new Client(
    { name: "melt-value-verify", version: "0" },
    pin2026 ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

/** Lists the skills, then fetches and checks each SKILL.md (size, digest, frontmatter) as a host does before loading it. */
async function skills(url: string, pin2026: boolean): Promise<boolean> {
  const client = await connect(url, pin2026);
  const skillsClient = new SkillsClient(client);
  const problems: string[] = [];
  if (!skillsClient.supported) problems.push("the server does not declare io.modelcontextprotocol/skills");
  const listing = skillsClient.supported ? await skillsClient.list() : { skills: [], invalid: [] };
  if (listing.invalid.length > 0) problems.push(`invalid entries: ${JSON.stringify(listing.invalid)}`);
  const read = [];
  for (const skill of listing.skills) {
    const file = await skillsClient.read(skill);
    if (!file.verified) problems.push(`${skill.uri} was not verified`);
    read.push({
      uri: skill.uri,
      name: skill.frontmatter.name,
      description: skill.frontmatter.description,
      files: Array.isArray(skill.resources) ? skill.resources.length : skill.resources,
      verified: file.verified,
      bytes: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
    });
  }
  let unknownSkillCode: unknown = null;
  if (skillsClient.supported) {
    try {
      await skillsClient.get("skill://no-such-skill/SKILL.md");
      problems.push("an unknown skill was not refused");
    } catch (error) {
      unknownSkillCode = (error as { code?: unknown }).code ?? String(error);
    }
  }
  const protocol = client.getNegotiatedProtocolVersion();
  await client.close();
  console.log(
    JSON.stringify(
      { url, protocol, ttlMs: listing.ttlMs ?? null, cacheScope: listing.cacheScope ?? null, skills: read, unknownSkillCode, problems },
      null,
      2,
    ),
  );
  return problems.length === 0;
}

async function doctor(url: string): Promise<boolean> {
  const client = await connect(url);
  const problems: string[] = [];
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).toSorted();
  if (names.join() !== EXPECTED_TOOLS.join()) problems.push(`tools are ${names.join(", ")}, expected ${EXPECTED_TOOLS.join(", ")}`);
  const listed = [];
  for (const tool of tools) {
    if (!tool.title) problems.push(`${tool.name} has no title`);
    if (tool.annotations?.readOnlyHint !== true) problems.push(`${tool.name} is not readOnlyHint`);
    const card = getToolUiResourceUri(tool);
    if (card === undefined) problems.push(`${tool.name} has no card`);
    else if ((await client.readResource({ uri: card })).contents.length === 0) problems.push(`${tool.name} card ${card} is empty`);
    listed.push({ name: tool.name, title: tool.title, readOnlyHint: tool.annotations?.readOnlyHint, card });
  }
  const server = client.getServerVersion();
  await client.close();
  console.log(JSON.stringify({ url, server, tools: listed, problems }, null, 2));
  return problems.length === 0;
}

async function call(url: string, tool: string, json: string): Promise<boolean> {
  const args: unknown = JSON.parse(json);
  if (typeof args !== "object" || args === null || Array.isArray(args)) usage();
  const client = await connect(url);
  const result = await client.callTool({ name: tool, arguments: args as Record<string, unknown> });
  await client.close();
  console.log(
    JSON.stringify(
      {
        url,
        tool,
        arguments: args,
        isError: result.isError === true,
        structuredContent: result.structuredContent,
        content: result.content,
      },
      null,
      2,
    ),
  );
  return true;
}

const [command, url, tool, json] = process.argv.slice(2);
if (url === undefined) usage();
let ok: boolean;
if (command === "doctor") ok = await doctor(url);
else if (command === "call" && tool !== undefined && json !== undefined) ok = await call(url, tool, json);
else if (command === "skills" && (tool === undefined || tool === "2026")) ok = await skills(url, tool === "2026");
else usage();
process.exit(ok ? 0 : 1);
