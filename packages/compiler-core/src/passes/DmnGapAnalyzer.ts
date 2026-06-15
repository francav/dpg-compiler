// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { DecisionAnalysisEntry, Finding } from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

/**
 * DMN Gap Analyzer
 *
 * Detects decision table completeness gaps.
 *
 * Responsibilities:
 * - Extract decision table input/output structure
 * - Extract all decision rules
 * - Analyze rule coverage (missing null handling, overlapping rules, unreachable rules)
 * - Emit DecisionAnalysisEntry with gap metadata
 * - Emit findings with ruleId: "DMN_GAP_DETECTION"
 */
export class DmnGapAnalyzer implements SemanticPass {
  readonly id = "dmn-gap-analysis";
  readonly phase = "analysis" as const;
  readonly requires = ["structural-validation"] as const;

  run(context: PassContext): PassOutput {
    const findings: Finding[] = [];
    const decisionAnalysis: DecisionAnalysisEntry[] = [];

    // Extract decision nodes from IR
    const decisions = Array.from(context.ir.nodes.values()).filter(
      (node) => node.kind === "decision",
    );

    if (decisions.length === 0) {
      return { findings };
    }

    // Analyze each decision table
    for (const decisionNode of decisions) {
      if (decisionNode.kind !== "decision") {
        continue;
      }

      const annotation = context.ir.annotations.get(decisionNode.id) ?? {};

      // Extract decision metadata (would come from parser in real implementation)
      const inputs = (annotation.inputs as string[]) ?? [];
      const rules =
        (annotation.rules as Array<{
          id: string;
          inputEntries: Record<string, string>;
          outputEntries: Record<string, string>;
        }>) ?? [];

      // Detect gaps
      const missingCombinations = this.detectNullGaps(inputs, rules);
      const overlappingRules = this.detectOverlappingRules(decisionNode.hitPolicy, rules);
      const unreachableRules = this.detectUnreachableRules(decisionNode.hitPolicy, rules);

      // Count overlaps and gaps (legacy fields)
      const overlaps = overlappingRules.length;
      const gaps = missingCombinations.length;

      // Determine severity
      let severity: "info" | "warning" | "error" = "info";
      const tier = this.parseTier(context.compilerContext.governanceTier);
      if (gaps > 0 || overlaps > 0) {
        severity = tier >= 3 ? "error" : tier >= 2 ? "warning" : "info";
      }

      // Create decision analysis entry
      decisionAnalysis.push({
        decisionId: decisionNode.id,
        hitPolicy: decisionNode.hitPolicy,
        rules: rules.length,
        overlaps,
        gaps,
        unreachableRules: unreachableRules.map((r) => r.id),
        shadowedRules: [], // Would be populated by shadow analysis
        runtimeDependence: "profileScoped", // DMN is profile-scoped (FEEL)
        severity,
        policyClause: "dmn.completeness",
        // MVP extensions
        missingCombinations,
        overlappingRules: overlappingRules.map((r) => r.id),
      });

      // Emit findings for gaps
      if (gaps > 0 && tier >= 2) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity,
            message: `Decision table "${decisionNode.id}" has ${gaps} missing input combination(s): ${missingCombinations.join(", ")}`,
            ruleId: "DMN_GAP_DETECTION",
            targetId: decisionNode.id,
            policyClause: "dmn.completeness",
            remediation: "Add rules to handle null or missing input values",
          }),
        );
      }

      // Emit findings for overlaps (non-FIRST hit policy only)
      if (overlaps > 0 && decisionNode.hitPolicy !== "FIRST" && tier >= 2) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity,
            message: `Decision table "${decisionNode.id}" with ${decisionNode.hitPolicy} hit policy has ${overlaps} overlapping rule(s)`,
            ruleId: "DMN_GAP_DETECTION",
            targetId: decisionNode.id,
            policyClause: "dmn.completeness",
            remediation: "Use FIRST hit policy or ensure rules are mutually exclusive",
          }),
        );
      }

      // Emit findings for unreachable rules
      if (unreachableRules.length > 0 && tier >= 2) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "warning",
            message: `Decision table "${decisionNode.id}" has ${unreachableRules.length} unreachable rule(s) (shadowed by earlier rules)`,
            ruleId: "DMN_GAP_DETECTION",
            targetId: decisionNode.id,
            policyClause: "dmn.completeness",
            remediation: "Reorder rules or remove unreachable ones",
          }),
        );
      }
    }

    // Return decision analysis entries
    return {
      findings,
      determinism: [], // No determinism entries from this pass
      decisionAnalysis,
    };
  }

  /**
   * Detect missing null handling for inputs
   */
  private detectNullGaps(
    inputs: string[],
    rules: Array<{ id: string; inputEntries: Record<string, string> }>,
  ): string[] {
    const missingNulls: string[] = [];

    for (const input of inputs) {
      const hasNullRule = rules.some(
        (rule) =>
          rule.inputEntries[input] === "null" ||
          rule.inputEntries[input] === "-" || // DMN null indicator
          rule.inputEntries[input] === "" || // Empty = null/any
          !rule.inputEntries[input], // Missing entry = null/any
      );
      if (!hasNullRule) {
        missingNulls.push(`${input}=null`);
      }
    }

    return missingNulls;
  }

  /**
   * Detect overlapping rules (simplified MVP - checks for duplicate conditions)
   */
  private detectOverlappingRules(
    hitPolicy: string,
    rules: Array<{ id: string; inputEntries: Record<string, string> }>,
  ): Array<{ id: string }> {
    const overlapping: Array<{ id: string }> = [];

    // Only check for UNIQUE/ANY hit policies (FIRST allows shadowing intentionally)
    if (hitPolicy === "FIRST") {
      return overlapping;
    }

    // Simple duplicate detection (real implementation would check range overlaps)
    const seen = new Set<string>();
    for (const rule of rules) {
      const signature = JSON.stringify(rule.inputEntries);
      if (seen.has(signature)) {
        overlapping.push({ id: rule.id });
      } else {
        seen.add(signature);
      }
    }

    return overlapping;
  }

  /**
   * Detect unreachable rules (basic shadow analysis for FIRST hit policy)
   */
  private detectUnreachableRules(
    hitPolicy: string,
    rules: Array<{ id: string; inputEntries: Record<string, string> }>,
  ): Array<{ id: string }> {
    const unreachable: Array<{ id: string }> = [];

    // Only relevant for FIRST hit policy (later rules can be shadowed)
    if (hitPolicy !== "FIRST") {
      return unreachable;
    }

    // Simplified: check if rule N+1 is identical to rule N (full subsumption check is complex)
    for (let i = 1; i < rules.length; i++) {
      const rule = rules[i];
      const prior = rules[i - 1];
      if (!rule || !prior) {
        continue;
      }
      const current = JSON.stringify(rule.inputEntries);
      const previous = JSON.stringify(prior.inputEntries);
      if (current === previous) {
        unreachable.push({ id: rule.id });
      }
    }

    return unreachable;
  }

  /**
   * Parse governance tier string to number
   */
  private parseTier(tier: string): number {
    const match = tier.match(/(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : 1;
  }
}
