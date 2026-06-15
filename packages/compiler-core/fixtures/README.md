# Compiler Core Fixtures

This folder contains minimal XML and governance artifacts that allow developers to exercise the
compiler core without wiring an adapter or fetching policies at runtime.

## Layout

- `bpmn/` — BPMN diagrams used for structural and semantic smoke tests.
- `dmn/` — DMN decision tables paired with the BPMN flows.

The catalog currently includes:

- `simple-process.bpmn` + `loan-decision.dmn` — expected to stay policy-dependent across both axes.
- `runtime-bound.bpmn` + `runtime-bound.dmn` — includes FEEL `now()` calls to force a runtime-bound
  determinism downgrade on Axis Y.

## Usage

```bash
node --input-type=module <<'EOF'
import { readFile } from "node:fs/promises";
import { compileModel } from "../../dist/index.js";

const bpmnXml = await readFile(new URL("./bpmn/simple-process.bpmn", import.meta.url), "utf8");
const result = await compileModel({
  modelId: "simple-process",
  bpmnXml,
  // Optional: provide dmnXml when you want DMN analysis
  // dmnXml,
});

console.log(result.summary);
EOF
```

### Shortcut Command

After building the package (`npm run build --workspace @lumen/compiler-core`), run:

```bash
npm run fixtures --workspace @lumen/compiler-core
```

The script `scripts/run-fixtures.mjs` loads both fixture pairs and prints summaries plus the Axis Y
distribution so you can observe the runtime-bound downgrade alongside the policy-dependent baseline.
It relies on the compiler's built-in tier-1 policy and runtime profile, so no additional governance
files are necessary.
