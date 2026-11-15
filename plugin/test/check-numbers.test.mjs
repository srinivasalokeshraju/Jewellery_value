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

function tool(content, { error = false, name = "mcp__melt-value__calc_melt_value", input = {} } = {}) {
  const id = `toolu_${nextId++}`;
  const result = { type: "tool_result", tool_use_id: id, content, ...(error ? { is_error: true } : {}) };
  return [
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } },
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
  const reply = "Pure gold content **11.37 g**\nMelt value (spot) `133617.88` INR spot at 2026-11-15T05:17:56Z\nLikely offer 93532.51 to 126936.98 INR (typical 70 to 95% of melt)\nRate 94.05 INR per US dollar. Weight 12.4 g.";
  assert.equal(afterCalc(reply).code, 0);
});

test("fails the 1 of a rate written as 1 USD =, a known false failure", () => {
  assert.equal(afterCalc("Rate 1 USD = 94.05 INR.").code, 1);
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
  aed_joined: "Melt value is AED5600.",
  rs_joined: "Melt value is Rs140000.",
  inr_joined: "Melt value is INR140000.",
  dhs_after: "Melt value is 5600 Dhs.",
  dh_before: "Melt value is Dh 5600.",
  dhs_before: "Melt value is Dhs. 5600.",
  rs_after: "Melt value is 140000 Rs.",
  inr_after_lower: "Melt value is 140000 inr.",
  usd_after_lower: "Melt value is 5000 usd.",
  rupees_word_before: "Melt value: Rupees 140000.",
  lakh_whole: "Melt value is about 2 lakh rupees.",
  crore_whole: "Melt value is about 2 crore rupees.",
  k_dollars: "Melt value is about 5k dollars.",
  k_suffix: "About $140k.",
  bucks: "About 1700 bucks.",
  kr: "Melt value 15000 kr.",
  sym_two_spaces: "Melt value is ₹  140000.",
  rupee_sign_alt: "Melt value is ₨140000.",
  peso_sign: "Melt value is ₱5600.",
  baht_sign: "Melt value ฿15000.",
  arabic_dirham: "Melt value is 5600 د.إ.",
  euro_thousands_collides: "Melt value is 12.400 €.",
  euro_thousands_prefix: "Melt value is €12.400.",
  space_group_euro: "Melt value is 140 000 €.",
  space_group_rupees: "Melt value is 1 40 000 rupees.",
  thin_space_group: "Melt value is 140 000 INR.",
  nbsp_group: "Melt value is 140 000 ₹.",
  apostrophe_group: "Melt value is CHF 140'000.",
  carats_mass: "The stone weighs 3 carats.",
  ct_mass: "The stone weighs 3 ct.",
  hyphen_gram: "This is a 13-gram chain.",
  hyphen_g: "This is a 13-g chain.",
  kilos: "That is 3 kilos of silver.",
  ratti: "The stone is 5 ratti.",
  bhori: "It weighs 2 bhori.",
  lbs: "That is 7 lbs.",
  md_bold_number: "Melt value is ₹**140000**.",
  md_bold_then_code: "Melt value is **140000** INR.",
  md_code_number: "Melt value is `140000` INR.",
  md_italic_word: "Melt value is 140000 *rupees*.",
  md_table: "| Item | Value | Currency |\n|---|---|---|\n| Melt value | 140000 | INR |",
  md_bold_mass: "It weighs **13** g.",
  purity_number_as_money: "Melt value is 916 INR.",
  purity_number_as_mass: "It weighs 18 g.",
  long_list_marker: "Melt value:\n140000. That is the total.",
  long_step_number: "Melt value is step 140000.",
  long_range_start: "Melt value is 140000 to 1% of the total.",
  dotted_group_not_date: "Melt value is ₹1.40.000.",
  devanagari_digits: "Melt value is ₹१४००००.",
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

test("does not count a written date or an HTTP date in a tool result as proof", () => {
  const cases = [
    ["Fetched Sat, 15 Nov 2026 05:17:56 GMT", "It weighs 15 g."],
    ["Listing posted 15/11/2026.", "It weighs 15 g."],
    ["Posted Nov 15, 2026.", "Melt value is ₹2026."],
    ["Posted 15 November 2026.", "It weighs 15 g."],
  ];
  for (const [result, reply] of cases) {
    assert.equal(check(tool(result, { name: "WebSearch" }), say(reply), endTurn).code, 1, reply);
  }
});

test("passes a figure copied with markdown or spaced digit groups", () => {
  const result = JSON.stringify({ value: "140000", melt: "133617.88", weight: "12.400" });
  for (const reply of ["**₹140000**", "₹**140000**", "`140000` INR", "140 000 €", "1 40 000 rupees", "CHF 140'000", "133 617.88 INR", "12.400 g", "12.4 g"]) {
    const { code, out } = check(tool(result), say(`Melt value is ${reply}.`), endTurn);
    assert.equal(code, 0, out);
  }
});

test("fails a weight passed to a tool that no person message or tool result gave", () => {
  const photo = person("[photo] What is this 22K chain worth? India.");
  const ounces = person("My 22K chain weighs 1.5 ozt, India.");
  for (const [message, input] of [[photo, { weight: 12.4, unit: "g" }], [ounces, { weight: 46.66, unit: "g" }], [ounces, { value: 46.66 }]]) {
    const name = "value" in input ? "mcp__melt-value__convert_weight" : "mcp__melt-value__calc_melt_value";
    const { code, out } = check(message, tool(CALC_RESULT, { name, input }), say("Melt value is 133617.88 INR."), endTurn);
    assert.equal(code, 1, out);
  }
});

test("passes a tool weight the person typed or a tool returned, and a zero stone weight", () => {
  const typed = check(person("It is 12.4 g of 22K gold."), tool(CALC_RESULT, { input: { weight: 12.4, non_metal_weight: 0 } }), say("Melt value is 133617.88 INR."), endTurn);
  assert.equal(typed.code, 0, typed.out);
  const converted = check(
    person("It weighs 1 tola."),
    tool(JSON.stringify({ value: "11.6638" }), { name: "mcp__melt-value__convert_weight", input: { value: 1 } }),
    tool(CALC_RESULT, { input: { weight: 11.6638 } }),
    say("Melt value is 133617.88 INR."),
    endTurn,
  );
  assert.equal(converted.code, 0, converted.out);
});

test("passes a bare purity mark, a karat, a list marker, a step number, and a percentage range", () => {
  const reply = "1. Look for a stamp such as `916`, 22K, 750, or 18 carat.\n2) Weigh it, as in step 3.\nBuyers pay 70 to 95% of melt.";
  const { code, out } = check(person("What is my ring worth?"), say(reply), endTurn);
  assert.equal(code, 0, out);
});

test("fails a bare number that is no purity mark, no list marker, and no percentage", () => {
  for (const reply of ["Look for a mark such as 21K or 875.", "For example, 4.2.", "It holds 3 stones."]) {
    assert.equal(check(person("What is my ring worth?"), say(reply), endTurn).code, 1, reply);
  }
});

test("treats dates, times, percents, and purity marks in a reply as no figure", () => {
  const reply = "Spot at 2026-11-15T05:17:56Z, at 13:35. Sterling is 92.5% silver. The mark 916 is 22K, and 750 is 18 carat.";
  assert.equal(afterCalc(reply).code, 0);
});

test("is inconclusive when the transcript has no assistant text", () => {
  assert.equal(check(tool(CALC_RESULT), endTurn).code, 2);
});

const ASK = person("What is my ring worth?");

function failsUnproven(reply) {
  const { code, out } = check(ASK, say(reply), endTurn);
  assert.equal(code, 1, `${reply}\n${out}`);
  return out;
}

test("fails a percentage, list marker, or step number that has a currency or mass mark", () => {
  for (const reply of ["Making charges run ₹950 to 15% of the price.", "Melt value: ₹140000%", "Add it in step 40 g increments.", "Weights:\n12) grams of gold"]) {
    failsUnproven(reply);
  }
});

test("fails a purity-set number with a mark across spaces, a hyphen, a colon, a slash, a scale word, or a table cell", () => {
  const replies = [
    "This looks like a 22-gram chain.",
    "Melt value ₹  916.",
    "Melt value INR: 900.",
    "Melt value is 999 rs.",
    "Melt value is rs 916.",
    "It weighs 18/g.",
    "The chain is 18 (g) heavy.",
    "Worth 925k INR.",
    "Worth 916 Dhs.",
    "Worth ₨916.",
    "About 916 per gram.",
    "| Item | Weight | Unit |\n|---|---|---|\n| Chain | 18 | g |",
    "It weighs **18** g.",
  ];
  for (const reply of replies) failsUnproven(reply);
});

test("joins digits that markdown marks split", () => {
  const { code, out } = check(tool(JSON.stringify({ a: "1", b: "40000" })), say("Melt value is ₹1**40000**."), endTurn);
  assert.equal(code, 1, out);
  assert.match(out, /MISSING text 1: 140000/);
});

test("fails superscript, circled, and full-width digits", () => {
  for (const reply of ["Melt value ₹¹⁴⁰⁰⁰⁰.", "Melt value ₹①④⓪⓪⓪⓪.", "Melt value ₹１４００００."]) {
    assert.match(failsUnproven(reply), /digits the checker cannot read/);
  }
});

test("reads a figure that an invisible character splits as one number", () => {
  for (const invisible of ["​", "⁠", "­", "<!---->"]) {
    const { code, out } = afterCalc(`Melt value ₹22${invisible}0000.`);
    assert.equal(code, 1, out);
    assert.match(out, /MISSING text 1: 220000/);
  }
});

test("fails a figure split across a line break or two text blocks", () => {
  const twoBlocks = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Melt value ₹22" }, { type: "text", text: "0000 INR." }] } };
  for (const reply of [say("Melt value ₹22\n0000"), twoBlocks, [say("Melt value ₹22"), say("0000 INR.")]]) {
    const { code, out } = check(person("12.4g 22K gold"), tool(CALC_RESULT), reply, endTurn);
    assert.equal(code, 1, out);
  }
  for (const reply of [[say("Melt value ₹1 40"), say("000.")], say("Melt value ₹1 40\n000.")]) {
    const grouped = check(tool(JSON.stringify({ a: "1", b: "40", c: "000" })), reply, endTurn);
    assert.match(grouped.out, /MISSING text 1: 140000/);
  }
});

test("does not count a number that a web search or fetch got from its own input", () => {
  const search = (query, result) => tool(`Web search results for query: "${query}"\n\n${result}`, { name: "WebSearch", input: { query } });
  const echoed = check(ASK, search("22K gold bangle typical weight 46.66 g", "Links: []"), say("A 46.66 g bangle."), endTurn);
  assert.equal(echoed.code, 1, echoed.out);
  const input = check(ASK, search("22K bangle weight 46.66 g", "Links: []"), tool(CALC_RESULT, { input: { weight: 46.66, unit: "g" } }), say("Melt value is 133617.88 INR."), endTurn);
  assert.equal(input.code, 1, input.out);
  const fetched = check(ASK, tool("Bangle, 46.66 g.", { name: "WebFetch", input: { url: "https://example.com/bangle-46.66-g", prompt: "weight" } }), say("A 46.66 g bangle."), endTurn);
  assert.equal(fetched.code, 1, fetched.out);
  const listed = check(ASK, search("22K gold bangle weight", "The listing says 19.1 g."), tool(CALC_RESULT, { input: { weight: 19.1, unit: "g" } }), say("The listing says 19.1 g."), endTurn);
  assert.equal(listed.code, 0, listed.out);
});

test("reads a decimal with no leading zero as a decimal", () => {
  const unproven = check(ASK, tool(JSON.stringify({ age_seconds: 25 })), say("That is about .25 oz of pure gold."), endTurn);
  assert.equal(unproven.code, 1, unproven.out);
  const proven = check(ASK, tool(JSON.stringify({ pure_ozt: "0.25" })), say("That is about .25 oz of pure gold."), endTurn);
  assert.equal(proven.code, 0, proven.out);
});

test("reads a proof number only the way the tool wrote it", () => {
  const rate = check(ASK, tool(JSON.stringify({ rate: "94.051" })), say("Worth INR 94,051."), endTurn);
  assert.equal(rate.code, 1, rate.out);
  const grouped = check(ASK, tool(JSON.stringify({ fee: "1,400" })), say("Pure content is about 1.4 g."), endTurn);
  assert.equal(grouped.code, 1, grouped.out);
  const copied = check(ASK, tool(JSON.stringify({ rate: "94.051", fee: "1,400" })), say("Rate 94.051 INR, fee 1,400 INR."), endTurn);
  assert.equal(copied.code, 0, copied.out);
});

test("fails a tool weight whose unit differs from the unit the person gave", () => {
  const sent = (message, input) => check(person(message), tool(CALC_RESULT, { input }), say("Melt value is 133617.88 INR."), endTurn);
  assert.equal(sent("It is 22K gold, 12 dwt, India.", { weight: 12, unit: "g" }).code, 1);
  assert.equal(sent("It is 22K gold, 0.5 oz, India.", { weight: 0.5, unit: "g" }).code, 1);
  assert.equal(sent("It is 22K gold, 12 dwt, India.", { weight: 12, unit: "dwt" }).code, 0);
  assert.equal(sent("It is 22K gold, 2 oz, India.", { weight: 2, unit: "ozt" }).code, 0);
  assert.equal(sent("It is 22K gold, 12.4 grams.", { weight: 12.4, unit: "g" }).code, 0);
  const converted = check(person("It weighs 2 dwt."), tool(JSON.stringify({ value: "3.11" }), { name: "mcp__melt-value__convert_weight", input: { value: 2, from_unit: "g", to_unit: "g" } }), say("That is 3.11 g."), endTurn);
  assert.equal(converted.code, 1, converted.out);
});

test("does not count the fix of an error as proof for a tool input", () => {
  const error = JSON.stringify({ code: "invalid_weight", message: "Weight is not a number.", fix: "Give the weight as a number above zero, such as 12.4." });
  const { code, out } = check(ASK, tool(error, { error: true }), tool(CALC_RESULT, { input: { weight: 12.4, unit: "g" } }), say("Melt value is 133617.88 INR."), endTurn);
  assert.equal(code, 1, out);
});

test("passes the pass fixture and fails the fail fixture", () => {
  const run = (name) => spawnSync(process.execPath, [checker, join(here, "scenarios", name)], { encoding: "utf8" }).status;
  assert.equal(run("fixture-pass.jsonl"), 0);
  assert.equal(run("fixture-fail.jsonl"), 1);
});
