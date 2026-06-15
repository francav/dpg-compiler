// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFromFiles } from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "../../compiler-core/fixtures");

const BPMN = path.join(fixturesDir, "bpmn/simple-process.bpmn");
const DMN = path.join(fixturesDir, "dmn/loan-decision.dmn");

describe("compileFromFiles", () => {
  it("compiles a BPMN process using on-disk resources", async () => {
    const result = await compileFromFiles({
      modelId: "node-fixture",
      bpmnPath: BPMN,
      dmnPath: DMN,
    });

    expect(result.metadata.modelId).toBe("node-fixture");
    expect(result.summary.governanceTier).toBe("tier-1");
    expect(result.structuralFindings.length).toBeGreaterThanOrEqual(0);
  });
});
