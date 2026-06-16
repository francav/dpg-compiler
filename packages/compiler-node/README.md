# @dpg/compiler-node

Node.js entrypoint for the DPG compiler. It re-exports the host-agnostic
analysis from `@dpg/compiler-core` and adds file-loading helpers so you can
analyze BPMN/DMN models directly from disk: `compileFromFiles` reads the
model (and optional DMN, policy, and runtime-profile files) and forwards
them to `compileModel`.

## Install

```sh
npm install @dpg/compiler-node
```

## Usage

```ts
import { compileFromFiles } from "@dpg/compiler-node";

const result = await compileFromFiles({
  modelId: "order-process",
  bpmnPath: "./models/order-process.bpmn",
  // optional: dmnPath, policyPath, runtimeProfilePath, governanceTier, metadata
});

console.log(result.determinism);
```

`compileModel` and the `CompilerResult` type are also re-exported from
`@dpg/compiler-core` for callers that already hold the model XML in memory.

## License

Apache-2.0
