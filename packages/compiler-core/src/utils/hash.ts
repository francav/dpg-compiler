// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { sha256 } from "@noble/hashes/sha2.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

function normalizeInput(parts: readonly (string | undefined)[]): Uint8Array {
  const safe = parts.map((part) => part ?? "").join("|");
  return utf8ToBytes(safe);
}

export function hashSha1(...parts: readonly (string | undefined)[]): string {
  return bytesToHex(sha1(normalizeInput(parts)));
}

export function hashSha256(...parts: readonly (string | undefined)[]): string {
  return bytesToHex(sha256(normalizeInput(parts)));
}
