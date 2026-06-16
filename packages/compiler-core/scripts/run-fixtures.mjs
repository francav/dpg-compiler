#!/usr/bin/env node
/* global console, process */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function importCompiler() {
  try {
    const module = await import("../dist/index.js");
    if (!module.compileModel) {
      throw new Error("compileModel export missing");
    }
    return module.compileModel;
  } catch (error) {
    console.error(
      "Compiler build artifacts not found. Run 'npm run build --workspace @francav/compiler-core' first.",
    );
    throw error;
  }
}

async function readFixture(...relativePath) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const fixturesDir = path.resolve(__dirname, "..", "fixtures");
  const absolutePath = path.join(fixturesDir, ...relativePath);
  return readFile(absolutePath, "utf8");
}

async function main() {
  const compileModel = await importCompiler();
  const scenarios = [
    {
      label: "Baseline (policy-dependent)",
      modelId: "fixtures/simple-process",
      bpmn: ["bpmn", "simple-process.bpmn"],
    },
    {
      label: "Runtime-bound expressions",
      modelId: "fixtures/runtime-bound",
      bpmn: ["bpmn", "runtime-bound.bpmn"],
    },
  ];

  for (const scenario of scenarios) {
    const bpmnXml = await readFixture(...scenario.bpmn);
    const result = await compileModel({
      modelId: scenario.modelId,
      bpmnXml,
      metadata: { caller: `fixture-runner:${scenario.modelId}` },
    });
    console.log(`\n=== ${scenario.label} ===`);
    console.log(JSON.stringify(result.summary, null, 2));
    console.log("Determinism axisY distribution:");
    const distribution = result.determinismMap.reduce((acc, entry) => {
      acc[entry.axisY] = (acc[entry.axisY] ?? 0) + 1;
      return acc;
    }, {});
    for (const [axisY, count] of Object.entries(distribution)) {
      console.log(`- ${axisY}: ${count}`);
    }
  }
}

main().catch((error) => {
  console.error("Fixture run failed:", error.message);
  process.exitCode = 1;
});
