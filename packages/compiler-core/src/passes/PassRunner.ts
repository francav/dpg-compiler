// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type {
  AnnotationBag,
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
import { finalizeFinding } from "../parser/findingHelpers.js";
import type { PassContext, PassOutput, SemanticPass } from "./SemanticPass.js";

export interface PassRunnerOutput {
  readonly findings: Finding[];
  readonly determinism: PassOutput["determinism"];
  readonly runtimeDependencies: PassOutput["runtimeDependencies"];
  readonly decisionAnalysis?: readonly DecisionAnalysisEntry[];
  readonly contractCoverage?: readonly ContractCoverageEntry[];
  readonly maturitySignal?: MaturitySignal;
  readonly degraded: boolean;
  // Sprint 3 extensions
  readonly expressionDescriptors?: readonly ExpressionDescriptor[];
  readonly gatewayDescriptors?: readonly GatewayDescriptor[];
  // Sprint 4 extensions
  readonly dmnExpressionDescriptors?: readonly DmnExpressionDescriptor[];
  readonly dmnDecisionDescriptors?: readonly DmnDecisionDescriptor[];
  readonly businessRuleTaskDescriptors?: readonly BusinessRuleTaskDescriptor[];
}

export class PassRunner {
  constructor(private readonly passes: readonly SemanticPass[]) {}

  async run(context: CompilerContext, ir: IrGraph): Promise<PassRunnerOutput> {
    const findings: Finding[] = [];
    const determinism: DeterminismEntry[] = [];
    const runtimeDependencies: RuntimeDependencyEntry[] = [];
    const decisionAnalysis: DecisionAnalysisEntry[] = [];
    const contractCoverage: ContractCoverageEntry[] = [];
    const expressionDescriptors: ExpressionDescriptor[] = [];
    const gatewayDescriptors: GatewayDescriptor[] = [];
    const dmnExpressionDescriptors: DmnExpressionDescriptor[] = [];
    const dmnDecisionDescriptors: DmnDecisionDescriptor[] = [];
    const businessRuleTaskDescriptors: BusinessRuleTaskDescriptor[] = [];
    let maturitySignal: MaturitySignal | undefined = undefined;
    let degraded = false;
    const annotations = ir.annotations as Map<string, AnnotationBag>;

    const passContext: PassContext = {
      compilerContext: context,
      ir,
      findings,
      annotate: (id: string, data: Record<string, unknown>) => {
        annotations.set(id, { ...(annotations.get(id) ?? {}), ...data });
      },
    } as PassContext; // Type cast to allow dynamic properties for cross-pass data sharing

    // Expose the live accumulator arrays so downstream passes can consume real
    // upstream output (e.g. GatewaySemanticAnalyzer reads ExpressionClassifier's
    // descriptors; AggregationEngine reads every prior pass's determinism entries).
    // The arrays are mutated in place below, so the references stay current.
    (passContext as { expressionDescriptors?: ExpressionDescriptor[] }).expressionDescriptors =
      expressionDescriptors;
    (passContext as { determinismEntries?: DeterminismEntry[] }).determinismEntries = determinism;

    for (const pass of this.passes) {
      try {
        const output = await pass.run(passContext);
        if (output.findings) {
          findings.push(...output.findings);
        }
        if (output.determinism) {
          determinism.push(...output.determinism);
        }
        if (output.runtimeDependencies || output.runtimeDependencyMap) {
          runtimeDependencies.push(
            ...(output.runtimeDependencies ?? output.runtimeDependencyMap ?? []),
          );
        }
        if (output.decisionAnalysis) {
          decisionAnalysis.push(...output.decisionAnalysis);
        }
        if (output.contractCoverage) {
          contractCoverage.push(...output.contractCoverage);
        }
        if (output.expressionDescriptors) {
          expressionDescriptors.push(...output.expressionDescriptors);
        }
        if (output.gatewayDescriptors) {
          gatewayDescriptors.push(...output.gatewayDescriptors);
        }
        // Sprint 4: Collect DMN descriptors and make them available to subsequent passes
        if (output.dmnExpressionDescriptors) {
          dmnExpressionDescriptors.push(...output.dmnExpressionDescriptors);
          (
            passContext as { dmnExpressionDescriptors?: DmnExpressionDescriptor[] }
          ).dmnExpressionDescriptors = dmnExpressionDescriptors;
        }
        if (output.dmnDecisionDescriptors) {
          dmnDecisionDescriptors.push(...output.dmnDecisionDescriptors);
          (
            passContext as { dmnDecisionDescriptors?: DmnDecisionDescriptor[] }
          ).dmnDecisionDescriptors = dmnDecisionDescriptors;
        }
        if (output.businessRuleTaskDescriptors) {
          businessRuleTaskDescriptors.push(...output.businessRuleTaskDescriptors);
        }
        if (output.maturitySignal) {
          maturitySignal = output.maturitySignal;
        }
        degraded = degraded || Boolean(output.degraded);
      } catch (error) {
        findings.push(
          finalizeFinding({
            category: "semantic",
            severity: "error",
            message: `Pass ${pass.id} failed: ${(error as Error).message}`,
            ruleId: pass.id,
          }),
        );
        degraded = true;
      }
    }

    return {
      findings,
      determinism,
      runtimeDependencies,
      decisionAnalysis: decisionAnalysis.length > 0 ? decisionAnalysis : undefined,
      contractCoverage: contractCoverage.length > 0 ? contractCoverage : undefined,
      expressionDescriptors: expressionDescriptors.length > 0 ? expressionDescriptors : undefined,
      gatewayDescriptors: gatewayDescriptors.length > 0 ? gatewayDescriptors : undefined,
      dmnExpressionDescriptors:
        dmnExpressionDescriptors.length > 0 ? dmnExpressionDescriptors : undefined,
      dmnDecisionDescriptors:
        dmnDecisionDescriptors.length > 0 ? dmnDecisionDescriptors : undefined,
      businessRuleTaskDescriptors:
        businessRuleTaskDescriptors.length > 0 ? businessRuleTaskDescriptors : undefined,
      maturitySignal,
      degraded,
    };
  }
}
