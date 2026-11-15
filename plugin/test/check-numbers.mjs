#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SYMBOLS = "₹$€£¥";
const words = (list, units) => list.split(" ").map((word) => [word, units]);
// Each mark word maps to the server unit ids it can mean. A currency word means no unit.
const MARK_UNITS = new Map([
  ...words("g gm gms grm grms gram grams gramme grammes", ["g"]),
  ...words("gr", ["g", "grain"]),
  ...words("kg kgs kilo kilos kilogram kilograms", ["kg"]),
  ...words("mg milligram milligrams", ["mg"]),
  ...words("oz ounce ounces", ["ozt", "oz_av"]),
  ...words("ozt troy", ["ozt"]),
  ...words("dwt pennyweight pennyweights", ["dwt"]),
  ...words("grain grains", ["grain"]),
  ...words("tola tolas", ["tola"]),
  ...words("baht", ["baht_jewellery", "baht_bullion"]),
  ...words("tael taels", ["tael_hk", "tael_tw"]),
  ...words(
    "rupee rupees dollar dollars euro euros pound pounds dirham dirhams dinar dinars riyal riyals rial rials " +
      "yen yuan franc francs peso pesos rand ringgit rs dh dhs " +
      "inr usd aed gbp eur sar qar kwd omr bhd jpy cny sgd hkd myr thb aud cad chf nzd zar pkr lkr npr bdt",
    [],
  ),
]);
const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DAY = "\\d{1,2}(?:st|nd|rd|th)?";
const DATES_AND_TIMES = [
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  /\b(?:0?[1-9]|[12]\d|3[01])([/.-])(?:0?[1-9]|[12]\d|3[01])\1(?:\d{4}|\d{2})\b/g,
  new RegExp(`\\b${DAY} ${MONTH},? \\d{4}\\b`, "g"),
  new RegExp(`\\b${MONTH} ${DAY},? \\d{4}\\b`, "g"),
  new RegExp(`\\b${MONTH} \\d{4}\\b`, "g"),
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
];
const GROUP_SEPARATOR = "[ '’\\n]";
const SPACED_GROUPS = new RegExp(`(?<![\\d.,])\\d{1,3}(?:${GROUP_SEPARATOR}\\d{2,3})*${GROUP_SEPARATOR}\\d{3}(?!\\d)`, "g");
const TOKEN = /(?<![\w.,])\.\d+|(?<!\d|\d[.,])\d+(?:[.,]\d+)*/g;
const INVISIBLE = /\p{Cf}/gu;
const HTML = /<!--[\s\S]*?-->|<\/?[A-Za-z][^<>]*>/g;
const OTHER_DIGITS = /[^\P{N}0-9]+/gu;
const LINK = /https?:\/\/\S+/g;
const PROVEN_INPUT_TOOLS = /__(?:calc_melt_value|convert_weight)$/;
const SEARCH_TOOLS = new Set(["WebSearch", "WebFetch"]);
const UNIT_FIELD = { weight: "unit", non_metal_weight: "unit", value: "from_unit" };

function normalise(text) {
  const plain = text.replace(INVISIBLE, "").replace(HTML, "").normalize("NFKC").replace(/[*_`]/g, "").replace(/\|/g, " ");
  const undated = DATES_AND_TIMES.reduce((rest, pattern) => rest.replace(pattern, (date) => " ".repeat(date.length)), plain);
  return undated.replace(SPACED_GROUPS, (groups) => groups.replace(new RegExp(GROUP_SEPARATOR, "g"), ""));
}

function trimZeros(plain) {
  return plain.includes(".") ? plain.replace(/\.?0+$/, "") : plain;
}

// Each reading is a value the written number can mean. In a reply, one to three digits, a dot,
// and three digits can be a grouped whole number or a decimal, so 12.400 reads as 12400 or as the
// decimal written with all three digits, and a proof of 12.4 proves neither. Proof text has one
// reading, the way the tool wrote it, so 94.051 there is a decimal and 1,400 is a whole number.
function readings(token, role) {
  if (token.startsWith(".")) return [trimZeros(`0${token}`)];
  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    return [trimZeros(token.replaceAll(group, "").replace(decimal, "."))];
  }
  const separator = lastDot !== -1 ? "." : lastComma !== -1 ? "," : undefined;
  if (!separator) return [token];
  const parts = token.split(separator);
  if (parts.length === 2 && /^[1-9]\d{0,2}$/.test(parts[0]) && parts[1].length === 3) {
    const decimal = `${parts[0]}.${parts[1]}`;
    if (separator === ",") return [parts.join("")];
    return role === "proof" ? [decimal, trimZeros(decimal)] : [parts.join(""), decimal];
  }
  if (parts.length === 2) return [trimZeros(parts.join("."))];
  const grouping = separator === "," ? /^\d{1,3}(?:,\d{2,3})*,\d{3}$/ : /^\d{1,3}(?:\.\d{3})+$/;
  return grouping.test(token) ? [parts.join("")] : undefined;
}

function numbers(text, role) {
  const found = [];
  for (const match of normalise(text).matchAll(TOKEN)) {
    const read = readings(match[0], role);
    if (read) found.push({ token: match[0], index: match.index, readings: read, text: match.input });
    else {
      let offset = match.index;
      for (const part of match[0].split(/[.,]/)) {
        found.push({ token: part, index: offset, readings: [part], text: match.input });
        offset += part.length + 1;
      }
    }
  }
  return found;
}

const here = dirname(fileURLToPath(import.meta.url));
const pluginText = ["skills", "commands"]
  .flatMap((folder) =>
    readdirSync(join(here, "..", folder), { recursive: true })
      .filter((file) => file.endsWith(".md"))
      .map((file) => join(here, "..", folder, file)),
  )
  .map((file) => readFileSync(file, "utf8").replace(LINK, " "))
  .join("\n");
const PURITY_NUMBERS = new Set([
  ...[...pluginText.matchAll(/(?<!\d)(\d{1,2})(?=\s?(?:K(?![A-Za-z])|carat|karat))/g)].map((match) => match[1]),
  ...[...pluginText.matchAll(/(?<![\d.,])\d{3}(?![\d]|[.,]\d)/g)].map((match) => match[0]),
]);

const SEPARATOR = "[\\s:/()–-]";
const SCALE = "(?<![A-Za-z])(?:k|thousand|lakhs?|lacs?|crores?|million|billion|per)(?![A-Za-z])";
const MARK_AFTER = new RegExp(`^(?:${SEPARATOR}|${SCALE})*([${SYMBOLS}]|[A-Za-z]+)`, "i");
const MARK_BEFORE = new RegExp(`(?:([${SYMBOLS}])|(?<![A-Za-z])([A-Za-z]+)\\.?)${SEPARATOR}*$`);

function unitsOf(mark) {
  if (SYMBOLS.includes(mark) || /^[A-Z]{3}$/.test(mark)) return [];
  return MARK_UNITS.get(mark.toLowerCase());
}

function markAfter({ token, index, text }) {
  const mark = text.slice(index + token.length).match(MARK_AFTER);
  return mark ? unitsOf(mark[1]) : undefined;
}

function currencyBefore({ index, text }) {
  const mark = text.slice(0, index).match(MARK_BEFORE);
  return mark !== null && unitsOf(mark[1] ?? mark[2])?.length === 0;
}

// Tier two: a number no proof supports passes only as one of these, and never with a mark.
function allowedAs(number) {
  if (currencyBefore(number) || markAfter(number)) return undefined;
  const { token, index, text } = number;
  const before = text.slice(0, index);
  const after = text.slice(index + token.length);
  if (/^\s?%/.test(after)) return "percentage";
  if (/^\d{1,3}$/.test(token) && /^\s?(?:to|-|–)\s?\d+(?:[.,]\d+)?\s?%/.test(after)) return "percentage";
  if (/^\d{1,2}$/.test(token) && /(?:^|\n)[ \t>#-]*$/.test(before) && /^[.)]\s/.test(after)) return "list marker";
  if (/^\d{1,2}$/.test(token) && /\bstep $/i.test(before)) return "step number";
  if (PURITY_NUMBERS.has(token)) return "purity mark or karat";
  return undefined;
}

function textOf(content) {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
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
  const context = text
    .slice(Math.max(0, index - 12), index + token.length + 12)
    .replace(/\s+/g, " ")
    .trim();
  return `${token} in "${context}"`;
}

function check(events) {
  const proof = new Set();
  // Each reading maps to the units it was given in. null means any unit.
  const inputProof = new Map();
  const echoes = new Map();
  const lines = [];
  let texts = 0;
  let inputs = 0;
  let missing = 0;
  let pending = [];
  const report = (found, label) => {
    if (!found) missing += 1;
    lines.push(`${found ? "found  " : "MISSING"} ${label}`);
  };
  const prove = (text, { echo = new Set(), forInputs = false, person = false } = {}) => {
    for (const number of numbers(text, "proof")) {
      for (const reading of number.readings) {
        if (echo.has(reading)) continue;
        proof.add(reading);
        if (forInputs) inputProof.set(reading, [...(inputProof.get(reading) ?? []), person ? (markAfter(number) ?? null) : null]);
      }
    }
  };
  const checkText = () => {
    if (pending.length === 0) return;
    const text = pending.join(" ");
    pending = [];
    texts += 1;
    for (const [digits] of text.replace(INVISIBLE, "").matchAll(OTHER_DIGITS))
      report(false, `text ${texts}: ${digits}, digits the checker cannot read`);
    for (const number of numbers(text, "reply")) {
      if (number.readings.some((reading) => proof.has(reading))) {
        report(true, `text ${texts}: ${excerpt(number)}`);
        continue;
      }
      const kind = allowedAs(number);
      if (kind) lines.push(`allowed text ${texts}: ${number.token} (${kind})`);
      else report(false, `text ${texts}: ${excerpt(number)}`);
    }
  };
  const checkInputs = ({ name, input }) => {
    inputs += 1;
    for (const [field, value] of Object.entries(input ?? {})) {
      if (typeof value !== "number" || value === 0) continue;
      const unit = input[UNIT_FIELD[field]];
      const given = inputProof.get(trimZeros(String(value))) ?? [];
      const agrees = given.some((units) => units === null || typeof unit !== "string" || units.includes(unit.toLowerCase()));
      report(agrees, `input ${name.split("__").pop()}.${field}: ${value}${typeof unit === "string" ? ` ${unit}` : ""}`);
    }
  };
  for (const event of events) {
    if (event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type === "text") pending.push(block.text);
        if (block.type !== "tool_use") continue;
        checkText();
        if (SEARCH_TOOLS.has(block.name))
          echoes.set(block.id, new Set(numbers(JSON.stringify(block.input ?? {}), "proof").flatMap((number) => number.readings)));
        if (PROVEN_INPUT_TOOLS.test(block.name)) checkInputs(block);
      }
      continue;
    }
    if (event.type === "user" || event.type === "result") checkText();
    if (event.type !== "user" || event.isSynthetic || event.isMeta) continue;
    for (const block of [event.message.content].flat()) {
      if (typeof block === "string" || block.type === "text") {
        prove(typeof block === "string" ? block : block.text, { forInputs: true, person: true });
      } else if (block.type === "tool_result") {
        const text = textOf(block.content);
        const echo = echoes.get(block.tool_use_id);
        if (block.is_error) prove(errorFix(text), { echo });
        else prove(text, { echo, forInputs: true });
      }
    }
  }
  checkText();
  return { texts, inputs, lines, missing };
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
const { texts, inputs, lines, missing } = check(events);
if (texts === 0) {
  console.log(`INCONCLUSIVE ${path}: the transcript has no assistant text`);
  process.exit(2);
}
for (const line of lines) console.log(line);
console.log(
  `${missing === 0 ? "PASS" : "FAIL"} ${path}: ${lines.length} numbers in ${texts} assistant texts and ${inputs} tool calls, ${missing} missing from every earlier tool result and person message`,
);
process.exit(missing === 0 ? 0 : 1);
