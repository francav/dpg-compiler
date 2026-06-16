// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type {
  DeterminismEntry,
  Finding,
  RuntimeDependencyEntry,
  ContractCoverageEntry,
} from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

/**
 * Service task implementation classification
 */
export interface ServiceTaskImplementation {
  readonly type:
    | "javaClass"
    | "delegateExpression"
    | "externalTask"
    | "jobWorker"
    | "connector"
    | "adapter"
    | "workItemHandler"
    | "unknown";
  readonly axisX: DeterminismEntry["axisX"];
  readonly requiresContract: boolean;
}

/**
 * Profile-specific service task classification rules
 */
const CLASSIFICATION_RULES: Record<string, Record<string, ServiceTaskImplementation>> = {
  "camunda-7": {
    "camunda:class": {
      type: "javaClass",
      axisX: "engineSpecific",
      requiresContract: false,
    },
    "camunda:delegateExpression": {
      type: "delegateExpression",
      axisX: "engineSpecific",
      requiresContract: false,
    },
    "camunda:type=external": {
      type: "externalTask",
      axisX: "externalized",
      requiresContract: true,
    },
    "camunda:connectorId": {
      type: "connector",
      axisX: "profileScoped",
      requiresContract: true,
    },
  },
  "camunda-8": {
    "zeebe:taskDefinition": {
      type: "jobWorker",
      axisX: "externalized",
      requiresContract: true,
    },
  },
  "cib-seven": {
    "cib:adapterType": {
      type: "adapter",
      axisX: "profileScoped",
      requiresContract: true,
    },
  },
  jbpm: {
    ioSpecification: {
      type: "workItemHandler",
      axisX: "engineSpecific",
      requiresContract: false,
    },
  },
};

/**
 * ServiceTaskClassifier
 *
 * Classifies service task implementation type and Axis X coupling.
 * Identifies integration boundaries requiring contract coverage.
 *
 * **Phase:** L2 (semantic-determinism)
 * **Dependencies:** structural-validation
 *
 * **Responsibilities:**
 * - Extract service task implementation attributes from IR annotations
 * - Classify Axis X coupling (engineSpecific, externalized, profileScoped)
 * - Emit RuntimeDependencyEntry for each service task
 * - Emit DeterminismEntry (Axis Y depends on implementation, Axis X from classification)
 * - Mark external boundaries for contract coverage analysis
 *
 * **Profile Support (MVP):**
 * - ✅ Camunda 7: `camunda:class`, `camunda:delegateExpression`, `camunda:type="external"`, `camunda:connectorId`
 * - ✅ Camunda 8: `zeebe:taskDefinition`
 * - ⏳ CIB Seven: `cib:adapterType` (partial)
 * - ⏳ jBPM: `ioSpecification` (detection only)
 */
export class ServiceTaskClassifier implements SemanticPass {
  readonly id = "service-task-classifier";
  readonly phase = "L2" as const;
  readonly requires = ["structural-validation"] as const;

  run(context: PassContext): PassOutput {
    const findings: Finding[] = [];
    const determinism: DeterminismEntry[] = [];
    const runtimeDependencyMap: RuntimeDependencyEntry[] = [];
    const contractCoverage: ContractCoverageEntry[] = [];

    const profileId = context.compilerContext.runtimeProfile?.id ?? "unknown";
    const tierMatch = context.compilerContext.governanceTier.match(/\d+/);
    const policyTier = tierMatch ? parseInt(tierMatch[0], 10) : 1;

    // Extract service task nodes
    const serviceTasks = Array.from(context.ir.nodes.values()).filter(
      (node) =>
        node.kind === "flowNode" &&
        (node.flowType === "serviceTask" || node.flowType === "bpmn:serviceTask"),
    );

    for (const serviceTask of serviceTasks) {
      const attributes = (context.ir.annotations.get(serviceTask.id) ?? {}) as Record<
        string,
        string
      >;

      const classification = this.classifyServiceTask(attributes, profileId);

      // Emit runtime dependency entry
      runtimeDependencyMap.push({
        evaluationPointId: serviceTask.id,
        dependency: classification.type,
        profileCoverage: profileId !== "unknown" ? "documented" : "missingProfile",
        policyClause: "runtime-coupling",
        ruleId: "SERVICE_TASK_CLASSIFICATION",
      });

      // Emit determinism entry (service tasks are generally non-deterministic unless pure computation)
      const axisY: DeterminismEntry["axisY"] =
        classification.type === "unknown" ? "unknown" : "nonDeterministic";

      determinism.push({
        evaluationPointId: serviceTask.id,
        axisY,
        axisX: classification.axisX,
        confidence: classification.type === "unknown" ? 0.5 : 0.9,
        policyClause: "service-task-determinism",
        ruleId: "SERVICE_TASK_DETERMINISM",
        rationale:
          classification.type === "unknown"
            ? "Service task implementation is unrecognised; determinism cannot be established"
            : `Service task delegates to an external implementation (${classification.type}); side-effect not a function of declared inputs`,
      });

      // Emit warning if implementation type unknown and policy tier >= 2
      if (classification.type === "unknown" && policyTier >= 2) {
        const ruleEnabled =
          context.compilerContext.policy.ruleToggles["SERVICE_TASK_IMPLEMENTATION_UNKNOWN"] ?? true;
        if (ruleEnabled) {
          findings.push(
            finalizeFinding({
              category: "semantic",
              severity: "warning",
              message: `Service task '${serviceTask.id}' has no recognizable implementation attributes`,
              targetId: serviceTask.id,
              ruleId: "SERVICE_TASK_IMPLEMENTATION_UNKNOWN",
              confidence: 0.8,
              policyClause: "service-task-implementation",
              remediation:
                "Add implementation attributes (e.g., camunda:class, zeebe:taskDefinition)",
            }),
          );
        }
      }

      // Emit info finding for non-MVP engines (CIB, jBPM)
      if (
        (profileId === "cib-seven" || profileId === "jbpm") &&
        classification.type !== "unknown"
      ) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "info",
            message: `Service task '${serviceTask.id}' implementation detected (${classification.type}), but full validation is post-MVP`,
            targetId: serviceTask.id,
            ruleId: "SERVICE_TASK_PARTIAL_SUPPORT",
            confidence: 0.7,
            policyClause: "service-task-implementation",
          }),
        );
      }
    }

    return {
      findings,
      determinism,
      runtimeDependencyMap,
      contractCoverage,
    };
  }

  /**
   * Classify service task implementation based on attributes and runtime profile
   */
  private classifyServiceTask(
    attributes: Record<string, string>,
    profileId: string,
  ): ServiceTaskImplementation {
    const rules = CLASSIFICATION_RULES[profileId];

    if (!rules) {
      return {
        type: "unknown",
        axisX: "unknown",
        requiresContract: false,
      };
    }

    // Check for Camunda 7 external task (special case: attribute value matters)
    const externalRule = rules["camunda:type=external"];
    if (attributes["camunda:type"] === "external" && externalRule) {
      return externalRule;
    }

    // Check other attributes
    for (const [attributeKey, implementation] of Object.entries(rules)) {
      if (attributeKey.includes("=")) {
        continue; // Skip value-based rules (handled above)
      }
      if (attributes[attributeKey]) {
        return implementation;
      }
    }

    return {
      type: "unknown",
      axisX: "unknown",
      requiresContract: false,
    };
  }
}
