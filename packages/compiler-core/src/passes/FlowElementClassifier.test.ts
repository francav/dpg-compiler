// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileModel } from "../index.js";
import type { DeterminismEntry } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "..", "..", "fixtures", "bpmn");

async function classify(fixture: string): Promise<Map<string, DeterminismEntry>> {
  const bpmnXml = await readFile(path.join(FIXTURES_DIR, fixture), "utf8");
  const result = await compileModel({
    modelId: `test/${fixture}`,
    bpmnXml,
    metadata: { caller: "flow-element-classifier-test" },
  });
  const byId = new Map<string, DeterminismEntry>();
  for (const entry of result.determinismMap) {
    byId.set(entry.evaluationPointId, entry);
  }
  return byId;
}

describe("FlowElementClassifier — every execution-bearing element is classified", () => {
  it("classifies human tasks by source of non-determinism", async () => {
    const map = await classify("human-task.bpmn");

    const freeForm = map.get("UserTask_FreeForm");
    expect(freeForm?.axisY).toBe("nonDeterministic");
    expect(freeForm?.axisX).toBe("engineAgnostic");
    expect(freeForm?.rationale).toContain("uncontrolled input");

    const constrained = map.get("UserTask_Constrained");
    expect(constrained?.axisY).toBe("policyDependent");
    expect(constrained?.axisX).toBe("profileScoped");
    expect(constrained?.rationale).toContain("closed value set");

    const manual = map.get("ManualTask_File");
    expect(manual?.axisY).toBe("nonDeterministic");
    expect(manual?.axisX).toBe("engineAgnostic");
    expect(manual?.rationale).toContain("human input is uncontrolled");

    // Plain start/end events are inert pass-throughs.
    expect(map.get("StartEvent_human")?.axisY).toBe("deterministic");
    expect(map.get("EndEvent_human")?.axisY).toBe("deterministic");
  });

  it("classifies messaging: inbound = non-deterministic, send = deterministic, both externalized", async () => {
    const map = await classify("messaging.bpmn");

    const receive = map.get("ReceiveTask_Order");
    expect(receive?.axisY).toBe("nonDeterministic");
    expect(receive?.axisX).toBe("externalized");
    expect(receive?.rationale).toContain("External message content");

    const catchMsg = map.get("CatchEvent_Payment");
    expect(catchMsg?.axisY).toBe("nonDeterministic");
    expect(catchMsg?.axisX).toBe("externalized");

    const send = map.get("SendTask_Ack");
    expect(send?.axisY).toBe("deterministic");
    expect(send?.axisX).toBe("externalized");
    expect(send?.rationale).toContain("Deterministic emission");

    // A message throw event is an inbound-shaped message-event in the parser's view;
    // its content is still classified via the message event-definition path.
    const throwMsg = map.get("ThrowEvent_Notify");
    expect(throwMsg?.axisX).toBe("externalized");
  });

  it("classifies timer events as runtime-bound", async () => {
    const map = await classify("timer.bpmn");

    const start = map.get("StartEvent_timer");
    expect(start?.axisY).toBe("runtimeBound");
    expect(start?.axisX).toBe("profileScoped");
    expect(start?.rationale).toContain("time-dependent");

    const wait = map.get("CatchEvent_Wait");
    expect(wait?.axisY).toBe("runtimeBound");
    expect(wait?.rationale).toContain("runtime clock");

    // Abstract task is an inert pass-through.
    expect(map.get("Task_Prepare")?.axisY).toBe("deterministic");
  });

  it("bounds callActivity as unknown (depends on callee)", async () => {
    const map = await classify("call-activity.bpmn");
    const call = map.get("CallActivity_Sub");
    expect(call?.axisY).toBe("unknown");
    expect(call?.axisX).toBe("unknown");
    expect(call?.rationale).toContain("depends on callee");
  });

  it("bounds subProcess as unknown (children not separately resolved)", async () => {
    const map = await classify("sub-process.bpmn");
    const sub = map.get("SubProcess_Embedded");
    expect(sub?.axisY).toBe("unknown");
    expect(sub?.axisX).toBe("unknown");
    expect(sub?.rationale).toContain("Composition of child elements");

    // The parser does not recurse into the subProcess, so its children are not
    // emitted as separate evaluation points — exactly what the rationale states.
    expect(map.has("SubTask_1")).toBe(false);
    expect(map.has("SubStart_1")).toBe(false);
  });

  it("every emitted determinism entry carries a rationale", async () => {
    for (const fixture of [
      "human-task.bpmn",
      "messaging.bpmn",
      "timer.bpmn",
      "call-activity.bpmn",
      "sub-process.bpmn",
      "simple-process.bpmn",
      "runtime-bound.bpmn",
    ]) {
      const map = await classify(fixture);
      for (const entry of map.values()) {
        expect(entry.rationale, `${fixture}:${entry.evaluationPointId}`).toBeTruthy();
      }
    }
  });
});
