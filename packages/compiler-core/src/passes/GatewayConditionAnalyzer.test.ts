// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { GatewayConditionAnalyzer } from "./GatewayConditionAnalyzer.js";
import type { PassContext } from "./SemanticPass.js";
import type { FlowNodeIr } from "../types.js";

function createMockContext(overrides?: Partial<PassContext>): PassContext {
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
    ...overrides,
  };
}

describe("GatewayConditionAnalyzer", () => {
  const pass = new GatewayConditionAnalyzer();

  it("should have correct metadata", () => {
    expect(pass.id).toBe("gateway-condition-analysis");
    expect(pass.phase).toBe("L2");
    expect(pass.requires).toEqual(["structural-validation"]);
  });

  it("should return empty results when no gateways present", () => {
    const context = createMockContext();
    const result = pass.run(context);

    expect(result.determinism).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("should skip non-gateway nodes", () => {
    const nodes = new Map();
    const serviceTask: FlowNodeIr = {
      kind: "flowNode",
      id: "task1",
      astNodeId: "Task_1",
      flowType: "serviceTask",
    };

    nodes.set("task1", serviceTask);

    const context = createMockContext({
      ir: {
        nodes,
        edges: [],
        annotations: new Map(),
        state: "complete" as const,
      },
    });

    const result = pass.run(context);

    expect(result.determinism).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("emits a determinism entry per outgoing sequence-flow condition", () => {
    const nodes = new Map();
    const annotations = new Map();

    const gateway: FlowNodeIr = {
      kind: "flowNode",
      id: "gw1",
      astNodeId: "Gateway_1",
      flowType: "exclusiveGateway",
    };
    nodes.set("gw1", gateway);

    // Conditions live on the gateway's outgoing sequence flows, not the gateway.
    const flow1: FlowNodeIr = {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    };
    nodes.set("flow1", flow1);
    annotations.set("flow1", {
      sourceRef: "gw1",
      conditionExpression: "${orderTotal > 1000}",
    });

    const context = createMockContext({
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    });

    const result = pass.run(context);

    // One condition flow → one determinism entry, keyed by the flow id.
    expect(result.determinism).toHaveLength(1);
    expect(result.determinism![0].evaluationPointId).toBe("flow1");
    expect(result.determinism![0].ruleId).toBe("gateway-condition-analysis");
  });

  it("ignores conditions stored on the gateway node itself", () => {
    const nodes = new Map();
    const annotations = new Map();

    const gateway: FlowNodeIr = {
      kind: "flowNode",
      id: "gw1",
      astNodeId: "Gateway_1",
      flowType: "exclusiveGateway",
    };
    nodes.set("gw1", gateway);
    // A stray condition on the gateway annotation must NOT be treated as a flow.
    annotations.set("gw1", { conditionExpression: "${orderTotal > 1000}" });

    const context = createMockContext({
      ir: {
        nodes,
        edges: [],
        annotations,
        state: "complete" as const,
      },
    });

    const result = pass.run(context);

    expect(result.determinism).toEqual([]);
  });
});
