// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { parse } from "yaml";
import { hashSha1 } from "../utils/hash.js";
import type { PolicySnapshot } from "../types.js";

export interface PolicyLoaderOptions {
  readonly governanceTier: string;
}

export function loadPolicy(
  source: string | PolicySnapshot,
  options: PolicyLoaderOptions,
): PolicySnapshot {
  if (typeof source !== "string") {
    return source;
  }

  const parsed = parse(source) as Record<string, unknown>;
  const processTiers = parsed["processTiers"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  const tier = processTiers?.[options.governanceTier] ?? {};
  const version = String(parsed["version"] ?? "0.0");
  const ruleList = parsed["rules"] as { enabled?: string[]; disabled?: string[] } | undefined;

  const ruleToggles: Record<string, boolean> = {};
  for (const rule of ruleList?.enabled ?? []) {
    ruleToggles[rule] = true;
  }
  for (const rule of ruleList?.disabled ?? []) {
    ruleToggles[rule] = false;
  }

  return {
    id: String(parsed["id"] ?? "policy"),
    version,
    governanceTier: options.governanceTier,
    determinism: tier["determinism"] as Record<string, unknown> | undefined,
    runtimeProfileRequired: Boolean(
      tier["runtimeProfile"] === "required" || tier["runtimeProfileRequired"],
    ),
    ruleToggles,
  };
}

export function policyChecksum(policy: PolicySnapshot): string {
  return hashSha1(policy.id, policy.version, policy.governanceTier);
}
