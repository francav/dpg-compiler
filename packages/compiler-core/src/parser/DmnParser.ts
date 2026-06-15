// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { XMLParser } from "fast-xml-parser";
import type {
  DecisionAst,
  DecisionRuleAst,
  DmnAst,
  ExpressionDescriptor,
  Finding,
  ParserContext,
  ParserOutcome,
} from "../types.js";
import { finalizeFinding } from "./findingHelpers.js";

type XmlValue = string | number | boolean | null | undefined | XmlNode | XmlValue[];
interface XmlNode {
  [key: string]: XmlValue;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  ignoreDeclaration: true,
  trimValues: true,
});

export class DmnParser {
  parse(xml: string, _context: ParserContext): ParserOutcome<DmnAst> {
    const findings: Finding[] = [];
    const expressionCatalog: ExpressionDescriptor[] = [];

    try {
      const json = parser.parse(xml) as XmlNode | undefined;
      const definitions = (json?.definitions ?? json?.["dmn:definitions"]) as XmlNode | undefined;
      const decisions = this.extractDecisions(definitions, findings, expressionCatalog);
      return {
        ast: { decisions, warnings: findings },
        findings,
        expressionCatalog,
      };
    } catch (error) {
      findings.push(
        finalizeFinding({
          category: "structural",
          severity: "error",
          message: (error as Error).message,
          ruleId: "dmn-parse",
        }),
      );
      return { findings, expressionCatalog };
    }
  }

  private extractDecisions(
    definitions: XmlNode | undefined,
    findings: Finding[],
    expressionCatalog: ExpressionDescriptor[],
  ): DecisionAst[] {
    const result: DecisionAst[] = [];
    const rawDecisions = definitions?.decision ?? definitions?.["dmn:decision"] ?? [];
    const arr = Array.isArray(rawDecisions) ? rawDecisions : [rawDecisions];
    for (const entry of arr.filter(Boolean) as XmlNode[]) {
      const decisionId = (entry["@_id"] ?? "decision") as string;
      const table = (entry.decisionTable ?? entry["dmn:decisionTable"]) as XmlNode | undefined;

      if (!table) {
        findings.push(
          finalizeFinding({
            category: "structural",
            severity: "warning",
            message: `Decision ${decisionId} has no decision table`,
            ruleId: "dmn-table-missing",
            targetId: decisionId,
          }),
        );
        continue;
      }

      const hitPolicy = (table["@_hitPolicy"] ?? "UNIQUE") as string;
      const aggregation = table["@_aggregation"] as string | undefined; // COLLECT aggregation operator
      const expressionLanguage = (entry["@_expressionLanguage"] ??
        (definitions as XmlNode)["@_expressionLanguage"]) as string | undefined;

      // Sprint 4: Extract input clauses
      const inputs = this.extractInputClauses(table, decisionId);

      // Sprint 4: Extract output clauses
      const outputs = this.extractOutputClauses(table, decisionId);

      // Extract rules with enhanced expression cataloging
      const rules = this.extractRules(
        table,
        decisionId,
        expressionCatalog,
        inputs.length,
        outputs.length,
      );

      result.push({
        id: decisionId,
        name: (entry["@_name"] ?? decisionId) as string,
        hitPolicy,
        aggregation,
        rules,
        inputs,
        outputs,
        expressionLanguage,
      });
    }
    return result;
  }

  private extractRules(
    table: XmlNode,
    decisionId: string,
    expressionCatalog: ExpressionDescriptor[],
    _inputCount: number,
    _outputCount: number,
  ): DecisionRuleAst[] {
    const rawRules = table?.rule ?? table?.["dmn:rule"] ?? [];
    const arr = Array.isArray(rawRules) ? rawRules : [rawRules];
    let index = 0;
    return (arr.filter(Boolean) as XmlNode[]).map((rule) => {
      const ruleId = (rule["@_id"] ?? `${decisionId}:rule:${index++}`) as string;
      const conditions = this.extractText(rule.inputEntry ?? rule["dmn:inputEntry"]);
      const conclusions = this.extractText(rule.outputEntry ?? rule["dmn:outputEntry"]);

      // Sprint 4: Catalog input/output expressions separately
      conditions.forEach((expression, i) => {
        const desc: ExpressionDescriptor = {
          id: `${ruleId}:input:${i}`,
          language: "feel",
          text: expression,
          hint: expression.includes("now()") || expression.includes("today()") ? "runtime" : "pure",
          nodeId: ruleId,
        };
        expressionCatalog.push(desc);
      });

      conclusions.forEach((expression, i) => {
        const desc: ExpressionDescriptor = {
          id: `${ruleId}:output:${i}`,
          language: "feel",
          text: expression,
          hint: expression.includes("now()") || expression.includes("today()") ? "runtime" : "pure",
          nodeId: ruleId,
        };
        expressionCatalog.push(desc);
      });

      return {
        id: ruleId,
        conditions,
        conclusions,
      };
    });
  }

  /**
   * Sprint 4: Extract DMN input clauses with type information
   */
  private extractInputClauses(table: XmlNode, decisionId: string) {
    const rawInputs = table?.input ?? table?.["dmn:input"] ?? [];
    const arr = Array.isArray(rawInputs) ? rawInputs : [rawInputs];

    return (arr.filter(Boolean) as XmlNode[]).map((input, index) => {
      const inputExpression = (input.inputExpression ?? input["dmn:inputExpression"]) as
        | XmlNode
        | undefined;
      const expressionText =
        this.extractText(
          inputExpression?.text ?? inputExpression?.["dmn:text"] ?? inputExpression,
        )?.[0] ?? "";

      return {
        id: (input["@_id"] ?? `${decisionId}:input:${index}`) as string,
        expression: expressionText,
        typeRef: inputExpression?.["@_typeRef"] as string | undefined,
        expressionLanguage: input["@_expressionLanguage"] as string | undefined,
      };
    });
  }

  /**
   * Sprint 4: Extract DMN output clauses with type information
   */
  private extractOutputClauses(table: XmlNode, decisionId: string) {
    const rawOutputs = table?.output ?? table?.["dmn:output"] ?? [];
    const arr = Array.isArray(rawOutputs) ? rawOutputs : [rawOutputs];

    return (arr.filter(Boolean) as XmlNode[]).map((output, index) => {
      return {
        id: (output["@_id"] ?? `${decisionId}:output:${index}`) as string,
        name: (output["@_name"] ?? `output${index}`) as string,
        typeRef: output["@_typeRef"] as string | undefined,
      };
    });
  }

  private extractText(entry: XmlValue): string[] {
    const arr = Array.isArray(entry) ? entry : [entry];
    return arr
      .filter(Boolean)
      .map((value) => {
        if (typeof value === "string") {
          return value;
        }
        if ((value as XmlNode)?.text) {
          return String((value as XmlNode).text);
        }
        if ((value as XmlNode)?._text) {
          return String((value as XmlNode)._text);
        }
        return "";
      })
      .filter(Boolean);
  }
}
