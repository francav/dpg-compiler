// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { hashSha1 } from "../utils/hash.js";
import type { Finding, FindingDraft } from "../types.js";

export function finalizeFinding(draft: FindingDraft): Finding {
  return {
    id: hashSha1(`${draft.ruleId}:${draft.message}`),
    category: draft.category ?? "structural",
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
