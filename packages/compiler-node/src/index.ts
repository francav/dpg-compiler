// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileModel, type CompileOptions, type CompilerResult } from "@dpg/compiler-core";

export interface CompileFromFilesOptions {
  readonly modelId: string;
  readonly governanceTier?: string;
  readonly policyPath?: string;
  readonly runtimeProfilePath?: string;
  readonly bpmnPath: string;
  readonly dmnPath?: string;
  readonly metadata?: CompileOptions["metadata"];
}

export async function compileFromFiles(options: CompileFromFilesOptions): Promise<CompilerResult> {
  const [policy, runtimeProfile, bpmnXml, dmnXml] = await Promise.all([
    readOptionalText(options.policyPath, "policy"),
    readOptionalText(options.runtimeProfilePath, "runtime profile"),
    readRequiredText(options.bpmnPath, "BPMN model"),
    readOptionalText(options.dmnPath, "DMN model"),
  ]);

  return compileModel({
    modelId: options.modelId,
    governanceTier: options.governanceTier,
    policy,
    runtimeProfile,
    bpmnXml,
    dmnXml,
    metadata: options.metadata,
  });
}

async function readRequiredText(filePath: string, label: string): Promise<string> {
  const absolutePath = resolve(filePath);
  try {
    return await readFile(absolutePath, "utf-8");
  } catch (error) {
    const err = error as Error;
    throw new Error(`Failed to read ${label} at ${absolutePath}: ${err.message}`);
  }
}

async function readOptionalText(
  filePath: string | undefined,
  label: string,
): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }
  return readRequiredText(filePath, label);
}
