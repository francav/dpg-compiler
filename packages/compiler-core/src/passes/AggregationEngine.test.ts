// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { AggregationEngine } from "./AggregationEngine.js";
import type { PassContext } from "./SemanticPass.js";
import type { DeterminismEntry } from "../types.js";

function createMockContext(): PassContext {
  return {
    compilerContext: {
      modelId: "test-model",
      governanceTier: "tier-2",
      policy: {
        id: "test-policy",
        version: "1.0",
        governanceTier: "tier-2",
        ruleToggles: {},
      },
      runtimeProfile: {
        id: "camunda-7",
        version: "7.21.0",
        capabilities: {},
      },
      metadata: {
        timestamp: "2024-01-01T00:00:00Z",
      },
    },
    ir: {
      nodes: new Map(),
      edges: [],
      annotations: new Map(),
      state: "complete" as const,
    },
    findings: [],
    annotate: () => {},
  };
}

describe("AggregationEngine", () => {
  const pass = new AggregationEngine();

  it("should have correct metadata", () => {
    expect(pass.id).toBe("maturity-aggregation");
    expect(pass.phase).toBe("summary");
    expect(pass.requires).toEqual([
      "gateway-condition-analysis",
      "script-determinism-classification",
    ]);
  });

  it("should return a maturitySignal", () => {
    const context = createMockContext();
    const result = pass.run(context);

    expect(result.maturitySignal).toBeDefined();
  });

  it("should return default maturity signal when no determinism entries", () => {
    const context = createMockContext();
    const result = pass.run(context);

    const signal = result.maturitySignal!;

    // Default signal with zero evaluation points
    expect(signal.totalEvaluationPoints).toBe(0);
    expect(signal.deterministicAgnostic).toBe(100);
    expect(signal.deterministicTotal).toBe(100);
  });

  it("computes the quadrant distribution from accumulated determinism entries", () => {
    const context = createMockContext();
    // PassRunner exposes the live determinism accumulator on the context; the
    // aggregation pass must read real entries, not a placeholder empty array.
    (context as { determinismEntries?: DeterminismEntry[] }).determinismEntries = [
      {
        evaluationPointId: "flow1",
        axisY: "deterministic",
        axisX: "engineAgnostic",
        confidence: 0.9,
        policyClause: "determinism.gatewayConditions",
        ruleId: "gateway-condition-analysis",
      },
      {
        evaluationPointId: "flow2",
        axisY: "runtimeBound",
        axisX: "externalized",
        confidence: 0.9,
        policyClause: "determinism.gatewayConditions",
        ruleId: "gateway-condition-analysis",
      },
      {
        evaluationPointId: "task1",
        axisY: "policyDependent",
        axisX: "profileScoped",
        confidence: 0.9,
        policyClause: "service-task-determinism",
        ruleId: "service-task-classifier",
      },
      {
        evaluationPointId: "task2",
        axisY: "deterministic",
        axisX: "engineAgnostic",
        confidence: 0.9,
        policyClause: "service-task-determinism",
        ruleId: "service-task-classifier",
      },
    ];

    const signal = pass.run(context).maturitySignal!;

    expect(signal.totalEvaluationPoints).toBe(4);
    // 2/4 deterministic+agnostic, 1/4 runtimeBound+externalized, 1/4 policyDependent+profileScoped
    expect(signal.deterministicAgnostic).toBe(50);
    expect(signal.nonDeterministicBound).toBe(25);
    expect(signal.policyDependentBound).toBe(25);
    // No longer the trivial 100%-deterministic placeholder.
    expect(signal.deterministicTotal).not.toBe(100);
  });

  it("should always emit findings array", () => {
    const context = createMockContext();
    const result = pass.run(context);

    expect(result.findings).toBeDefined();
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
