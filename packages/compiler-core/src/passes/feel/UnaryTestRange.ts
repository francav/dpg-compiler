// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

/**
 * FEEL unary-test / interval region comparator.
 *
 * A small, deliberately-bounded analyzer shared by the DMN gap analyzer (decision-table
 * input entries) and the gateway semantic analyzer (sequence-flow conditions). It parses
 * the *credible 80%* of FEEL unary tests into a normalized {@link Region} and answers two
 * questions used by the semantic passes:
 *   - do two regions overlap? ({@link intersects})
 *   - does one region fully contain another? ({@link subsumes})
 *
 * Guiding principle: NEVER manufacture a false governance claim. Anything this module
 * cannot analyze with confidence (non-numeric comparisons it doesn't model, negation,
 * function calls, mixed domains) yields `null` from {@link parseUnaryTest} so the caller
 * degrades gracefully instead of guessing. This is NOT a general FEEL evaluator.
 *
 * Supported unary tests:
 *   - "-" / "" (and FEEL `null` handling lives in the caller) → matches anything (`any`)
 *   - comparisons against a number: `< n`, `<= n`, `> n`, `>= n`, `= n`
 *   - intervals: `[1..10]`, `(0..5]`, `]0..5]`, `[1..10)` (FEEL open/closed bracket forms)
 *   - bare numeric literal `42` → equality `[42, 42]`
 *   - disjunctions: `1, 2, 3` or `"a", "b"` → union of the parsed parts
 *   - non-numeric literals (quoted strings, `true`/`false`, bare identifiers) → equality set
 */

/** A half-open/closed numeric interval. `min`/`max` may be ±Infinity. */
export interface NumericInterval {
  readonly min: number;
  readonly minInclusive: boolean;
  readonly max: number;
  readonly maxInclusive: boolean;
}

/**
 * A normalized region over a single decision input / condition variable.
 * `any === true` means the test places no constraint (matches everything).
 * Otherwise the region is the union of its numeric `intervals` and string `literals`.
 */
export interface Region {
  readonly any: boolean;
  readonly intervals: readonly NumericInterval[];
  readonly literals: ReadonlySet<string>;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const COMPARISON_RE = new RegExp(String.raw`^(<=|>=|<|>|=)\s*(${NUMBER})$`);
const INTERVAL_RE = new RegExp(
  String.raw`^([\[\(\]])\s*(${NUMBER})\s*\.\.\s*(${NUMBER})\s*([\]\)\[])$`,
);
const BARE_NUMBER_RE = new RegExp(String.raw`^${NUMBER}$`);
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ANY: Region = { any: true, intervals: [], literals: new Set() };

function numericRegion(interval: NumericInterval): Region {
  return { any: false, intervals: [interval], literals: new Set() };
}

function literalRegion(value: string): Region {
  return { any: false, intervals: [], literals: new Set([value]) };
}

function comparisonInterval(op: string, n: number): NumericInterval {
  switch (op) {
    case "<":
      return { min: -Infinity, minInclusive: false, max: n, maxInclusive: false };
    case "<=":
      return { min: -Infinity, minInclusive: false, max: n, maxInclusive: true };
    case ">":
      return { min: n, minInclusive: false, max: Infinity, maxInclusive: false };
    case ">=":
      return { min: n, minInclusive: true, max: Infinity, maxInclusive: false };
    case "=":
    default:
      return { min: n, minInclusive: true, max: n, maxInclusive: true };
  }
}

/** Split on top-level commas (FEEL disjunction); commas inside brackets stay grouped. */
function splitDisjunction(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim());
}

function mergeRegions(regions: Region[]): Region {
  if (regions.some((r) => r.any)) return ANY;
  const intervals: NumericInterval[] = [];
  const literals = new Set<string>();
  for (const region of regions) {
    intervals.push(...region.intervals);
    for (const literal of region.literals) literals.add(literal);
  }
  return { any: false, intervals, literals };
}

function parseSingleTest(text: string): Region | null {
  const t = text.trim();
  if (t === "" || t === "-") return ANY;

  const interval = INTERVAL_RE.exec(t);
  if (interval) {
    const [, left, minStr, maxStr, right] = interval;
    const min = Number(minStr);
    const max = Number(maxStr);
    if (min > max) return null; // malformed interval — refuse to guess
    return numericRegion({
      min,
      minInclusive: left === "[",
      max,
      maxInclusive: right === "]",
    });
  }

  const comparison = COMPARISON_RE.exec(t);
  if (comparison) {
    const [, op, numStr] = comparison;
    return numericRegion(comparisonInterval(op!, Number(numStr)));
  }

  if (BARE_NUMBER_RE.test(t)) {
    const n = Number(t);
    return numericRegion({ min: n, minInclusive: true, max: n, maxInclusive: true });
  }

  // Quoted string literal.
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return literalRegion(t.slice(1, -1));
  }

  // Boolean or bare identifier (enum-style value). Anything else is out of scope.
  if (t === "true" || t === "false" || IDENTIFIER_RE.test(t)) {
    return literalRegion(t);
  }

  return null;
}

/**
 * Parse a FEEL unary test into a {@link Region}, or `null` when it cannot be analyzed
 * with confidence. Callers MUST treat `null` as "unknown" and avoid asserting overlap or
 * subsumption for that column.
 */
export function parseUnaryTest(raw: string): Region | null {
  const text = raw.trim();
  const parts = splitDisjunction(text);
  if (parts.length > 1) {
    const parsed: Region[] = [];
    for (const part of parts) {
      const region = parseSingleTest(part);
      if (region === null) return null; // any unparseable member → whole test unknown
      parsed.push(region);
    }
    return mergeRegions(parsed);
  }
  return parseSingleTest(text);
}

function intervalsIntersect(a: NumericInterval, b: NumericInterval): boolean {
  // Lower bound of the intersection.
  let lo: number;
  let loInclusive: boolean;
  if (a.min > b.min) {
    lo = a.min;
    loInclusive = a.minInclusive;
  } else if (a.min < b.min) {
    lo = b.min;
    loInclusive = b.minInclusive;
  } else {
    lo = a.min;
    loInclusive = a.minInclusive && b.minInclusive;
  }

  // Upper bound of the intersection.
  let hi: number;
  let hiInclusive: boolean;
  if (a.max < b.max) {
    hi = a.max;
    hiInclusive = a.maxInclusive;
  } else if (a.max > b.max) {
    hi = b.max;
    hiInclusive = b.maxInclusive;
  } else {
    hi = a.max;
    hiInclusive = a.maxInclusive && b.maxInclusive;
  }

  if (lo < hi) return true;
  if (lo === hi) return loInclusive && hiInclusive;
  return false;
}

/** True when two regions could both match the same value. */
export function intersects(a: Region, b: Region): boolean {
  if (a.any || b.any) return true;
  for (const ia of a.intervals) {
    for (const ib of b.intervals) {
      if (intervalsIntersect(ia, ib)) return true;
    }
  }
  for (const literal of a.literals) {
    if (b.literals.has(literal)) return true;
  }
  return false;
}

const CONDITION_RE = new RegExp(
  String.raw`^([A-Za-z_][A-Za-z0-9_.]*)\s*(<=|>=|==|=|<|>)\s*(${NUMBER})$`,
);
const CONDITION_RE_FLIPPED = new RegExp(
  String.raw`^(${NUMBER})\s*(<=|>=|==|=|<|>)\s*([A-Za-z_][A-Za-z0-9_.]*)$`,
);

const FLIP_OP: Record<string, string> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };

/** Strip a `${...}` / `#{...}` expression-language wrapper if present. */
function unwrapExpression(text: string): string {
  const t = text.trim();
  const match = /^[#$]\{(.*)\}$/.exec(t);
  return (match ? match[1]! : t).trim();
}

/**
 * Parse a single-variable boolean condition (e.g. `${orderTotal > 1000}`) into the variable
 * name and the {@link Region} of values for which it is true. Returns `null` for anything
 * beyond a single numeric comparison (negation, function calls, multi-variable, boolean ops)
 * so the caller treats it as unanalyzable rather than guessing.
 */
export function parseCondition(raw: string): { variable: string; region: Region } | null {
  const text = unwrapExpression(raw);

  let variable: string | undefined;
  let op: string | undefined;
  let numStr: string | undefined;

  const direct = CONDITION_RE.exec(text);
  if (direct) {
    [, variable, op, numStr] = direct;
  } else {
    const flipped = CONDITION_RE_FLIPPED.exec(text);
    if (flipped) {
      const [, num, rawOp, name] = flipped;
      variable = name;
      numStr = num;
      op = FLIP_OP[rawOp!] ?? rawOp; // normalize `1000 < x` → `x > 1000`
    }
  }

  if (!variable || !op || numStr === undefined) return null;

  const normalizedOp = op === "==" ? "=" : op;
  return {
    variable,
    region: numericRegion(comparisonInterval(normalizedOp, Number(numStr))),
  };
}

/**
 * True when a union of numeric intervals covers the entire real line (−∞, +∞) with no gap.
 * Used to decide whether a set of gateway conditions is genuinely exhaustive.
 */
export function unionCoversReals(intervals: readonly NumericInterval[]): boolean {
  if (intervals.length === 0) return false;
  const sorted = [...intervals].sort((a, b) =>
    a.min === b.min ? Number(b.minInclusive) - Number(a.minInclusive) : a.min - b.min,
  );

  // Must start at −∞.
  if (sorted[0]!.min !== -Infinity) return false;

  let reach = sorted[0]!.max;
  let reachInclusive = sorted[0]!.maxInclusive;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    const touches =
      next.min < reach || (next.min === reach && (next.minInclusive || reachInclusive));
    if (!touches) return false; // gap between `reach` and the next interval
    if (next.max > reach || (next.max === reach && next.maxInclusive)) {
      reach = next.max;
      reachInclusive = next.maxInclusive;
    }
  }

  return reach === Infinity;
}

function intervalContains(outer: NumericInterval, inner: NumericInterval): boolean {
  const lowerOk =
    outer.min < inner.min ||
    (outer.min === inner.min && (outer.minInclusive || !inner.minInclusive));
  const upperOk =
    outer.max > inner.max ||
    (outer.max === inner.max && (outer.maxInclusive || !inner.maxInclusive));
  return lowerOk && upperOk;
}

/**
 * True when `outer` fully contains `inner` (every value matching `inner` also matches
 * `outer`). Sound but intentionally incomplete: numeric containment is checked against a
 * single outer interval, not the union of several, so it never reports a false subsumption.
 */
export function subsumes(outer: Region, inner: Region): boolean {
  if (outer.any) return true;
  if (inner.any) return false;
  for (const innerInterval of inner.intervals) {
    if (!outer.intervals.some((o) => intervalContains(o, innerInterval))) return false;
  }
  for (const literal of inner.literals) {
    if (!outer.literals.has(literal)) return false;
  }
  return true;
}
