import { describe, expect, it } from "vitest";
import { parsePurity, type Metal } from "../../src/domain/purity";

function accepted(text: string, metal: Metal) {
  const result = parsePurity(text, metal);
  if (!result.ok) throw new Error(`${text} on ${metal} was rejected: ${result.error.message}`);
  return { fraction: result.value.fraction.toFixed(), mark: result.value.mark, basis: result.value.basis };
}

function rejected(text: string, metal: Metal) {
  const result = parsePurity(text, metal);
  if (result.ok) throw new Error(`${text} on ${metal} was accepted`);
  return result.error;
}

describe("parsePurity accepts", () => {
  it.each(["22K", "22k", "22kt", "22 karat", " 22 KT "])("karat form %j as 22/24", (text) => {
    expect(accepted(text, "gold")).toEqual({ fraction: "0.9166666666666666666666666666666666666667", mark: "22K", basis: "karat" });
  });

  it.each([
    ["24K", "1"],
    ["18K", "0.75"],
    ["1K", "0.04166666666666666666666666666666666666667"],
  ])("karat %s", (text, fraction) => {
    expect(accepted(text, "gold").fraction).toBe(fraction);
  });

  it.each([
    ["916", "gold", "0.916"],
    ["750", "gold", "0.75"],
    ["375", "gold", "0.375"],
    ["925", "silver", "0.925"],
    ["999.9", "gold", "0.9999"],
    ["800", "silver", "0.8"],
  ] as const)("fineness %s on %s", (text, metal, fraction) => {
    expect(accepted(text, metal)).toEqual({ fraction, mark: text, basis: "fineness" });
  });

  it.each([
    ["91.6%", "gold", "0.916"],
    ["100%", "silver", "1"],
    ["92.5 %", "silver", "0.925"],
  ] as const)("percent %s on %s", (text, metal, fraction) => {
    expect(accepted(text, metal).fraction).toBe(fraction);
  });

  it.each([
    ["sterling", "silver", "0.925"],
    ["Britannia", "silver", "0.958"],
    ["fine", "gold", "0.999"],
    ["fine", "silver", "0.999"],
  ] as const)("name %s on %s", (text, metal, fraction) => {
    expect(accepted(text, metal)).toEqual({ fraction, mark: text.toLowerCase(), basis: "name" });
  });
});

describe("parsePurity rejects", () => {
  it("karat on silver as invalid_purity", () => {
    expect(rejected("22K", "silver").code).toBe("invalid_purity");
  });

  it.each(["25K", "0K"])("karat %s outside 1 to 24 as invalid_purity", (text) => {
    expect(rejected(text, "gold").code).toBe("invalid_purity");
  });

  it.each(["100.1%", "0%"])("percent %s outside 0 to 100 as invalid_purity", (text) => {
    expect(rejected(text, "gold").code).toBe("invalid_purity");
  });

  it("fineness above 999.9 as invalid_purity", () => {
    expect(rejected("1000", "gold").code).toBe("invalid_purity");
  });

  it.each(["sterling", "britannia"])("silver name %s on gold as invalid_purity", (text) => {
    expect(rejected(text, "gold").code).toBe("invalid_purity");
  });

  it.each([
    ["100", "gold"],
    ["100", "silver"],
    ["333", "gold"],
    ["374.9", "gold"],
    ["799", "silver"],
    ["375", "silver"],
  ] as const)("bare number %s below the lowest %s fineness mark as unknown_purity", (text, metal) => {
    expect(rejected(text, metal).code).toBe("unknown_purity");
  });

  const belowAnyMark = ["0", "00", "0.5", "1", "022", "22", "24", "25", "92.5", "99.9", "100", "100.5", "150", "333", "374.9"];
  const bareNumbers: [string, Metal][] = [
    ...belowAnyMark.map((text): [string, Metal] => [text, "gold"]),
    ...[...belowAnyMark, "375", "500", "750", "799"].map((text): [string, Metal] => [text, "silver"]),
  ];

  it.each(bareNumbers)("bare number %s on %s suggests only marks that parse", (text, metal) => {
    const error = rejected(text, metal);
    expect(error.code).toBe("unknown_purity");
    const forms = error.fix?.split("Use one of: ")[1]?.replace(/\.$/, "").split(", ") ?? [];
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) expect(parsePurity(form, metal).ok, `${form} on ${metal}`).toBe(true);
  });

  it.each([
    ["100", "gold", ["100%"]],
    ["22", "gold", ["22K", "22%"]],
    ["92.5", "silver", ["92.5%"]],
    ["500", "silver", ["50%"]],
  ] as const)("bare number %s on %s suggests %j", (text, metal, expected) => {
    for (const form of expected) expect(rejected(text, metal).fix).toContain(form);
  });

  it.each(["platinum", "22.5K", "toString", ""])("other text %j as unknown_purity with the nearest marks", (text) => {
    const error = rejected(text, "silver");
    expect(error.code).toBe("unknown_purity");
    expect(error.fix).toMatch(/^Use one of: /);
  });

  it("suggests sterling for a misspelling", () => {
    expect(rejected("sterlng", "silver").fix).toContain("sterling");
  });
});
