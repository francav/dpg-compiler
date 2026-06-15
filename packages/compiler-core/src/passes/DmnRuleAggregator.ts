// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type {
  AxisYClass,
  DecisionNode,
  DecisionRuleNode,
  DmnDecisionDescriptor,
  DmnExpressionDescriptor,
  Finding,
} from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

/**
 * DMN Rule Aggregator (Sprint 4)
 *
 * Aggregates determinism across decision table rules and applies hit policy semantics.
 *
 * Responsibilities:
 * - Aggregate rule-level determinism from input/output expressions
 * - Apply hit policy logic (UNIQUE, FIRST, PRIORITY, ANY, COLLECT, etc.)
 * - Populate DmnDecisionDescriptor with aggregated determinism
 * - Emit findings for hit policy violations (overlapping rules, inconsistent ANY, etc.)
 */
export class DmnRuleAggregator implements SemanticPass {
  readonly id = "dmn-rule-aggregator";
  readonly phase = "L2" as const;
  readonly requires = ["dmn-expression-classifier"] as const;

  run(context: PassContext): PassOutput {
    const descriptors: DmnDecisionDescriptor[] = [];
    const findings: Finding[] = [];

    const tier = this.parseGovernanceTier(context.compilerContext.governanceTier);

    // Get DMN expression descriptors from previous pass
    const expressionDescriptors = (
      context as { dmnExpressionDescriptors?: DmnExpressionDescriptor[] }
    ).dmnExpressionDescriptors as DmnExpressionDescriptor[] | undefined;

    if (!expressionDescriptors) {
      // DmnExpressionClassifier hasn't run yet or produced no output
      return { dmnDecisionDescriptors: descriptors, findings };
    }

    // Group expressions by decision ID
    const expressionsByDecision = new Map<string, DmnExpressionDescriptor[]>();
    for (const descriptor of expressionDescriptors) {
      const bucket = expressionsByDecision.get(descriptor.decisionId) ?? [];
      bucket.push(descriptor);
      expressionsByDecision.set(descriptor.decisionId, bucket);
    }

    // Iterate over all decision nodes
    for (const node of context.ir.nodes.values()) {
      if (node.kind !== "decision") continue;

      const decisionNode = node as DecisionNode;
      const decisionAnnotations = context.ir.annotations.get(decisionNode.id) ?? {};
      const hitPolicy = (decisionAnnotations.hitPolicy as string) ?? "UNIQUE";
      const aggregation = decisionAnnotations.aggregation as string | undefined;
      const inputCount = (decisionAnnotations.inputCount as number) ?? 0;
      const outputCount = (decisionAnnotations.outputCount as number) ?? 0;

      // Get all rules for this decision
      const ruleNodes = Array.from(context.ir.nodes.values()).filter(
        (n) => n.kind === "decisionRule" && n.id.startsWith(decisionNode.id + ":rule:"),
      ) as DecisionRuleNode[];

      const ruleDeterminism: AxisYClass[] = [];
      const ruleExpressionMap = new Map<string, DmnExpressionDescriptor[]>();

      // Aggregate expressions per rule
      const expressions = expressionsByDecision.get(decisionNode.id) ?? [];
      for (const expr of expressions) {
        if (expr.ruleId) {
          const bucket = ruleExpressionMap.get(expr.ruleId) ?? [];
          bucket.push(expr);
          ruleExpressionMap.set(expr.ruleId, bucket);
        }
      }

      // Compute per-rule determinism
      for (const ruleNode of ruleNodes) {
        const ruleExpressions = ruleExpressionMap.get(ruleNode.id) ?? [];
        const ruleDet = this.aggregateRuleDeterminism(ruleExpressions);
        ruleDeterminism.push(ruleDet);
      }

      // Apply hit policy logic to compute decision-level determinism
      const decisionDeterminism = this.applyHitPolicyLogic(
        hitPolicy,
        ruleDeterminism,
        decisionNode.id,
        findings,
        tier,
      );

      descriptors.push({
        decisionId: decisionNode.id,
        decisionName: decisionNode.astNodeId,
        hitPolicy,
        aggregator: aggregation,
        ruleCount: ruleNodes.length,
        ruleDeterminism,
        decisionDeterminism,
        inputCount,
        outputCount,
      });

      // Emit findings for specific hit policies
      if (hitPolicy === "UNIQUE" && ruleNodes.length > 1 && tier >= 2) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "info",
            message: `Decision ${decisionNode.id} uses UNIQUE hit policy with ${ruleNodes.length} rules. Rule overlap detection not yet implemented.`,
            targetId: decisionNode.id,
            ruleId: this.id,
            policyClause: "dmn-hit-policy",
          }),
        );
      }

      if (hitPolicy === "ANY" && this.hasInconsistentRules(ruleDeterminism) && tier >= 2) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "warning",
            message: `Decision ${decisionNode.id} uses ANY hit policy but rules have inconsistent determinism`,
            targetId: decisionNode.id,
            ruleId: this.id,
            policyClause: "dmn-hit-policy-consistency",
          }),
        );
      }

      if (ruleNodes.length === 0 && tier >= 2) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "warning",
            message: `Decision ${decisionNode.id} has no rules`,
            targetId: decisionNode.id,
            ruleId: this.id,
            policyClause: "dmn-rule-count",
          }),
        );
      }
    }

    return {
      dmnDecisionDescriptors: descriptors,
      findings,
    };
  }

  /**
   * Aggregate determinism across expressions within a single rule
   * Rule determinism = least deterministic expression in that rule
   */
  private aggregateRuleDeterminism(expressions: DmnExpressionDescriptor[]): AxisYClass {
    if (expressions.length === 0) {
      return "deterministic"; // Empty rule defaults to deterministic
    }

    const determinisms = expressions.map((e) => e.determinism);

    // Priority: runtimeBound > policyDependent > deterministic > unknown
    if (determinisms.includes("runtimeBound")) return "runtimeBound";
    if (determinisms.includes("nonDeterministic")) return "nonDeterministic";
    if (determinisms.includes("policyDependent")) return "policyDependent";
    if (determinisms.includes("unknown")) return "unknown";
    return "deterministic";
  }

  /**
   * Apply hit policy logic to compute decision-level determinism
   *
   * Hit Policy Semantics (Sprint 4):
   * - UNIQUE: all rules must be mutually exclusive (emit warning if overlap detected)
   * - FIRST: determinism = first matching rule's determinism
   * - PRIORITY: determinism = least deterministic priority rule
   * - ANY: all rules must produce same determinism (emit warning if inconsistent)
   * - COLLECT: determinism = least deterministic across all rules
   * - RULE ORDER: determinism = aggregated across rule execution sequence
   * - OUTPUT ORDER: determinism = aggregated across output ordering
   */
  private applyHitPolicyLogic(
    hitPolicy: string,
    ruleDeterminism: AxisYClass[],
    _decisionId: string,
    _findings: Finding[],
    _tier: number,
  ): AxisYClass {
    if (ruleDeterminism.length === 0) {
      return "deterministic"; // No rules = deterministic (vacuously true)
    }

    switch (hitPolicy) {
      case "UNIQUE":
        // UNIQUE: all rules must be mutually exclusive
        // For Sprint 4 MVP, we treat this as COLLECT (least deterministic)
        return this.leastDeterministic(ruleDeterminism);

      case "FIRST":
        // FIRST: determinism = first matching rule's determinism
        return ruleDeterminism[0] ?? "deterministic";

      case "PRIORITY":
        // PRIORITY: determinism = least deterministic priority rule
        return this.leastDeterministic(ruleDeterminism);

      case "ANY":
        // ANY: all rules must have same determinism
        // If inconsistent, use least deterministic
        return this.leastDeterministic(ruleDeterminism);

      case "COLLECT":
      case "RULE ORDER":
      case "OUTPUT ORDER":
        // COLLECT/RULE ORDER/OUTPUT ORDER: determinism = least deterministic across all rules
        return this.leastDeterministic(ruleDeterminism);

      default:
        // Unknown hit policy
        return this.leastDeterministic(ruleDeterminism);
    }
  }

  /**
   * Determine the least deterministic classification from a list
   */
  private leastDeterministic(determinisms: AxisYClass[]): AxisYClass {
    // Priority: nonDeterministic > runtimeBound > policyDependent > unknown > deterministic
    if (determinisms.includes("nonDeterministic")) return "nonDeterministic";
    if (determinisms.includes("runtimeBound")) return "runtimeBound";
    if (determinisms.includes("policyDependent")) return "policyDependent";
    if (determinisms.includes("unknown")) return "unknown";
    return "deterministic";
  }

  /**
   * Check if rules have inconsistent determinism (for ANY hit policy)
   */
  private hasInconsistentRules(ruleDeterminism: AxisYClass[]): boolean {
    if (ruleDeterminism.length <= 1) return false;
    const first = ruleDeterminism[0];
    return ruleDeterminism.some((det) => det !== first);
  }

  /**
   * Parse governance tier string to number
   */
  private parseGovernanceTier(tier: string): number {
    const match = tier.match(/\d+/);
    return match ? parseInt(match[0], 10) : 1;
  }
}
