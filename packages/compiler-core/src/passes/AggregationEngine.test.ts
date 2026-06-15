// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { AggregationEngine } from "./AggregationEngine.js";
import type { PassContext } from "./SemanticPass.js";

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

  it("should return maturitySignal (implementation placeholder)", () => {
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

  it("should always emit findings array", () => {
    const context = createMockContext();
    const result = pass.run(context);

    expect(result.findings).toBeDefined();
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
