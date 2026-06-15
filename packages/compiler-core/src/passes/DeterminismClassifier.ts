// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { DeterminismEntry } from "../types.js";

/**
 * Classification context for a single evaluation point
 */
export interface ClassificationContext {
  readonly elementType: string; // BPMN element type (e.g., 'exclusiveGateway', 'scriptTask', 'serviceTask')
  readonly expression?: string; // Expression text (if applicable)
  readonly expressionLanguage?: "feel" | "juel" | "mvel" | "unknown";
  readonly implementationType?: string; // Service task impl type (e.g., 'javaClass', 'externalTask', 'jobWorker')
  readonly profileId?: string; // Runtime profile ID
  readonly policyTier: number; // Policy governance tier (1, 2, 3)
  readonly scriptFormat?: string; // Script language (e.g., 'groovy', 'javascript', 'python')
}

/**
 * Classification result with Axis Y/B + reasoning
 */
export interface ClassificationResult {
  readonly axisY: DeterminismEntry["axisY"];
  readonly axisX: DeterminismEntry["axisX"];
  readonly confidence: number; // 0.0 to 1.0
  readonly reasoning: string;
  readonly policyClause?: string;
}

/**
 * Pattern library for non-deterministic detection
 */
const NON_DETERMINISTIC_PATTERNS = {
  time: [
    "now()",
    "today()",
    "System.currentTimeMillis()",
    "System.currentMillis()",
    "Date.now()",
    "new Date()",
    "LocalDateTime.now()",
    "LocalDate.now()",
    "Instant.now()",
    "Clock.systemUTC()",
  ],
  random: ["Math.random()", "UUID.randomUUID()", "Random.next", "Random()", "ThreadLocalRandom"],
  externalIO: [
    "HttpClient",
    "Files.",
    "Socket(",
    "ServerSocket",
    "fetch(",
    "XMLHttpRequest",
    "URLConnection",
    "new File(",
    "RandomAccessFile",
  ],
  database: [
    "EntityManager",
    "Session.createQuery",
    "PreparedStatement",
    "DataSource.getConnection",
  ],
};

/**
 * JUEL bean call pattern (e.g., ${service.check()})
 */
const JUEL_BEAN_CALL_PATTERN = /\$\{[\w]+\.[\w]+\(/;

/**
 * Unified determinism classifier for all semantic passes
 */
export class DeterminismClassifier {
  /**
   * Classify evaluation point into Axis Y (determinism) + Axis X (portability)
   */
  classify(context: ClassificationContext): ClassificationResult {
    // Axis Y: Temporal/behavioral determinism
    const axisYResult = this.classifyAxisY(context);

    // Axis X: Runtime coupling/portability
    const axisX = this.classifyAxisX(context);

    return {
      axisY: axisYResult.classification,
      axisX,
      confidence: axisYResult.confidence,
      reasoning: axisYResult.reasoning,
      policyClause: this.inferPolicyClause(context),
    };
  }

  /**
   * Axis Y classification: deterministic vs time-dependent vs non-deterministic
   */
  private classifyAxisY(context: ClassificationContext): {
    classification: DeterminismEntry["axisY"];
    confidence: number;
    reasoning: string;
  } {
    // Check expression for non-deterministic patterns
    if (context.expression) {
      const patterns = this.detectPatterns(context.expression);
      if (patterns.length > 0) {
        return {
          classification: "nonDeterministic",
          confidence: 0.9,
          reasoning: `Non-deterministic pattern detected: ${patterns.join(", ")}`,
        };
      }

      // JUEL bean calls are runtime-bound (not pure)
      if (
        context.expressionLanguage === "juel" &&
        JUEL_BEAN_CALL_PATTERN.test(context.expression)
      ) {
        return {
          classification: "runtimeBound",
          confidence: 0.85,
          reasoning: "JUEL bean method invocation detected",
        };
      }

      // Pure FEEL/JUEL variable comparisons
      if (
        (context.expressionLanguage === "feel" || context.expressionLanguage === "juel") &&
        this.isPureComparison(context.expression)
      ) {
        return {
          classification: "deterministic",
          confidence: 0.95,
          reasoning: "Pure variable comparison",
        };
      }
    }

    // Service task implementations
    if (context.elementType === "serviceTask") {
      if (context.implementationType === "javaClass") {
        return {
          classification: "runtimeBound",
          confidence: 0.8,
          reasoning: "Java class delegate (runtime-bound)",
        };
      }
      if (
        context.implementationType === "externalTask" ||
        context.implementationType === "jobWorker"
      ) {
        return {
          classification: "nonDeterministic",
          confidence: 0.7,
          reasoning: "External service invocation",
        };
      }
    }

    // Script tasks: assume policy-dependent unless patterns detected
    if (context.elementType === "scriptTask") {
      return {
        classification: "policyDependent",
        confidence: 0.7,
        reasoning: "Script task requires pattern analysis",
      };
    }

    // DMN decisions: deterministic unless custom functions
    if (context.elementType === "businessRuleTask") {
      return {
        classification: "deterministic",
        confidence: 0.85,
        reasoning: "DMN decision table (assumed pure)",
      };
    }

    // Default: policy-dependent
    return {
      classification: "policyDependent",
      confidence: 0.5,
      reasoning: "Unknown evaluation type, policy-driven",
    };
  }

  /**
   * Axis X classification: engine-agnostic vs profile-scoped vs runtime-bound
   */
  private classifyAxisX(context: ClassificationContext): DeterminismEntry["axisX"] {
    // FEEL is profile-scoped (profile determines function libraries)
    if (context.expressionLanguage === "feel") {
      return "profileScoped";
    }

    // JUEL is runtime-bound (engine-specific)
    if (context.expressionLanguage === "juel") {
      return "engineSpecific";
    }

    // MVEL is runtime-bound (jBPM-specific)
    if (context.expressionLanguage === "mvel") {
      return "engineSpecific";
    }

    // Service task implementations
    if (context.implementationType === "javaClass") {
      return "engineSpecific";
    }
    if (
      context.implementationType === "externalTask" ||
      context.implementationType === "jobWorker"
    ) {
      return "externalized";
    }
    if (context.implementationType === "connector" || context.implementationType === "adapter") {
      return "profileScoped";
    }

    // Script engines are runtime-bound
    if (context.scriptFormat) {
      return "engineSpecific";
    }

    // No profile provided
    if (!context.profileId) {
      return "unknown";
    }

    // Default: engine-agnostic
    return "engineAgnostic";
  }

  /**
   * Detect non-deterministic patterns in expression text
   */
  private detectPatterns(expression: string): string[] {
    const detected: string[] = [];

    // Time functions
    for (const pattern of NON_DETERMINISTIC_PATTERNS.time) {
      if (expression.includes(pattern)) {
        detected.push(pattern);
      }
    }

    // Random functions
    for (const pattern of NON_DETERMINISTIC_PATTERNS.random) {
      if (expression.includes(pattern)) {
        detected.push(pattern);
      }
    }

    // External I/O
    for (const pattern of NON_DETERMINISTIC_PATTERNS.externalIO) {
      if (expression.includes(pattern)) {
        detected.push(pattern);
      }
    }

    // Database access
    for (const pattern of NON_DETERMINISTIC_PATTERNS.database) {
      if (expression.includes(pattern)) {
        detected.push(pattern);
      }
    }

    return detected;
  }

  /**
   * Check if expression is a pure variable comparison
   * (heuristic: no function calls, no I/O)
   */
  private isPureComparison(expression: string): boolean {
    // FEEL: simple comparisons like "amount > 1000"
    if (/^[\w\s><=!&|()]+$/.test(expression)) {
      return true;
    }

    // JUEL: variable-only like "${orderTotal > 1000}"
    if (/^\$\{[\w\s><=!&|()]+\}$/.test(expression)) {
      return true;
    }

    return false;
  }

  /**
   * Infer policy clause based on context
   */
  private inferPolicyClause(context: ClassificationContext): string {
    if (context.elementType === "scriptTask") {
      return "determinism.scriptTaskRestrictions";
    }
    if (context.elementType === "serviceTask") {
      return "determinism.integrationBoundaries";
    }
    if (context.elementType === "businessRuleTask") {
      return "determinism.decisionLogic";
    }
    if (context.elementType.includes("Gateway")) {
      return "determinism.gatewayConditions";
    }
    return "determinism.default";
  }

  /**
   * Check if policy tier restricts non-deterministic patterns
   */
  shouldRestrict(classification: ClassificationResult, context: ClassificationContext): boolean {
    // Tier 1: warnings only
    if (context.policyTier === 1) {
      return false;
    }

    // Tier 2+: restrict non-deterministic patterns
    if (
      context.policyTier >= 2 &&
      (classification.axisY === "nonDeterministic" || classification.axisY === "runtimeBound")
    ) {
      return true;
    }

    // Tier 3: strict restrictions
    if (context.policyTier >= 3 && classification.axisY === "policyDependent") {
      return true;
    }

    return false;
  }
}

/**
 * Singleton instance for convenience
 */
export const determinismClassifier = new DeterminismClassifier();
