// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { DeterminismEntry, Finding } from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";
import { determinismClassifier } from "./DeterminismClassifier.js";

/**
 * Gateway Condition Analyzer
 *
 * Extracts conditions from sequence flows originating from gateways and
 * performs determinism classification based on expression patterns.
 *
 * Responsibilities:
 * - Extract <conditionExpression> from sequence flows
 * - Detect expression language (JUEL, FEEL, MVEL) via patterns or xsi:type
 * - Perform language-agnostic pattern matching
 * - Emit DeterminismEntry for each condition evaluation point
 * - Emit findings when policy restricts non-deterministic patterns
 */
export class GatewayConditionAnalyzer implements SemanticPass {
  readonly id = "gateway-condition-analysis";
  readonly phase = "L2" as const;
  readonly requires = ["structural-validation"] as const;

  run(context: PassContext): PassOutput {
    const determinism: DeterminismEntry[] = [];
    const findings: Finding[] = [];

    // Extract gateway nodes
    const gateways = Array.from(context.ir.nodes.values()).filter(
      (node) =>
        node.kind === "flowNode" &&
        (node.flowType.includes("Gateway") || node.flowType.includes("gateway")),
    );

    if (gateways.length === 0) {
      return { determinism, findings };
    }

    // Analyze conditions for each gateway
    for (const gateway of gateways) {
      const annotation = context.ir.annotations.get(gateway.id) ?? {};

      // Extract sequence flow conditions from annotations
      // (In real implementation, this would come from parser metadata)
      const conditions = this.extractConditions(gateway, annotation);

      for (const condition of conditions) {
        const classification = determinismClassifier.classify({
          elementType: gateway.kind === "flowNode" ? gateway.flowType : "exclusiveGateway",
          expression: condition.expression,
          expressionLanguage: condition.language,
          profileId: context.compilerContext.runtimeProfile?.id,
          policyTier: this.parseTier(context.compilerContext.governanceTier),
        });

        determinism.push({
          evaluationPointId: condition.nodeId,
          axisY: classification.axisY,
          axisX: classification.axisX,
          confidence: classification.confidence,
          policyClause: classification.policyClause ?? "determinism.gatewayConditions",
          runtimeProfileSection: context.compilerContext.runtimeProfile
            ? "gatewayConditions"
            : undefined,
          ruleId: this.id,
        });

        // Emit finding if policy restricts this pattern
        if (
          determinismClassifier.shouldRestrict(classification, {
            elementType: gateway.kind === "flowNode" ? gateway.flowType : "exclusiveGateway",
            expression: condition.expression,
            expressionLanguage: condition.language,
            profileId: context.compilerContext.runtimeProfile?.id,
            policyTier: this.parseTier(context.compilerContext.governanceTier),
          })
        ) {
          findings.push(
            finalizeFinding({
              category: "semantic",
              severity:
                this.parseTier(context.compilerContext.governanceTier) >= 3 ? "error" : "warning",
              message: `Gateway condition uses non-deterministic pattern: ${classification.reasoning}`,
              ruleId: this.id,
              targetId: condition.nodeId,
              policyClause: classification.policyClause,
            }),
          );
        }
      }
    }

    return { determinism, findings };
  }

  /**
   * Extract condition expressions from gateway annotations
   *
   * TODO: Enhance parser to populate this metadata directly
   */
  private extractConditions(
    gateway: { id: string },
    annotation: Record<string, unknown>,
  ): Array<{
    nodeId: string;
    expression: string;
    language: "feel" | "juel" | "mvel" | "unknown";
  }> {
    const conditions: Array<{
      nodeId: string;
      expression: string;
      language: "feel" | "juel" | "mvel" | "unknown";
    }> = [];

    // Check annotation for condition metadata (mock for MVP)
    const conditionExpression = annotation.conditionExpression as string | undefined;
    if (conditionExpression) {
      conditions.push({
        nodeId: gateway.id,
        expression: conditionExpression,
        language: this.detectLanguage(conditionExpression),
      });
    }

    // TODO: Parse actual sequence flows from BPMN XML
    // This would require enhancing BpmnParser to extract <sequenceFlow><conditionExpression>

    return conditions;
  }

  /**
   * Detect expression language from text patterns
   */
  private detectLanguage(expression: string): "feel" | "juel" | "mvel" | "unknown" {
    // JUEL: starts with ${ and ends with }
    if (/^\$\{.*\}$/.test(expression.trim())) {
      return "juel";
    }

    // FEEL: no curly braces, uses FEEL keywords/syntax
    if (
      /\b(in|some|every|for|return|if|then|else|function)\b/.test(expression) ||
      /[<>=!]=/.test(expression)
    ) {
      return "feel";
    }

    // MVEL: similar to Java, may use : or [] indexing
    if (/[\w]+\[.*\]|[\w]+:[\w]+/.test(expression)) {
      return "mvel";
    }

    return "unknown";
  }

  /**
   * Parse governance tier string to number
   */
  private parseTier(tier: string): number {
    const match = tier.match(/(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : 1;
  }
}
