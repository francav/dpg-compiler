// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type {
  AnnotationBag,
  BpmnAst,
  DmnAst,
  ExpressionDescriptor,
  IrEdge,
  IrGraph,
  IrNode,
  FlowNodeIr,
  ProcessScopeNode,
  DecisionNode,
  DecisionRuleNode,
  IntegrationBoundaryNode,
  EvaluationPointNode,
} from "../types.js";

export interface IrBuilderInput {
  readonly astBpmn?: BpmnAst;
  readonly astDmn?: DmnAst;
  readonly expressions?: readonly ExpressionDescriptor[];
}

export class IrBuilder {
  build(input: IrBuilderInput): IrGraph {
    const nodes = new Map<string, IrNode>();
    const edges: IrEdge[] = [];
    const annotations = new Map<string, AnnotationBag>();
    const expressionIndex = this.createExpressionIndex(input.expressions);

    if (input.astBpmn) {
      this.buildBpmn(nodes, edges, input.astBpmn, annotations);
    }
    if (input.astDmn) {
      this.buildDmn(nodes, edges, annotations, input.astDmn, expressionIndex);
    }

    return {
      nodes,
      edges,
      annotations,
      state: input.astBpmn || input.astDmn ? "complete" : "partial",
    };
  }

  private createExpressionIndex(
    expressions?: readonly ExpressionDescriptor[],
  ): Map<string, ExpressionDescriptor[]> {
    const index = new Map<string, ExpressionDescriptor[]>();
    for (const descriptor of expressions ?? []) {
      const bucket = index.get(descriptor.nodeId);
      if (bucket) {
        bucket.push(descriptor);
        continue;
      }
      index.set(descriptor.nodeId, [descriptor]);
    }
    return index;
  }

  private buildBpmn(
    nodes: Map<string, IrNode>,
    edges: IrEdge[],
    bpmn: BpmnAst,
    annotations: Map<string, AnnotationBag>,
  ): void {
    const scopeId = "processScope:default";
    const scope: ProcessScopeNode = {
      kind: "processScope",
      id: scopeId,
      astNodeId: scopeId,
    };
    nodes.set(scope.id, scope);

    for (const flowNode of bpmn.processes) {
      const irNode: FlowNodeIr = {
        kind: "flowNode",
        id: flowNode.id,
        astNodeId: flowNode.id,
        flowType: flowNode.type,
      };
      nodes.set(irNode.id, irNode);

      // Preserve attributes in annotations for semantic passes
      if (flowNode.attributes) {
        annotations.set(flowNode.id, { ...flowNode.attributes });
      }

      for (const target of flowNode.outgoing) {
        edges.push({ kind: "controlFlow", from: flowNode.id, to: target });
      }
      if (flowNode.type === "businessRuleTask" && flowNode.name) {
        const boundary: IntegrationBoundaryNode = {
          kind: "integration",
          id: `${flowNode.id}:integration`,
          astNodeId: flowNode.id,
          integrationType: "dmn",
        };
        nodes.set(boundary.id, boundary);
        edges.push({
          kind: "integrationDependency",
          from: flowNode.id,
          to: boundary.id,
        });
        const evaluationPoint: EvaluationPointNode = {
          kind: "evaluationPoint",
          id: `${flowNode.id}:evaluation`,
          astNodeId: flowNode.id,
          expressionId: undefined,
        };
        nodes.set(evaluationPoint.id, evaluationPoint);
        edges.push({
          kind: "evaluationBinding",
          from: flowNode.id,
          to: evaluationPoint.id,
        });
      }
    }
  }

  private buildDmn(
    nodes: Map<string, IrNode>,
    edges: IrEdge[],
    annotations: Map<string, AnnotationBag>,
    dmn: DmnAst,
    expressionIndex: Map<string, ExpressionDescriptor[]>,
  ): void {
    for (const decision of dmn.decisions) {
      const decisionNode: DecisionNode = {
        kind: "decision",
        id: decision.id,
        astNodeId: decision.id,
        hitPolicy: decision.hitPolicy,
      };
      nodes.set(decisionNode.id, decisionNode);

      // Sprint 4: Preserve decision-level metadata in annotations
      annotations.set(decisionNode.id, {
        hitPolicy: decision.hitPolicy,
        aggregation: decision.aggregation,
        expressionLanguage: decision.expressionLanguage,
        inputCount: decision.inputs?.length ?? 0,
        outputCount: decision.outputs?.length ?? 0,
        inputs: decision.inputs ?? [],
        outputs: decision.outputs ?? [],
      });

      decision.rules.forEach((rule, index) => {
        const ruleNode: DecisionRuleNode = {
          kind: "decisionRule",
          id: `${decision.id}:rule:${index}`,
          astNodeId: rule.id,
        };
        nodes.set(ruleNode.id, ruleNode);
        edges.push({
          kind: "decisionDependency",
          from: ruleNode.id,
          to: decisionNode.id,
        });

        // Sprint 4: Store rule conditions/conclusions in annotations
        annotations.set(ruleNode.id, {
          conditions: rule.conditions,
          conclusions: rule.conclusions,
        });

        const descriptorBucket = expressionIndex.get(rule.id) ?? [];
        const expressionHints = descriptorBucket.map((descriptor) => descriptor.hint);
        const evaluationPoint: EvaluationPointNode = {
          kind: "evaluationPoint",
          id: `${ruleNode.id}:evaluation`,
          astNodeId: rule.id,
          expressionId: descriptorBucket[0]?.id,
        };
        nodes.set(evaluationPoint.id, evaluationPoint);
        edges.push({
          kind: "evaluationBinding",
          from: ruleNode.id,
          to: evaluationPoint.id,
        });
        if (expressionHints.length > 0) {
          annotations.set(evaluationPoint.id, { expressionHints });
        }
      });
    }
  }
}
