// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BrowserCompilerClient,
  compileModelInBrowser,
  type WorkerLike,
  type WorkerMessageEvent,
} from "./index.js";
import type { BrowserWorkerRequest, BrowserWorkerResponse } from "./protocol.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "../../compiler-core/fixtures");

async function readFixture(relativePath: string): Promise<string> {
  const absolutePath = path.join(fixturesDir, relativePath);
  return readFile(absolutePath, "utf-8");
}

describe("compileModelInBrowser", () => {
  it("compiles in the same thread for small payloads", async () => {
    const bpmn = await readFixture("bpmn/simple-process.bpmn");

    const result = await compileModelInBrowser({
      modelId: "browser-inline",
      bpmnXml: bpmn,
    });

    expect(result.metadata.modelId).toBe("browser-inline");
    expect(result.summary.governanceTier).toBe("tier-1");
  });
});

describe("BrowserCompilerClient", () => {
  class MockWorker implements WorkerLike {
    private readonly listeners = new Set<(event: WorkerMessageEvent) => void>();
    constructor(
      private readonly responder: (request: BrowserWorkerRequest) => BrowserWorkerResponse,
    ) {}

    addEventListener(_type: "message", listener: (event: WorkerMessageEvent) => void): void {
      this.listeners.add(listener);
    }

    removeEventListener(_type: "message", listener: (event: WorkerMessageEvent) => void): void {
      this.listeners.delete(listener);
    }

    postMessage(message: BrowserWorkerRequest): void {
      const response = this.responder(message);
      queueMicrotask(() => {
        const event: WorkerMessageEvent = { data: response };
        for (const listener of this.listeners) {
          listener(event);
        }
      });
    }

    terminate(): void {
      this.listeners.clear();
    }
  }

  it("resolves compile results from worker responses", async () => {
    const mockResult = {
      metadata: {
        compilerVersion: "test",
        timestamp: new Date().toISOString(),
        modelId: "worker",
        inputHashes: {},
        policyId: "policy",
        policyVersion: "0.1",
        governanceTier: "tier-1",
        degraded: false,
      },
      structuralFindings: [],
      semanticFindings: [],
      determinismMap: [],
      runtimeDependencyMap: [],
      decisionAnalysis: [],
      contractCoverage: [],
      summary: {
        structuralErrors: 0,
        semanticErrors: 0,
        warnings: 0,
        determinismCompliance: true,
        runtimeProfileMissing: false,
        contractCoverageRatio: 1,
        decisionAnalysisStatus: "complete",
        governanceTier: "tier-1",
      },
    } as const;

    const worker = new MockWorker((request) => ({
      id: request.id,
      result: mockResult,
    }));

    const client = new BrowserCompilerClient(worker);
    const result = await client.compile({
      modelId: "worker",
      bpmnXml: "<definitions />",
    });

    expect(result.metadata.modelId).toBe("worker");
  });

  it("rejects when worker returns an error", async () => {
    const worker = new MockWorker((request) => ({
      id: request.id,
      error: { message: "compile failed" },
    }));

    const client = new BrowserCompilerClient(worker);
    await expect(
      client.compile({
        modelId: "broken",
        bpmnXml: "<definitions />",
      }),
    ).rejects.toThrow(/compile failed/);
  });

  it("rejects pending requests when disposed", async () => {
    const worker = new MockWorker((_request) => ({
      id: "pending",
      error: { message: "should not resolve" },
    }));
    const client = new BrowserCompilerClient(worker);
    const promise = client.compile({
      modelId: "pending",
      bpmnXml: "<definitions />",
    });
    client.dispose();
    await expect(promise).rejects.toThrow(/disposed/);
  });
});
