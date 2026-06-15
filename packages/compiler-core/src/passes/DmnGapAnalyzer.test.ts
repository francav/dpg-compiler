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

  /** Build a context with one decision table from `hitPolicy`, `inputs`, and `rules`. */
  function decisionContext(
    hitPolicy: string,
    inputs: string[],
    rules: Array<{ id: string; inputEntries: Record<string, string> }>,
  ): PassContext {
    const nodes = new Map();
    const annotations = new Map();
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "Decision_1",
      hitPolicy,
    };
    nodes.set("decision1", decision);
    annotations.set("decision1", { inputs, rules });
    const context = createMockContext();
    return {
      ...context,
      ir: { nodes, edges: [], annotations, state: "complete" as const },
    };
  }

  function analysis(result: ReturnType<DmnGapAnalyzer["run"]>) {
    return result.decisionAnalysis![0]!;
  }

  it("detects overlapping rules by range subsumption (>1000 vs >=500)", () => {
    const result = pass.run(
      decisionContext(
        "UNIQUE",
        ["amount"],
        [
          { id: "rule1", inputEntries: { amount: ">1000" } },
          { id: "rule2", inputEntries: { amount: ">=500" } },
        ],
      ),
    );

    expect(analysis(result).overlaps).toBe(1);
    expect(analysis(result).overlappingRules).toContain("rule2");
    expect(result.findings.some((f) => f.message.includes("overlapping rule"))).toBe(true);
  });

  it("detects overlapping intervals", () => {
    const result = pass.run(
      decisionContext(
        "UNIQUE",
        ["score"],
        [
          { id: "rule1", inputEntries: { score: "[1..10]" } },
          { id: "rule2", inputEntries: { score: "[5..20]" } },
        ],
      ),
    );

    expect(analysis(result).overlaps).toBe(1);
  });

  it("does not flag disjoint ranges as overlapping", () => {
    const result = pass.run(
      decisionContext(
        "UNIQUE",
        ["amount"],
        [
          { id: "rule1", inputEntries: { amount: "<10" } },
          { id: "rule2", inputEntries: { amount: ">=10" } },
        ],
      ),
    );

    expect(analysis(result).overlaps).toBe(0);
  });

  it("never claims overlap when a column is unparseable (no false positive)", () => {
    const result = pass.run(
      decisionContext(
        "UNIQUE",
        ["amount"],
        [
          { id: "rule1", inputEntries: { amount: "between(x, y)" } },
          { id: "rule2", inputEntries: { amount: "between(x, y)" } },
        ],
      ),
    );

    expect(analysis(result).overlaps).toBe(0);
  });

  it("requires ALL columns to intersect for a multi-column overlap", () => {
    // amount overlaps, but tier is disjoint → rules do not overlap overall.
    const result = pass.run(
      decisionContext(
        "UNIQUE",
        ["amount", "tier"],
        [
          { id: "rule1", inputEntries: { amount: ">1000", tier: '"gold"' } },
          { id: "rule2", inputEntries: { amount: ">=500", tier: '"silver"' } },
        ],
      ),
    );

    expect(analysis(result).overlaps).toBe(0);
  });

  it("flags a rule fully shadowed by an earlier rule under FIRST", () => {
    const result = pass.run(
      decisionContext(
        "FIRST",
        ["amount"],
        [
          { id: "rule1", inputEntries: { amount: ">=0" } },
          { id: "rule2", inputEntries: { amount: "[5..10]" } },
        ],
      ),
    );

    expect(analysis(result).shadowedRules).toContain("rule2");
    expect(analysis(result).unreachableRules).toContain("rule2");
    expect(result.findings.some((f) => f.message.includes("unreachable rule"))).toBe(true);
  });

  it("does not flag a reachable later rule under FIRST", () => {
    const result = pass.run(
      decisionContext(
        "FIRST",
        ["amount"],
        [
          { id: "rule1", inputEntries: { amount: "[5..10]" } },
          { id: "rule2", inputEntries: { amount: ">=0" } },
        ],
      ),
    );

    expect(analysis(result).shadowedRules).toEqual([]);
  });
});
