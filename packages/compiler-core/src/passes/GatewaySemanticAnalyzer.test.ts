// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { GatewaySemanticAnalyzer } from "./GatewaySemanticAnalyzer.js";
import type { PassContext } from "./SemanticPass.js";
import type { ExpressionDescriptor } from "../types.js";

function createMockContext(overrides?: Partial<PassContext>): PassContext {
  return {
    compilerContext: {
      modelId: "test-model",
      governanceTier: "tier-2",
      policy: {
        id: "test-policy",
        version: "1.0.0",
        governanceTier: "tier-2",
        ruleToggles: {},
      },
      runtimeProfile: {
        id: "camunda-7",
        version: "1.0.0",
        capabilities: {
          expressionLanguage: "juel",
        },
      },
      metadata: {
        timestamp: "2026-02-17T12:00:00Z",
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
    ...overrides,
  };
}

describe("GatewaySemanticAnalyzer", () => {
  const pass = new GatewaySemanticAnalyzer();

  it("should have correct metadata", () => {
    expect(pass.id).toBe("gateway-semantic-analyzer");
    expect(pass.phase).toBe("L2");
    expect(pass.requires).toEqual(["expression-classifier"]);
  });

  it("should return empty results when no gateways present", async () => {
    const context = createMockContext();
    const result = await pass.run(context);

    expect(result.gatewayDescriptors).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("should analyze exclusive gateway with default flow (coverage OK)", async () => {
    const nodes = new Map();
    const annotations = new Map();

    // Add exclusive gateway
    nodes.set("gw1", {
      kind: "flowNode",
      id: "gw1",
      astNodeId: "Gateway_1",
      flowType: "exclusiveGateway",
      outgoing: ["flow1", "flow2"],
    });

    annotations.set("gw1", {
      default: "flow2",
    });

    // Add sequence flows
    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "${orderTotal > 1000}",
    });

    nodes.set("flow2", {
      kind: "flowNode",
      id: "flow2",
      astNodeId: "Flow_2",
      flowType: "sequenceFlow",
    });

    const context = createMockContext({
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    });

    const result = await pass.run(context);

    expect(result.gatewayDescriptors).toHaveLength(1);
    expect(result.gatewayDescriptors![0].type).toBe("exclusive");
    expect(result.gatewayDescriptors![0].conditionCoverage).toBe(true); // Has default flow
    expect(result.gatewayDescriptors![0].defaultFlow).toBe("flow2");
    expect(result.findings).toEqual([]); // No coverage issues
  });

  it("should emit warning for exclusive gateway without default (tier >= 2)", async () => {
    const nodes = new Map();
    const annotations = new Map();

    // Add exclusive gateway without default flow
    nodes.set("gw1", {
      kind: "flowNode",
      id: "gw1",
      astNodeId: "Gateway_1",
      flowType: "exclusiveGateway",
      outgoing: ["flow1", "flow2"],
    });

    // Only one flow has condition (not exhaustive)
    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "${orderTotal > 1000}",
      sourceRef: "gw1",
    });

    nodes.set("flow2", {
      kind: "flowNode",
      id: "flow2",
      astNodeId: "Flow_2",
      flowType: "sequenceFlow",
    });

    annotations.set("flow2", {
      sourceRef: "gw1",
    });

    const context = createMockContext({
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    });

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].conditionCoverage).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].severity).toBe("warning");
    expect(result.findings![0].message).toContain("missing default flow");
  });

  it("should accept exhaustive conditions without default flow", async () => {
    const nodes = new Map();
    const annotations = new Map();

    // Add exclusive gateway
    nodes.set("gw1", {
      kind: "flowNode",
      id: "gw1",
      astNodeId: "Gateway_1",
      flowType: "exclusiveGateway",
      outgoing: ["flow1", "flow2"],
    });

    // Both flows have conditions (exhaustive)
    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "${orderTotal > 1000}",
      sourceRef: "gw1",
    });

    nodes.set("flow2", {
      kind: "flowNode",
      id: "flow2",
      astNodeId: "Flow_2",
      flowType: "sequenceFlow",
    });

    annotations.set("flow2", {
      conditionExpression: "${orderTotal <= 1000}",
      sourceRef: "gw1",
    });

    const context = createMockContext({
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    });

    const result = await pass.run(context);

    // orderTotal > 1000 ∪ orderTotal <= 1000 provably covers the whole domain.
    expect(result.gatewayDescriptors![0].conditionCoverage).toBe(true);
    expect(result.findings).toEqual([]); // No coverage issues
  });

  it("should emit error for parallel gateway with conditions (tier >= 2)", async () => {
    const nodes = new Map();
    const annotations = new Map();

    // Add parallel gateway
    nodes.set("gw1", {
      kind: "flowNode",
      id: "gw1",
      astNodeId: "Gateway_1",
      flowType: "parallelGateway",
      outgoing: ["flow1", "flow2"],
    });

    // Flow has condition (BPMN violation)
    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "${orderTotal > 1000}",
      sourceRef: "gw1",
    });

    nodes.set("flow2", {
      kind: "flowNode",
      id: "flow2",
      astNodeId: "Flow_2",
      flowType: "sequenceFlow",
    });

    annotations.set("flow2", {
      sourceRef: "gw1",
    });

    const context = createMockContext({
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    });

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].type).toBe("parallel");
    expect(result.gatewayDescriptors![0].conditionCoverage).toBe(false); // Violation
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].severity).toBe("error");
    expect(result.findings![0].message).toContain("BPMN 2.0 violation");
  });

  it("should aggregate determinism as runtimeBound when any condition is runtimeBound", async () => {
    const nodes = new Map();
    const annotations = new Map();

    // Add gateway
    nodes.set("gw1", {
      kind: "flowNode",
      id: "gw1",
      astNodeId: "Gateway_1",
      flowType: "exclusiveGateway",
      outgoing: ["flow1", "flow2"],
    });

    // Flow1: pure condition
    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "${orderTotal > 1000}",
      sourceRef: "gw1",
    });

    // Flow2: bean call (runtimeBound)
    nodes.set("flow2", {
      kind: "flowNode",
      id: "flow2",
      astNodeId: "Flow_2",
      flowType: "sequenceFlow",
    });

    annotations.set("flow2", {
      conditionExpression: "${service.check()}",
      sourceRef: "gw1",
    });

    const context = createMockContext({
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    });

    // Determinism is cross-referenced from ExpressionClassifier's descriptors
    // (keyed by sequence-flow id), which PassRunner exposes on the context.
    (context as { expressionDescriptors?: ExpressionDescriptor[] }).expressionDescriptors = [
      {
        id: "expr:flow1",
        nodeId: "flow1",
        language: "juel",
        text: "${orderTotal > 1000}",
        hint: "pure",
        determinism: "deterministic",
      },
      {
        id: "expr:flow2",
        nodeId: "flow2",
        language: "juel",
        text: "${service.check()}",
        hint: "runtime",
        determinism: "runtimeBound",
      },
    ];

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].determinism).toBe("runtimeBound");
  });

  it("should handle gateway without outgoing flows", async () => {
    const nodes = new Map();

    nodes.set("gw1", {
      kind: "flowNode",
      id: "gw1",
      astNodeId: "Gateway_1",
      flowType: "exclusiveGateway",
      outgoing: [],
    });

    const context = createMockContext({
      ir: {
        nodes,
        edges: [],
        annotations: new Map(),
        state: "complete" as const,
      },
    });

    const result = await pass.run(context);

    expect(result.gatewayDescriptors).toHaveLength(1);
    expect(result.gatewayDescriptors![0].outgoingFlows).toEqual([]);
    expect(result.gatewayDescriptors![0].determinism).toBe("deterministic");
  });

  /**
   * Build an ir context with one gateway of `flowType` and the given outgoing flows.
   * Each flow: [flowId, conditionExpression | undefined].
   */
  function gatewayContext(
    flowType: string,
    flows: Array<[string, string | undefined]>,
    gatewayAnnotation: Record<string, unknown> = {},
  ): PassContext {
    const nodes = new Map();
    const annotations = new Map();
    nodes.set("gw1", { kind: "flowNode", id: "gw1", astNodeId: "Gateway_1", flowType });
    annotations.set("gw1", gatewayAnnotation);
    for (const [flowId, condition] of flows) {
      nodes.set(flowId, {
        kind: "flowNode",
        id: flowId,
        astNodeId: flowId,
        flowType: "sequenceFlow",
      });
      annotations.set(flowId, {
        sourceRef: "gw1",
        ...(condition !== undefined ? { conditionExpression: condition } : {}),
      });
    }
    return createMockContext({
      ir: { nodes, edges: [], annotations, state: "complete" as const },
    });
  }

  it("should accept inclusive gateway with a default flow", async () => {
    const context = gatewayContext(
      "inclusiveGateway",
      [
        ["flow1", "${amount > 100}"],
        ["flow2", undefined],
      ],
      { default: "flow2" },
    );

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].type).toBe("inclusive");
    expect(result.gatewayDescriptors![0].conditionCoverage).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("should warn for inclusive gateway without default and incomplete conditions", async () => {
    const context = gatewayContext("inclusiveGateway", [
      ["flow1", "${amount > 100}"],
      ["flow2", undefined], // no condition, not the default
    ]);

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].conditionCoverage).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].message).toContain("inclusive gateway missing default flow");
  });

  it("should detect a real coverage gap in exclusive conditions", async () => {
    // x > 0 ∪ x > 10 leaves x <= 0 uncovered.
    const context = gatewayContext("exclusiveGateway", [
      ["flow1", "${x > 0}"],
      ["flow2", "${x > 10}"],
    ]);

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].conditionCoverage).toBe(false);
    expect(result.findings.some((f) => f.message.includes("uncovered gap"))).toBe(true);
  });

  it("should flag overlapping conditions on an exclusive gateway", async () => {
    // x >= 0 ∪ x <= 100 covers the domain but overlaps on [0, 100].
    const context = gatewayContext("exclusiveGateway", [
      ["flow1", "${x >= 0}"],
      ["flow2", "${x <= 100}"],
    ]);

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].conditionCoverage).toBe(true); // domain covered
    const overlapFinding = result.findings.find((f) =>
      f.message.includes("overlapping conditions"),
    );
    expect(overlapFinding).toBeDefined();
    expect(overlapFinding!.policyClause).toBe("bpmn.exclusiveGatewayOverlap");
  });

  it("should not analyze coverage for event-based gateways", async () => {
    const context = gatewayContext("eventBasedGateway", [
      ["flow1", undefined],
      ["flow2", undefined],
    ]);

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].type).toBe("eventBased");
    expect(result.gatewayDescriptors![0].conditionCoverage).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("should emit an info finding for complex gateways", async () => {
    const context = gatewayContext("complexGateway", [["flow1", "${x > 0}"]]);

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].type).toBe("complex");
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].severity).toBe("info");
    expect(result.findings![0].message).toContain("not statically analyzable");
  });

  it("should classify an unclassified condition as unknown determinism, not deterministic", async () => {
    // A conditioned flow with no matching ExpressionDescriptor must not be called deterministic.
    const context = gatewayContext("exclusiveGateway", [
      ["flow1", "${mystery(x)}"],
      ["flow2", undefined],
    ]);

    const result = await pass.run(context);

    expect(result.gatewayDescriptors![0].determinism).toBe("unknown");
  });
});
