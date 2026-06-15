// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { parse } from "yaml";
import type { RuntimeProfileSnapshot } from "../types.js";

export function loadRuntimeProfile(
  source?: string | RuntimeProfileSnapshot,
): RuntimeProfileSnapshot | undefined {
  if (!source) {
    return undefined;
  }

  if (typeof source !== "string") {
    return source;
  }

  const parsed = parse(source) as Record<string, unknown>;
  return {
    id: String(parsed["id"] ?? "runtime-profile"),
    version: String(parsed["version"] ?? "0.0"),
    capabilities: parsed,
  };
}
