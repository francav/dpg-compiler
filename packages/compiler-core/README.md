# @dpg/compiler-core

Host-agnostic engine that analyzes BPMN and DMN models for execution
determinism. It parses a process model, builds an intermediate
representation, runs structural and semantic analysis passes (gateway
conditions, expression classification, DMN rule gaps, service-task and
flow-element classification, contract coverage), and assembles a single
`CompilerResult` describing determinism, runtime dependencies, decision
analysis, findings, and a maturity signal. It has no Node- or
browser-specific dependencies; supply the model XML directly.

## Install

```sh
npm install @dpg/compiler-core
```

## Usage

```ts
import { compileModel } from "@dpg/compiler-core";

const result = await compileModel({
  modelId: "order-process",
  bpmnXml: "<bpmn:definitions>...</bpmn:definitions>",
  // optional: dmnXml, policy, runtimeProfile, governanceTier, metadata
});

console.log(result.determinism);
```

## License

Apache-2.0
