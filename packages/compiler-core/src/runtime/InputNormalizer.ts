// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { XMLParser } from "fast-xml-parser";
import { hashSha1, hashSha256 } from "../utils/hash.js";
import type { CompilerContext, Finding, FindingDraft, NormalizedInput } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: false,
  trimValues: true,
  allowBooleanAttributes: true,
  ignoreDeclaration: true,
});

export function normalizeXml(xml: string, ruleId: string): NormalizedInput {
  const trimmed = xml.trim();
  const checksum = hashSha256(trimmed);
  const warnings: Finding[] = [];

  try {
    parser.parse(trimmed);
  } catch (error) {
    const err = error as Error;
    warnings.push(
      finalizeFinding({
        category: "ingestion",
        severity: "error",
        confidence: 1,
        message: `XML parsing failed: ${err.message}`,
        ruleId,
      }),
    );
  }

  return { xml: trimmed, checksum, warnings };
}

function finalizeFinding(draft: FindingDraft): Finding {
  return {
    id: hashSha1(`${draft.ruleId}:${draft.message}`),
    category: draft.category ?? "ingestion",
    severity: draft.severity ?? "warning",
    confidence: draft.confidence ?? 1,
    message: draft.message,
    targetId: draft.targetId,
    policyClause: draft.policyClause,
    runtimeProfileSection: draft.runtimeProfileSection,
    ruleId: draft.ruleId,
    remediation: draft.remediation,
  };
}

export function mergeNormalizationWarnings(
  ctx: CompilerContext,
  additional: readonly Finding[],
): CompilerContext {
  return {
    ...ctx,
    metadata: ctx.metadata,
    normalizedBpmn: ctx.normalizedBpmn && {
      ...ctx.normalizedBpmn,
      warnings: [...ctx.normalizedBpmn.warnings, ...additional],
    },
    normalizedDmn: ctx.normalizedDmn && {
      ...ctx.normalizedDmn,
      warnings: [...ctx.normalizedDmn.warnings, ...additional],
    },
  };
}
