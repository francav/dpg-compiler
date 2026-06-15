// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { ContractCoverageAnalyzer } from "./ContractCoverageAnalyzer.js";
import type {
  CompilerContext,
  FlowNodeIr,
  IrGraph,
  IrNode,
  PolicySnapshot,
  RuntimeProfileSnapshot,
} from "../types.js";
import type { PassContext } from "./SemanticPass.js";

describe("ContractCoverageAnalyzer", () => {
  const createContext = (
    profileId: string,
    tier: string = "2",
    serviceTaskNodes: FlowNodeIr[] = [],
    annotations: Map<string, Record<string, string>> = new Map(),
  ): PassContext => {
    const policy: PolicySnapshot = {
      id: "test-policy",
      version: "1.0",
      governanceTier: tier,
      ruleToggles: {},
    };

    const runtimeProfile: RuntimeProfileSnapshot = {
      id: profileId,
      version: "1.0",
      capabilities: {},
    };

    const compilerContext: CompilerContext = {
      modelId: "test-model",
      governanceTier: tier,
      policy,
      runtimeProfile,
      metadata: {
        timestamp: new Date().toISOString(),
      },
    };

    const nodes = new Map<string, IrNode>();
    for (const node of serviceTaskNodes) {
      nodes.set(node.id, node);
    }

    const ir: IrGraph = {
      nodes,
      edges: [],
      annotations,
      state: "complete",
    };

    return { compilerContext, ir, findings: [], annotate: () => {} };
  };

  describe("External service tasks (Camunda 7)", () => {
    it("should detect missing contract for external task (tier 2)", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task1",
        astNodeId: "task1",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task1", {
        "camunda:type": "external",
        "camunda:topic": "payment-processing",
      });

      const context = createContext("camunda-7", "2", [serviceTask], annotations);
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.contractCoverage).toHaveLength(1);
      expect(result.contractCoverage![0].boundaryId).toBe("task1");
      expect(result.contractCoverage![0].missingContract).toBe(true);
      expect(result.contractCoverage![0].hasDeclaredContract).toBe(false);
      expect(result.contractCoverage![0].implementationType).toBe("externalTask");
      expect(result.contractCoverage![0].risk).toBe("high");

      expect(result.findings).toHaveLength(1);
      expect(result.findings![0].severity).toBe("warning");
      expect(result.findings![0].ruleId).toBe("MISSING_CONTRACT");
    });

    it("should emit error for missing contract at tier 3", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task2",
        astNodeId: "task2",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task2", { "camunda:type": "external" });

      const context = createContext("camunda-7", "3", [serviceTask], annotations);
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.findings).toHaveLength(1);
      expect(result.findings![0].severity).toBe("error");
    });

    it("should emit info for missing contract at tier 1", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task3",
        astNodeId: "task3",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task3", { "camunda:type": "external" });

      const context = createContext("camunda-7", "1", [serviceTask], annotations);
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.findings).toHaveLength(1);
      expect(result.findings![0].severity).toBe("info");
      expect(result.findings![0].ruleId).toBe("MISSING_CONTRACT_INFO");
    });

    it("should detect missing contract for connector", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task4",
        astNodeId: "task4",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task4", { "camunda:connectorId": "http-connector" });

      const context = createContext("camunda-7", "2", [serviceTask], annotations);
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.contractCoverage).toHaveLength(1);
      expect(result.contractCoverage![0].implementationType).toBe("connector");
      expect(result.contractCoverage![0].missingContract).toBe(true);
    });
  });

  describe("External service tasks (Camunda 8)", () => {
    it("should detect missing contract for job worker", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task5",
        astNodeId: "task5",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task5", { "zeebe:taskDefinition": "payment-worker" });

      const context = createContext("camunda-8", "2", [serviceTask], annotations);
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.contractCoverage).toHaveLength(1);
      expect(result.contractCoverage![0].implementationType).toBe("jobWorker");
      expect(result.contractCoverage![0].missingContract).toBe(true);
      expect(result.findings).toHaveLength(1);
    });
  });

  describe("Internal service tasks (no contract required)", () => {
    it("should not analyze Java class service tasks", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task6",
        astNodeId: "task6",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task6", { "camunda:class": "com.example.MyDelegate" });

      const context = createContext("camunda-7", "2", [serviceTask], annotations);
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.contractCoverage).toHaveLength(0);
      expect(result.findings).toHaveLength(0);
    });

    it("should not analyze delegateExpression service tasks", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task7",
        astNodeId: "task7",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task7", { "camunda:delegateExpression": "${myDelegate}" });

      const context = createContext("camunda-7", "2", [serviceTask], annotations);
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.contractCoverage).toHaveLength(0);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("CIB Seven adapters", () => {
    it("should detect missing contract for adapter", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task8",
        astNodeId: "task8",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task8", { "cib:adapterType": "http-adapter" });

      const context = createContext("cib-seven", "2", [serviceTask], annotations);
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.contractCoverage).toHaveLength(1);
      expect(result.contractCoverage![0].implementationType).toBe("adapter");
    });
  });

  describe("Rule toggles", () => {
    it("should respect MISSING_CONTRACT rule toggle when disabled", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task9",
        astNodeId: "task9",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task9", { "camunda:type": "external" });

      const policy: PolicySnapshot = {
        id: "test-policy",
        version: "1.0",
        governanceTier: "2",
        ruleToggles: {
          MISSING_CONTRACT: false,
        },
      };

      const runtimeProfile: RuntimeProfileSnapshot = {
        id: "camunda-7",
        version: "1.0",
        capabilities: {},
      };

      const compilerContext: CompilerContext = {
        modelId: "test-model",
        governanceTier: "2",
        policy,
        runtimeProfile,
        metadata: {
          timestamp: new Date().toISOString(),
        },
      };

      const nodes = new Map<string, IrNode>();
      nodes.set("task9", serviceTask);

      const ir: IrGraph = {
        nodes,
        edges: [],
        annotations,
        state: "complete",
      };

      const context: PassContext = { compilerContext, ir, findings: [], annotate: () => {} };
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.contractCoverage).toHaveLength(1);
      expect(result.findings).toHaveLength(0); // Finding suppressed by toggle
    });
  });

  describe("Multiple service tasks", () => {
    it("should analyze multiple external tasks", () => {
      const task1: FlowNodeIr = {
        kind: "flowNode",
        id: "task1",
        astNodeId: "task1",
        flowType: "serviceTask",
      };

      const task2: FlowNodeIr = {
        kind: "flowNode",
        id: "task2",
        astNodeId: "task2",
        flowType: "serviceTask",
      };

      const task3: FlowNodeIr = {
        kind: "flowNode",
        id: "task3",
        astNodeId: "task3",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task1", { "camunda:type": "external" });
      annotations.set("task2", { "camunda:connectorId": "http" });
      annotations.set("task3", { "camunda:class": "MyDelegate" }); // Internal - skip

      const context = createContext("camunda-7", "2", [task1, task2, task3], annotations);
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.contractCoverage).toHaveLength(2); // Only task1 and task2
      expect(result.findings).toHaveLength(2);
    });
  });

  describe("Pass metadata", () => {
    it("should expose correct pass metadata", () => {
      const analyzer = new ContractCoverageAnalyzer();

      expect(analyzer.id).toBe("contract-coverage-analyzer");
      expect(analyzer.phase).toBe("L2");
      expect(analyzer.requires).toEqual(["structural-validation"]);
    });
  });

  describe("Non-service-task filtering", () => {
    it("should ignore non-service-task nodes", () => {
      const userTask: FlowNodeIr = {
        kind: "flowNode",
        id: "user1",
        astNodeId: "user1",
        flowType: "userTask",
      };

      const gateway: FlowNodeIr = {
        kind: "flowNode",
        id: "gw1",
        astNodeId: "gw1",
        flowType: "exclusiveGateway",
      };

      const context = createContext("camunda-7", "2", [userTask, gateway], new Map());
      const analyzer = new ContractCoverageAnalyzer();
      const result = analyzer.run(context);

      expect(result.contractCoverage).toHaveLength(0);
      expect(result.findings).toHaveLength(0);
    });
  });
});
