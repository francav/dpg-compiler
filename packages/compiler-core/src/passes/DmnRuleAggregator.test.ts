// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { DmnRuleAggregator } from "./DmnRuleAggregator.js";
import { PassContext } from "./SemanticPass.js";
import type {
  IrGraph,
  IrNode,
  CompilerContext,
  DecisionNode,
  DecisionRuleNode,
  DmnExpressionDescriptor,
} from "../types.js";

describe("DmnRuleAggregator", () => {
  const aggregator = new DmnRuleAggregator();

  function createContext(
    ir: IrGraph,
    dmnExpressionDescriptors?: DmnExpressionDescriptor[],
    governanceTier = "tier-2",
  ): PassContext & { dmnExpressionDescriptors?: DmnExpressionDescriptor[] } {
    const compilerContext: CompilerContext = {
      modelId: "test-model",
      governanceTier,
      policy: {
        id: "test-policy",
        version: "1.0",
        governanceTier,
        ruleToggles: {},
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    return {
      compilerContext,
      ir,
      findings: [],
      annotate: () => {},
      dmnExpressionDescriptors,
    } as PassContext & { dmnExpressionDescriptors?: DmnExpressionDescriptor[] };
  }

  it("aggregates UNIQUE hit policy with all rules fullyDeterministic", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "UNIQUE",
    };

    const rule1: DecisionRuleNode = {
      kind: "decisionRule",
      id: "decision1:rule:0",
      astNodeId: "rule1",
    };

    const rule2: DecisionRuleNode = {
      kind: "decisionRule",
      id: "decision1:rule:1",
      astNodeId: "rule2",
    };

    const ir: IrGraph = {
      nodes: new Map<string, IrNode>([
        [decision.id, decision],
        [rule1.id, rule1],
        [rule2.id, rule2],
      ]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            hitPolicy: "UNIQUE",
            inputCount: 1,
            outputCount: 1,
          },
        ],
      ]),
      state: "complete",
    };

    const expressionDescriptors: DmnExpressionDescriptor[] = [
      {
        id: "rule1:input:0",
        decisionId: "decision1",
        ruleId: "decision1:rule:0",
        expressionType: "input",
        language: "feel",
        content: "orderTotal > 1000",
        determinism: "deterministic",
        functionsUsed: [],
      },
      {
        id: "rule2:input:0",
        decisionId: "decision1",
        ruleId: "decision1:rule:1",
        expressionType: "input",
        language: "feel",
        content: "orderTotal <= 1000",
        determinism: "deterministic",
        functionsUsed: [],
      },
    ];

    const context = createContext(ir, expressionDescriptors);
    const output = aggregator.run(context);

    expect(output.dmnDecisionDescriptors).toHaveLength(1);
    expect(output.dmnDecisionDescriptors![0].decisionDeterminism).toBe("deterministic");
    expect(output.dmnDecisionDescriptors![0].ruleCount).toBe(2);
    expect(output.dmnDecisionDescriptors![0].ruleDeterminism).toEqual([
      "deterministic",
      "deterministic",
    ]);
  });

  it("aggregates FIRST hit policy with first rule policyDependent", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "FIRST",
    };

    const rule1: DecisionRuleNode = {
      kind: "decisionRule",
      id: "decision1:rule:0",
      astNodeId: "rule1",
    };

    const rule2: DecisionRuleNode = {
      kind: "decisionRule",
      id: "decision1:rule:1",
      astNodeId: "rule2",
    };

    const ir: IrGraph = {
      nodes: new Map<string, IrNode>([
        [decision.id, decision],
        [rule1.id, rule1],
        [rule2.id, rule2],
      ]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            hitPolicy: "FIRST",
            inputCount: 1,
            outputCount: 1,
          },
        ],
      ]),
      state: "complete",
    };

    const expressionDescriptors: DmnExpressionDescriptor[] = [
      {
        id: "rule1:input:0",
        decisionId: "decision1",
        ruleId: "decision1:rule:0",
        expressionType: "input",
        language: "feel",
        content: "now() > startDate",
        determinism: "policyDependent",
        functionsUsed: ["now"],
      },
      {
        id: "rule2:input:0",
        decisionId: "decision1",
        ruleId: "decision1:rule:1",
        expressionType: "input",
        language: "feel",
        content: "orderTotal > 1000",
        determinism: "deterministic",
        functionsUsed: [],
      },
    ];

    const context = createContext(ir, expressionDescriptors);
    const output = aggregator.run(context);

    expect(output.dmnDecisionDescriptors).toHaveLength(1);
    expect(output.dmnDecisionDescriptors![0].decisionDeterminism).toBe("policyDependent");
    expect(output.dmnDecisionDescriptors![0].hitPolicy).toBe("FIRST");
  });

  it("aggregates COLLECT + SUM with one rule runtimeBound", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "COLLECT",
    };

    const rule1: DecisionRuleNode = {
      kind: "decisionRule",
      id: "decision1:rule:0",
      astNodeId: "rule1",
    };

    const ir: IrGraph = {
      nodes: new Map<string, IrNode>([
        [decision.id, decision],
        [rule1.id, rule1],
      ]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            hitPolicy: "COLLECT",
            aggregation: "SUM",
            inputCount: 1,
            outputCount: 1,
          },
        ],
      ]),
      state: "complete",
    };

    const expressionDescriptors: DmnExpressionDescriptor[] = [
      {
        id: "rule1:input:0",
        decisionId: "decision1",
        ruleId: "decision1:rule:0",
        expressionType: "input",
        language: "feel",
        content: "calculateRisk(customer) -> score",
        determinism: "runtimeBound",
        functionsUsed: ["BKM invocation"],
      },
    ];

    const context = createContext(ir, expressionDescriptors);
    const output = aggregator.run(context);

    expect(output.dmnDecisionDescriptors).toHaveLength(1);
    expect(output.dmnDecisionDescriptors![0].decisionDeterminism).toBe("runtimeBound");
    expect(output.dmnDecisionDescriptors![0].aggregator).toBe("SUM");
  });

  it("emits warning for ANY hit policy with inconsistent rule determinism", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "ANY",
    };

    const rule1: DecisionRuleNode = {
      kind: "decisionRule",
      id: "decision1:rule:0",
      astNodeId: "rule1",
    };

    const rule2: DecisionRuleNode = {
      kind: "decisionRule",
      id: "decision1:rule:1",
      astNodeId: "rule2",
    };

    const ir: IrGraph = {
      nodes: new Map<string, IrNode>([
        [decision.id, decision],
        [rule1.id, rule1],
        [rule2.id, rule2],
      ]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            hitPolicy: "ANY",
            inputCount: 1,
            outputCount: 1,
          },
        ],
      ]),
      state: "complete",
    };

    const expressionDescriptors: DmnExpressionDescriptor[] = [
      {
        id: "rule1:input:0",
        decisionId: "decision1",
        ruleId: "decision1:rule:0",
        expressionType: "input",
        language: "feel",
        content: "orderTotal > 1000",
        determinism: "deterministic",
        functionsUsed: [],
      },
      {
        id: "rule2:input:0",
        decisionId: "decision1",
        ruleId: "decision1:rule:1",
        expressionType: "input",
        language: "feel",
        content: "now() > startDate",
        determinism: "policyDependent",
        functionsUsed: ["now"],
      },
    ];

    const context = createContext(ir, expressionDescriptors);
    const output = aggregator.run(context);

    expect(output.dmnDecisionDescriptors).toHaveLength(1);
    expect(output.findings!.length).toBeGreaterThan(0);
    expect(output.findings!.some((f) => f.message.includes("inconsistent determinism"))).toBe(true);
  });

  it("emits warning for empty decision table", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "UNIQUE",
    };

    const ir: IrGraph = {
      nodes: new Map<string, IrNode>([[decision.id, decision]]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            hitPolicy: "UNIQUE",
            inputCount: 1,
            outputCount: 1,
          },
        ],
      ]),
      state: "complete",
    };

    const context = createContext(ir, [], "tier-2");
    const output = aggregator.run(context);

    expect(output.dmnDecisionDescriptors).toHaveLength(1);
    expect(output.findings!.length).toBeGreaterThan(0);
    expect(output.findings!.some((f) => f.message.includes("no rules"))).toBe(true);
  });
});
