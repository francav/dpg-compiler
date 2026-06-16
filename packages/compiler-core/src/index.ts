// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import {
  createCompilerContext,
  type ContextFactoryInput,
} from "./runtime/CompilerContextFactory.js";
import { BpmnParser } from "./parser/BpmnParser.js";
import { DmnParser } from "./parser/DmnParser.js";
import { IrBuilder } from "./ir/IrBuilder.js";
import { PassRegistry } from "./passes/PassRegistry.js";
import { StructuralValidationPass } from "./passes/StructuralValidationPass.js";
import { SemanticDeterminismPass } from "./passes/SemanticDeterminismPass.js";
import { GatewayConditionAnalyzer } from "./passes/GatewayConditionAnalyzer.js";
import { ScriptDeterminismClassifier } from "./passes/ScriptDeterminismClassifier.js";
import { DmnGapAnalyzer } from "./passes/DmnGapAnalyzer.js";
import { ServiceTaskClassifier } from "./passes/ServiceTaskClassifier.js";
import { FlowElementClassifier } from "./passes/FlowElementClassifier.js";
import { ContractCoverageAnalyzer } from "./passes/ContractCoverageAnalyzer.js";
import { AggregationEngine } from "./passes/AggregationEngine.js";
// Sprint 3 passes
import { ExpressionClassifier } from "./passes/ExpressionClassifier.js";
import { GatewaySemanticAnalyzer } from "./passes/GatewaySemanticAnalyzer.js";
// Sprint 4 passes
import { DmnExpressionClassifier } from "./passes/DmnExpressionClassifier.js";
import { DmnRuleAggregator } from "./passes/DmnRuleAggregator.js";
import { BusinessRuleTaskAnalyzer } from "./passes/BusinessRuleTaskAnalyzer.js";
import { PassRunner } from "./passes/PassRunner.js";
import { assembleResult } from "./result/ResultAssembler.js";
import type { CompilerResult } from "./types.js";

export type CompileOptions = ContextFactoryInput;

export async function compileModel(options: CompileOptions): Promise<CompilerResult> {
  const context = createCompilerContext(options);
  const parserContext = { compilerContext: context };
  const bpmnOutcome = context.normalizedBpmn
    ? new BpmnParser().parse(context.normalizedBpmn.xml, parserContext)
    : { findings: [], expressionCatalog: [] };
  const dmnOutcome = context.normalizedDmn
    ? new DmnParser().parse(context.normalizedDmn.xml, parserContext)
    : { findings: [], expressionCatalog: [] };

  const structuralFindings = [
    ...(context.normalizedBpmn?.warnings ?? []),
    ...(context.normalizedDmn?.warnings ?? []),
    ...bpmnOutcome.findings,
    ...dmnOutcome.findings,
  ];

  const expressionCatalog = [...bpmnOutcome.expressionCatalog, ...dmnOutcome.expressionCatalog];

  const ir = new IrBuilder().build({
    astBpmn: bpmnOutcome.ast,
    astDmn: dmnOutcome.ast,
    expressions: expressionCatalog,
  });

  const registry = new PassRegistry();
  registry.register(new StructuralValidationPass());
  registry.register(new SemanticDeterminismPass());
  // Sprint 3 passes
  registry.register(new ExpressionClassifier());
  registry.register(new GatewaySemanticAnalyzer());
  // Sprint 4 passes (DMN analysis)
  registry.register(new DmnExpressionClassifier());
  registry.register(new DmnRuleAggregator());
  registry.register(new BusinessRuleTaskAnalyzer());
  // Sprint 1 & 2 passes
  registry.register(new GatewayConditionAnalyzer());
  registry.register(new ScriptDeterminismClassifier());
  registry.register(new ServiceTaskClassifier());
  registry.register(new FlowElementClassifier());
  registry.register(new ContractCoverageAnalyzer());
  registry.register(new DmnGapAnalyzer());
  registry.register(new AggregationEngine());
  const runner = new PassRunner(registry.list());
  const {
    findings: semanticFindings,
    determinism,
    runtimeDependencies,
    decisionAnalysis,
    contractCoverage,
    maturitySignal,
    expressionDescriptors,
    gatewayDescriptors,
    dmnExpressionDescriptors,
    dmnDecisionDescriptors,
    businessRuleTaskDescriptors,
    degraded,
  } = await runner.run(context, ir);

  return assembleResult({
    compilerContext: context,
    structuralFindings,
    semanticFindings,
    determinism: determinism ?? [],
    runtimeDependencies: runtimeDependencies ?? [],
    decisionAnalysis,
    contractCoverage,
    maturitySignal,
    expressionDescriptors,
    gatewayDescriptors,
    dmnExpressionDescriptors,
    dmnDecisionDescriptors,
    businessRuleTaskDescriptors,
    degraded,
  });
}

export type { CompilerResult } from "./types.js";
