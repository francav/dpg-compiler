// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import {
  parseUnaryTest,
  parseCondition,
  intersects,
  subsumes,
  unionCoversReals,
  type Region,
} from "./UnaryTestRange.js";

function parse(text: string): Region {
  const region = parseUnaryTest(text);
  expect(region, `expected "${text}" to parse`).not.toBeNull();
  return region!;
}

describe("parseUnaryTest", () => {
  it('treats "-" and empty as any', () => {
    expect(parseUnaryTest("-")!.any).toBe(true);
    expect(parseUnaryTest("")!.any).toBe(true);
    expect(parseUnaryTest("   ")!.any).toBe(true);
  });

  it("parses comparison operators", () => {
    expect(parse(">1000").intervals[0]).toMatchObject({ min: 1000, minInclusive: false });
    expect(parse(">=500").intervals[0]).toMatchObject({ min: 500, minInclusive: true });
    expect(parse("<= 10").intervals[0]).toMatchObject({ max: 10, maxInclusive: true });
    expect(parse("= 42").intervals[0]).toMatchObject({ min: 42, max: 42 });
  });

  it("parses closed and open intervals", () => {
    expect(parse("[1..10]").intervals[0]).toMatchObject({
      min: 1,
      minInclusive: true,
      max: 10,
      maxInclusive: true,
    });
    expect(parse("(0..5]").intervals[0]).toMatchObject({ min: 0, minInclusive: false });
    expect(parse("[1..10)").intervals[0]).toMatchObject({ max: 10, maxInclusive: false });
  });

  it("parses disjunctions as a union", () => {
    const region = parse("1, 2, 3");
    expect(region.intervals).toHaveLength(3);
  });

  it("parses literals and bare numbers", () => {
    expect(parse('"approved"').literals.has("approved")).toBe(true);
    expect(parse("true").literals.has("true")).toBe(true);
    expect(parse("5").intervals[0]).toMatchObject({ min: 5, max: 5 });
  });

  it("returns null for un-analyzable tests", () => {
    expect(parseUnaryTest("not(5)")).toBeNull();
    expect(parseUnaryTest("> x + 1")).toBeNull();
    expect(parseUnaryTest("[10..1]")).toBeNull(); // inverted bounds
    expect(parseUnaryTest('1, "a", foo()')).toBeNull(); // one member unparseable
  });
});

describe("intersects", () => {
  it("detects overlapping numeric ranges (>1000 vs >=500)", () => {
    expect(intersects(parse(">1000"), parse(">=500"))).toBe(true);
  });

  it("detects overlapping intervals", () => {
    expect(intersects(parse("[1..10]"), parse("[5..20]"))).toBe(true);
  });

  it("reports disjoint ranges as non-overlapping", () => {
    expect(intersects(parse("<10"), parse(">=10"))).toBe(false);
    expect(intersects(parse("[1..5]"), parse("(5..9]"))).toBe(false);
  });

  it("treats any as overlapping everything", () => {
    expect(intersects(parse("-"), parse(">1000"))).toBe(true);
  });

  it("matches literal equality and rejects different literals", () => {
    expect(intersects(parse('"a"'), parse('"a"'))).toBe(true);
    expect(intersects(parse('"a"'), parse('"b"'))).toBe(false);
  });

  it("treats numeric vs literal columns as non-overlapping (no false claim)", () => {
    expect(intersects(parse(">1000"), parse('"approved"'))).toBe(false);
  });
});

describe("subsumes", () => {
  it("any subsumes anything; nothing but any subsumes any", () => {
    expect(subsumes(parse("-"), parse(">1000"))).toBe(true);
    expect(subsumes(parse(">1000"), parse("-"))).toBe(false);
  });

  it("a wider range subsumes a narrower one", () => {
    expect(subsumes(parse(">=0"), parse("[5..10]"))).toBe(true);
    expect(subsumes(parse("[1..10]"), parse("[5..10]"))).toBe(true);
  });

  it("does not over-claim subsumption", () => {
    expect(subsumes(parse("[5..10]"), parse("[1..10]"))).toBe(false);
    expect(subsumes(parse(">1000"), parse(">=500"))).toBe(false);
  });
});

describe("parseCondition", () => {
  it("parses a wrapped single-variable comparison", () => {
    const parsed = parseCondition("${orderTotal > 1000}");
    expect(parsed?.variable).toBe("orderTotal");
    expect(parsed?.region.intervals[0]).toMatchObject({ min: 1000, minInclusive: false });
  });

  it("normalizes a flipped comparison", () => {
    const parsed = parseCondition("1000 < orderTotal");
    expect(parsed?.variable).toBe("orderTotal");
    expect(parsed?.region.intervals[0]).toMatchObject({ min: 1000, minInclusive: false });
  });

  it("returns null for non-comparison conditions", () => {
    expect(parseCondition("${service.check()}")).toBeNull();
    expect(parseCondition("${a > 1 && b < 2}")).toBeNull();
    expect(parseCondition("${x != 5}")).toBeNull();
  });
});

describe("unionCoversReals", () => {
  it("recognizes a complementary partition", () => {
    const a = parseCondition("${x > 1000}")!.region.intervals;
    const b = parseCondition("${x <= 1000}")!.region.intervals;
    expect(unionCoversReals([...a, ...b])).toBe(true);
  });

  it("detects a gap", () => {
    const a = parseCondition("${x > 0}")!.region.intervals;
    const b = parseCondition("${x > 10}")!.region.intervals;
    expect(unionCoversReals([...a, ...b])).toBe(false); // x <= 0 uncovered
  });

  it("is false for an empty set", () => {
    expect(unionCoversReals([])).toBe(false);
  });
});
