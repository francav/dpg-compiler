// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import type { SemanticPass } from "./SemanticPass.js";

export class PassRegistry {
  private readonly passes = new Map<string, SemanticPass>();

  register(pass: SemanticPass): void {
    if (this.passes.has(pass.id)) {
      throw new Error(`Pass ${pass.id} already registered`);
    }
    this.passes.set(pass.id, pass);
  }

  list(): SemanticPass[] {
    const phases = ["L1", "L2", "analysis", "contracts", "summary"] as const;
    const sorted = [...this.passes.values()].sort(
      (a, b) => phases.indexOf(a.phase) - phases.indexOf(b.phase),
    );
    return topoSort(sorted);
  }
}

function topoSort(passes: SemanticPass[]): SemanticPass[] {
  const result: SemanticPass[] = [];
  const temporary = new Set<string>();
  const permanent = new Set<string>();
  const map = new Map(passes.map((pass) => [pass.id, pass]));

  function visit(pass: SemanticPass): void {
    if (permanent.has(pass.id)) {
      return;
    }
    if (temporary.has(pass.id)) {
      throw new Error(`Cyclic dependency detected at pass ${pass.id}`);
    }
    temporary.add(pass.id);
    for (const dep of pass.requires ?? []) {
      const dependency = map.get(dep);
      if (dependency) {
        visit(dependency);
      }
    }
    temporary.delete(pass.id);
    permanent.add(pass.id);
    result.push(pass);
  }

  for (const pass of passes) {
    visit(pass);
  }

  return result;
}
