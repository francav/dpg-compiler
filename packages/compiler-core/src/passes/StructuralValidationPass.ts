// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { Finding } from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

export class StructuralValidationPass implements SemanticPass {
  readonly id = "structural-validation";
  readonly phase = "L1" as const;

  run(context: PassContext): PassOutput {
    const findings: Finding[] = [];

    if (!context.compilerContext.normalizedBpmn && !context.compilerContext.normalizedDmn) {
      findings.push(
        finalizeFinding({
          category: "structural",
          severity: "error",
          message: "No BPMN or DMN input supplied",
          ruleId: this.id,
        }),
      );
      return { findings, degraded: true };
    }

    return { findings };
  }
}
