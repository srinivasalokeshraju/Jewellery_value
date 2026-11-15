#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = "usage: node plugin/test/run-scenario.mjs <scenario.md> --port <n> --out <transcript.jsonl> [--no-plugin] [-- <extra claude args>]";

const TOPICS = [
  ["stones", /\b(stones?|gems?|non-metal|enamel)\b/i],
  ["unit", /\b(troy|regular ounce|avoirdupois|which unit)\b/i],
  ["weight", /\b(weigh|weight|grams?|scale)\b/i],
  ["purity", /\b(purity|karat|carat|stamp|hallmark|marked)\b/i],
  ["metal", /\b(metal|gold or silver|silver or gold)\b/i],
  ["location", /\b(where|country|located|currency|city|live)\b/i],
];

function parseArgs(argv) {
  const split = argv.indexOf("--");
  const own = split === -1 ? argv : argv.slice(0, split);
  const extra = split === -1 ? [] : argv.slice(split + 1);
  const opts = { scenario: undefined, port: undefined, out: undefined, plugin: true, extra };
  for (let i = 0; i < own.length; i++) {
    const arg = own[i];
    if (arg === "--port") opts.port = Number(own[++i]);
    else if (arg === "--out") opts.out = own[++i];
    else if (arg === "--no-plugin") opts.plugin = false;
    else opts.scenario = arg;
  }
  if (!opts.scenario || !Number.isInteger(opts.port) || !opts.out) throw new Error(usage);
  return opts;
}

function parseScenario(path) {
  const scenario = { prompt: undefined, images: [], answers: new Map(), then: [], maxTurns: 12 };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^(prompt|image|then|answer [a-z]+|max-turns):\s*(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "prompt") scenario.prompt = value;
    else if (key === "image") scenario.images.push(resolve(dirname(path), value));
    else if (key === "then") scenario.then.push(value);
    else if (key === "max-turns") scenario.maxTurns = Number(value);
    else scenario.answers.set(key.slice("answer ".length), value);
  }
  if (!scenario.prompt) throw new Error(`${path} has no "prompt:" line`);
  return scenario;
}

function userMessage(text, images) {
  const content = images.map((file) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: readFileSync(file).toString("base64") },
  }));
  content.push({ type: "text", text });
  return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
}

function pickAnswer(question, answers) {
  for (const [topic, pattern] of TOPICS) {
    if (answers.has(topic) && pattern.test(question)) return topic;
  }
  return undefined;
}

function finalText(events) {
  const texts = [];
  for (const event of events) {
    if (event.type !== "assistant") continue;
    for (const block of event.message.content) if (block.type === "text") texts.push(block.text);
  }
  return texts.at(-1) ?? "";
}

const opts = parseArgs(process.argv.slice(2));
const scenario = parseScenario(opts.scenario);
const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localConfig = JSON.parse(readFileSync(join(pluginDir, "test", "local-mcp.json"), "utf8"));
for (const server of Object.values(localConfig.mcpServers)) server.url = server.url.replace(/:\d+\//, `:${opts.port}/`);
const configPath = join(mkdtempSync(join(tmpdir(), "melt-value-mcp-")), "mcp.json");
writeFileSync(configPath, JSON.stringify(localConfig));

const args = [
  "-p",
  "--setting-sources", "local",
  ...(opts.plugin ? ["--plugin-dir", pluginDir] : []),
  "--mcp-config", configPath,
  "--strict-mcp-config",
  "--input-format", "stream-json",
  "--output-format", "stream-json",
  "--verbose",
  "--max-turns", String(scenario.maxTurns),
  "--allowedTools=mcp__melt-value__*,WebSearch,WebFetch",
  ...opts.extra,
];

const child = spawn("claude", args, { stdio: ["pipe", "pipe", "inherit"] });
const transcript = [];
let turn = [];
let buffer = "";
const unused = new Map(scenario.answers);
const log = { turns: 0, questions: 0, questionsBeforeResult: 0, calcCalls: 0, answered: [] };

child.stdin.write(userMessage(scenario.prompt, scenario.images));
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    transcript.push(line);
    const event = JSON.parse(line);
    turn.push(event);
    if (event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type === "tool_use" && block.name.endsWith("__calc_melt_value")) log.calcCalls += 1;
      }
    }
    if (event.type !== "result") continue;
    const reply = finalText(turn);
    turn = [];
    log.turns += 1;
    const questions = (reply.match(/[^.?!\n]*\?/g) ?? []).join(" ");
    const request = questions || reply.trim().split(/\n\s*\n/).at(-1);
    const topic = log.calcCalls === 0 ? pickAnswer(request, unused) : undefined;
    const asks = questions !== "" || topic !== undefined;
    if (asks) log.questions += 1;
    if (asks && log.calcCalls === 0) log.questionsBeforeResult += 1;
    if (topic) {
      log.answered.push(topic);
      child.stdin.write(userMessage(unused.get(topic), []));
      unused.delete(topic);
    } else if (scenario.then.length > 0) {
      child.stdin.write(userMessage(scenario.then.shift(), []));
    } else {
      child.stdin.end();
    }
  }
});

child.on("close", (code) => {
  writeFileSync(opts.out, transcript.join("\n") + "\n");
  console.log(JSON.stringify({ scenario: opts.scenario, out: opts.out, exit: code, ...log }));
  process.exit(code ?? 1);
});
