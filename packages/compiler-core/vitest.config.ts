// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
