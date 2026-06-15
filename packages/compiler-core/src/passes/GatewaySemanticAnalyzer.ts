// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { AxisYClass, Finding, FlowNodeIr, GatewayDescriptor, IrNode } from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

/**
 * Gateway Semantic Analyzer (Sprint 3)
 *
 * Enhances gateway condition analysis with runtime profile validation and coverage checks.
 *
 * Responsibilities:
 * - Validate condition coverage (default flow, exhaustive conditions)
 * - Cross-reference ExpressionDescriptor from ExpressionClassifier
 * - Aggregate determinism classifications across all outgoing flows
 * - Profile-aware validation (Camunda 8 FEEL-only constraint, etc.)
 * - Detect BPMN violations (parallel gateway with conditions)
 * - Populate GatewayDescriptor entries
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
      const descriptor = await this.analyzeGateway(gateway, context);
      if (descriptor) {
        gatewayDescriptors.push(descriptor);

        // Emit findings for coverage issues
        const coverageFindings = this.validateCoverage(descriptor, context);
        findings.push(...coverageFindings);
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
  ): Promise<GatewayDescriptor | null> {
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

    // Check condition coverage
    const conditionCoverage = this.checkConditionCoverage(gatewayType, outgoingFlows, defaultFlow);

    return {
      gatewayId: gateway.id,
      type: gatewayType,
      conditionCoverage,
      determinism,
      outgoingFlows,
      defaultFlow,
    };
  }

  /**
   * Detect gateway type from flowType string
   */
  private detectGatewayType(
    flowType: string,
  ): "exclusive" | "inclusive" | "parallel" | "eventBased" | "complex" {
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
  ): Promise<
    Array<{
      flowId: string;
      hasCondition: boolean;
      conditionDeterminism?: AxisYClass;
    }>
  > {
    const flows: Array<{
      flowId: string;
      hasCondition: boolean;
      conditionDeterminism?: AxisYClass;
    }> = [];

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
      const hasCondition = !!flowAnnotations?.conditionExpression;

      const conditionDeterminism = hasCondition
        ? this.inferDeterminism(flowAnnotations.conditionExpression as string)
        : undefined;

      flows.push({
        flowId,
        hasCondition,
        conditionDeterminism,
      });
    }

    return flows;
  }

  /**
   * Infer determinism from condition expression (simplified heuristic)
   * TODO: Read from ExpressionDescriptor populated by ExpressionClassifier
   */
  private inferDeterminism(expression: string): AxisYClass {
    // Time-dependent patterns
    if (/now\(|today\(|Date\.|currentTime/.test(expression)) {
      return "policyDependent";
    }

    // External call patterns
    if (/\$\{[\w]+\.[\w]+\(|HttpClient|fetch\(/.test(expression)) {
      return "runtimeBound";
    }

    // Default: pure
    return "deterministic";
  }

  /**
   * Aggregate determinism across all outgoing flows
   * Gateway determinism = least deterministic condition
   */
  private aggregateDeterminism(
    flows: Array<{
      flowId: string;
      hasCondition: boolean;
      conditionDeterminism?: AxisYClass;
    }>,
  ): AxisYClass {
    const determinisms = flows
      .map((f) => f.conditionDeterminism)
      .filter((d) => d !== undefined) as AxisYClass[];

    if (determinisms.length === 0) {
      return "deterministic"; // No conditions = deterministic
    }

    // Priority: runtimeBound > policyDependent > deterministic
    if (determinisms.includes("runtimeBound")) return "runtimeBound";
    if (determinisms.includes("policyDependent")) return "policyDependent";
    return "deterministic";
  }

  /**
   * Check condition coverage for gateway
   */
  private checkConditionCoverage(
    type: "exclusive" | "inclusive" | "parallel" | "eventBased" | "complex",
    flows: Array<{ flowId: string; hasCondition: boolean }>,
    defaultFlow?: string,
  ): boolean {
    // Parallel gateways should NOT have conditions
    if (type === "parallel") {
      return !flows.some((f) => f.hasCondition);
    }

    // Exclusive/inclusive gateways should have default flow OR exhaustive conditions
    if (type === "exclusive" || type === "inclusive") {
      // Has default flow
      if (defaultFlow) return true;

      // Check if all outgoing flows have conditions (exhaustive)
      const allHaveConditions = flows.every((f) => f.hasCondition);
      return allHaveConditions;
    }

    // Event-based and complex: always covered (no validation)
    return true;
  }

  /**
   * Validate condition coverage and emit findings
   */
  private validateCoverage(descriptor: GatewayDescriptor, context: PassContext): Finding[] {
    const findings: Finding[] = [];
    const policyTier = this.parseTier(context.compilerContext.governanceTier);

    // Parallel gateway violation: has conditions
    if (descriptor.type === "parallel" && descriptor.outgoingFlows.some((f) => f.hasCondition)) {
      findings.push(
        finalizeFinding({
          category: "semantic",
          severity: policyTier >= 2 ? "error" : "warning",
          message: `Parallel gateway should not have sequence flow conditions (BPMN 2.0 violation)`,
          ruleId: this.id,
          targetId: descriptor.gatewayId,
          policyClause: "bpmn.parallelGatewayConditions",
        }),
      );
    }

    // Exclusive/inclusive gateway: missing default flow and non-exhaustive
    if (
      (descriptor.type === "exclusive" || descriptor.type === "inclusive") &&
      !descriptor.conditionCoverage
    ) {
      findings.push(
        finalizeFinding({
          category: "semantic",
          severity: policyTier >= 2 ? "warning" : "info",
          message: `${descriptor.type} gateway missing default flow and conditions may not be exhaustive`,
          ruleId: this.id,
          targetId: descriptor.gatewayId,
          policyClause: "bpmn.gatewayConditionCoverage",
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
