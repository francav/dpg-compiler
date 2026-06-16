// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { DeterminismEntry, RuntimeDependencyEntry } from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

export class SemanticDeterminismPass implements SemanticPass {
  readonly id = "semantic-determinism";
  readonly phase = "L2" as const;
  readonly requires = ["structural-validation"] as const;

  run(context: PassContext): PassOutput {
    const determinism: DeterminismEntry[] = [];
    const runtimeDependencies: RuntimeDependencyEntry[] = [];

    for (const node of context.ir.nodes.values()) {
      if (node.kind !== "evaluationPoint") {
        continue;
      }
      const annotation = context.ir.annotations.get(node.id) ?? {};
      const expressionHints = Array.isArray(annotation.expressionHints)
        ? (annotation.expressionHints as string[])
        : [];
      const runtimeBound = expressionHints.includes("runtime");
      determinism.push({
        evaluationPointId: node.id,
        axisY: runtimeBound ? "runtimeBound" : "policyDependent",
        axisX: context.compilerContext.runtimeProfile ? "profileScoped" : "unknown",
        confidence: 0.8,
        policyClause: "determinism.default",
        runtimeProfileSection: context.compilerContext.runtimeProfile ? "root" : undefined,
        ruleId: this.id,
        rationale: runtimeBound
          ? "Policy-driven evaluation point with a runtime-bound expression hint"
          : "Policy-driven evaluation point; determinism depends on policy declarations",
      });
      runtimeDependencies.push({
        evaluationPointId: node.id,
        dependency: node.expressionId ?? "expression",
        profileCoverage: context.compilerContext.runtimeProfile ? "documented" : "missingProfile",
        policyClause: "runtime.default",
        ruleId: this.id,
      });
    }

    if (
      !context.compilerContext.runtimeProfile &&
      context.compilerContext.policy.runtimeProfileRequired
    ) {
      const finding = finalizeFinding({
        category: "semantic",
        severity: "warning",
        message: "Runtime profile required by policy but not provided",
        ruleId: this.id,
      });
      return {
        determinism,
        runtimeDependencies,
        findings: [finding],
        degraded: true,
      };
    }

    return { determinism, runtimeDependencies };
  }
}
