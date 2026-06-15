// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { ServiceTaskClassifier } from "./ServiceTaskClassifier.js";
import type {
  CompilerContext,
  FlowNodeIr,
  IrGraph,
  IrNode,
  PolicySnapshot,
  RuntimeProfileSnapshot,
} from "../types.js";
import type { PassContext } from "./SemanticPass.js";

describe("ServiceTaskClassifier", () => {
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

    return {
      compilerContext,
      ir,
      findings: [],
      annotate: () => {},
    };
  };

  describe("Camunda 7 service tasks", () => {
    it("should classify Java class service task as engineSpecific", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task1",
        astNodeId: "task1",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task1", {
        "camunda:class": "com.example.MyDelegate",
      });

      const context = createContext("camunda-7", "2", [serviceTask], annotations);
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.determinism).toHaveLength(1);
      expect(result.determinism![0].axisX).toBe("engineSpecific");
      expect(result.determinism![0].axisY).toBe("nonDeterministic");

      expect(result.runtimeDependencyMap).toHaveLength(1);
      expect(result.runtimeDependencyMap![0].dependency).toBe("javaClass");

      // Contract coverage is now handled by ContractCoverageAnalyzer
    });

    it("should classify external task as externalized and require contract", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task2",
        astNodeId: "task2",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task2", {
        "camunda:type": "external",
        "camunda:topic": "payment-processing",
      });

      const context = createContext("camunda-7", "2", [serviceTask], annotations);
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.determinism![0].axisX).toBe("externalized");
      expect(result.runtimeDependencyMap![0].dependency).toBe("externalTask");

      // Contract coverage is now handled by ContractCoverageAnalyzer
    });

    it("should classify connector as profileScoped and require contract", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task3",
        astNodeId: "task3",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task3", {
        "camunda:connectorId": "http-connector",
      });

      const context = createContext("camunda-7", "2", [serviceTask], annotations);
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.determinism![0].axisX).toBe("profileScoped");
      expect(result.runtimeDependencyMap![0].dependency).toBe("connector");

      // Contract coverage is now handled by ContractCoverageAnalyzer
    });

    it("should classify delegateExpression as engineSpecific", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task4",
        astNodeId: "task4",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task4", {
        "camunda:delegateExpression": "${myDelegate}",
      });

      const context = createContext("camunda-7", "2", [serviceTask], annotations);
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.determinism![0].axisX).toBe("engineSpecific");
      expect(result.runtimeDependencyMap![0].dependency).toBe("delegateExpression");

      // Contract coverage is now handled by ContractCoverageAnalyzer
    });
  });

  describe("Camunda 8 service tasks", () => {
    it("should classify job worker as externalized and require contract", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task5",
        astNodeId: "task5",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task5", {
        "zeebe:taskDefinition": "payment-worker",
      });

      const context = createContext("camunda-8", "2", [serviceTask], annotations);
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.determinism![0].axisX).toBe("externalized");
      expect(result.runtimeDependencyMap![0].dependency).toBe("jobWorker");

      // Contract coverage is now handled by ContractCoverageAnalyzer
    });
  });

  describe("Unknown implementation", () => {
    it("should emit warning for service task with no implementation (tier 2)", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task6",
        astNodeId: "task6",
        flowType: "serviceTask",
      };

      const context = createContext("camunda-7", "2", [serviceTask], new Map());
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.determinism![0].axisX).toBe("unknown");
      expect(result.determinism![0].axisY).toBe("unknown");
      expect(result.findings).toHaveLength(1);
      expect(result.findings![0].severity).toBe("warning");
      expect(result.findings![0].ruleId).toBe("SERVICE_TASK_IMPLEMENTATION_UNKNOWN");
    });

    it("should not emit warning for tier 1 (info only)", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task7",
        astNodeId: "task7",
        flowType: "serviceTask",
      };

      const context = createContext("camunda-7", "1", [serviceTask], new Map());
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.findings).toHaveLength(0);
    });
  });

  describe("Non-MVP engines", () => {
    it("should emit info finding for CIB Seven adapter", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task8",
        astNodeId: "task8",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task8", {
        "cib:adapterType": "http-adapter",
      });

      const context = createContext("cib-seven", "2", [serviceTask], annotations);
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.findings).toHaveLength(1);
      expect(result.findings![0].severity).toBe("info");
      expect(result.findings![0].ruleId).toBe("SERVICE_TASK_PARTIAL_SUPPORT");
    });

    it("should emit info finding for jBPM work item handler", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task9",
        astNodeId: "task9",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task9", {
        ioSpecification: "true",
      });

      const context = createContext("jbpm", "2", [serviceTask], annotations);
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.findings).toHaveLength(1);
      expect(result.findings![0].severity).toBe("info");
    });
  });

  describe("Unknown profile", () => {
    it("should classify all tasks as unknown when profile missing", () => {
      const serviceTask: FlowNodeIr = {
        kind: "flowNode",
        id: "task10",
        astNodeId: "task10",
        flowType: "serviceTask",
      };

      const annotations = new Map<string, Record<string, string>>();
      annotations.set("task10", {
        "camunda:class": "com.example.MyDelegate",
      });

      const context = createContext("unknown", "2", [serviceTask], annotations);
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.determinism![0].axisX).toBe("unknown");
      expect(result.runtimeDependencyMap![0].profileCoverage).toBe("missingProfile");
    });
  });

  describe("Pass metadata", () => {
    it("should expose correct pass metadata", () => {
      const classifier = new ServiceTaskClassifier();

      expect(classifier.id).toBe("service-task-classifier");
      expect(classifier.phase).toBe("L2");
      expect(classifier.requires).toEqual(["structural-validation"]);
    });
  });

  describe("Multiple service tasks", () => {
    it("should classify multiple service tasks correctly", () => {
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
      annotations.set("task1", { "camunda:class": "com.example.Delegate" });
      annotations.set("task2", { "camunda:type": "external" });
      annotations.set("task3", { "camunda:connectorId": "http" });

      const context = createContext("camunda-7", "2", [task1, task2, task3], annotations);
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.determinism).toHaveLength(3);
      expect(result.runtimeDependencyMap).toHaveLength(3);

      // Contract coverage is now handled by ContractCoverageAnalyzer
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
      const classifier = new ServiceTaskClassifier();
      const result = classifier.run(context);

      expect(result.determinism).toHaveLength(0);
      expect(result.runtimeDependencyMap).toHaveLength(0);

      // Contract coverage is now handled by ContractCoverageAnalyzer
    });
  });
});
