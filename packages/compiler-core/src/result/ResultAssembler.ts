// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type {
  BusinessRuleTaskDescriptor,
  CompilerContext,
  CompilerResult,
  ContractCoverageEntry,
  DecisionAnalysisEntry,
  DeterminismEntry,
  DmnDecisionDescriptor,
  DmnExpressionDescriptor,
  ExpressionDescriptor,
  Finding,
  GatewayDescriptor,
  MaturitySignal,
  ResultMetadata,
  ResultSummary,
  RuntimeDependencyEntry,
} from "../types.js";

export interface ResultAssemblerInput {
  readonly compilerContext: CompilerContext;
  readonly structuralFindings: readonly Finding[];
  readonly semanticFindings: readonly Finding[];
  readonly determinism: readonly DeterminismEntry[];
  readonly runtimeDependencies: readonly RuntimeDependencyEntry[];
  readonly degraded: boolean;
  // MVP extensions
  readonly decisionAnalysis?: readonly DecisionAnalysisEntry[];
  readonly contractCoverage?: readonly ContractCoverageEntry[];
  readonly maturitySignal?: MaturitySignal;
  // Sprint 3 extensions
  readonly expressionDescriptors?: readonly ExpressionDescriptor[];
  readonly gatewayDescriptors?: readonly GatewayDescriptor[];
  // Sprint 4 extensions
  readonly dmnExpressionDescriptors?: readonly DmnExpressionDescriptor[];
  readonly dmnDecisionDescriptors?: readonly DmnDecisionDescriptor[];
  readonly businessRuleTaskDescriptors?: readonly BusinessRuleTaskDescriptor[];
}

export function assembleResult(input: ResultAssemblerInput): CompilerResult {
  const metadata: ResultMetadata = {
    compilerVersion: "0.1.0",
    timestamp: input.compilerContext.metadata.timestamp,
    modelId: input.compilerContext.modelId,
    inputHashes: {
      bpmn: input.compilerContext.normalizedBpmn?.checksum,
      dmn: input.compilerContext.normalizedDmn?.checksum,
    },
    policyId: input.compilerContext.policy.id,
    policyVersion: input.compilerContext.policy.version,
    runtimeProfileId: input.compilerContext.runtimeProfile?.id,
    runtimeProfileVersion: input.compilerContext.runtimeProfile?.version,
    governanceTier: input.compilerContext.governanceTier,
    degraded: input.degraded,
  };

  const summary: ResultSummary = {
    structuralErrors: input.structuralFindings.filter((f) => f.severity === "error").length,
    semanticErrors: input.semanticFindings.filter((f) => f.severity === "error").length,
    warnings: input.semanticFindings.filter((f) => f.severity === "warning").length,
    determinismCompliance: !input.degraded,
    runtimeProfileMissing:
      !input.compilerContext.runtimeProfile &&
      Boolean(input.compilerContext.policy.runtimeProfileRequired),
    contractCoverageRatio: calculateContractCoverageRatio(input.contractCoverage),
    decisionAnalysisStatus:
      input.decisionAnalysis && input.decisionAnalysis.length > 0 ? "complete" : "skipped",
    governanceTier: input.compilerContext.governanceTier,
    maturitySignal: input.maturitySignal,
  };

  return {
    metadata,
    structuralFindings: input.structuralFindings,
    semanticFindings: input.semanticFindings,
    determinismMap: input.determinism,
    runtimeDependencyMap: input.runtimeDependencies,
    decisionAnalysis: input.decisionAnalysis ?? [],
    contractCoverage: input.contractCoverage ?? [],
    summary,
    // Sprint 3 extensions
    expressionDescriptors: input.expressionDescriptors,
    gatewayDescriptors: input.gatewayDescriptors,
    // Sprint 4 extensions
    dmnExpressionDescriptors: input.dmnExpressionDescriptors,
    dmnDecisionDescriptors: input.dmnDecisionDescriptors,
    businessRuleTaskDescriptors: input.businessRuleTaskDescriptors,
  };
}

function calculateContractCoverageRatio(
  contractCoverage?: readonly ContractCoverageEntry[],
): number {
  if (!contractCoverage || contractCoverage.length === 0) {
    return 0;
  }
  const covered = contractCoverage.filter((entry) => entry.hasDeclaredContract).length;
  return covered / contractCoverage.length;
}
