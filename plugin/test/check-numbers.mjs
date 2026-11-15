#!/usr/bin/env node
import { readFileSync } from "node:fs";

const SYMBOLS = "₹$€£¥";
const UNIT_WORDS = new Set([
  "g", "gm", "gms", "gr", "grm", "grms", "gram", "grams", "gramme", "grammes",
  "kg", "kgs", "kilogram", "kilograms", "mg", "milligram", "milligrams",
  "oz", "ozt", "ounce", "ounces", "troy", "dwt", "pennyweight", "pennyweights", "grain", "grains",
  "tola", "tolas", "baht", "tael", "taels",
  "rupee", "rupees", "dollar", "dollars", "euro", "euros", "pound", "pounds", "dirham", "dirhams",
  "dinar", "dinars", "riyal", "riyals", "rial", "rials", "yen", "yuan", "franc", "francs", "peso", "pesos", "rand", "ringgit",
]);
const TOKEN = /(?<!\w|\d[.,])\d+(?:[.,]\d+)*/g;
const DATES_AND_TIMES = [/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?/g, /\b\d{1,2}:\d{2}(?::\d{2})?\b/g];
const NOT_A_FIGURE = [...DATES_AND_TIMES, /\b1\s?[A-Z]{3}\s?=/g, /\d+(?:[.,]\d+)*\s?%/g];
const PURITY_MARKS = new Set(["916.6", "958.4", "999.9"]);

function blank(text, patterns) {
  return patterns.reduce((rest, pattern) => rest.replace(pattern, " "), text);
}

function trimZeros(plain) {
  const whole = plain.replace(/^0+(?=\d)/, "");
  return whole.includes(".") ? whole.replace(/\.?0+$/, "") : whole;
}

// The separator written last is the decimal point when both appear. Commas alone group
// digits when every group after the first has two or three digits and the last has three.
function value(token) {
  const lastDot = token.lastIndexOf(".");
  const lastComma = token.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    return trimZeros(token.replaceAll(group, "").replace(decimal, "."));
  }
  if (lastComma !== -1) {
    if (/^\d{1,3}(?:,\d{2,3})*,\d{3}$/.test(token)) return trimZeros(token.replaceAll(",", ""));
    if (token.indexOf(",") === lastComma) return trimZeros(token.replace(",", "."));
    return undefined;
  }
  if (token.indexOf(".") !== lastDot) return /^\d{1,3}(?:\.\d{3})+$/.test(token) ? trimZeros(token.replaceAll(".", "")) : undefined;
  return trimZeros(token);
}

function addNumbers(proof, text) {
  for (const [token] of blank(text, DATES_AND_TIMES).matchAll(TOKEN)) {
    const parsed = value(token);
    if (parsed !== undefined) proof.add(parsed);
    else for (const part of token.split(",")) proof.add(trimZeros(part));
  }
}

const MARK_BEFORE = new RegExp(`(?:[${SYMBOLS}]|(?<![A-Za-z])(?:[A-Z]{3}|Rs\\.?))\\s?$`);
const WORD_AFTER = new RegExp(`^\\s?(?:[A-Za-z]+|[${SYMBOLS}])`);

function isMarkAfter(word) {
  return (word.length === 1 && SYMBOLS.includes(word)) || /^[A-Z]{3}$/.test(word) || UNIT_WORDS.has(word.toLowerCase());
}

function figure(text, token, start) {
  const before = text.slice(Math.max(0, start - 6), start).match(MARK_BEFORE)?.[0] ?? "";
  const after = text.slice(start + token.length).match(WORD_AFTER)?.[0] ?? "";
  if (isMarkAfter(after.trim())) return `${before}${token}${after}`;
  if (before) return `${before}${token}`;
  if (/[.,]/.test(token) && !PURITY_MARKS.has(value(token))) return token;
  return undefined;
}

function figures(reply) {
  const text = blank(reply, NOT_A_FIGURE);
  return [...text.matchAll(TOKEN)]
    .map(({ 0: token, index }) => ({ figure: figure(text, token, index), number: value(token) ?? token }))
    .filter(({ figure }) => figure !== undefined);
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

function check(events) {
  const proof = new Set();
  const lines = [];
  let blocks = 0;
  let missing = 0;
  for (const event of events) {
    if (event.type === "user" && !event.isSynthetic && !event.isMeta) {
      for (const block of [event.message.content].flat()) {
        if (typeof block === "string") addNumbers(proof, block);
        else if (block.type === "text") addNumbers(proof, block.text);
        else if (block.type === "tool_result") {
          const text = textOf(block.content);
          addNumbers(proof, block.is_error ? errorFix(text) : text);
        }
      }
    } else if (event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type !== "text") continue;
        blocks += 1;
        for (const { figure, number } of figures(block.text)) {
          const found = proof.has(number);
          if (!found) missing += 1;
          lines.push(`${found ? "found  " : "MISSING"} text ${blocks}: ${figure}`);
        }
      }
    }
  }
  return { blocks, lines, missing };
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
const { blocks, lines, missing } = check(events);
if (blocks === 0) {
  console.log(`INCONCLUSIVE ${path}: the transcript has no assistant text`);
  process.exit(2);
}
for (const line of lines) console.log(line);
console.log(`${missing === 0 ? "PASS" : "FAIL"} ${path}: ${lines.length} figures in ${blocks} text blocks, ${missing} missing from every earlier tool result and person message`);
process.exit(missing === 0 ? 0 : 1);
