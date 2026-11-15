#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SYMBOLS = "₹$€£¥";
const UNIT_WORDS = new Set([
  "g", "gm", "gms", "gr", "grm", "grms", "gram", "grams", "gramme", "grammes",
  "kg", "kgs", "kilogram", "kilograms", "mg", "milligram", "milligrams",
  "oz", "ozt", "ounce", "ounces", "troy", "dwt", "pennyweight", "pennyweights", "grain", "grains",
  "tola", "tolas", "baht", "tael", "taels",
  "rupee", "rupees", "dollar", "dollars", "euro", "euros", "pound", "pounds", "dirham", "dirhams",
  "dinar", "dinars", "riyal", "riyals", "rial", "rials", "yen", "yuan", "franc", "francs", "peso", "pesos", "rand", "ringgit",
]);
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";
const DATES_AND_TIMES = [
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  /\b(?:0?[1-9]|[12]\d|3[01])([/.-])(?:0?[1-9]|[12]\d|3[01])\1(?:\d{4}|\d{2})\b/g,
  new RegExp(`\\b${DAY} ${MONTH},? \\d{4}\\b`, "g"),
  new RegExp(`\\b${MONTH} ${DAY},? \\d{4}\\b`, "g"),
  new RegExp(`\\b${MONTH} \\d{4}\\b`, "g"),
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
];
const GROUP_SEPARATOR = "[ '’\\u00a0\\u2009\\u202f]";
const SPACED_GROUPS = new RegExp(`(?<![\\d.,])\\d{1,3}(?:${GROUP_SEPARATOR}\\d{2,3})*${GROUP_SEPARATOR}\\d{3}(?!\\d)`, "g");
const TOKEN = /(?<!\d|\d[.,])\d+(?:[.,]\d+)*/g;
const LINK = /https?:\/\/\S+/g;
const PROVEN_INPUT_TOOLS = /__(?:calc_melt_value|convert_weight)$/;

function normalise(text) {
  const plain = text.replace(/[*_`]/g, "").replace(/\|/g, " ");
  const undated = DATES_AND_TIMES.reduce((rest, pattern) => rest.replace(pattern, (date) => " ".repeat(date.length)), plain);
  return undated.replace(SPACED_GROUPS, (groups) => groups.replace(new RegExp(GROUP_SEPARATOR, "g"), ""));
}

function trimZeros(plain) {
  const whole = plain.replace(/^0+(?=\d)/, "");
  return whole.includes(".") ? whole.replace(/\.?0+$/, "") : whole;
}

// Each reading is a value the written number can mean. One to three digits, one separator, and
// three digits can be a grouped whole number or a decimal, so 12.400 reads as 12400 or as the
// decimal written with all three digits. A proof of 12.4 proves neither.
function readings(token) {
  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    return [trimZeros(token.replaceAll(group, "").replace(decimal, "."))];
  }
  const separator = lastDot !== -1 ? "." : lastComma !== -1 ? "," : undefined;
  if (!separator) return [trimZeros(token)];
  const parts = token.split(separator);
  if (parts.length === 2 && /^\d{1,3}$/.test(parts[0]) && parts[1].length === 3) {
    return [trimZeros(parts.join("")), `${trimZeros(parts[0])}.${parts[1]}`];
  }
  if (parts.length === 2) return [trimZeros(parts.join("."))];
  const grouping = separator === "," ? /^\d{1,3}(?:,\d{2,3})*,\d{3}$/ : /^\d{1,3}(?:\.\d{3})+$/;
  return grouping.test(token) ? [trimZeros(parts.join(""))] : undefined;
}

function numbers(text) {
  const found = [];
  for (const match of normalise(text).matchAll(TOKEN)) {
    const read = readings(match[0]);
    if (read) found.push({ token: match[0], index: match.index, readings: read, text: match.input });
    else {
      let offset = match.index;
      for (const part of match[0].split(/[.,]/)) {
        found.push({ token: part, index: offset, readings: [trimZeros(part)], text: match.input });
        offset += part.length + 1;
      }
    }
  }
  return found;
}

function addProof(proof, text) {
  for (const { readings: read } of numbers(text)) {
    for (const reading of read) proof.add(reading);
    if (read.length === 2) proof.add(trimZeros(read[1]));
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const pluginText = ["skills", "commands"]
  .flatMap((folder) => readdirSync(join(here, "..", folder), { recursive: true }).filter((file) => file.endsWith(".md")).map((file) => join(here, "..", folder, file)))
  .map((file) => readFileSync(file, "utf8").replace(LINK, " "))
  .join("\n");
const PURITY_NUMBERS = new Set([
  ...[...pluginText.matchAll(/(?<!\d)(\d{1,2})(?=\s?(?:K(?![A-Za-z])|carat|karat))/g)].map((match) => match[1]),
  ...[...pluginText.matchAll(/(?<![\d.,])\d{3}(?![\d]|[.,]\d)/g)].map((match) => match[0]),
]);

const MARK_BEFORE = new RegExp(`(?:[${SYMBOLS}]|(?<![A-Za-z])(?:[A-Z]{3}|Rs\\.?))\\s?$`);
const WORD_AFTER = new RegExp(`^\\s?(?:[A-Za-z]+|[${SYMBOLS}])`);

function hasMark(text, token, index) {
  if (MARK_BEFORE.test(text.slice(Math.max(0, index - 6), index))) return true;
  const after = text.slice(index + token.length).match(WORD_AFTER)?.[0].trim() ?? "";
  return (after.length === 1 && SYMBOLS.includes(after)) || /^[A-Z]{3}$/.test(after) || UNIT_WORDS.has(after.toLowerCase());
}

// Tier two: a number no proof supports passes only as one of these, and never with a mark.
function allowedAs({ token, index, text }) {
  const before = text.slice(0, index);
  const after = text.slice(index + token.length);
  if (/^\s?%/.test(after)) return "percentage";
  if (/^\d{1,3}$/.test(token) && /^\s?(?:to|-|–)\s?\d+(?:[.,]\d+)?\s?%/.test(after)) return "percentage";
  if (/^\d{1,2}$/.test(token) && /(?:^|\n)[ \t>#-]*$/.test(before) && /^[.)]\s/.test(after)) return "list marker";
  if (/^\d{1,2}$/.test(token) && /\bstep $/i.test(before)) return "step number";
  if (hasMark(text, token, index)) return undefined;
  if (PURITY_NUMBERS.has(token)) return "purity mark or karat";
  return undefined;
}

function textOf(content) {
  if (typeof content === "string") return content;
  return content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

function errorFix(text) {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.fix === "string" ? parsed.fix : "";
  } catch {
    return "";
  }
}

function excerpt({ token, index, text }) {
  const context = text.slice(Math.max(0, index - 12), index + token.length + 12).replace(/\s+/g, " ").trim();
  return `${token} in "${context}"`;
}

function check(events) {
  const proof = new Set();
  const inputProof = new Set();
  const lines = [];
  let blocks = 0;
  let inputs = 0;
  let missing = 0;
  const report = (found, label) => {
    if (!found) missing += 1;
    lines.push(`${found ? "found  " : "MISSING"} ${label}`);
  };
  for (const event of events) {
    if (event.type === "user" && !event.isSynthetic && !event.isMeta) {
      for (const block of [event.message.content].flat()) {
        if (typeof block === "string" || block.type === "text") {
          const text = typeof block === "string" ? block : block.text;
          addProof(proof, text);
          addProof(inputProof, text);
        } else if (block.type === "tool_result") {
          const text = textOf(block.content);
          addProof(proof, block.is_error ? errorFix(text) : text);
          if (!block.is_error) addProof(inputProof, text);
        }
      }
    } else if (event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type === "tool_use" && PROVEN_INPUT_TOOLS.test(block.name)) {
          inputs += 1;
          for (const [field, value] of Object.entries(block.input ?? {})) {
            if (typeof value !== "number" || value === 0) continue;
            report(inputProof.has(trimZeros(String(value))), `input ${block.name.split("__").pop()}.${field}: ${value}`);
          }
        }
        if (block.type !== "text") continue;
        blocks += 1;
        for (const [digits] of block.text.matchAll(/[^\P{Nd}0-9]+/gu)) report(false, `text ${blocks}: ${digits}, digits the checker cannot read`);
        for (const number of numbers(block.text)) {
          if (number.readings.some((reading) => proof.has(reading))) {
            report(true, `text ${blocks}: ${excerpt(number)}`);
            continue;
          }
          const kind = allowedAs(number);
          if (kind) lines.push(`allowed text ${blocks}: ${number.token} (${kind})`);
          else report(false, `text ${blocks}: ${excerpt(number)}`);
        }
      }
    }
  }
  return { blocks, inputs, lines, missing };
}

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: node plugin/test/check-numbers.mjs <transcript.jsonl>");
  process.exit(2);
}

const events = readFileSync(path, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));
const { blocks, inputs, lines, missing } = check(events);
if (blocks === 0) {
  console.log(`INCONCLUSIVE ${path}: the transcript has no assistant text`);
  process.exit(2);
}
for (const line of lines) console.log(line);
console.log(`${missing === 0 ? "PASS" : "FAIL"} ${path}: ${lines.length} numbers in ${blocks} text blocks and ${inputs} tool calls, ${missing} missing from every earlier tool result and person message`);
process.exit(missing === 0 ? 0 : 1);
