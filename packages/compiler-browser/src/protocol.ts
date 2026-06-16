// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { CompileOptions, CompilerResult } from "@francav/compiler-core";

export type BrowserCompileOptions = CompileOptions;

export interface BrowserWorkerRequest {
  readonly id: string;
  readonly options: BrowserCompileOptions;
}

export interface BrowserWorkerSuccess {
  readonly id: string;
  readonly result: CompilerResult;
}

export interface BrowserWorkerError {
  readonly id: string;
  readonly error: {
    readonly message: string;
    readonly name?: string;
    readonly stack?: string;
  };
}

export type BrowserWorkerResponse = BrowserWorkerSuccess | BrowserWorkerError;
