// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileModel } from "./index.js";
import type { AxisYClass, MaturitySignal } from "./types.js";

/**
 * Fixture parity baseline (WU-1.1).
 *
 * Mirrors scripts/run-fixtures.mjs and locks the compiler's real output on the
 * sample processes so the maturity signal can't silently regress. These values
 * reflect the REAL behavior after the three mock analyzers were retired, not the
 * old placeholder "100% deterministic" output.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "..", "fixtures");

async function loadBpmn(name: string): Promise<string> {
  return readFile(path.join(FIXTURES_DIR, "bpmn", name), "utf8");
}

function axisYDistribution(entries: readonly { axisY: AxisYClass }[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.axisY] = (acc[entry.axisY] ?? 0) + 1;
    return acc;
  }, {});
}

describe("fixture parity", () => {
  it("baseline simple-process.bpmn", async () => {
    const result = await compileModel({
      modelId: "fixtures/simple-process",
      bpmnXml: await loadBpmn("simple-process.bpmn"),
      metadata: { caller: "fixture-runner:fixtures/simple-process" },
    });

    expect(result.summary.structuralErrors).toBe(0);
    expect(result.summary.semanticErrors).toBe(0);
    expect(result.summary.determinismCompliance).toBe(true);
    expect(result.summary.governanceTier).toBe("tier-1");

    // Since WU-F.2, every execution-bearing element is classified: the lone
    // serviceTask (unknown) plus the start and end events (deterministic,
    // engine-agnostic pass-through) → 3 evaluation points.
    expect(result.summary.maturitySignal).toEqual<MaturitySignal>({
      deterministicAgnostic: 67,
      deterministicBound: 0,
      policyDependentAgnostic: 0,
      policyDependentBound: 0,
      nonDeterministicAgnostic: 0,
      nonDeterministicBound: 0,
      totalEvaluationPoints: 3,
      deterministicTotal: 67,
      portableTotal: 67,
    });

    expect(axisYDistribution(result.determinismMap)).toEqual({ unknown: 1, deterministic: 2 });
  });

  it("runtime-bound runtime-bound.bpmn", async () => {
    const result = await compileModel({
      modelId: "fixtures/runtime-bound",
      bpmnXml: await loadBpmn("runtime-bound.bpmn"),
      metadata: { caller: "fixture-runner:fixtures/runtime-bound" },
    });

    expect(result.summary.structuralErrors).toBe(0);
    expect(result.summary.semanticErrors).toBe(0);
    expect(result.summary.governanceTier).toBe("tier-1");

    // Since WU-F.2: the businessRuleTask eval point (policyDependent, profile-scoped)
    // plus the start and end events (deterministic, engine-agnostic) → 3 points.
    expect(result.summary.maturitySignal).toEqual<MaturitySignal>({
      deterministicAgnostic: 67,
      deterministicBound: 0,
      policyDependentAgnostic: 0,
      policyDependentBound: 33,
      nonDeterministicAgnostic: 0,
      nonDeterministicBound: 0,
      totalEvaluationPoints: 3,
      deterministicTotal: 100,
      portableTotal: 67,
    });

    expect(axisYDistribution(result.determinismMap)).toEqual({
      policyDependent: 1,
      deterministic: 2,
    });
  });
});
