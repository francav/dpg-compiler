// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { Finding, ContractCoverageEntry } from "../types.js";
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

/**
 * Contract reference (MVP: detection only, no parsing)
 */
export interface ContractReference {
  readonly boundaryId: string; // BPMN element ID
  readonly contractId?: string; // External contract reference (URL, file path)
  readonly contractFormat?: string; // 'openapi-3.0' | 'asyncapi-2.0' | 'grpc-proto'
}

/**
 * Service task implementation types that require contracts
 */
const REQUIRES_CONTRACT = new Set(["externalTask", "jobWorker", "connector", "adapter"]);

/**
 * Contract Coverage Analyzer
 *
 * Detects missing integration contracts for external boundaries.
 * Analyzes service tasks and message events to identify integration points.
 *
 * **Phase:** L2 (semantic-determinism)
 * **Dependencies:** structural-validation
 *
 * **Responsibilities:**
 * - Identify integration boundaries (service tasks with external implementations)
 * - Cross-reference boundary IDs with provided contract definitions (if any)
 * - Populate ContractCoverageEntry with contract presence status
 * - Emit findings when contracts are missing and policy tier ≥ 2
 *
 * **MVP Scope:**
 * - ✅ Detection of missing contracts for external service tasks
 * - ✅ Contract reference cataloging (URL/ID captured, not validated)
 * - ⏳ Contract parsing/validation (post-MVP)
 * - ⏳ Message event contract coverage (post-MVP)
 * - ⏳ Send/receive task contract coverage (post-MVP)
 *
 * **Policy Integration:**
 * - Tier 1: Info findings only
 * - Tier 2: Warning findings for missing contracts
 * - Tier 3: Error findings for missing contracts
 */
export class ContractCoverageAnalyzer implements SemanticPass {
  readonly id = "contract-coverage-analyzer";
  readonly phase = "L2" as const;
  readonly requires = ["structural-validation"] as const;

  /**
   * Execute contract coverage analysis
   */
  run(context: PassContext): PassOutput {
    const findings: Finding[] = [];
    const contractCoverage: ContractCoverageEntry[] = [];

    const profileId = context.compilerContext.runtimeProfile?.id ?? "unknown";
    const tierMatch = context.compilerContext.governanceTier.match(/\d+/);
    const policyTier = tierMatch ? parseInt(tierMatch[0], 10) : 1;

    // Contract definitions (from compilation context - MVP: empty for now)
    const declaredContracts = this.loadDeclaredContracts(context);

    // Extract service task nodes
    const serviceTasks = Array.from(context.ir.nodes.values()).filter(
      (node) =>
        node.kind === "flowNode" &&
        (node.flowType === "serviceTask" || node.flowType === "bpmn:serviceTask"),
    );

    for (const serviceTask of serviceTasks) {
      const attributes = (context.ir.annotations.get(serviceTask.id) ?? {}) as Record<
        string,
        string
      >;

      const implementationType = this.detectImplementationType(attributes, profileId);

      // Only analyze tasks that require external contracts
      if (!REQUIRES_CONTRACT.has(implementationType)) {
        continue;
      }

      const contractRef = declaredContracts.find((ref) => ref.boundaryId === serviceTask.id);

      const hasDeclaredContract = !!contractRef;
      const missingContract = !hasDeclaredContract;

      // Create contract coverage entry
      const entry: ContractCoverageEntry = {
        boundaryId: serviceTask.id,
        coverageRatio: hasDeclaredContract ? 1.0 : 0.0,
        risk: hasDeclaredContract ? "low" : "high",
        issues: missingContract ? ["No contract definition provided"] : [],
        policyClause: "integration-contract-coverage",
        bpmnElementType: "serviceTask",
        implementationType,
        hasDeclaredContract,
        contractReference: contractRef?.contractId,
        missingContract,
      };

      contractCoverage.push(entry);

      // Emit finding if contract missing and policy tier ≥ 2
      if (missingContract && policyTier >= 2) {
        const ruleEnabled = context.compilerContext.policy.ruleToggles["MISSING_CONTRACT"] ?? true;

        if (ruleEnabled) {
          const severity = policyTier >= 3 ? "error" : "warning";

          findings.push(
            finalizeFinding({
              category: "semantic",
              severity,
              message: `Integration boundary '${serviceTask.id}' (${implementationType}) has no declared contract`,
              targetId: serviceTask.id,
              ruleId: "MISSING_CONTRACT",
              confidence: 0.9,
              policyClause: "integration-contract-coverage",
              remediation:
                "Provide contract definition (OpenAPI, AsyncAPI, gRPC) for external integration",
            }),
          );
        }
      }

      // Emit info finding for tier 1 (advisory)
      if (missingContract && policyTier === 1) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "info",
            message: `Integration boundary '${serviceTask.id}' has no declared contract (advisory only at tier 1)`,
            targetId: serviceTask.id,
            ruleId: "MISSING_CONTRACT_INFO",
            confidence: 0.9,
            policyClause: "integration-contract-coverage",
          }),
        );
      }
    }

    return {
      findings,
      contractCoverage,
    };
  }

  /**
   * Detect service task implementation type from attributes
   */
  private detectImplementationType(attributes: Record<string, string>, profileId: string): string {
    // Camunda 7
    if (profileId === "camunda-7") {
      if (attributes["camunda:type"] === "external") {
        return "externalTask";
      }
      if (attributes["camunda:connectorId"]) {
        return "connector";
      }
      if (attributes["camunda:class"]) {
        return "javaClass";
      }
      if (attributes["camunda:delegateExpression"]) {
        return "delegateExpression";
      }
    }

    // Camunda 8
    if (profileId === "camunda-8") {
      if (attributes["zeebe:taskDefinition"]) {
        return "jobWorker";
      }
    }

    // CIB Seven
    if (profileId === "cib-seven") {
      if (attributes["cib:adapterType"]) {
        return "adapter";
      }
    }

    // jBPM
    if (profileId === "jbpm") {
      if (attributes["ioSpecification"]) {
        return "workItemHandler";
      }
    }

    return "unknown";
  }

  /**
   * Load declared contract references from compilation context
   *
   * MVP: Returns empty array (contract ingestion not yet implemented)
   * Post-MVP: Will load from `context.compilerContext.contracts`
   */
  private loadDeclaredContracts(_context: PassContext): ContractReference[] {
    // MVP: No contract ingestion - always returns empty
    // Post-MVP: Load from context.compilerContext.contracts
    return [];
  }
}
