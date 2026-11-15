import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const checker = join(here, "check-numbers.mjs");
const work = mkdtempSync(join(tmpdir(), "check-numbers-"));

const CALC_RESULT = JSON.stringify({
  metal: "gold",
  currency: "INR",
  pure_grams: "11.37",
  spot_melt: { value: "133617.88", source: "gold-api.com", as_of: "2026-11-15T05:17:56Z", stale: false },
  buyback_low: "93532.51",
  buyback_high: "126936.98",
  rates: {
    spot: { source: "gold-api.com", as_of: "2026-11-15T05:17:56Z", kind: "market_closed", age_seconds: 0, usd_per_troy_oz: "3887.600098" },
    currency: { source: "frankfurter.dev", as_of: "2026-11-15", kind: "fresh", pair: "USD/INR", rate: "94.05" },
  },
  warnings: [{ code: "gross_weight_used", message: "No weight was given for stones, so the full weight counts as metal." }],
  inputs: { metal: "gold", weight: 12.4, unit: "g", purity: "22K", country: "IN", currency: "INR" },
});

let nextId = 0;

function say(text) {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}

function person(text) {
  return { type: "user", message: { role: "user", content: [{ type: "text", text }] } };
}

function injected(text) {
  return { type: "user", isSynthetic: true, message: { role: "user", content: [{ type: "text", text }] } };
}

function tool(content, { error = false, name = "mcp__melt-value__calc_melt_value" } = {}) {
  const id = `toolu_${nextId++}`;
  const result = { type: "tool_result", tool_use_id: id, content, ...(error ? { is_error: true } : {}) };
  return [
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] } },
    { type: "user", message: { role: "user", content: [result] } },
  ];
}

const endTurn = { type: "result", subtype: "success" };

function check(...events) {
  const path = join(work, `t${nextId++}.jsonl`);
  writeFileSync(path, events.flat().map((event) => JSON.stringify(event)).join("\n") + "\n");
  const run = spawnSync(process.execPath, [checker, path], { encoding: "utf8" });
  return { code: run.status, out: run.stdout };
}

function afterCalc(reply) {
  return check(tool(CALC_RESULT), say(reply), endTurn);
}

test("passes a reply that copies every figure from the result", () => {
  const reply = "Pure gold content 11.37 g\nMelt value (spot) 133617.88 INR spot at 2026-11-15T05:17:56Z\nLikely offer 93532.51 to 126936.98 INR (typical 70 to 95% of melt)\nRate 1 USD = 94.05 INR. Weight 12.4 g.";
  assert.equal(afterCalc(reply).code, 0);
});

const INVENTED = {
  a1_rupee_sym_sep: "Melt value is ₹1,40,000 today.",
  a2_dollar_sep: "Melt value is $5,000.",
  a3_inr_suffix_sep: "Melt value is 140,000 INR.",
  a4_rs_space: "Melt value is Rs. 1,40,000.",
  a5_rupees_word: "Melt value is 1,40,000 rupees.",
  a6_dollars_word: "Melt value is 5,000 dollars.",
  a7_bare_sep: "Melt value is about 1,40,000 in total.",
  a8_lakh: "Melt value is about 1.4 lakh.",
  a9_euro_comma_decimal: "Melt value is 5.000,50 €.",
  a10_usd_prefix_sym: "Melt value is US$5,000.",
  a11_sym_after: "Melt value is 140000₹.",
  a12_rupee_whole: "Melt value is ₹140000.",
  b1_grams: "It weighs 13 g.",
  b2_grams_word: "It weighs 13 grams.",
  b3_gm: "It weighs 13gm.",
  b4_gms: "It weighs 13 gms.",
  b5_decimal_g: "It weighs 13.5 g.",
  b6_tola: "That is 1 tola.",
  c1_date_part_g: "It weighs 15 g.",
  c2_date_part_g2: "It weighs 56 g.",
  c3_date_part_money: "Melt value is ₹2026.",
  c4_prefix_of_longer: "Melt value is ₹133617.",
  c5_leading_zero: "It weighs 5 g.",
  euros_word: "Melt value is 5000 euros.",
  pound_word: "Melt value is 1 pound.",
  dirhams_word: "Melt value is 459 dirhams.",
  gr: "It weighs 13 gr.",
  grm: "It weighs 13 grm.",
  tolas: "That is 2 tolas.",
  ounces: "That is 2 ounces.",
  ozt: "That is 2 ozt.",
  dwt: "That is 8 dwt.",
};

for (const [name, reply] of Object.entries(INVENTED)) {
  test(`fails an invented figure: ${name}`, () => {
    const { code, out } = afterCalc(reply);
    assert.equal(code, 1, out);
  });
}

test("matches a figure written with grouping, a trailing symbol, or a European format", () => {
  const result = JSON.stringify({ value: "140000", other: "5000.50", weight: "13" });
  for (const reply of ["₹1,40,000", "140000₹", "1,40,000 rupees", "5.000,50 €", "5,000.50 euros", "13gm", "13 gms", "13 grams"]) {
    const { code, out } = check(tool(result), say(`Melt value is ${reply}.`), endTurn);
    assert.equal(code, 0, out);
  }
});

test("fails a figure that only a figure in an error message supports", () => {
  const error = "Error: weight 777.77 g exceeds limit; try 13 g";
  const { code, out } = check(tool(error, { error: true }), tool(CALC_RESULT), say("Melt value is ₹777.77 for 13 g."), endTurn);
  assert.equal(code, 1, out);
});

test("fails a figure that appears only in the message of a JSON error", () => {
  const error = JSON.stringify({ code: "invalid_weight", message: "Weight 777.77 is too high.", fix: "Give the weight as a number above zero." });
  assert.equal(check(tool(error, { error: true }), say("It weighs 777.77 g."), endTurn).code, 1);
});

test("passes a figure that the fix of a JSON error gives", () => {
  const error = JSON.stringify({ code: "invalid_weight", message: "Weight is not a number.", fix: "Give the weight as a number above zero, such as 12.4." });
  assert.equal(check(tool(error, { error: true }), say("Give the weight as a number, such as 12.4 g."), endTurn).code, 0);
});

test("fails a figure in text written before the tool call", () => {
  const { code, out } = check(say("Before I call the server: it should be around ₹99,999.00 for roughly 10 g."), tool(CALC_RESULT), say("Melt value is 133617.88 INR."), endTurn);
  assert.equal(code, 1, out);
});

test("fails a figure that a later tool result gives but the text stated first", () => {
  const { code, out } = check(say("I expect about 133617.88 INR."), tool(CALC_RESULT), say("Melt value is 133617.88 INR."), endTurn);
  assert.equal(code, 1, out);
});

test("fails a figure guessed in a question turn with no tool call", () => {
  const { code, out } = check(say("From the photo it looks like about 10 g. What karat is it?"), endTurn, tool(CALC_RESULT), say("Melt value is 133617.88 INR."), endTurn);
  assert.equal(code, 1, out);
});

test("passes a figure that the person typed", () => {
  const { code, out } = check(person("It is 2 oz, and my friend says it is worth $900."), say("Is the 2 oz in troy or regular ounces? I will not use the $900 figure."), endTurn);
  assert.equal(code, 0, out);
});

test("does not count injected skill or command text as proof", () => {
  const { code, out } = check(injected("Use a scale that reads to 0.1 g."), say("Use a scale that reads to 0.1 g."), endTurn);
  assert.equal(code, 1, out);
});

test("does not count a date or time in a tool result as proof", () => {
  const result = JSON.stringify({ as_of: "2026-11-15T05:17:56Z", day: "2026-11-15" });
  for (const reply of ["It weighs 15 g.", "It weighs 56 g.", "It weighs 17 g.", "Melt value is ₹2026.", "It weighs 11 g."]) {
    assert.equal(check(tool(result), say(reply), endTurn).code, 1, reply);
  }
});

test("treats dates, times, percents, and purity marks in a reply as no figure", () => {
  const reply = "Spot at 2026-11-15T05:17:56Z, at 13:35. Sterling is 92.5% silver. The mark 916.6 is 22K.";
  assert.equal(afterCalc(reply).code, 0);
});

test("is inconclusive when the transcript has no assistant text", () => {
  assert.equal(check(tool(CALC_RESULT), endTurn).code, 2);
});

test("passes the pass fixture and fails the fail fixture", () => {
  const run = (name) => spawnSync(process.execPath, [checker, join(here, "scenarios", name)], { encoding: "utf8" }).status;
  assert.equal(run("fixture-pass.jsonl"), 0);
  assert.equal(run("fixture-fail.jsonl"), 1);
});
