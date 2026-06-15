// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { compileModel, type CompilerResult } from "@dpg/compiler-core";
import type {
  BrowserCompileOptions,
  BrowserWorkerRequest,
  BrowserWorkerResponse,
} from "./protocol.js";

export type {
  BrowserCompileOptions,
  BrowserWorkerRequest,
  BrowserWorkerResponse,
} from "./protocol.js";

export interface WorkerMessageEvent {
  readonly data: BrowserWorkerResponse;
}

export interface WorkerLike {
  postMessage(message: BrowserWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEvent) => void): void;
  terminate?(): void;
}

export function compileModelInBrowser(options: BrowserCompileOptions): Promise<CompilerResult> {
  return compileModel(options);
}

export class BrowserCompilerClient {
  private sequence = 0;
  private readonly pending = new Map<
    string,
    {
      resolve: (result: CompilerResult) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly handleMessage = (event: WorkerMessageEvent): void => {
    const payload = event.data;
    const resolver = this.pending.get(payload.id);
    if (!resolver) {
      return;
    }
    this.pending.delete(payload.id);
    if ("result" in payload) {
      resolver.resolve(payload.result);
    } else {
      const message = payload.error?.message ?? "Unknown worker error";
      const error = new Error(message);
      error.name = payload.error?.name ?? "BrowserCompilerWorkerError";
      resolver.reject(error);
    }
  };

  constructor(private readonly worker: WorkerLike) {
    this.worker.addEventListener("message", this.handleMessage);
  }

  compile(options: BrowserCompileOptions): Promise<CompilerResult> {
    const requestId = `compile-${++this.sequence}`;
    return new Promise<CompilerResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const request: BrowserWorkerRequest = {
        id: requestId,
        options,
      };
      this.worker.postMessage(request);
    });
  }

  dispose(): void {
    this.worker.removeEventListener("message", this.handleMessage);
    for (const [, resolver] of this.pending.entries()) {
      resolver.reject(new Error("Browser compiler worker disposed"));
    }
    this.pending.clear();
    if (typeof this.worker.terminate === "function") {
      this.worker.terminate();
    }
  }
}

export function createCompilerWorker(): Worker {
  return new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
}
