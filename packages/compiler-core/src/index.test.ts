// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileModel } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "..", "fixtures");

async function loadFixture(...segments: string[]): Promise<string> {
  return readFile(path.join(FIXTURES_DIR, ...segments), "utf8");
}

describe("compileModel", () => {
  it("compiles the baseline fixtures", async () => {
    const [bpmnXml, dmnXml] = await Promise.all([
      loadFixture("bpmn", "simple-process.bpmn"),
      loadFixture("dmn", "loan-decision.dmn"),
    ]);

    const result = await compileModel({
      modelId: "test-model",
      bpmnXml,
      dmnXml,
    });
    expect(result.metadata.modelId).toBe("test-model");
    expect(result.determinismMap.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.structuralErrors).toBe(0);

    // Service tasks may have unknown implementation (axisY = "unknown").
    // Since WU-F.2 every execution-bearing element is classified: the DMN/
    // businessRule evaluation points remain policyDependent, while inert
    // start/end events are deterministic pass-throughs.
    const evalPointEntries = result.determinismMap.filter((e) =>
      e.evaluationPointId.includes(":evaluation"),
    );
    expect(evalPointEntries.length).toBeGreaterThan(0);
    expect(evalPointEntries.every((entry) => entry.axisY === "policyDependent")).toBe(true);

    const eventEntries = result.determinismMap.filter((e) => e.evaluationPointId.includes("Event"));
    expect(eventEntries.every((entry) => entry.axisY === "deterministic")).toBe(true);

    // Every emitted entry carries a rationale (WU-F.2 done-criterion).
    expect(result.determinismMap.every((entry) => Boolean(entry.rationale))).toBe(true);
  });

  it("falls back to default governance artifacts when omitted", async () => {
    const bpmnXml = await loadFixture("bpmn", "simple-process.bpmn");

    const result = await compileModel({
      modelId: "defaults-only",
      bpmnXml,
    });

    expect(result.metadata.modelId).toBe("defaults-only");
    expect(result.summary.governanceTier).toBe("tier-1");
    expect(result.metadata.policyId).toBe("standard-governance-policy");
    expect(result.metadata.runtimeProfileId).toBe("standard-runtime-profile");
  });

  it("downgrades determinism for runtime-bound expressions", async () => {
    const [bpmnXml, dmnXml] = await Promise.all([
      loadFixture("bpmn", "runtime-bound.bpmn"),
      loadFixture("dmn", "runtime-bound.dmn"),
    ]);

    const result = await compileModel({
      modelId: "runtime-test",
      bpmnXml,
      dmnXml,
    });

    expect(result.determinismMap.some((entry) => entry.axisY === "runtimeBound")).toBe(true);
    expect(result.summary.structuralErrors).toBe(0);
  });
});
