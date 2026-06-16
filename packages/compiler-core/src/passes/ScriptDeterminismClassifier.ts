// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { DeterminismEntry, Finding } from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";
import { determinismClassifier } from "./DeterminismClassifier.js";

/**
 * Script Determinism Classifier
 *
 * Identifies non-deterministic patterns in script task bodies.
 *
 * Responsibilities:
 * - Extract script bodies from <script> elements in BPMN AST
 * - Detect script format (Groovy, JavaScript, Python, MVEL)
 * - Scan script text for non-deterministic API calls (time, random, I/O, beans)
 * - Classify Axis Y based on detected patterns
 * - Classify Axis X based on script engine
 * - Emit DeterminismEntry + findings
 */
export class ScriptDeterminismClassifier implements SemanticPass {
  readonly id = "script-determinism-classification";
  readonly phase = "L2" as const;
  readonly requires = ["structural-validation"] as const;

  /**
   * Script pattern library (MVP - Groovy/JavaScript)
   */
  private readonly scriptPatterns = {
    groovy: {
      date: ["new Date()", "System.currentTimeMillis()", "LocalDateTime.now()", "Instant.now()"],
      random: ["Math.random()", "UUID.randomUUID()", "Random.next", "new Random("],
      io: ["new File(", "HttpClient", "URL(", "Socket(", "Files.", "Paths.get("],
      bean: ["execution.getVariable(", "runtimeService.", "taskService.", "repositoryService."],
    },
    javascript: {
      date: ["new Date()", "Date.now()", "performance.now()"],
      random: ["Math.random()"],
      io: ["fetch(", "XMLHttpRequest", "require('fs')", "require('http')"],
      bean: ["execution.getVariable("],
    },
    python: {
      date: ["datetime.now()", "time.time()", "date.today()"],
      random: ["random.random()", "random.randint(", "uuid.uuid4()"],
      io: ["open(", "requests.", "urllib.", "http.client"],
      bean: ["execution.getVariable("],
    },
  };

  run(context: PassContext): PassOutput {
    const determinism: DeterminismEntry[] = [];
    const findings: Finding[] = [];

    // Extract script task nodes
    const scriptTasks = Array.from(context.ir.nodes.values()).filter(
      (node) =>
        node.kind === "flowNode" &&
        (node.flowType === "scriptTask" || node.flowType === "bpmn:scriptTask"),
    );

    if (scriptTasks.length === 0) {
      return { determinism, findings };
    }

    // Analyze each script task
    for (const scriptTask of scriptTasks) {
      const annotation = context.ir.annotations.get(scriptTask.id) ?? {};
      const scriptBody = annotation.scriptBody as string | undefined;
      const scriptFormat = (annotation.scriptFormat as string | undefined) ?? "groovy";

      if (!scriptBody) {
        // Script task without body - emit info finding
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "info",
            message: "Script task has no script body (metadata extraction may be incomplete)",
            ruleId: this.id,
            targetId: scriptTask.id,
          }),
        );
        continue;
      }

      // Detect non-deterministic patterns
      const detectedPatterns = this.detectPatterns(scriptBody, scriptFormat);

      // Classify using DeterminismClassifier
      const classification = determinismClassifier.classify({
        elementType: "scriptTask",
        expression: scriptBody,
        scriptFormat,
        profileId: context.compilerContext.runtimeProfile?.id,
        policyTier: this.parseTier(context.compilerContext.governanceTier),
      });

      // Override Axis Y if non-deterministic patterns detected
      let finalAxisY = classification.axisY;
      let reasoning = classification.reasoning;

      if (detectedPatterns.length > 0) {
        finalAxisY = "nonDeterministic";
        reasoning = `Non-deterministic patterns detected: ${detectedPatterns.join(", ")}`;
      }

      determinism.push({
        evaluationPointId: scriptTask.id,
        axisY: finalAxisY,
        axisX: classification.axisX,
        confidence: detectedPatterns.length > 0 ? 0.9 : classification.confidence,
        policyClause: "determinism.scriptTaskRestrictions",
        runtimeProfileSection: context.compilerContext.runtimeProfile ? "scriptTasks" : undefined,
        ruleId: this.id,
        rationale: reasoning,
      });

      // Emit finding if patterns detected and policy restricts
      if (
        detectedPatterns.length > 0 &&
        this.parseTier(context.compilerContext.governanceTier) >= 2
      ) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity:
              this.parseTier(context.compilerContext.governanceTier) >= 3 ? "error" : "warning",
            message: `Script task contains non-deterministic patterns: ${detectedPatterns.join(", ")}`,
            ruleId: this.id,
            targetId: scriptTask.id,
            policyClause: "determinism.scriptTaskRestrictions",
            remediation: "Replace non-deterministic calls with input variables or decision tables",
          }),
        );
      }

      // MVEL support note (post-MVP)
      if (scriptFormat === "mvel") {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "info",
            message: "MVEL pattern detection is pending (post-MVP); basic classification applied",
            ruleId: this.id,
            targetId: scriptTask.id,
          }),
        );
      }
    }

    return { determinism, findings };
  }

  /**
   * Detect non-deterministic patterns in script body
   */
  private detectPatterns(scriptBody: string, format: string): string[] {
    const detected: string[] = [];

    // Get pattern library for this script format
    const patterns = this.scriptPatterns[format as keyof typeof this.scriptPatterns];
    if (!patterns) {
      return detected; // Unknown format, no patterns to check
    }

    // Check date/time patterns
    for (const pattern of patterns.date) {
      if (scriptBody.includes(pattern)) {
        detected.push(pattern);
      }
    }

    // Check random patterns
    for (const pattern of patterns.random) {
      if (scriptBody.includes(pattern)) {
        detected.push(pattern);
      }
    }

    // Check I/O patterns
    for (const pattern of patterns.io) {
      if (scriptBody.includes(pattern)) {
        detected.push(pattern);
      }
    }

    // Check bean/context invocation patterns
    for (const pattern of patterns.bean) {
      if (scriptBody.includes(pattern)) {
        detected.push(pattern);
      }
    }

    return detected;
  }

  /**
   * Parse governance tier string to number
   */
  private parseTier(tier: string): number {
    const match = tier.match(/(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : 1;
  }
}
