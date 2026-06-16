// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

export type Severity = "info" | "warning" | "error";

/**
 * Axis Y: Behavioral Determinism
 * Sprint 3/4: Used across all semantic passes
 */
export type AxisYClass =
  | "deterministic" // Fully deterministic (renamed from "fullyDeterministic" for consistency)
  | "policyDependent" // Determinism relies on policy declarations
  | "runtimeBound" // Behavior depends on runtime signals
  | "nonDeterministic" // Behavior may vary between runs
  | "unknown"; // Insufficient information

/**
 * Alias: "fullyDeterministic" → "deterministic" for Sprint 3 compatibility
 * Sprint 3 code uses "fullyDeterministic", Sprint 4+ uses "deterministic"
 * Both map to the same semantic meaning
 */
export type AxisYClassCompat = AxisYClass | "fullyDeterministic";

/**
 * Axis X: Runtime Dependence
 * Sprint 3/4: Used across all semantic passes
 */
export type AxisXClass =
  | "engineAgnostic" // No reliance on runtime-specific semantics
  | "profileScoped" // Dependent on characteristics declared in runtime profile
  | "engineSpecific" // Requires undocumented or implicit engine features
  | "externalized" // Behavior delegated to external services
  | "unknown"; // Insufficient data

export interface Finding {
  readonly id: string;
  readonly category: "structural" | "semantic" | "ingestion";
  readonly severity: Severity;
  readonly confidence: number;
  readonly message: string;
  readonly targetId?: string;
  readonly policyClause?: string;
  readonly runtimeProfileSection?: string;
  readonly ruleId: string;
  readonly remediation?: string;
}

export interface FindingDraft extends Partial<
  Omit<Finding, "id" | "category" | "severity" | "confidence" | "ruleId" | "message">
> {
  readonly category?: Finding["category"];
  readonly severity?: Severity;
  readonly confidence?: number;
  readonly message: string;
  readonly ruleId: string;
}

export interface NormalizedInput {
  readonly xml: string;
  readonly checksum: string;
  readonly warnings: Finding[];
}

export interface PolicySnapshot {
  readonly id: string;
  readonly version: string;
  readonly governanceTier: string;
  readonly determinism?: Record<string, unknown>;
  readonly runtimeProfileRequired?: boolean;
  readonly ruleToggles: Record<string, boolean>;
}

export interface RuntimeProfileSnapshot {
  readonly id: string;
  readonly version: string;
  readonly capabilities: Record<string, unknown>;
}

export interface RunMetadata {
  readonly timestamp: string;
  readonly caller?: string;
  readonly ingestionDurationMs?: number;
}

export interface CompilerContext {
  readonly modelId: string;
  readonly governanceTier: string;
  readonly policy: PolicySnapshot;
  readonly runtimeProfile?: RuntimeProfileSnapshot;
  readonly normalizedBpmn?: NormalizedInput;
  readonly normalizedDmn?: NormalizedInput;
  readonly metadata: RunMetadata;
}

export interface ParserContext {
  readonly compilerContext: CompilerContext;
}

export interface BpmnAst {
  readonly processes: readonly FlowNodeAst[];
  readonly warnings: Finding[];
}

export interface FlowNodeAst {
  readonly id: string;
  readonly type: string;
  readonly name?: string;
  readonly outgoing: readonly string[];
  readonly incoming: readonly string[];
  readonly attributes?: Record<string, string>; // Engine-specific attributes (e.g., camunda:class, zeebe:taskDefinition)
}

export interface DmnAst {
  readonly decisions: readonly DecisionAst[];
  readonly warnings: Finding[];
}

export interface DecisionAst {
  readonly id: string;
  readonly name: string;
  readonly hitPolicy: string;
  readonly aggregation?: string; // COLLECT aggregation operator (SUM, MIN, MAX, COUNT)
  readonly rules: readonly DecisionRuleAst[];
  readonly inputs?: readonly DmnInputClauseAst[]; // Sprint 4: input expressions with types
  readonly outputs?: readonly DmnOutputClauseAst[]; // Sprint 4: output definitions with types
  readonly expressionLanguage?: string; // Sprint 4: decision-level expression language
}

export interface DmnInputClauseAst {
  readonly id: string;
  readonly expression: string; // Input expression text (e.g., "orderTotal", "customer.age")
  readonly typeRef?: string; // Input type (e.g., "number", "string", "boolean")
  readonly expressionLanguage?: string; // Override for this input
}

export interface DmnOutputClauseAst {
  readonly id: string;
  readonly name: string; // Output variable name
  readonly typeRef?: string; // Output type
}

export interface DecisionRuleAst {
  readonly id: string;
  readonly conditions: readonly string[]; // Input entries (FEEL expressions)
  readonly conclusions: readonly string[]; // Output entries (FEEL expressions or literals)
}

export interface ParserOutcome<TAst> {
  readonly ast?: TAst;
  readonly findings: Finding[];
  readonly expressionCatalog: readonly ExpressionDescriptor[];
}

export interface ExpressionDescriptor {
  readonly id: string;
  readonly language:
    | "feel"
    | "juel"
    | "groovy"
    | "javascript"
    | "python"
    | "mvel"
    | "cib-proprietary"
    | "unknown";
  readonly text: string;
  readonly content?: string; // Alias for Sprint 3 compatibility
  readonly hint: "pure" | "runtime" | "unknown";
  readonly nodeId: string;
  readonly determinism?: AxisYClass; // Sprint 3: Axis Y classification
  readonly functionsUsed?: readonly string[]; // Sprint 3: detected function calls
  readonly elementType?: string; // Sprint 3: source element type (gateway, scriptTask, etc.)
}

/**
 * Gateway semantic descriptor (Sprint 3)
 * Populated by GatewaySemanticAnalyzer
 */
export interface GatewayDescriptor {
  readonly gatewayId: string;
  readonly type: "exclusive" | "inclusive" | "parallel" | "eventBased" | "complex";
  readonly conditionCoverage: boolean; // Has default flow or exhaustive conditions
  readonly determinism?: AxisYClass; // Aggregated determinism from all conditions
  readonly outgoingFlows: readonly {
    flowId: string;
    hasCondition: boolean;
    conditionDeterminism?: AxisYClass;
  }[];
  readonly defaultFlow?: string; // ID of default sequence flow (if any)
}

/**
 * DMN Expression Descriptor (Sprint 4)
 * Populated by DmnExpressionClassifier
 */
export interface DmnExpressionDescriptor {
  readonly id: string;
  readonly decisionId: string; // Parent decision ID
  readonly ruleId?: string; // Parent rule ID (if expression is within a rule)
  readonly expressionType: "input" | "output"; // Input expression or output entry
  readonly language: ExpressionDescriptor["language"]; // Expression language (typically FEEL)
  readonly content: string; // Raw expression text
  readonly typeRef?: string; // Type reference (number, string, boolean, etc.)
  readonly determinism: AxisYClass; // Axis Y classification
  readonly functionsUsed: readonly string[]; // FEEL functions detected (now(), sum(), etc.)
}

/**
 * DMN Decision Descriptor (Sprint 4)
 * Populated by DmnRuleAggregator
 */
export interface DmnDecisionDescriptor {
  readonly decisionId: string;
  readonly decisionName: string;
  readonly hitPolicy: string; // UNIQUE, FIRST, PRIORITY, ANY, COLLECT, RULE ORDER, OUTPUT ORDER
  readonly aggregator?: string; // COLLECT aggregation operator (SUM, MIN, MAX, COUNT) or null
  readonly ruleCount: number;
  readonly ruleDeterminism: readonly AxisYClass[]; // Per-rule determinism classifications
  readonly decisionDeterminism: AxisYClass; // Aggregated determinism for the entire decision
  readonly inputCount: number;
  readonly outputCount: number;
}

/**
 * Business Rule Task Descriptor (Sprint 4)
 * Populated by BusinessRuleTaskAnalyzer
 */
export interface BusinessRuleTaskDescriptor {
  readonly taskId: string;
  readonly decisionRef: string; // ID of referenced DMN decision
  readonly decisionName?: string; // Name of decision (if resolved)
  readonly implementationType: "dmn" | "drl" | "script" | "external" | "unknown";
  readonly determinism: AxisYClass; // Propagated from DMN decision
  readonly coupling: AxisXClass; // Axis X classification
  readonly resolved: boolean; // Whether decisionRef was successfully resolved
}

export interface IrGraph {
  readonly nodes: ReadonlyMap<string, IrNode>;
  readonly edges: readonly IrEdge[];
  readonly annotations: ReadonlyMap<string, AnnotationBag>;
  readonly state: "complete" | "partial";
}

export type IrNode =
  | ProcessScopeNode
  | FlowNodeIr
  | DecisionNode
  | DecisionRuleNode
  | IntegrationBoundaryNode
  | ContractNode
  | EvaluationPointNode;

export interface ProcessScopeNode {
  readonly kind: "processScope";
  readonly id: string;
  readonly astNodeId: string;
  readonly name?: string;
}

export interface FlowNodeIr {
  readonly kind: "flowNode";
  readonly id: string;
  readonly astNodeId: string;
  readonly flowType: string;
}

export interface DecisionNode {
  readonly kind: "decision";
  readonly id: string;
  readonly astNodeId: string;
  readonly hitPolicy: string;
}

export interface DecisionRuleNode {
  readonly kind: "decisionRule";
  readonly id: string;
  readonly astNodeId: string;
}

export interface IntegrationBoundaryNode {
  readonly kind: "integration";
  readonly id: string;
  readonly astNodeId: string;
  readonly integrationType: string;
}

export interface ContractNode {
  readonly kind: "contract";
  readonly id: string;
  readonly astNodeId: string;
}

export interface EvaluationPointNode {
  readonly kind: "evaluationPoint";
  readonly id: string;
  readonly astNodeId: string;
  readonly expressionId?: string;
}

export interface IrEdge {
  readonly kind:
    | "controlFlow"
    | "decisionDependency"
    | "integrationDependency"
    | "evaluationBinding";
  readonly from: string;
  readonly to: string;
  readonly metadata?: Record<string, unknown>;
}

export type AnnotationBag = Record<string, unknown>;

export interface DeterminismEntry {
  readonly evaluationPointId: string;
  readonly axisY:
    | "deterministic"
    | "policyDependent"
    | "runtimeBound"
    | "nonDeterministic"
    | "unknown";
  readonly axisX:
    | "engineAgnostic"
    | "profileScoped"
    | "engineSpecific"
    | "externalized"
    | "unknown";
  readonly confidence: number;
  readonly policyClause: string;
  readonly runtimeProfileSection?: string;
  readonly ruleId: string;
  /**
   * Human-readable justification naming the source of (non-)determinism for this
   * evaluation point (e.g. "Human input is an uncontrolled input"). Optional for
   * backward compatibility with legacy producers; new passes always set it.
   */
  readonly rationale?: string;
}

export interface RuntimeDependencyEntry {
  readonly evaluationPointId: string;
  readonly dependency: string;
  readonly profileCoverage: "documented" | "undocumented" | "missingProfile";
  readonly policyClause: string;
  readonly ruleId: string;
}

export interface DecisionAnalysisEntry {
  readonly decisionId: string;
  readonly hitPolicy: string;
  readonly rules: number;
  readonly overlaps: number;
  readonly gaps: number;
  readonly unreachableRules: readonly string[];
  readonly shadowedRules: readonly string[];
  readonly runtimeDependence: DeterminismEntry["axisX"];
  readonly severity: Severity;
  readonly policyClause: string;
  // MVP extensions
  readonly missingCombinations?: readonly string[]; // e.g., ['loanAmount=null']
  readonly overlappingRules?: readonly string[]; // rule IDs
}

export interface ContractCoverageEntry {
  readonly boundaryId: string;
  readonly contractId?: string;
  readonly coverageRatio: number;
  readonly risk: "low" | "medium" | "high";
  readonly issues: readonly string[];
  readonly policyClause: string;
  // MVP extensions
  readonly bpmnElementType?: string; // BPMN 2.0 element type
  readonly implementationType?: string; // Profile-determined (javaClass, externalTask, jobWorker, etc.)
  readonly hasDeclaredContract?: boolean;
  readonly contractReference?: string;
  readonly missingContract?: boolean;
}

export interface MaturitySignal {
  readonly deterministicAgnostic: number; // Percentage
  readonly deterministicBound: number; // Percentage (profileScoped + runtimeBound + engineSpecific)
  readonly policyDependentAgnostic: number;
  readonly policyDependentBound: number;
  readonly nonDeterministicAgnostic: number;
  readonly nonDeterministicBound: number;
  readonly totalEvaluationPoints: number;
  readonly deterministicTotal: number; // deterministic + policyDependent
  readonly portableTotal: number; // agnostic + profileScoped
}

export interface ResultSummary {
  readonly structuralErrors: number;
  readonly semanticErrors: number;
  readonly warnings: number;
  readonly determinismCompliance: boolean;
  readonly runtimeProfileMissing: boolean;
  readonly contractCoverageRatio: number;
  readonly decisionAnalysisStatus: "complete" | "partial" | "skipped";
  readonly governanceTier: string;
  // MVP extension
  readonly maturitySignal?: MaturitySignal;
}

export interface CompilerResult {
  readonly metadata: ResultMetadata;
  readonly structuralFindings: readonly Finding[];
  readonly semanticFindings: readonly Finding[];
  readonly determinismMap: readonly DeterminismEntry[];
  readonly runtimeDependencyMap: readonly RuntimeDependencyEntry[];
  readonly decisionAnalysis: readonly DecisionAnalysisEntry[];
  readonly contractCoverage: readonly ContractCoverageEntry[];
  readonly summary: ResultSummary;
  // Sprint 3 extensions
  readonly expressionDescriptors?: readonly ExpressionDescriptor[];
  readonly gatewayDescriptors?: readonly GatewayDescriptor[];
  // Sprint 4 extensions
  readonly dmnExpressionDescriptors?: readonly DmnExpressionDescriptor[];
  readonly dmnDecisionDescriptors?: readonly DmnDecisionDescriptor[];
  readonly businessRuleTaskDescriptors?: readonly BusinessRuleTaskDescriptor[];
}

export interface ResultMetadata {
  readonly compilerVersion: string;
  readonly timestamp: string;
  readonly modelId: string;
  readonly inputHashes: { readonly bpmn?: string; readonly dmn?: string };
  readonly policyId: string;
  readonly policyVersion: string;
  readonly runtimeProfileId?: string;
  readonly runtimeProfileVersion?: string;
  readonly governanceTier: string;
  readonly degraded: boolean;
}
