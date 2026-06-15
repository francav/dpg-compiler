// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { XMLParser } from "fast-xml-parser";
import type {
  BpmnAst,
  ExpressionDescriptor,
  Finding,
  FlowNodeAst,
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
  removeNSPrefix: false, // Preserve namespace prefixes (camunda:, zeebe:, etc.)
  attributeNamePrefix: "@_",
  parseAttributeValue: false, // Keep attribute values as strings
});

export class BpmnParser {
  parse(xml: string, _context: ParserContext): ParserOutcome<BpmnAst> {
    const findings: Finding[] = [];
    const expressionCatalog: ExpressionDescriptor[] = [];

    try {
      const json = parser.parse(xml, {
        allowBooleanAttributes: true,
      }) as XmlNode | undefined;
      const definitions = (json?.definitions ?? json?.["bpmn:definitions"]) as XmlNode | undefined;
      const processes = this.extractProcesses(definitions, findings);
      return {
        ast: { processes, warnings: findings },
        findings,
        expressionCatalog,
      };
    } catch (error) {
      findings.push(
        finalizeFinding({
          category: "structural",
          severity: "error",
          message: (error as Error).message,
          ruleId: "bpmn-parse",
        }),
      );
      return { findings, expressionCatalog };
    }
  }

  private extractProcesses(raw: XmlNode | undefined, _findings: Finding[]): FlowNodeAst[] {
    const processes: FlowNodeAst[] = [];

    // Handle both with and without namespace prefix
    const rawProcesses: XmlNode[] =
      (raw?.process ?? raw?.["bpmn:process"])
        ? Array.isArray(raw.process ?? raw["bpmn:process"])
          ? ((raw.process ?? raw["bpmn:process"]) as XmlNode[])
          : [(raw.process ?? raw["bpmn:process"]) as XmlNode]
        : [];

    for (const proc of rawProcesses) {
      const extracted = this.extractFlowNodes(proc, (proc["@_id"] as string) ?? "process");
      processes.push(...extracted);
    }

    return processes;
  }

  private extractFlowNodes(process: XmlNode | undefined, processId: string): FlowNodeAst[] {
    const nodes: FlowNodeAst[] = [];
    const entries = Object.entries(process ?? {});
    for (const [key, value] of entries) {
      // Skip non-BPMN elements (@ attributes, text nodes)
      if (key.startsWith("@_") || key === "#text") {
        continue;
      }

      // Ensure value is an array (fast-xml-parser returns single elements as objects)
      const elements = this.ensureArray(value);

      for (const element of elements as XmlNode[]) {
        if (typeof element !== "object" || !element) {
          continue;
        }

        const id = (element["@_id"] as string) ?? `${processId}:${key}`;
        const outgoing = this.ensureArray(element.outgoing).map((n: XmlValue) =>
          typeof n === "string" ? n : String((n as XmlNode)?._text ?? ""),
        );
        const incoming = this.ensureArray(element.incoming).map((n: XmlValue) =>
          typeof n === "string" ? n : String((n as XmlNode)?._text ?? ""),
        );

        // Extract all attributes (engine-specific metadata)
        const attributes: Record<string, string> = {};
        for (const [attrKey, attrValue] of Object.entries(element)) {
          if (attrKey.startsWith("@_") && attrKey !== "@_id" && attrKey !== "@_name") {
            const cleanKey = attrKey.substring(2); // Remove @_ prefix
            attributes[cleanKey] = String(attrValue);
          }
        }

        // Extract nested extension elements (Camunda 8 zeebe:* attributes)
        const extensionElements = element["bpmn:extensionElements"] ?? element.extensionElements;
        if (extensionElements) {
          this.extractExtensionAttributes(extensionElements as XmlNode, attributes);
        }

        // Extract nested condition expressions (gateway sequence flows)
        const conditionExpr = element["bpmn:conditionExpression"] ?? element["conditionExpression"];
        if (conditionExpr) {
          this.extractConditionExpression(conditionExpr, attributes);
        }

        // Extract script content (script tasks)
        const script = element["bpmn:script"] ?? element["script"];
        if (script) {
          this.extractScriptContent(script as XmlNode, element, attributes);
        }

        nodes.push({
          id,
          type: key.replace("bpmn:", ""),
          name: element["@_name"] as string | undefined,
          outgoing,
          incoming,
          attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        });
      }
    }
    return nodes;
  }

  /**
   * Extract condition expression text and metadata from sequence flows
   */
  private extractConditionExpression(
    conditionExpr: XmlValue,
    attributes: Record<string, string>,
  ): void {
    const expr = (Array.isArray(conditionExpr) ? conditionExpr[0] : conditionExpr) as
      | XmlNode
      | undefined;
    if (!expr) return;

    // Extract text content (expression body)
    const text = expr["#text"] ?? expr["_text"] ?? expr["_"] ?? String(expr ?? "");
    if (text && typeof text === "string") {
      attributes["conditionExpression"] = text.trim();
    }

    // Extract language attribute (Camunda 7 JUEL/Groovy)
    if (expr["@_language"]) {
      attributes["expressionLanguage"] = String(expr["@_language"]);
    }

    // Extract xsi:type (distinguishes formal vs documentation expressions)
    if (expr["@_xsi:type"]) {
      attributes["expressionType"] = String(expr["@_xsi:type"]);
    }
  }

  /**
   * Extract script content from script tasks
   */
  private extractScriptContent(
    script: XmlNode,
    element: XmlNode,
    attributes: Record<string, string>,
  ): void {
    // Extract script text content
    const scriptText = script["#text"] ?? script["_text"] ?? script["_"] ?? String(script ?? "");
    if (scriptText && typeof scriptText === "string") {
      attributes["scriptContent"] = scriptText.trim();
    }

    // Extract scriptFormat attribute (language identifier)
    if (element["@_scriptFormat"]) {
      attributes["scriptFormat"] = String(element["@_scriptFormat"]);
    }
  }

  /**
   * Extract attributes from BPMN extension elements (Camunda 8 zeebe:* namespace)
   */
  private extractExtensionAttributes(
    extensionElements: XmlNode,
    attributes: Record<string, string>,
  ): void {
    for (const [key, value] of Object.entries(extensionElements)) {
      // Handle zeebe:taskDefinition
      if (key === "zeebe:taskDefinition" || key === "taskDefinition") {
        const taskDef = (Array.isArray(value) ? value[0] : value) as XmlNode | undefined;
        if (taskDef && taskDef["@_type"]) {
          // Store as zeebe:taskDefinition (classification key)
          attributes["zeebe:taskDefinition"] = String(taskDef["@_type"]);
        }
      }
      // Handle zeebe:ioMapping (future extension)
      // Handle other zeebe:* elements as needed
    }
  }

  private ensureArray(value: XmlValue): XmlValue[] {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }
}
