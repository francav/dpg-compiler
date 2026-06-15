// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { DecisionAnalysisEntry, Finding } from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import { parseUnaryTest, intersects, subsumes, type Region } from "./feel/UnaryTestRange.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

type DecisionRule = {
  id: string;
  inputEntries: Record<string, string>;
  outputEntries?: Record<string, string>;
};

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
 *
 * Overlap and shadow detection compare rule input regions with the shared FEEL
 * {@link UnaryTestRange} comparator (real range/interval subsumption), not byte-equality.
 * When a column's unary test cannot be analyzed, the column is treated as "unknown" and
 * never contributes a false overlap/unreachable claim.
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
      const rules = (annotation.rules as DecisionRule[]) ?? [];

      // Detect gaps
      const missingCombinations = this.detectNullGaps(inputs, rules);
      const overlappingRules = this.detectOverlappingRules(decisionNode.hitPolicy, rules);
      const shadowedRules = this.detectShadowedRules(decisionNode.hitPolicy, rules);

      // Count overlaps and gaps (legacy fields)
      const overlaps = overlappingRules.length;
      const gaps = missingCombinations.length;

      // Determine severity
      let severity: "info" | "warning" | "error" = "info";
      const tier = this.parseTier(context.compilerContext.governanceTier);
      if (gaps > 0 || overlaps > 0) {
        severity = tier >= 3 ? "error" : tier >= 2 ? "warning" : "info";
      }

      // Create decision analysis entry. Shadowed rules are unreachable: an earlier rule
      // fully subsumes them under an order-sensitive hit policy.
      decisionAnalysis.push({
        decisionId: decisionNode.id,
        hitPolicy: decisionNode.hitPolicy,
        rules: rules.length,
        overlaps,
        gaps,
        unreachableRules: shadowedRules.map((r) => r.id),
        shadowedRules: shadowedRules.map((r) => r.id),
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
      if (shadowedRules.length > 0 && tier >= 2) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "warning",
            message: `Decision table "${decisionNode.id}" has ${shadowedRules.length} unreachable rule(s) (shadowed by earlier rules)`,
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
   * Detect overlapping rules via real region intersection.
   *
   * Two rules overlap when EVERY input column's unary tests can match a common value.
   * FIRST allows shadowing by design, so overlap is not flagged there. A column whose
   * test cannot be parsed is treated as "unknown" and prevents an overlap claim for that
   * pair — we never report an overlap we cannot prove.
   */
  private detectOverlappingRules(hitPolicy: string, rules: DecisionRule[]): Array<{ id: string }> {
    if (hitPolicy === "FIRST") {
      return [];
    }

    const regions = rules.map((rule) => this.toRuleRegions(rule.inputEntries));
    const columns = this.collectColumns(rules);
    const overlapping: Array<{ id: string }> = [];

    for (let i = 0; i < rules.length; i++) {
      for (let j = 0; j < i; j++) {
        if (this.rulesOverlap(regions[i]!, regions[j]!, columns)) {
          overlapping.push({ id: rules[i]!.id });
          break; // already overlaps an earlier rule; count it once
        }
      }
    }

    return overlapping;
  }

  /**
   * Detect rules made unreachable by an earlier, more general rule.
   *
   * Only order-sensitive hit policies (FIRST, PRIORITY) can shadow later rules. A rule is
   * reported when some earlier rule fully subsumes it on every input column. Subsumption is
   * sound-but-incomplete (it checks against single earlier rules, not their union), so it
   * never produces a false "unreachable" claim.
   */
  private detectShadowedRules(hitPolicy: string, rules: DecisionRule[]): Array<{ id: string }> {
    if (hitPolicy !== "FIRST" && hitPolicy !== "PRIORITY") {
      return [];
    }

    const regions = rules.map((rule) => this.toRuleRegions(rule.inputEntries));
    const columns = this.collectColumns(rules);
    const shadowed: Array<{ id: string }> = [];

    for (let i = 1; i < rules.length; i++) {
      for (let j = 0; j < i; j++) {
        if (this.ruleSubsumes(regions[j]!, regions[i]!, columns)) {
          shadowed.push({ id: rules[i]!.id });
          break;
        }
      }
    }

    return shadowed;
  }

  /** Parse each input column's unary test into a Region (null = unparseable). */
  private toRuleRegions(inputEntries: Record<string, string>): Record<string, Region | null> {
    const regions: Record<string, Region | null> = {};
    for (const [column, test] of Object.entries(inputEntries)) {
      regions[column] = parseUnaryTest(test);
    }
    return regions;
  }

  /** Union of every input column name across all rules. */
  private collectColumns(rules: DecisionRule[]): string[] {
    const columns = new Set<string>();
    for (const rule of rules) {
      for (const column of Object.keys(rule.inputEntries)) columns.add(column);
    }
    return Array.from(columns);
  }

  /** Rules overlap when every column intersects; a missing column is unconstrained (any). */
  private rulesOverlap(
    a: Record<string, Region | null>,
    b: Record<string, Region | null>,
    columns: string[],
  ): boolean {
    for (const column of columns) {
      const ra = a[column];
      const rb = b[column];
      // A missing entry constrains nothing → behaves like "any" → always intersects.
      if (ra === undefined || rb === undefined) continue;
      // An unparseable column means we cannot prove an overlap exists.
      if (ra === null || rb === null) return false;
      if (!intersects(ra, rb)) return false;
    }
    return true;
  }

  /** `outer` subsumes `inner` when it contains inner on every column. */
  private ruleSubsumes(
    outer: Record<string, Region | null>,
    inner: Record<string, Region | null>,
    columns: string[],
  ): boolean {
    for (const column of columns) {
      const outerRegion = outer[column];
      const innerRegion = inner[column];
      // Missing outer entry = unconstrained = contains anything on this column.
      if (outerRegion === undefined) continue;
      // Unparseable on either side → cannot prove subsumption.
      if (outerRegion === null || innerRegion === null || innerRegion === undefined) return false;
      if (!subsumes(outerRegion, innerRegion)) return false;
    }
    return true;
  }

  /**
   * Parse governance tier string to number
   */
  private parseTier(tier: string): number {
    const match = tier.match(/(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : 1;
  }
}
