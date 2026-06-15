// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type {
  AxisXClass,
  BusinessRuleTaskDescriptor,
  DmnDecisionDescriptor,
  Finding,
  FlowNodeIr,
} from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

/**
 * Business Rule Task Analyzer (Sprint 4)
 *
 * Resolves BPMN business rule task → DMN decision references and propagates determinism.
 *
 * Responsibilities:
 * - Resolve decision references (decisionRef attribute or zeebe:calledDecision)
 * - Propagate determinism from DMN decision to BPMN task
 * - Classify Axis X coupling (embedded vs external DMN)
 * - Populate BusinessRuleTaskDescriptor
 * - Emit findings for missing or unresolved decision references
 */
export class BusinessRuleTaskAnalyzer implements SemanticPass {
  readonly id = "business-rule-task-analyzer";
  readonly phase = "L2" as const;
  readonly requires = ["dmn-rule-aggregator", "ir-builder"] as const;

  run(context: PassContext): PassOutput {
    const descriptors: BusinessRuleTaskDescriptor[] = [];
    const findings: Finding[] = [];

    const tier = this.parseGovernanceTier(context.compilerContext.governanceTier);
    const profileId = context.compilerContext.runtimeProfile?.id;

    // Get DMN decision descriptors from previous pass
    const dmnDecisionDescriptors = (context as { dmnDecisionDescriptors?: DmnDecisionDescriptor[] })
      .dmnDecisionDescriptors as DmnDecisionDescriptor[] | undefined;

    const decisionMap = new Map<string, DmnDecisionDescriptor>();
    if (dmnDecisionDescriptors) {
      for (const descriptor of dmnDecisionDescriptors) {
        decisionMap.set(descriptor.decisionId, descriptor);
      }
    }

    // Iterate over all BPMN flow nodes looking for business rule tasks
    for (const node of context.ir.nodes.values()) {
      if (node.kind !== "flowNode") continue;

      const flowNode = node as FlowNodeIr;
      if (flowNode.flowType !== "businessRuleTask") continue;

      const annotations = context.ir.annotations.get(flowNode.id) ?? {};

      // Extract decision reference (Camunda 7: camunda:decisionRef, Camunda 8: zeebe:calledDecision)
      const decisionRef = this.extractDecisionRef(annotations, profileId);

      if (!decisionRef) {
        // Missing decisionRef attribute
        if (tier >= 2) {
          findings.push(
            finalizeFinding({
              category: "semantic",
              severity: "error",
              message: `Business rule task ${flowNode.id} is missing decisionRef attribute`,
              targetId: flowNode.id,
              ruleId: this.id,
              policyClause: "business-rule-task-reference",
            }),
          );
        }

        descriptors.push({
          taskId: flowNode.id,
          decisionRef: "",
          implementationType: "unknown",
          determinism: "unknown",
          coupling: "unknown",
          resolved: false,
        });
        continue;
      }

      // Resolve decision reference
      const dmnDecision = decisionMap.get(decisionRef);

      if (!dmnDecision) {
        // Unresolved decision reference
        if (tier >= 2) {
          findings.push(
            finalizeFinding({
              category: "semantic",
              severity: "error",
              message: `Business rule task ${flowNode.id} references decision '${decisionRef}' which was not found`,
              targetId: flowNode.id,
              ruleId: this.id,
              policyClause: "business-rule-task-resolution",
            }),
          );
        }

        descriptors.push({
          taskId: flowNode.id,
          decisionRef,
          implementationType: "dmn",
          determinism: "unknown",
          coupling: "unknown",
          resolved: false,
        });
        continue;
      }

      // Successfully resolved - propagate determinism from DMN decision
      const determinism = dmnDecision.decisionDeterminism;
      const coupling = this.classifyCoupling(annotations, profileId);

      descriptors.push({
        taskId: flowNode.id,
        decisionRef,
        decisionName: dmnDecision.decisionName,
        implementationType: "dmn",
        determinism,
        coupling,
        resolved: true,
      });

      // Propagate DMN findings if decision has time-dependent or runtime-bound expressions
      if ((determinism === "policyDependent" || determinism === "runtimeBound") && tier >= 2) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "info",
            message: `Business rule task ${flowNode.id} references decision '${decisionRef}' with ${determinism} determinism`,
            targetId: flowNode.id,
            ruleId: this.id,
            policyClause: "business-rule-task-determinism",
          }),
        );
      }
    }

    return {
      businessRuleTaskDescriptors: descriptors,
      findings,
    };
  }

  /**
   * Extract decision reference from task annotations
   * Supports Camunda 7 (camunda:decisionRef), Camunda 8 (zeebe:calledDecision), and generic BPMN 2.0 (decisionRef)
   */
  private extractDecisionRef(
    annotations: Record<string, unknown>,
    _profileId?: string,
  ): string | null {
    // Camunda 7: camunda:decisionRef attribute
    if (annotations["camunda:decisionRef"]) {
      return annotations["camunda:decisionRef"] as string;
    }

    // Camunda 8: zeebe:calledDecision extension element
    if (annotations["zeebe:calledDecision"]) {
      const calledDecision = annotations["zeebe:calledDecision"];
      if (typeof calledDecision === "object" && calledDecision !== null) {
        return (calledDecision as { decisionId?: string }).decisionId as string;
      }
      return calledDecision as string;
    }

    // Generic BPMN 2.0: decisionRef attribute
    if (annotations["decisionRef"]) {
      return annotations["decisionRef"] as string;
    }

    return null;
  }

  /**
   * Classify Axis X coupling for business rule task
   *
   * Sprint 4 logic:
   * - DMN embedded in process (same BPMN file) → processScoped
   * - DMN referenced externally (separate .dmn file) → profileScoped
   * - DMN uses engine-specific extensions → engineSpecific
   */
  private classifyCoupling(annotations: Record<string, unknown>, _profileId?: string): AxisXClass {
    // Camunda 7: if camunda:decisionRef is used, it's profile-scoped (external DMN repository)
    if (annotations["camunda:decisionRef"]) {
      return "profileScoped";
    }

    // Camunda 8: if zeebe:calledDecision is used, it's profile-scoped (Zeebe decision deployment)
    if (annotations["zeebe:calledDecision"]) {
      return "profileScoped";
    }

    // Generic BPMN 2.0: if decisionRef is used without engine-specific attributes, it's engine-agnostic
    if (annotations["decisionRef"]) {
      return "engineAgnostic";
    }

    return "unknown";
  }

  /**
   * Parse governance tier string to number
   */
  private parseGovernanceTier(tier: string): number {
    const match = tier.match(/\d+/);
    return match ? parseInt(match[0], 10) : 1;
  }
}
