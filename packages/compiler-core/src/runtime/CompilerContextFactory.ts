// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { collectMetadata } from "./MetadataCollector.js";
import { loadPolicy } from "./PolicyLoader.js";
import { loadRuntimeProfile } from "./ProfileLoader.js";
import { normalizeXml } from "./InputNormalizer.js";
import {
  DEFAULT_GOVERNANCE_TIER,
  DEFAULT_POLICY_YAML,
  DEFAULT_RUNTIME_PROFILE_YAML,
} from "./defaultArtifacts.js";
import type {
  CompilerContext,
  PolicySnapshot,
  RuntimeProfileSnapshot,
  RunMetadata,
} from "../types.js";

export interface ContextFactoryInput {
  readonly modelId: string;
  readonly governanceTier?: string;
  readonly policy?: string | PolicySnapshot;
  readonly runtimeProfile?: string | RuntimeProfileSnapshot;
  readonly bpmnXml?: string;
  readonly dmnXml?: string;
  readonly metadata?: Partial<RunMetadata> & { caller?: string };
}

export function createCompilerContext(input: ContextFactoryInput): CompilerContext {
  const metadata = collectMetadata(input.metadata);
  const governanceTier = input.governanceTier ?? DEFAULT_GOVERNANCE_TIER;

  const policySource = input.policy ?? DEFAULT_POLICY_YAML;
  const policy = loadPolicy(policySource, {
    governanceTier,
  });

  const runtimeProfileSource = input.runtimeProfile ?? DEFAULT_RUNTIME_PROFILE_YAML;
  const runtimeProfile = loadRuntimeProfile(runtimeProfileSource);

  const normalizedBpmn = input.bpmnXml ? normalizeXml(input.bpmnXml, "ingestion-bpmn") : undefined;
  const normalizedDmn = input.dmnXml ? normalizeXml(input.dmnXml, "ingestion-dmn") : undefined;

  return {
    modelId: input.modelId,
    governanceTier,
    policy,
    runtimeProfile,
    normalizedBpmn,
    normalizedDmn,
    metadata,
  };
}
