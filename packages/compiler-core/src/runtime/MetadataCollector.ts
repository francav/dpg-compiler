// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { RunMetadata } from "../types.js";

export interface MetadataInput {
  readonly timestamp?: string;
  readonly caller?: string;
}

export function collectMetadata(input: MetadataInput = {}): RunMetadata {
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    caller: input.caller,
  };
}
