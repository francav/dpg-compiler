# @francav/compiler-browser

Browser entrypoint for the DPG compiler. It wraps the host-agnostic analysis
from `@francav/compiler-core` for use in the browser: `compileModelInBrowser`
runs a single analysis from in-memory XML, and `BrowserCompilerClient`
together with `createCompilerWorker` runs the compiler off the main thread in
a Web Worker.

## Install

```sh
npm install @francav/compiler-browser
```

## Usage

```ts
import { compileModelInBrowser } from "@francav/compiler-browser";

const result = await compileModelInBrowser({
  modelId: "order-process",
  bpmnXml: "<bpmn:definitions>...</bpmn:definitions>",
  // optional: dmnXml, policy, runtimeProfile, governanceTier, metadata
});

console.log(result.determinism);
```

For off-main-thread analysis, construct a `BrowserCompilerClient` with a
worker from `createCompilerWorker()` and call `client.compile(options)`.

## License

Apache-2.0
