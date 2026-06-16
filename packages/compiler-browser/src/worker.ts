// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { compileModel } from "@francav/compiler-core";
import type {
  BrowserWorkerRequest,
  BrowserWorkerResponse,
  BrowserWorkerError,
} from "./protocol.js";

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<BrowserWorkerRequest>) => void,
  ): void;
  postMessage(message: BrowserWorkerResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener("message", async (event) => {
  const payload = event.data;
  try {
    const result = await compileModel(payload.options);
    scope.postMessage({ id: payload.id, result });
  } catch (error) {
    scope.postMessage({
      id: payload.id,
      error: serializeError(error),
    });
  }
});

function serializeError(error: unknown): BrowserWorkerError["error"] {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}
