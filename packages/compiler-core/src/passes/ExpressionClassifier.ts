// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { AxisYClass, ExpressionDescriptor, Finding } from "../types.js";

type ExpressionLanguage =
  | "feel"
  | "juel"
  | "groovy"
  | "javascript"
  | "python"
  | "mvel"
  | "cib-proprietary"
  | "unknown";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

/**
 * Expression Classifier (Sprint 3)
 *
 * Classifies expression language and determinism for gateway conditions and script tasks.
 *
 * Responsibilities:
 * - Identify expression language from attributes or content patterns
 * - Classify Axis Y determinism (pure/time-dependent/external)
 * - Detect function usage (FEEL time functions, JUEL bean calls, etc.)
 * - Populate ExpressionDescriptor entries
 * - Emit findings when expression language is unsupported by runtime profile
 */
export class ExpressionClassifier implements SemanticPass {
  readonly id = "expression-classifier";
  readonly phase = "L2" as const;
  readonly requires = ["structural-validation"] as const;

  /**
   * Expression language detection rules by runtime profile
   */
  private readonly expressionRules = {
    "camunda-7": {
      languages: ["juel", "groovy", "python", "javascript"],
      defaultLanguage: "juel",
      timeFunctions: ["now()", "currentDate()", "Date.now()"],
    },
    "camunda-8": {
      languages: ["feel"],
      defaultLanguage: "feel",
      timeFunctions: ["now()", "today()", "current date()"],
    },
    "cib-seven": {
      languages: ["cib-proprietary"],
      defaultLanguage: "cib-proprietary",
      timeFunctions: [], // Detection TBD
    },
    jbpm: {
      languages: ["mvel", "java"],
      defaultLanguage: "mvel",
      timeFunctions: ["new Date()", "System.currentTimeMillis()"],
    },
  };

  /**
   * FEEL function catalog (minimal MVP coverage)
   */
  private readonly feelTimeFunctions = [
    "now()",
    "today()",
    "current date()",
    "current time()",
    "current date and time()",
    "day of week(",
    "month(",
    "year(",
  ];

  private readonly feelPureFunctions = [
    "sum(",
    "count(",
    "min(",
    "max(",
    "mean(",
    "string(",
    "number(",
    "substring(",
    "contains(",
  ];

  async run(context: PassContext): Promise<PassOutput> {
    const expressionDescriptors: ExpressionDescriptor[] = [];
    const findings: Finding[] = [];

    // Extract gateway sequence flows
    const sequenceFlows = this.extractSequenceFlows(context);
    for (const flow of sequenceFlows) {
      const descriptor = this.classifyExpression(flow, context);
      if (descriptor) {
        expressionDescriptors.push(descriptor);

        // Emit finding if expression violates profile constraints
        const profileViolation = this.validateProfileConstraints(descriptor, context);
        if (profileViolation) {
          findings.push(profileViolation);
        }
      }
    }

    // Extract script tasks
    const scriptTasks = this.extractScriptTasks(context);
    for (const task of scriptTasks) {
      const descriptor = this.classifyExpression(task, context);
      if (descriptor) {
        expressionDescriptors.push(descriptor);

        // Emit finding if script language unsupported
        const profileViolation = this.validateProfileConstraints(descriptor, context);
        if (profileViolation) {
          findings.push(profileViolation);
        }
      }
    }

    return { expressionDescriptors, findings };
  }

  /**
   * Extract sequence flows from IR graph (gateway conditions)
   */
  private extractSequenceFlows(context: PassContext): Array<{
    id: string;
    expression?: string;
    language?: string;
    elementType: string;
    sourceRef?: string;
  }> {
    const flows: Array<{
      id: string;
      expression?: string;
      language?: string;
      elementType: string;
      sourceRef?: string;
    }> = [];

    for (const [nodeId, node] of context.ir.nodes.entries()) {
      if (node.kind === "flowNode" && node.flowType === "sequenceFlow") {
        const annotations = context.ir.annotations.get(nodeId) as
          | Record<string, string | undefined>
          | undefined;

        if (annotations?.conditionExpression) {
          flows.push({
            id: nodeId,
            expression: annotations.conditionExpression,
            language: annotations.expressionLanguage,
            elementType: "sequenceFlow",
            sourceRef: annotations.sourceRef,
          });
        }
      }
    }

    return flows;
  }

  /**
   * Extract script tasks from IR graph
   */
  private extractScriptTasks(context: PassContext): Array<{
    id: string;
    expression?: string;
    language?: string;
    elementType: string;
  }> {
    const tasks: Array<{
      id: string;
      expression?: string;
      language?: string;
      elementType: string;
    }> = [];

    for (const [nodeId, node] of context.ir.nodes.entries()) {
      if (node.kind === "flowNode" && node.flowType === "scriptTask") {
        const annotations = context.ir.annotations.get(nodeId) as
          | Record<string, string | undefined>
          | undefined;

        if (annotations?.scriptContent) {
          tasks.push({
            id: nodeId,
            expression: annotations.scriptContent,
            language: annotations.scriptFormat,
            elementType: "scriptTask",
          });
        }
      }
    }

    return tasks;
  }

  /**
   * Classify expression language and determinism
   */
  private classifyExpression(
    element: {
      id: string;
      expression?: string;
      language?: string;
      elementType: string;
      sourceRef?: string;
    },
    context: PassContext,
  ): ExpressionDescriptor | null {
    if (!element.expression) return null;

    // Detect language
    const language = this.detectLanguage(element.expression, element.language, context);

    // Classify Axis Y determinism
    const determinism = this.classifyDeterminism(element.expression, language);

    // Detect function usage
    const functionsUsed = this.detectFunctions(element.expression, language);

    return {
      id: `expr:${element.id}`,
      language,
      text: element.expression,
      content: element.expression,
      hint: determinism === "deterministic" ? "pure" : "runtime",
      nodeId: element.id,
      determinism,
      functionsUsed,
      elementType: element.elementType,
    };
  }

  /**
   * Detect expression language from attributes or patterns
   */
  private detectLanguage(
    expression: string,
    explicitLanguage: string | undefined,
    context: PassContext,
  ): "feel" | "juel" | "groovy" | "javascript" | "python" | "mvel" | "cib-proprietary" | "unknown" {
    // Priority 1: Explicit attribute
    if (explicitLanguage) {
      const normalized = explicitLanguage.toLowerCase();
      if (["feel", "juel", "groovy", "javascript", "python", "mvel"].includes(normalized)) {
        return normalized as ExpressionLanguage;
      }
    }

    // Priority 2: Pattern detection
    // JUEL: ${...}
    if (/^\$\{.*\}$/.test(expression.trim())) {
      return "juel";
    }

    // FEEL: keywords/operators
    if (
      /\b(in|some|every|for|return|if|then|else|function)\b/.test(expression) ||
      /[<>=!]=/.test(expression)
    ) {
      return "feel";
    }

    // MVEL: array indexing or map access
    if (/[\w]+\[.*\]|[\w]+:[\w]+/.test(expression)) {
      return "mvel";
    }

    // Priority 3: Profile default
    const profileId = context.compilerContext.runtimeProfile?.id ?? "generic";
    const rules = this.expressionRules[profileId as keyof typeof this.expressionRules];
    if (rules) {
      return rules.defaultLanguage as ExpressionLanguage;
    }

    return "unknown";
  }

  /**
   * Classify Axis Y determinism
   */
  private classifyDeterminism(expression: string, language: string): AxisYClass {
    // Check for time-dependent patterns
    if (this.hasTimeDependency(expression, language)) {
      return "policyDependent";
    }

    // Check for external calls
    if (this.hasExternalCall(expression, language)) {
      return "runtimeBound";
    }

    // Default: pure computation
    return "deterministic";
  }

  /**
   * Detect time-dependent functions
   */
  private hasTimeDependency(expression: string, language: string): boolean {
    if (language === "feel") {
      return this.feelTimeFunctions.some((fn) => expression.includes(fn));
    }

    if (language === "juel") {
      return /now\(\)|currentDate|Date\.now|System\.currentTimeMillis/.test(expression);
    }

    if (language === "groovy" || language === "javascript") {
      return /new Date\(\)|Date\.now|System\.currentTimeMillis/.test(expression);
    }

    return false;
  }

  /**
   * Detect external calls (bean methods, HTTP, I/O)
   */
  private hasExternalCall(expression: string, language: string): boolean {
    // JUEL bean calls
    if (language === "juel") {
      return /\$\{[\w]+\.[\w]+\(/.test(expression);
    }

    // HTTP / I/O patterns
    if (/HttpClient|fetch\(|Files\.|Socket|URL\(/.test(expression)) {
      return true;
    }

    return false;
  }

  /**
   * Detect function usage
   */
  private detectFunctions(expression: string, language: string): string[] {
    const functions: string[] = [];

    if (language === "feel") {
      // Extract FEEL function calls (remove parentheses and trim)
      for (const fn of [...this.feelTimeFunctions, ...this.feelPureFunctions]) {
        if (expression.includes(fn)) {
          // Remove both opening and closing parentheses
          const cleanName = fn.replace(/\(.*$/, "").trim();
          functions.push(cleanName);
        }
      }
    }

    if (language === "juel") {
      // Extract bean method calls
      const beanPattern = /\$\{([\w]+\.[\w]+)\(/g;
      let match;
      while ((match = beanPattern.exec(expression)) !== null) {
        if (match[1]) {
          functions.push(match[1]);
        }
      }
    }

    return functions;
  }

  /**
   * Validate expression against runtime profile constraints
   */
  private validateProfileConstraints(
    descriptor: ExpressionDescriptor,
    context: PassContext,
  ): Finding | null {
    const profileId = context.compilerContext.runtimeProfile?.id ?? "generic";
    const policyTier = this.parseTier(context.compilerContext.governanceTier);

    // Camunda 8: only FEEL is supported
    if (profileId === "camunda-8" && descriptor.language !== "feel") {
      return finalizeFinding({
        category: "semantic",
        severity: policyTier >= 2 ? "error" : "warning",
        message: `Camunda 8 only supports FEEL expressions, found: ${descriptor.language}`,
        ruleId: this.id,
        targetId: descriptor.nodeId,
        policyClause: "profile.expressionLanguage",
      });
    }

    // Warn if expression language is unknown
    if (descriptor.language === "unknown" && policyTier >= 2) {
      return finalizeFinding({
        category: "semantic",
        severity: "warning",
        message: `Unable to detect expression language: "${descriptor.text}"`,
        ruleId: this.id,
        targetId: descriptor.nodeId,
        policyClause: "expression.language",
      });
    }

    return null;
  }

  /**
   * Parse governance tier string to number
   */
  private parseTier(tier: string): number {
    const match = tier.match(/(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : 1;
  }
}
