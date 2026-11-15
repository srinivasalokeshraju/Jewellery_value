#!/usr/bin/env node
import { readFileSync } from "node:fs";

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: node plugin/test/show-transcript.mjs <transcript.jsonl>");
  process.exit(2);
}

function show(label, text) {
  console.log(`--- ${label}\n${text}\n`);
}

function resultText(content) {
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? block.text : `[${block.type}]`)).join("\n");
}

for (const line of readFileSync(path, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const event = JSON.parse(line);
  if (event.type === "system" && event.subtype === "init") {
    const plugins = event.plugins.map((plugin) => plugin.name).join(", ");
    const servers = event.mcp_servers.map((server) => `${server.name} (${server.status})`).join(", ");
    show("session", `model ${event.model}\nplugins: ${plugins}\nmcp servers: ${servers}`);
  } else if (event.type === "user") {
    for (const block of [event.message.content].flat()) {
      if (typeof block === "string") show("user", block);
      else if (block.type === "text" && block.text.startsWith("Base directory for this skill")) show("skill loaded", block.text.split("\n")[0]);
      else if (block.type === "text") show("user", block.text);
      else if (block.type === "image") show("user", "[image]");
      else if (block.type === "tool_result") show("tool result", resultText(block.content));
    }
  } else if (event.type === "assistant") {
    for (const block of event.message.content) {
      if (block.type === "text") show("assistant", block.text);
      else if (block.type === "tool_use") show(`tool call ${block.name}`, JSON.stringify(block.input));
    }
  } else if (event.type === "result") {
    show("end of turn", `${event.subtype}, ${event.num_turns} model turns`);
  }
}
