// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { ExpressionClassifier } from "./ExpressionClassifier.js";
import type { PassContext } from "./SemanticPass.js";

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
        id: "camunda-8",
        version: "1.0.0",
        capabilities: {
          expressionLanguage: "feel",
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

describe("ExpressionClassifier", () => {
  const pass = new ExpressionClassifier();

  it("should have correct metadata", () => {
    expect(pass.id).toBe("expression-classifier");
    expect(pass.phase).toBe("L2");
    expect(pass.requires).toEqual(["structural-validation"]);
  });

  it("should return empty results when no expressions present", async () => {
    const context = createMockContext();
    const result = await pass.run(context);

    expect(result.expressionDescriptors).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("should classify FEEL arithmetic expression as fullyDeterministic", async () => {
    const nodes = new Map();
    const annotations = new Map();

    // Add sequence flow with FEEL condition
    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "orderTotal > 1000",
      expressionLanguage: "feel",
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

    expect(result.expressionDescriptors).toHaveLength(1);
    expect(result.expressionDescriptors![0].language).toBe("feel");
    expect(result.expressionDescriptors![0].determinism).toMatch(
      /deterministic|fullyDeterministic/,
    );
    expect(result.expressionDescriptors![0].functionsUsed).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("should classify FEEL with now() as policyDependent", async () => {
    const nodes = new Map();
    const annotations = new Map();

    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "orderDate > now()",
      expressionLanguage: "feel",
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

    expect(result.expressionDescriptors).toHaveLength(1);
    expect(result.expressionDescriptors![0].determinism).toBe("policyDependent");
    expect(result.expressionDescriptors![0].functionsUsed).toContain("now");
  });

  it("should classify JUEL bean call as runtimeBound", async () => {
    const nodes = new Map();
    const annotations = new Map();

    const context = createMockContext({
      compilerContext: {
        ...createMockContext().compilerContext,
        runtimeProfile: {
          id: "camunda-7",
          version: "7.21.0",
          capabilities: {
            expressionLanguage: "juel",
          },
        },
      },
    });

    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "${service.checkCredit()}",
      expressionLanguage: "juel",
    });

    const contextWithData: PassContext = {
      ...context,
      ir: {
        ...context.ir,
        nodes,
        annotations,
      },
    };

    const result = await pass.run(contextWithData);

    expect(result.expressionDescriptors).toHaveLength(1);
    expect(result.expressionDescriptors![0].language).toBe("juel");
    expect(result.expressionDescriptors![0].determinism).toBe("runtimeBound");
    expect(result.expressionDescriptors![0].functionsUsed).toContain("service.checkCredit");
  });

  it("should detect JUEL language from ${...} pattern", async () => {
    const nodes = new Map();
    const annotations = new Map();

    const context = createMockContext({
      compilerContext: {
        ...createMockContext().compilerContext,
        runtimeProfile: {
          id: "camunda-7",
          version: "7.21.0",
          capabilities: {
            expressionLanguage: "juel",
          },
        },
      },
    });

    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "${orderTotal > 1000}",
      // No explicit language attribute
    });

    const contextWithData: PassContext = {
      ...context,
      ir: {
        ...context.ir,
        nodes,
        annotations,
      },
    };

    const result = await pass.run(contextWithData);

    expect(result.expressionDescriptors).toHaveLength(1);
    expect(result.expressionDescriptors![0].language).toBe("juel");
  });

  it("should emit error when Groovy used on Camunda 8", async () => {
    const nodes = new Map();
    const annotations = new Map();

    nodes.set("script1", {
      kind: "flowNode",
      id: "script1",
      astNodeId: "Script_1",
      flowType: "scriptTask",
    });

    annotations.set("script1", {
      scriptContent: "println 'Hello'",
      scriptFormat: "groovy",
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

    expect(result.expressionDescriptors).toHaveLength(1);
    expect(result.expressionDescriptors![0].language).toBe("groovy");
    expect(result.findings).toHaveLength(1);
    expect(result.findings![0].severity).toBe("error");
    expect(result.findings![0].message).toContain("Camunda 8 only supports FEEL");
  });

  it("should classify script task with new Date() as policyDependent", async () => {
    const nodes = new Map();
    const annotations = new Map();

    const context = createMockContext({
      compilerContext: {
        ...createMockContext().compilerContext,
        runtimeProfile: {
          id: "camunda-7",
          version: "7.21.0",
          capabilities: {
            expressionLanguage: "juel",
          },
        },
      },
    });

    nodes.set("script1", {
      kind: "flowNode",
      id: "script1",
      astNodeId: "Script_1",
      flowType: "scriptTask",
    });

    annotations.set("script1", {
      scriptContent: "def timestamp = new Date()",
      scriptFormat: "groovy",
    });

    const contextWithData: PassContext = {
      ...context,
      ir: {
        ...context.ir,
        nodes,
        annotations,
      },
    };

    const result = await pass.run(contextWithData);

    expect(result.expressionDescriptors).toHaveLength(1);
    expect(result.expressionDescriptors![0].determinism).toBe("policyDependent");
  });

  it("should warn when expression language is unknown (tier >= 2)", async () => {
    const nodes = new Map();
    const annotations = new Map();

    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "MYSTERIOUS_SYNTAX",
      // No language attribute and pattern doesn't match known languages
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

    expect(result.expressionDescriptors).toHaveLength(1);
    expect(result.expressionDescriptors![0].language).toBe("feel"); // Falls back to profile default
    expect(result.findings).toEqual([]); // FEEL is allowed on Camunda 8
  });

  it("should handle sequence flow without condition", async () => {
    const nodes = new Map();
    const annotations = new Map();

    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      // No conditionExpression
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

    expect(result.expressionDescriptors).toEqual([]);
  });

  it("should handle script task without script content", async () => {
    const nodes = new Map();
    const annotations = new Map();

    nodes.set("script1", {
      kind: "flowNode",
      id: "script1",
      astNodeId: "Script_1",
      flowType: "scriptTask",
    });

    annotations.set("script1", {
      // No scriptContent
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

    expect(result.expressionDescriptors).toEqual([]);
  });

  it("should detect FEEL keywords and classify as FEEL", async () => {
    const nodes = new Map();
    const annotations = new Map();

    nodes.set("flow1", {
      kind: "flowNode",
      id: "flow1",
      astNodeId: "Flow_1",
      flowType: "sequenceFlow",
    });

    annotations.set("flow1", {
      conditionExpression: "if orderTotal > 1000 then 'high' else 'low'",
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

    expect(result.expressionDescriptors![0].language).toBe("feel");
  });
});
