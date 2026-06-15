// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { ScriptDeterminismClassifier } from "./ScriptDeterminismClassifier.js";
import type { PassContext } from "./SemanticPass.js";
import type { FlowNodeIr } from "../types.js";

function createMockContext(): PassContext {
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
        version: "7.21.0",
        capabilities: {
          expressionLanguage: "juel",
        },
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

describe("ScriptDeterminismClassifier", () => {
  const pass = new ScriptDeterminismClassifier();

  it("should have correct metadata", () => {
    expect(pass.id).toBe("script-determinism-classification");
    expect(pass.phase).toBe("L2");
    expect(pass.requires).toEqual(["structural-validation"]);
  });

  it("should return empty results when no script tasks present", () => {
    const context = createMockContext();
    const result = pass.run(context);

    expect(result.determinism).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("should skip non-script nodes", () => {
    const nodes = new Map();
    const serviceTask: FlowNodeIr = {
      kind: "flowNode",
      id: "task1",
      astNodeId: "Task_1",
      flowType: "serviceTask",
    };

    nodes.set("task1", serviceTask);

    const context = createMockContext();
    const contextWithData: PassContext = {
      ...context,
      ir: {
        ...context.ir,
        nodes,
      },
    };

    const result = pass.run(contextWithData);

    expect(result.determinism).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("should detect non-deterministic patterns in Groovy scripts", () => {
    const nodes = new Map();
    const annotations = new Map();

    const scriptTask: FlowNodeIr = {
      kind: "flowNode",
      id: "script1",
      astNodeId: "Script_1",
      flowType: "scriptTask",
    };

    nodes.set("script1", scriptTask);
    annotations.set("script1", {
      scriptFormat: "groovy",
      scriptBody: 'execution.setVariable("timestamp", new Date())',
    });

    const context = createMockContext();
    const contextWithData: PassContext = {
      ...context,
      ir: {
        ...context.ir,
        nodes,
        annotations,
      },
    };

    const result = pass.run(contextWithData);

    // Should detect the Date pattern and emit findings
    expect(result.findings!.length).toBeGreaterThan(0);
    const nonDetFinding = result.findings!.find((f) =>
      f.message.toLowerCase().includes("non-deterministic"),
    );
    expect(nonDetFinding).toBeDefined();
  });

  it("should detect non-deterministic patterns in JavaScript scripts", () => {
    const nodes = new Map();
    const annotations = new Map();

    const scriptTask: FlowNodeIr = {
      kind: "flowNode",
      id: "script1",
      astNodeId: "Script_1",
      flowType: "scriptTask",
    };

    nodes.set("script1", scriptTask);
    annotations.set("script1", {
      scriptFormat: "javascript",
      scriptBody: 'execution.setVariable("random", Math.random())',
    });

    const context = createMockContext();
    const contextWithData: PassContext = {
      ...context,
      ir: {
        ...context.ir,
        nodes,
        annotations,
      },
    };

    const result = pass.run(contextWithData);

    // Should detect the random pattern and emit findings
    expect(result.findings!.length).toBeGreaterThan(0);
    const nonDetFinding = result.findings!.find((f) =>
      f.message.toLowerCase().includes("non-deterministic"),
    );
    expect(nonDetFinding).toBeDefined();
  });

  it("should handle Python scripts", () => {
    const nodes = new Map();
    const annotations = new Map();

    const scriptTask: FlowNodeIr = {
      kind: "flowNode",
      id: "script1",
      astNodeId: "Script_1",
      flowType: "scriptTask",
    };

    nodes.set("script1", scriptTask);
    annotations.set("script1", {
      scriptFormat: "python",
      scriptBody: "import datetime; timestamp = datetime.datetime.now()",
    });

    const context = createMockContext();
    const contextWithData: PassContext = {
      ...context,
      ir: {
        ...context.ir,
        nodes,
        annotations,
      },
    };

    const result = pass.run(contextWithData);

    // Should detect the datetime pattern and emit findings
    expect(result.findings!.length).toBeGreaterThan(0);
  });

  it("should emit info finding for MVEL scripts (post-MVP)", () => {
    const nodes = new Map();
    const annotations = new Map();

    const scriptTask: FlowNodeIr = {
      kind: "flowNode",
      id: "script1",
      astNodeId: "Script_1",
      flowType: "scriptTask",
    };

    nodes.set("script1", scriptTask);
    annotations.set("script1", {
      scriptFormat: "mvel",
      scriptBody: 'someVariable = "value"',
    });

    const context = createMockContext();
    const contextWithData: PassContext = {
      ...context,
      ir: {
        ...context.ir,
        nodes,
        annotations,
      },
    };

    const result = pass.run(contextWithData);

    // Should emit info finding about MVEL being post-MVP
    const infoFinding = result.findings!.find(
      (f) => f.severity === "info" && f.message.toLowerCase().includes("mvel"),
    );
    expect(infoFinding).toBeDefined();
  });
});
