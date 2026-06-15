# dpg-compiler

A pure, host-agnostic analysis engine for **Deterministic Process Governance (DPG)** — it analyzes
BPM process models and classifies their behavioral predictability.

## Status

Early development (0.1.0). APIs are unstable and subject to change.

## Packages

- `@dpg/compiler-core` — host-agnostic analysis core
- `@dpg/compiler-node` — Node.js filesystem adapter
- `@dpg/compiler-browser` — browser / Web Worker adapter

## Develop

Requires Node.js >= 18 and npm. This is an npm workspaces monorepo.

```sh
npm install
npm run build
npm test
```

## License

[Apache-2.0](./LICENSE). Copyright 2026 Victor França.

## Contributing

A contribution guide will follow.
