// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França
import { describe, expect, it } from "vitest";
import { greet } from "./index.js";

describe("greet", () => {
  it("includes the given name", () => {
    expect(greet("DPG")).toContain("DPG");
  });
});
