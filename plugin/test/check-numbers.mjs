#!/usr/bin/env node
import { readFileSync } from "node:fs";

const CURRENCY = String.raw`(?:[A-Z]{3}|Rs\.?|[₹$€£])`;
const MASS = String.raw`(?:g|grams?|kg|kilograms?|mg|milligrams?|oz|ozt|oz_av|ounces?|troy ounces?|dwt|pennyweights?|grains?|tolas?|baht|taels?)`;
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const FIGURE = new RegExp(
  String.raw`(?:${CURRENCY}\s?(${NUMBER}))|(?:(${NUMBER})\s?(?:${CURRENCY}|${MASS})\b)|(?<![\d.])(\d[\d,]*\.\d+)(?!\s?%)`,
  "g",
);
const NOT_A_FIGURE = [
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /\d[\d,]*(?:\.\d+)?\s?%/g,
];

function canonical(text) {
  const plain = text.replace(/,/g, "");
  if (!plain.includes(".")) return plain.replace(/^0+(?=\d)/, "");
  return plain.replace(/^0+(?=\d)/, "").replace(/\.?0+$/, "");
}

function readTranscript(path) {
  const events = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const toolNumbers = new Set();
  const replies = [];
  let lastText;
  for (const event of events) {
    if (event.type === "user" && Array.isArray(event.message.content)) {
      for (const block of event.message.content) {
        if (block.type !== "tool_result") continue;
        const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        for (const match of text.replace(/\\"/g, '"').matchAll(new RegExp(NUMBER, "g"))) toolNumbers.add(canonical(match[0]));
      }
    } else if (event.type === "assistant") {
      for (const block of event.message.content) if (block.type === "text") lastText = block.text;
    } else if (event.type === "result") {
      if (lastText !== undefined) replies.push(lastText);
      lastText = undefined;
    }
  }
  return { toolNumbers, replies };
}

function figures(reply) {
  let text = reply;
  for (const pattern of NOT_A_FIGURE) text = text.replace(pattern, " ");
  return [...text.matchAll(FIGURE)].map((match) => ({
    figure: match[0].trim(),
    number: canonical(match[1] ?? match[2] ?? match[3]),
  }));
}

const [path] = process.argv.slice(2);
if (!path) {
  console.error("usage: node plugin/test/check-numbers.mjs <transcript.jsonl>");
  process.exit(2);
}

const { toolNumbers, replies } = readTranscript(path);
if (replies.length === 0) {
  console.log(`INCONCLUSIVE ${path}: the transcript has no final reply`);
  process.exit(2);
}

let missing = 0;
let checked = 0;
replies.forEach((reply, index) => {
  for (const { figure, number } of figures(reply)) {
    checked += 1;
    const found = toolNumbers.has(number);
    if (!found) missing += 1;
    console.log(`${found ? "found  " : "MISSING"} reply ${index + 1}: ${figure}`);
  }
});

if (checked > 0 && toolNumbers.size === 0) {
  console.log(`INCONCLUSIVE ${path}: the replies have figures but the transcript has no tool result`);
  process.exit(2);
}
console.log(`${missing === 0 ? "PASS" : "FAIL"} ${path}: ${checked} figures in ${replies.length} replies, ${missing} missing from every tool result`);
process.exit(missing === 0 ? 0 : 1);
