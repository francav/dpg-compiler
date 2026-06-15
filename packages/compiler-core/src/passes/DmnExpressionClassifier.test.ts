// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { DmnExpressionClassifier } from "./DmnExpressionClassifier.js";
import { PassContext } from "./SemanticPass.js";
import type { IrGraph, CompilerContext, DecisionNode } from "../types.js";

describe("DmnExpressionClassifier", () => {
  const classifier = new DmnExpressionClassifier();

  function createContext(ir: IrGraph, profileId?: string, governanceTier = "tier-2"): PassContext {
    const compilerContext: CompilerContext = {
      modelId: "test-model",
      governanceTier,
      policy: {
        id: "test-policy",
        version: "1.0",
        governanceTier,
        ruleToggles: {},
      },
      runtimeProfile: profileId
        ? {
            id: profileId,
            version: "1.0",
            capabilities: {},
          }
        : undefined,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    return {
      compilerContext,
      ir,
      findings: [],
      annotate: () => {},
    };
  }

  it("classifies FEEL arithmetic as deterministic", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "UNIQUE",
    };

    const ir: IrGraph = {
      nodes: new Map([[decision.id, decision]]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            inputs: [
              {
                id: "input1",
                expression: "orderTotal > 1000",
                typeRef: "boolean",
              },
            ],
            outputs: [{ id: "output1", name: "discount", typeRef: "number" }],
            expressionLanguage: "feel",
          },
        ],
      ]),
      state: "complete",
    };

    const context = createContext(ir, "camunda-7");
    const output = classifier.run(context);

    expect(output.dmnExpressionDescriptors).toHaveLength(1);
    expect(output.dmnExpressionDescriptors![0].language).toBe("feel");
    expect(output.dmnExpressionDescriptors![0].determinism).toBe("deterministic");
    expect(output.dmnExpressionDescriptors![0].functionsUsed).toEqual([]);
    expect(output.findings).toHaveLength(0);
  });

  it("classifies FEEL with now() as policyDependent", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "UNIQUE",
    };

    const ir: IrGraph = {
      nodes: new Map([[decision.id, decision]]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            inputs: [
              {
                id: "input1",
                expression: "now() > startDate",
                typeRef: "boolean",
              },
            ],
            outputs: [{ id: "output1", name: "result", typeRef: "boolean" }],
            expressionLanguage: "feel",
          },
        ],
      ]),
      state: "complete",
    };

    const context = createContext(ir, "camunda-8");
    const output = classifier.run(context);

    expect(output.dmnExpressionDescriptors).toHaveLength(1);
    expect(output.dmnExpressionDescriptors![0].determinism).toBe("policyDependent");
    expect(output.dmnExpressionDescriptors![0].functionsUsed).toContain("now");
    expect(output.findings!.length).toBeGreaterThan(0);
    expect(output.findings![0].severity).toBe("warning");
  });

  it("classifies BKM invocation as runtimeBound", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "UNIQUE",
    };

    const ir: IrGraph = {
      nodes: new Map([[decision.id, decision]]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            inputs: [
              {
                id: "input1",
                expression: "calculateRisk(customer) -> score",
                typeRef: "number",
              },
            ],
            outputs: [{ id: "output1", name: "riskScore", typeRef: "number" }],
            expressionLanguage: "feel",
          },
        ],
      ]),
      state: "complete",
    };

    const context = createContext(ir, "camunda-7");
    const output = classifier.run(context);

    expect(output.dmnExpressionDescriptors).toHaveLength(1);
    expect(output.dmnExpressionDescriptors![0].determinism).toBe("runtimeBound");
    expect(output.dmnExpressionDescriptors![0].functionsUsed).toContain("BKM invocation");
    expect(output.findings!.length).toBeGreaterThan(0);
    expect(output.findings![0].message).toContain("external call");
  });

  it("emits error for non-FEEL on Camunda 8 profile", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "UNIQUE",
    };

    const ir: IrGraph = {
      nodes: new Map([[decision.id, decision]]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            inputs: [
              {
                id: "input1",
                expression: "${orderTotal > 1000}",
                typeRef: "boolean",
              },
            ],
            outputs: [{ id: "output1", name: "discount", typeRef: "number" }],
            expressionLanguage: "juel",
          },
        ],
      ]),
      state: "complete",
    };

    const context = createContext(ir, "camunda-8");
    const output = classifier.run(context);

    expect(output.findings!.length).toBeGreaterThan(0);
    expect(output.findings![0].severity).toBe("error");
    expect(output.findings![0].message).toContain("Camunda 8 only supports FEEL");
  });

  it("detects FEEL sum() function", () => {
    const decision: DecisionNode = {
      kind: "decision",
      id: "decision1",
      astNodeId: "decision1",
      hitPolicy: "COLLECT",
    };

    const ir: IrGraph = {
      nodes: new Map([[decision.id, decision]]),
      edges: [],
      annotations: new Map([
        [
          decision.id,
          {
            inputs: [{ id: "input1", expression: "sum(values)", typeRef: "number" }],
            outputs: [{ id: "output1", name: "total", typeRef: "number" }],
            expressionLanguage: "feel",
          },
        ],
      ]),
      state: "complete",
    };

    const context = createContext(ir, "camunda-7");
    const output = classifier.run(context);

    expect(output.dmnExpressionDescriptors).toHaveLength(1);
    expect(output.dmnExpressionDescriptors![0].determinism).toBe("deterministic");
    expect(output.dmnExpressionDescriptors![0].functionsUsed).toContain("sum");
  });
});
