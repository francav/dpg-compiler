// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { DeterminismEntry, RuntimeDependencyEntry } from "../types.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";
import { DeterminismClassifier, type ClassificationContext } from "./DeterminismClassifier.js";

/**
 * Flow types owned by other determinism producers. FlowElementClassifier never
 * emits for these to avoid double-counting:
 * - serviceTask        → ServiceTaskClassifier
 * - scriptTask         → ScriptDeterminismClassifier
 * - businessRuleTask   → IrBuilder eval point + SemanticDeterminismPass
 * - *Gateway           → GatewaySemanticAnalyzer / GatewayConditionAnalyzer
 */
const OWNED_BY_OTHER_PASSES = new Set<string>(["serviceTask", "scriptTask", "businessRuleTask"]);

/**
 * Structural / connector flow types that carry no execution semantics of their own.
 * They are not evaluation points, so they are skipped (not classified as `unknown`).
 */
const NON_EXECUTION_TYPES = new Set<string>([
  "sequenceFlow",
  "messageFlow",
  "association",
  "dataObject",
  "dataObjectReference",
  "dataStoreReference",
  "textAnnotation",
  "group",
  "laneSet",
  "lane",
  "extensionElements",
  "documentation",
  "ioSpecification",
]);

/**
 * FlowElementClassifier
 *
 * Classifies every *execution-bearing* BPMN flow element that no other pass owns,
 * routing each through {@link DeterminismClassifier} so it lands in the
 * `determinismMap` with a principled Axis-Y / Axis-X verdict and a rationale.
 *
 * **Phase:** L2
 * **Dependencies:** structural-validation
 *
 * **Owned types:** userTask/humanTask, manualTask, receiveTask, sendTask,
 * timer/message/other events (start/end/intermediate/boundary), callActivity,
 * subProcess, and the abstract `task`. Types owned by other passes
 * (serviceTask/scriptTask/businessRuleTask/gateways) are skipped, as are
 * non-execution structural nodes (sequenceFlow, dataObject, ...).
 *
 * Nothing execution-bearing is silently dropped: a type with no principled verdict
 * is emitted as an explicit `unknown` entry with a rationale.
 */
export class FlowElementClassifier implements SemanticPass {
  readonly id = "flow-element-classifier";
  readonly phase = "L2" as const;
  readonly requires = ["structural-validation"] as const;

  private readonly classifier = new DeterminismClassifier();

  run(context: PassContext): PassOutput {
    const determinism: DeterminismEntry[] = [];
    const runtimeDependencyMap: RuntimeDependencyEntry[] = [];

    const profileId = context.compilerContext.runtimeProfile?.id;
    const tierMatch = context.compilerContext.governanceTier.match(/\d+/);
    const policyTier = tierMatch ? parseInt(tierMatch[0], 10) : 1;

    for (const node of context.ir.nodes.values()) {
      if (node.kind !== "flowNode") {
        continue;
      }
      const flowType = node.flowType.replace("bpmn:", "");

      if (OWNED_BY_OTHER_PASSES.has(flowType) || flowType.endsWith("Gateway")) {
        continue;
      }
      if (NON_EXECUTION_TYPES.has(flowType)) {
        continue;
      }

      const attributes = (context.ir.annotations.get(node.id) ?? {}) as Record<string, unknown>;
      const eventDefinition =
        typeof attributes["eventDefinition"] === "string"
          ? (attributes["eventDefinition"] as string)
          : undefined;
      const formConstrained = this.isFormConstrained(attributes);

      const classificationContext: ClassificationContext = {
        elementType: flowType,
        profileId,
        policyTier,
        eventDefinition,
        formConstrained,
      };

      const result = this.classifier.classify(classificationContext);

      determinism.push({
        evaluationPointId: node.id,
        axisY: result.axisY,
        axisX: result.axisX,
        confidence: result.confidence,
        policyClause: result.policyClause ?? "determinism.default",
        runtimeProfileSection: profileId ? "root" : undefined,
        ruleId: "FLOW_ELEMENT_DETERMINISM",
        rationale: result.reasoning,
      });

      runtimeDependencyMap.push({
        evaluationPointId: node.id,
        dependency: flowType,
        profileCoverage: profileId ? "documented" : "missingProfile",
        policyClause: result.policyClause ?? "determinism.default",
        ruleId: "FLOW_ELEMENT_CLASSIFICATION",
      });
    }

    return { determinism, runtimeDependencyMap };
  }

  /**
   * A user task is "constrained" when its output is bound to a form / closed value
   * set (Camunda 7 `camunda:formKey`/`camunda:formRef`, Camunda 8
   * `zeebe:formDefinition`). Absent → unconstrained (human is an uncontrolled input).
   */
  private isFormConstrained(attributes: Record<string, unknown>): boolean {
    return (
      typeof attributes["camunda:formKey"] === "string" ||
      typeof attributes["camunda:formRef"] === "string" ||
      typeof attributes["zeebe:formDefinition"] === "string"
    );
  }
}
