// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type {
  BusinessRuleTaskDescriptor,
  CompilerContext,
  ContractCoverageEntry,
  DecisionAnalysisEntry,
  DeterminismEntry,
  DmnDecisionDescriptor,
  DmnExpressionDescriptor,
  ExpressionDescriptor,
  Finding,
  GatewayDescriptor,
  IrGraph,
  MaturitySignal,
  RuntimeDependencyEntry,
} from "../types.js";

export interface PassContext {
  readonly compilerContext: CompilerContext;
  readonly ir: IrGraph;
  readonly findings: Finding[];
  annotate(id: string, data: Record<string, unknown>): void;
}

export interface PassOutput {
  readonly findings?: readonly Finding[];
  readonly determinism?: readonly DeterminismEntry[];
  readonly runtimeDependencies?: readonly RuntimeDependencyEntry[];
  readonly runtimeDependencyMap?: readonly RuntimeDependencyEntry[]; // Alias for compatibility
  readonly degraded?: boolean;
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

export interface SemanticPass {
  readonly id: string;
  readonly phase: "L1" | "L2" | "analysis" | "contracts" | "summary";
  readonly requires?: readonly string[];
  run(context: PassContext): Promise<PassOutput> | PassOutput;
}
