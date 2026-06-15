// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type {
  AxisYClass,
  DecisionNode,
  DecisionRuleNode,
  DmnExpressionDescriptor,
  Finding,
} from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

/**
 * DMN Expression Classifier (Sprint 4)
 *
 * Classifies FEEL expressions in DMN input/output clauses using Axis Y determinism.
 *
 * Responsibilities:
 * - Detect expression language (DMN 1.3 default is FEEL)
 * - Classify Axis Y determinism for FEEL expressions
 * - Detect function usage (FEEL time functions, BKM invocations, etc.)
 * - Populate DmnExpressionDescriptor entries
 * - Emit findings when expression language is unsupported by runtime profile
 */
export class DmnExpressionClassifier implements SemanticPass {
  readonly id = "dmn-expression-classifier";
  readonly phase = "L2" as const;
  readonly requires = ["ir-builder"] as const;

  // FEEL time-dependent functions (Sprint 4 MVP catalog)
  private readonly feelTimeFunctions = [
    "now()",
    "today()",
    "current date()",
    "current time()",
    "current date and time()",
    "day of week(",
    "month(",
    "year(",
    "time(",
    "date(",
    "date and time(",
  ];

  // FEEL pure functions (Sprint 4 MVP catalog)
  private readonly feelPureFunctions = [
    "sum(",
    "count(",
    "min(",
    "max(",
    "mean()",
    "string(",
    "number(",
    "substring(",
    "contains(",
    "list contains(",
    "get entries(",
    "get value(",
  ];

  // FEEL external call indicators (Sprint 4 MVP catalog)
  private readonly feelExternalIndicators = [
    "->", // BKM invocation operator (FEEL 1.2+)
    "invoke(", // Explicit BKM call
    "external(", // Hypothetical external function marker
  ];

  run(context: PassContext): PassOutput {
    const descriptors: DmnExpressionDescriptor[] = [];
    const findings: Finding[] = [];

    const profileId = context.compilerContext.runtimeProfile?.id;
    const tier = this.parseGovernanceTier(context.compilerContext.governanceTier);

    // Iterate over all decision nodes
    for (const node of context.ir.nodes.values()) {
      if (node.kind !== "decision") continue;

      const decisionNode = node as DecisionNode;
      const decisionAnnotations = context.ir.annotations.get(decisionNode.id) ?? {};
      const inputs =
        (decisionAnnotations.inputs as { expression?: string; typeRef?: string }[] | undefined) ??
        [];
      const outputs = (decisionAnnotations.outputs as { typeRef?: string }[] | undefined) ?? [];
      const expressionLanguage =
        (decisionAnnotations.expressionLanguage as string) ??
        this.getDefaultExpressionLanguage(profileId);

      // Validate expression language for Camunda 8 (FEEL-only constraint)
      if (profileId === "camunda-8" && expressionLanguage !== "feel") {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: tier >= 2 ? "error" : "warning",
            message: `Decision ${decisionNode.id} uses ${expressionLanguage}, but Camunda 8 only supports FEEL`,
            targetId: decisionNode.id,
            ruleId: this.id,
            policyClause: "dmn-expression-language",
          }),
        );
      }

      // Process input expressions
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i] as { expression?: string; typeRef?: string };
        const expression = input.expression || "";
        const typeRef = input.typeRef;

        const determinism = this.classifyDeterminism(expression, expressionLanguage);
        const functionsUsed = this.detectFunctions(expression, expressionLanguage);

        descriptors.push({
          id: `${decisionNode.id}:input:${i}`,
          decisionId: decisionNode.id,
          expressionType: "input",
          language: expressionLanguage as DmnExpressionDescriptor["language"],
          content: expression,
          typeRef,
          determinism,
          functionsUsed,
        });

        // Emit findings for time-dependent or external functions
        if (determinism === "policyDependent" && tier >= 2) {
          findings.push(
            finalizeFinding({
              category: "semantic",
              severity: "warning",
              message: `Input expression in decision ${decisionNode.id} uses time-dependent function: ${functionsUsed.join(", ")}`,
              targetId: decisionNode.id,
              ruleId: this.id,
              policyClause: "dmn-time-dependency",
            }),
          );
        }

        if (determinism === "runtimeBound" && tier >= 2) {
          findings.push(
            finalizeFinding({
              category: "semantic",
              severity: "warning",
              message: `Input expression in decision ${decisionNode.id} contains external call: ${functionsUsed.join(", ")}`,
              targetId: decisionNode.id,
              ruleId: this.id,
              policyClause: "dmn-external-dependency",
            }),
          );
        }
      }

      // Process decision rules for output expressions
      const ruleNodes = Array.from(context.ir.nodes.values()).filter(
        (n) => n.kind === "decisionRule" && n.id.startsWith(decisionNode.id + ":rule:"),
      ) as DecisionRuleNode[];

      for (const ruleNode of ruleNodes) {
        const ruleAnnotations = context.ir.annotations.get(ruleNode.id) ?? {};
        const conclusions = (ruleAnnotations.conclusions as string[]) ?? [];

        conclusions.forEach((expression, i) => {
          const determinism = this.classifyDeterminism(expression, expressionLanguage);
          const functionsUsed = this.detectFunctions(expression, expressionLanguage);

          descriptors.push({
            id: `${ruleNode.id}:output:${i}`,
            decisionId: decisionNode.id,
            ruleId: ruleNode.id,
            expressionType: "output",
            language: expressionLanguage as DmnExpressionDescriptor["language"],
            content: expression,
            typeRef: outputs[i]?.typeRef,
            determinism,
            functionsUsed,
          });
        });
      }
    }

    return {
      dmnExpressionDescriptors: descriptors,
      findings,
    };
  }

  /**
   * Classify Axis Y determinism for FEEL expressions
   */
  private classifyDeterminism(expression: string, language: string): AxisYClass {
    if (language !== "feel") {
      // Non-FEEL expressions default to unknown (out of scope for Sprint 4 MVP)
      return "unknown";
    }

    // Check for time-dependent functions
    if (this.hasTimeDependency(expression)) {
      return "policyDependent";
    }

    // Check for external calls (BKM invocations, custom functions)
    if (this.hasExternalCall(expression)) {
      return "runtimeBound";
    }

    // Default: pure computation
    return "deterministic";
  }

  /**
   * Detect time-dependent patterns in FEEL expressions
   */
  private hasTimeDependency(expression: string): boolean {
    return this.feelTimeFunctions.some((fn) => expression.toLowerCase().includes(fn.toLowerCase()));
  }

  /**
   * Detect external call patterns in FEEL expressions
   */
  private hasExternalCall(expression: string): boolean {
    return this.feelExternalIndicators.some((indicator) => expression.includes(indicator));
  }

  /**
   * Detect FEEL function usage
   */
  private detectFunctions(expression: string, language: string): string[] {
    if (language !== "feel") return [];

    const detected: string[] = [];

    // Detect time functions
    for (const fn of this.feelTimeFunctions) {
      if (expression.toLowerCase().includes(fn.toLowerCase())) {
        detected.push(fn.replace(/[()]/g, "").trim());
      }
    }

    // Detect pure functions
    for (const fn of this.feelPureFunctions) {
      if (expression.toLowerCase().includes(fn.toLowerCase())) {
        detected.push(fn.replace(/[()]/g, "").trim());
      }
    }

    // Detect external indicators
    for (const indicator of this.feelExternalIndicators) {
      if (expression.includes(indicator)) {
        detected.push(
          indicator === "->" ? "BKM invocation" : indicator.replace(/[()]/g, "").trim(),
        );
      }
    }

    return detected;
  }

  /**
   * Get default expression language for runtime profile
   */
  private getDefaultExpressionLanguage(profileId?: string): string {
    switch (profileId) {
      case "camunda-7":
      case "camunda-8":
      case "cib-seven":
      case "jbpm":
        return "feel";
      default:
        return "feel"; // DMN 1.3 standard default
    }
  }

  /**
   * Parse governance tier string to number
   */
  private parseGovernanceTier(tier: string): number {
    const match = tier.match(/\d+/);
    return match ? parseInt(match[0], 10) : 1;
  }
}
