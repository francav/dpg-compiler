// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { DmnGapAnalyzer } from "./DmnGapAnalyzer.js";
import type { PassContext } from "./SemanticPass.js";
import type { DecisionNode } from "../types.js";

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

describe("DmnGapAnalyzer", () => {
  const pass = new DmnGapAnalyzer();

  it("should have correct metadata", () => {
    expect(pass.id).toBe("dmn-gap-analysis");
    expect(pass.phase).toBe("analysis");
    expect(pass.requires).toEqual(["structural-validation"]);
  });

  it("should return only findings when no decisions present", () => {
    const context = createMockContext();
    const result = pass.run(context);

    expect(result.findings).toEqual([]);
    expect(result.decisionAnalysis).toBeUndefined();
  });

  it("should skip non-decision nodes", () => {
    const nodes = new Map();
    const annotations = new Map();

    const flowNode = {
      kind: "flowNode" as const,
      id: "task1",
      astNodeId: "Task_1",
      flowType: "serviceTask",
    };

    nodes.set("task1", flowNode);

    const context = createMockContext();
    const contextWithData: PassContext = {
      ...context,
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    };

    const result = pass.run(contextWithData);

    expect(result.findings).toEqual([]);
    expect(result.decisionAnalysis).toBeUndefined();
  });

  it("should analyze decision tables and detect gaps", () => {
    const nodes = new Map();
    const annotations = new Map();

    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "Decision_1",
      hitPolicy: "UNIQUE",
    };

    nodes.set("decision1", decision);
    annotations.set("decision1", {
      inputs: ["loanAmount", "creditScore"],
      rules: [
        {
          id: "rule1",
          inputEntries: { loanAmount: ">1000", creditScore: ">700" },
          outputEntries: { decision: "approved" },
        },
        // No rule handles null inputs
      ],
    });

    const context = createMockContext();
    const contextWithData: PassContext = {
      ...context,
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    };

    const result = pass.run(contextWithData);

    // Should have decision analysis
    expect(result.decisionAnalysis).toBeDefined();
    expect(result.decisionAnalysis!.length).toBe(1);

    const analysis = result.decisionAnalysis![0];
    expect(analysis.decisionId).toBe("decision1");
    expect(analysis.gaps).toBeGreaterThan(0);
  });

  it("should handle empty decision tables", () => {
    const nodes = new Map();
    const annotations = new Map();

    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "Decision_1",
      hitPolicy: "UNIQUE",
    };

    nodes.set("decision1", decision);
    annotations.set("decision1", {
      inputs: [],
      rules: [],
    });

    const context = createMockContext();
    const contextWithData: PassContext = {
      ...context,
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    };

    const result = pass.run(contextWithData);

    expect(result.decisionAnalysis).toBeDefined();
    expect(result.decisionAnalysis!.length).toBe(1);
    expect(result.decisionAnalysis![0].rules).toBe(0);
  });
});
