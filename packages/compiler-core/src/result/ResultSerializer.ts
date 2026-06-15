// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { CompilerResult } from "../types.js";

export function serializeResult(result: CompilerResult): string {
  return JSON.stringify(result, null, 2);
}
