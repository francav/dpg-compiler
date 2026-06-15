// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

export const DEFAULT_GOVERNANCE_TIER = "tier-1";

export const DEFAULT_POLICY_YAML = `id: standard-governance-policy
version: 0.9
processTiers:
  tier-1:
    determinism:
      axisY:
        minimum: deterministic
      axisX:
        default: profileScoped
    runtimeProfile: required
  tier-2:
    determinism:
      axisY:
        minimum: policyDependent
      axisX:
        default: engineAgnostic
    runtimeProfileRequired: false
rules:
  enabled:
    - STRUCTURAL_WELL_FORMED
    - STRUCTURAL_BOUNDARY_MATCH
    - SEMANTIC_DETERMINISM_AXIS_Y
    - SEMANTIC_DETERMINISM_AXIS_X
    - RUNTIME_DEPENDENCY_DISCOVERY
  disabled:
    - LEGACY_GATEWAY_COMPAT
`;

export const DEFAULT_RUNTIME_PROFILE_YAML = `id: standard-runtime-profile
version: 2024.10
capabilities:
  timers:
    supportsCycleTimers: true
    maxPrecisionMs: 100
  integrations:
    boundaryTypes:
      - rest
      - queue
      - event
    outboundPolicies:
      retries: 3
      circuitBreaker: enabled
  expressions:
    languages:
      - feel
      - juel
    sandboxed: true
  scripting:
    allowsNodeExtensions: false
    deterministicApis:
      - clock.now
      - crypto.sha256
`;
