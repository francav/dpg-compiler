// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { DeterminismEntry, Finding, MaturitySignal } from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

/**
 * Aggregation Engine
 *
 * Calculates process-level maturity distribution across Axis Y × Axis X grid.
 *
 * Responsibilities:
 * - Collect all DeterminismEntry records from prior passes
 * - Count evaluation points per Axis Y × Axis X quadrant
 * - Calculate percentages
 * - Populate MaturitySignal
 * - Emit finding if policy defines maturity thresholds and they're violated
 */
export class AggregationEngine implements SemanticPass {
  readonly id = "maturity-aggregation";
  readonly phase = "summary" as const;
  readonly requires = ["gateway-condition-analysis", "script-determinism-classification"] as const;

  run(context: PassContext): PassOutput {
    const findings: Finding[] = [];

    // Collect determinism entries from context (would come from prior passes in real implementation)
    // For MVP, we'll receive them via PassRunner accumulation
    const determinismEntries =
      context.findings.filter((f) => f.category === "semantic").length > 0
        ? [] // Placeholder - real implementation would access accumulated determinism entries
        : [];

    // Calculate maturity signal
    const maturitySignal = this.calculateMaturity(determinismEntries);

    // Check policy thresholds
    const policyThresholds = this.extractThresholds(context.compilerContext.policy.determinism);
    if (policyThresholds) {
      const violations = this.checkThresholds(maturitySignal, policyThresholds);
      for (const violation of violations) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity:
              this.parseTier(context.compilerContext.governanceTier) >= 3 ? "error" : "warning",
            message: violation.message,
            ruleId: this.id,
            policyClause: "determinism.maturityThresholds",
            remediation: violation.remediation,
          }),
        );
      }
    }

    // Return maturity signal
    return {
      findings,
      maturitySignal,
    };
  }

  /**
   * Calculate maturity signal from determinism entries
   */
  private calculateMaturity(entries: DeterminismEntry[]): MaturitySignal {
    if (entries.length === 0) {
      // Default: 100% deterministic + agnostic (no evaluation points analyzed)
      return {
        deterministicAgnostic: 100,
        deterministicBound: 0,
        policyDependentAgnostic: 0,
        policyDependentBound: 0,
        nonDeterministicAgnostic: 0,
        nonDeterministicBound: 0,
        totalEvaluationPoints: 0,
        deterministicTotal: 100,
        portableTotal: 100,
      };
    }

    // Count evaluation points per quadrant
    let deterministicAgnostic = 0;
    let deterministicBound = 0; // profileScoped + runtimeBound + engineSpecific
    let policyDependentAgnostic = 0;
    let policyDependentBound = 0;
    let nonDeterministicAgnostic = 0;
    let nonDeterministicBound = 0;

    for (const entry of entries) {
      const isAgnostic = entry.axisX === "engineAgnostic";
      const isBound =
        entry.axisX === "profileScoped" ||
        entry.axisX === "engineSpecific" ||
        entry.axisX === "externalized";

      if (entry.axisY === "deterministic") {
        if (isAgnostic) deterministicAgnostic++;
        if (isBound) deterministicBound++;
      } else if (entry.axisY === "policyDependent") {
        if (isAgnostic) policyDependentAgnostic++;
        if (isBound) policyDependentBound++;
      } else if (entry.axisY === "nonDeterministic" || entry.axisY === "runtimeBound") {
        if (isAgnostic) nonDeterministicAgnostic++;
        if (isBound) nonDeterministicBound++;
      }
    }

    const total = entries.length;

    // Calculate percentages (rounded to integer)
    const signal: MaturitySignal = {
      deterministicAgnostic: Math.round((deterministicAgnostic / total) * 100),
      deterministicBound: Math.round((deterministicBound / total) * 100),
      policyDependentAgnostic: Math.round((policyDependentAgnostic / total) * 100),
      policyDependentBound: Math.round((policyDependentBound / total) * 100),
      nonDeterministicAgnostic: Math.round((nonDeterministicAgnostic / total) * 100),
      nonDeterministicBound: Math.round((nonDeterministicBound / total) * 100),
      totalEvaluationPoints: total,
      deterministicTotal: Math.round(
        ((deterministicAgnostic +
          deterministicBound +
          policyDependentAgnostic +
          policyDependentBound) /
          total) *
          100,
      ),
      portableTotal: Math.round(
        ((deterministicAgnostic + policyDependentAgnostic + deterministicBound) / total) * 100,
      ),
    };

    return signal;
  }

  /**
   * Extract maturity thresholds from policy
   */
  private extractThresholds(
    determinismPolicy: Record<string, unknown> | undefined,
  ): { deterministicTotal?: number; nonDeterministicBound?: number } | null {
    if (!determinismPolicy) {
      return null;
    }

    const thresholds = determinismPolicy.maturityThresholds as Record<string, number> | undefined;
    if (!thresholds) {
      return null;
    }

    return {
      deterministicTotal: thresholds.deterministicTotal,
      nonDeterministicBound: thresholds.nonDeterministicBound,
    };
  }

  /**
   * Check maturity signal against policy thresholds
   */
  private checkThresholds(
    signal: MaturitySignal,
    thresholds: { deterministicTotal?: number; nonDeterministicBound?: number },
  ): Array<{ message: string; remediation: string }> {
    const violations: Array<{ message: string; remediation: string }> = [];

    // Check deterministicTotal threshold (minimum required)
    if (
      thresholds.deterministicTotal !== undefined &&
      signal.deterministicTotal < thresholds.deterministicTotal
    ) {
      violations.push({
        message: `Process maturity below policy threshold: ${signal.deterministicTotal}% deterministic (required: ${thresholds.deterministicTotal}%)`,
        remediation:
          "Increase deterministic evaluation points by replacing non-deterministic patterns with input variables or decisions",
      });
    }

    // Check nonDeterministicBound threshold (maximum allowed)
    if (
      thresholds.nonDeterministicBound !== undefined &&
      signal.nonDeterministicBound > thresholds.nonDeterministicBound
    ) {
      violations.push({
        message: `Process has too many runtime-coupled non-deterministic points: ${signal.nonDeterministicBound}% (maximum: ${thresholds.nonDeterministicBound}%)`,
        remediation: "Externalize runtime-bound logic or replace with engine-agnostic alternatives",
      });
    }

    return violations;
  }

  /**
   * Parse governance tier string to number
   */
  private parseTier(tier: string): number {
    const match = tier.match(/(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : 1;
  }
}
