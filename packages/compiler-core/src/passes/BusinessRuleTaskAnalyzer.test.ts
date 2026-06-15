// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { BusinessRuleTaskAnalyzer } from "./BusinessRuleTaskAnalyzer.js";
import { PassContext } from "./SemanticPass.js";
import type { IrGraph, CompilerContext, FlowNodeIr, DmnDecisionDescriptor } from "../types.js";

describe("BusinessRuleTaskAnalyzer", () => {
  const analyzer = new BusinessRuleTaskAnalyzer();

  function createContext(
    ir: IrGraph,
    dmnDecisionDescriptors?: DmnDecisionDescriptor[],
    profileId?: string,
    governanceTier = "tier-2",
  ): PassContext & { dmnDecisionDescriptors?: DmnDecisionDescriptor[] } {
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
      dmnDecisionDescriptors,
    } as PassContext & { dmnDecisionDescriptors?: DmnDecisionDescriptor[] };
  }

  it("propagates determinism from DMN decision to business rule task", () => {
    const businessRuleTask: FlowNodeIr = {
      kind: "flowNode",
      id: "task1",
      astNodeId: "task1",
      flowType: "businessRuleTask",
    };

    const ir: IrGraph = {
      nodes: new Map([[businessRuleTask.id, businessRuleTask]]),
      edges: [],
      annotations: new Map([
        [
          businessRuleTask.id,
          {
            "camunda:decisionRef": "Decision_Pricing",
          },
        ],
      ]),
      state: "complete",
    };

    const dmnDecisions: DmnDecisionDescriptor[] = [
      {
        decisionId: "Decision_Pricing",
        decisionName: "Pricing Rules",
        hitPolicy: "UNIQUE",
        ruleCount: 3,
        ruleDeterminism: ["deterministic", "deterministic", "deterministic"],
        decisionDeterminism: "deterministic",
        inputCount: 1,
        outputCount: 1,
      },
    ];

    const context = createContext(ir, dmnDecisions, "camunda-7");
    const output = analyzer.run(context);

    expect(output.businessRuleTaskDescriptors).toHaveLength(1);
    expect(output.businessRuleTaskDescriptors![0].taskId).toBe("task1");
    expect(output.businessRuleTaskDescriptors![0].decisionRef).toBe("Decision_Pricing");
    expect(output.businessRuleTaskDescriptors![0].determinism).toBe("deterministic");
    expect(output.businessRuleTaskDescriptors![0].resolved).toBe(true);
    expect(output.businessRuleTaskDescriptors![0].coupling).toBe("profileScoped");
  });

  it("inherits runtimeBound determinism from DMN decision", () => {
    const businessRuleTask: FlowNodeIr = {
      kind: "flowNode",
      id: "task1",
      astNodeId: "task1",
      flowType: "businessRuleTask",
    };

    const ir: IrGraph = {
      nodes: new Map([[businessRuleTask.id, businessRuleTask]]),
      edges: [],
      annotations: new Map([
        [
          businessRuleTask.id,
          {
            "camunda:decisionRef": "Decision_Risk",
          },
        ],
      ]),
      state: "complete",
    };

    const dmnDecisions: DmnDecisionDescriptor[] = [
      {
        decisionId: "Decision_Risk",
        decisionName: "Risk Assessment",
        hitPolicy: "FIRST",
        ruleCount: 1,
        ruleDeterminism: ["runtimeBound"],
        decisionDeterminism: "runtimeBound",
        inputCount: 1,
        outputCount: 1,
      },
    ];

    const context = createContext(ir, dmnDecisions, "camunda-7");
    const output = analyzer.run(context);

    expect(output.businessRuleTaskDescriptors).toHaveLength(1);
    expect(output.businessRuleTaskDescriptors![0].determinism).toBe("runtimeBound");
    expect(output.findings!.length).toBeGreaterThan(0);
    expect(output.findings![0].message).toContain("runtimeBound determinism");
  });

  it("emits error for missing decisionRef attribute", () => {
    const businessRuleTask: FlowNodeIr = {
      kind: "flowNode",
      id: "task1",
      astNodeId: "task1",
      flowType: "businessRuleTask",
    };

    const ir: IrGraph = {
      nodes: new Map([[businessRuleTask.id, businessRuleTask]]),
      edges: [],
      annotations: new Map([[businessRuleTask.id, {}]]),
      state: "complete",
    };

    const context = createContext(ir, [], "camunda-7", "tier-2");
    const output = analyzer.run(context);

    expect(output.businessRuleTaskDescriptors).toHaveLength(1);
    expect(output.businessRuleTaskDescriptors![0].resolved).toBe(false);
    expect(output.findings!.length).toBeGreaterThan(0);
    expect(output.findings![0].severity).toBe("error");
    expect(output.findings![0].message).toContain("missing decisionRef");
  });

  it("emits error for unresolved decisionRef", () => {
    const businessRuleTask: FlowNodeIr = {
      kind: "flowNode",
      id: "task1",
      astNodeId: "task1",
      flowType: "businessRuleTask",
    };

    const ir: IrGraph = {
      nodes: new Map([[businessRuleTask.id, businessRuleTask]]),
      edges: [],
      annotations: new Map([
        [
          businessRuleTask.id,
          {
            "camunda:decisionRef": "Decision_NonExistent",
          },
        ],
      ]),
      state: "complete",
    };

    const context = createContext(ir, [], "camunda-7", "tier-2");
    const output = analyzer.run(context);

    expect(output.businessRuleTaskDescriptors).toHaveLength(1);
    expect(output.businessRuleTaskDescriptors![0].resolved).toBe(false);
    expect(output.findings!.length).toBeGreaterThan(0);
    expect(output.findings![0].severity).toBe("error");
    expect(output.findings![0].message).toContain("not found");
  });

  it("handles Camunda 8 zeebe:calledDecision extraction", () => {
    const businessRuleTask: FlowNodeIr = {
      kind: "flowNode",
      id: "task1",
      astNodeId: "task1",
      flowType: "businessRuleTask",
    };

    const ir: IrGraph = {
      nodes: new Map([[businessRuleTask.id, businessRuleTask]]),
      edges: [],
      annotations: new Map([
        [
          businessRuleTask.id,
          {
            "zeebe:calledDecision": { decisionId: "Decision_Pricing" },
          },
        ],
      ]),
      state: "complete",
    };

    const dmnDecisions: DmnDecisionDescriptor[] = [
      {
        decisionId: "Decision_Pricing",
        decisionName: "Pricing Rules",
        hitPolicy: "UNIQUE",
        ruleCount: 1,
        ruleDeterminism: ["deterministic"],
        decisionDeterminism: "deterministic",
        inputCount: 1,
        outputCount: 1,
      },
    ];

    const context = createContext(ir, dmnDecisions, "camunda-8");
    const output = analyzer.run(context);

    expect(output.businessRuleTaskDescriptors).toHaveLength(1);
    expect(output.businessRuleTaskDescriptors![0].decisionRef).toBe("Decision_Pricing");
    expect(output.businessRuleTaskDescriptors![0].resolved).toBe(true);
    expect(output.businessRuleTaskDescriptors![0].coupling).toBe("profileScoped");
  });

  it("classifies generic BPMN 2.0 decisionRef as engineAgnostic", () => {
    const businessRuleTask: FlowNodeIr = {
      kind: "flowNode",
      id: "task1",
      astNodeId: "task1",
      flowType: "businessRuleTask",
    };

    const ir: IrGraph = {
      nodes: new Map([[businessRuleTask.id, businessRuleTask]]),
      edges: [],
      annotations: new Map([
        [
          businessRuleTask.id,
          {
            decisionRef: "Decision_Pricing",
          },
        ],
      ]),
      state: "complete",
    };

    const dmnDecisions: DmnDecisionDescriptor[] = [
      {
        decisionId: "Decision_Pricing",
        decisionName: "Pricing Rules",
        hitPolicy: "UNIQUE",
        ruleCount: 1,
        ruleDeterminism: ["deterministic"],
        decisionDeterminism: "deterministic",
        inputCount: 1,
        outputCount: 1,
      },
    ];

    const context = createContext(ir, dmnDecisions);
    const output = analyzer.run(context);

    expect(output.businessRuleTaskDescriptors).toHaveLength(1);
    expect(output.businessRuleTaskDescriptors![0].coupling).toBe("engineAgnostic");
  });
});
