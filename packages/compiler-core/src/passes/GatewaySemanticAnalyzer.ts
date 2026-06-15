// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type {
  AxisYClass,
  ExpressionDescriptor,
  Finding,
  FlowNodeIr,
  GatewayDescriptor,
  IrNode,
} from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import {
  parseCondition,
  unionCoversReals,
  intersects,
  type NumericInterval,
} from "./feel/UnaryTestRange.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

type GatewayType = "exclusive" | "inclusive" | "parallel" | "eventBased" | "complex";

type OutgoingFlow = {
  flowId: string;
  hasCondition: boolean;
  conditionText?: string;
  conditionDeterminism?: AxisYClass;
};

/**
 * The outcome of analyzing a gateway's routing coverage. `covered` feeds the descriptor's
 * boolean `conditionCoverage`; `reason` drives the wording/severity of any finding so the
 * compiler never claims coverage it could not actually verify.
 */
type CoverageResult = {
  covered: boolean;
  reason:
    | "default" // a default flow guarantees a path
    | "proven" // conditions provably partition/cover the domain
    | "gap" // conditions provably leave an uncovered region
    | "incomplete" // a non-default flow lacks a condition
    | "unanalyzable" // conditions present but not statically analyzable
    | "parallel-ok" // parallel gateway with no conditions (correct)
    | "parallel-violation" // parallel gateway carrying conditions (BPMN violation)
    | "not-applicable"; // eventBased/complex — coverage is not condition-based
  /** Exclusive gateways only: conditions that can both be true (ambiguous routing). */
  overlap: boolean;
};

/**
 * Gateway Semantic Analyzer (Sprint 3)
 *
 * Enhances gateway condition analysis with runtime profile validation and coverage checks.
 *
 * Responsibilities:
 * - Validate condition coverage (default flow, real exhaustiveness, gaps)
 * - Distinguish exclusive (exactly one flow fires; overlap is ambiguous) from inclusive
 *   (any subset fires; overlap is expected)
 * - Cross-reference ExpressionDescriptor from ExpressionClassifier
 * - Aggregate determinism classifications across all outgoing flows
 * - Detect BPMN violations (parallel gateway with conditions)
 * - Populate GatewayDescriptor entries
 *
 * Exhaustiveness and overlap are computed with the shared FEEL {@link UnaryTestRange}
 * comparator. Conditions that cannot be analyzed (function calls, multi-variable, non-FEEL)
 * never yield a false coverage claim — they degrade to "could not verify".
 */
export class GatewaySemanticAnalyzer implements SemanticPass {
  readonly id = "gateway-semantic-analyzer";
  readonly phase = "L2" as const;
  readonly requires = ["expression-classifier"] as const;

  async run(context: PassContext): Promise<PassOutput> {
    const gatewayDescriptors: GatewayDescriptor[] = [];
    const findings: Finding[] = [];

    // Extract gateway nodes
    const gateways = Array.from(context.ir.nodes.values()).filter(
      (node) =>
        node.kind === "flowNode" &&
        (node.flowType.includes("Gateway") || node.flowType.includes("gateway")),
    );

    if (gateways.length === 0) {
      return { gatewayDescriptors, findings };
    }

    // Analyze each gateway
    for (const gateway of gateways) {
      const analyzed = await this.analyzeGateway(gateway, context);
      if (analyzed) {
        gatewayDescriptors.push(analyzed.descriptor);
        findings.push(...this.buildFindings(analyzed.descriptor, analyzed.coverage, context));
      }
    }

    return { gatewayDescriptors, findings };
  }

  /**
   * Analyze a single gateway node
   */
  private async analyzeGateway(
    gateway: IrNode,
    context: PassContext,
  ): Promise<{ descriptor: GatewayDescriptor; coverage: CoverageResult } | null> {
    if (gateway.kind !== "flowNode") return null;

    const gatewayType = this.detectGatewayType(gateway.flowType);
    const annotations = context.ir.annotations.get(gateway.id) as
      | Record<string, unknown>
      | undefined;

    // Extract outgoing flows
    const outgoingFlows = await this.extractOutgoingFlows(gateway, context);

    // Aggregate determinism across all conditions
    const determinism = this.aggregateDeterminism(outgoingFlows);

    // Detect default flow
    const defaultFlow = (annotations?.default ?? annotations?.["default"]) as string | undefined;

    // Compute real coverage (and exclusive-gateway condition overlap)
    const coverage = this.computeCoverage(gatewayType, outgoingFlows, defaultFlow);

    const descriptor: GatewayDescriptor = {
      gatewayId: gateway.id,
      type: gatewayType,
      conditionCoverage: coverage.covered,
      determinism,
      outgoingFlows: outgoingFlows.map(({ flowId, hasCondition, conditionDeterminism }) => ({
        flowId,
        hasCondition,
        conditionDeterminism,
      })),
      defaultFlow,
    };

    return { descriptor, coverage };
  }

  /**
   * Detect gateway type from flowType string
   */
  private detectGatewayType(flowType: string): GatewayType {
    const normalized = flowType.toLowerCase();

    if (normalized.includes("exclusive")) return "exclusive";
    if (normalized.includes("inclusive")) return "inclusive";
    if (normalized.includes("parallel")) return "parallel";
    if (normalized.includes("event")) return "eventBased";
    if (normalized.includes("complex")) return "complex";

    // Default to exclusive
    return "exclusive";
  }

  /**
   * Extract outgoing flows and their condition information
   */
  private async extractOutgoingFlows(
    gateway: FlowNodeIr,
    context: PassContext,
  ): Promise<OutgoingFlow[]> {
    const flows: OutgoingFlow[] = [];

    // Determinism comes from the ExpressionDescriptor records that
    // ExpressionClassifier produced upstream (keyed by sequence-flow node id),
    // exposed on the context by PassRunner — not from a local regex heuristic.
    const determinismByNode = this.indexExpressionDeterminism(context);

    // Find all sequence flow nodes
    for (const [flowId, node] of context.ir.nodes.entries()) {
      if (node.kind !== "flowNode" || node.flowType !== "sequenceFlow") {
        continue;
      }

      const flowAnnotations = context.ir.annotations.get(flowId) as
        | Record<string, unknown>
        | undefined;

      // Check if this flow's sourceRef matches the gateway
      if (flowAnnotations?.sourceRef !== gateway.id) {
        continue;
      }

      // This flow originates from our gateway
      const conditionText = flowAnnotations?.conditionExpression as string | undefined;
      const hasCondition = !!conditionText;

      const conditionDeterminism = hasCondition ? determinismByNode.get(flowId) : undefined;

      flows.push({
        flowId,
        hasCondition,
        conditionText,
        conditionDeterminism,
      });
    }

    return flows;
  }

  /**
   * Build a flow-id → Axis Y map from ExpressionClassifier's descriptors.
   */
  private indexExpressionDeterminism(context: PassContext): Map<string, AxisYClass> {
    const descriptors =
      (context as { expressionDescriptors?: readonly ExpressionDescriptor[] })
        .expressionDescriptors ?? [];
    const byNode = new Map<string, AxisYClass>();
    for (const descriptor of descriptors) {
      if (descriptor.determinism) {
        byNode.set(descriptor.nodeId, descriptor.determinism);
      }
    }
    return byNode;
  }

  /**
   * Aggregate determinism across all outgoing flows.
   * Gateway determinism = least deterministic condition. A flow whose condition could not be
   * classified contributes `unknown`, which ranks above `deterministic` so an unanalyzed
   * condition is never reported as deterministic.
   */
  private aggregateDeterminism(flows: OutgoingFlow[]): AxisYClass {
    const determinisms = flows
      .filter((f) => f.hasCondition)
      .map((f) => f.conditionDeterminism ?? "unknown");

    if (determinisms.length === 0) {
      return "deterministic"; // No conditions = deterministic
    }

    // Least deterministic wins:
    // nonDeterministic > runtimeBound > policyDependent > unknown > deterministic
    if (determinisms.includes("nonDeterministic")) return "nonDeterministic";
    if (determinisms.includes("runtimeBound")) return "runtimeBound";
    if (determinisms.includes("policyDependent")) return "policyDependent";
    if (determinisms.includes("unknown")) return "unknown";
    return "deterministic";
  }

  /**
   * Compute routing coverage for a gateway.
   *
   * - parallel: correct only when no flow carries a condition.
   * - exclusive/inclusive: a default flow guarantees a path; otherwise coverage is only
   *   asserted when the conditions provably cover the whole domain of a single variable.
   *   A missing condition, an unparseable condition, or multiple variables degrade to
   *   "could not verify" (covered = false) rather than a false positive.
   * - exclusive also flags conditions that can both be true (ambiguous routing).
   * - eventBased/complex: coverage is not condition-based (not applicable).
   */
  private computeCoverage(
    type: GatewayType,
    flows: OutgoingFlow[],
    defaultFlow?: string,
  ): CoverageResult {
    if (type === "parallel") {
      const hasConditions = flows.some((f) => f.hasCondition);
      return {
        covered: !hasConditions,
        reason: hasConditions ? "parallel-violation" : "parallel-ok",
        overlap: false,
      };
    }

    if (type === "eventBased" || type === "complex") {
      // Event-based routing is event-driven, and complex gateways use opaque activation
      // logic — neither is decided by sequence-flow conditions, so coverage is not analyzable.
      return { covered: true, reason: "not-applicable", overlap: false };
    }

    // exclusive | inclusive
    const overlap = type === "exclusive" ? this.detectConditionOverlap(flows) : false;

    if (defaultFlow) {
      return { covered: true, reason: "default", overlap };
    }

    // Without a default flow, every outgoing flow must carry a condition.
    if (flows.length === 0 || flows.some((f) => !f.hasCondition)) {
      return { covered: false, reason: "incomplete", overlap };
    }

    // Parse every condition; they must all be single comparisons over the same variable.
    const parsed = flows.map((f) => parseCondition(f.conditionText ?? ""));
    if (parsed.some((p) => p === null)) {
      return { covered: false, reason: "unanalyzable", overlap };
    }
    const variables = new Set(parsed.map((p) => p!.variable));
    if (variables.size !== 1) {
      return { covered: false, reason: "unanalyzable", overlap };
    }

    const intervals: NumericInterval[] = parsed.flatMap((p) => [...p!.region.intervals]);
    const covered = unionCoversReals(intervals);
    return { covered, reason: covered ? "proven" : "gap", overlap };
  }

  /** Exclusive gateways: any two conditions that can both be true are ambiguous. */
  private detectConditionOverlap(flows: OutgoingFlow[]): boolean {
    const regions = flows
      .map((f) => parseCondition(f.conditionText ?? ""))
      .filter((p): p is NonNullable<typeof p> => p !== null);

    for (let i = 0; i < regions.length; i++) {
      for (let j = 0; j < i; j++) {
        // Only comparable when the two conditions test the same variable.
        if (regions[i]!.variable !== regions[j]!.variable) continue;
        if (intersects(regions[i]!.region, regions[j]!.region)) return true;
      }
    }
    return false;
  }

  /**
   * Turn a gateway's coverage result into findings, with wording/severity that never
   * over-claims (a gap is reported differently from "could not verify").
   */
  private buildFindings(
    descriptor: GatewayDescriptor,
    coverage: CoverageResult,
    context: PassContext,
  ): Finding[] {
    const findings: Finding[] = [];
    const policyTier = this.parseTier(context.compilerContext.governanceTier);
    const { gatewayId, type } = descriptor;

    if (coverage.reason === "parallel-violation") {
      findings.push(
        finalizeFinding({
          category: "semantic",
          severity: policyTier >= 2 ? "error" : "warning",
          message: `Parallel gateway should not have sequence flow conditions (BPMN 2.0 violation)`,
          ruleId: this.id,
          targetId: gatewayId,
          policyClause: "bpmn.parallelGatewayConditions",
        }),
      );
    }

    if (type === "complex") {
      findings.push(
        finalizeFinding({
          category: "semantic",
          severity: "info",
          message: `Complex gateway routing is not statically analyzable; condition coverage was not verified`,
          ruleId: this.id,
          targetId: gatewayId,
          policyClause: "bpmn.gatewayConditionCoverage",
        }),
      );
    }

    if ((type === "exclusive" || type === "inclusive") && !coverage.covered) {
      const message =
        coverage.reason === "gap"
          ? `${type} gateway missing default flow and its conditions leave an uncovered gap`
          : `${type} gateway missing default flow; could not verify exhaustive condition coverage`;
      findings.push(
        finalizeFinding({
          category: "semantic",
          severity: policyTier >= 2 ? "warning" : "info",
          message,
          ruleId: this.id,
          targetId: gatewayId,
          policyClause: "bpmn.gatewayConditionCoverage",
        }),
      );
    }

    if (type === "exclusive" && coverage.overlap) {
      findings.push(
        finalizeFinding({
          category: "semantic",
          severity: policyTier >= 2 ? "warning" : "info",
          message: `Exclusive gateway has overlapping conditions; more than one flow can be taken (ambiguous routing)`,
          ruleId: this.id,
          targetId: gatewayId,
          policyClause: "bpmn.exclusiveGatewayOverlap",
        }),
      );
    }

    return findings;
  }

  /**
   * Parse governance tier string to number
   */
  private parseTier(tier: string): number {
    const match = tier.match(/(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : 1;
  }
}
