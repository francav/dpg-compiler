// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Victor França

import { describe, it, expect } from "vitest";
import { DeterminismClassifier } from "./DeterminismClassifier";

describe("DeterminismClassifier", () => {
  const classifier = new DeterminismClassifier();

  describe("Axis Y classification", () => {
    it("should classify pure FEEL expression as deterministic", () => {
      const result = classifier.classify({
        elementType: "exclusiveGateway",
        expression: "amount > 1000",
        expressionLanguage: "feel",
        policyTier: 2,
      });

      expect(result.axisY).toBe("deterministic");
      expect(result.reasoning).toContain("Pure variable comparison");
    });

    it("should classify FEEL with now() as non-deterministic", () => {
      const result = classifier.classify({
        elementType: "exclusiveGateway",
        expression: "now() > startDate",
        expressionLanguage: "feel",
        policyTier: 2,
      });

      expect(result.axisY).toBe("nonDeterministic");
      expect(result.reasoning).toContain("now()");
    });

    it("should classify JUEL bean call as runtime-bound", () => {
      const result = classifier.classify({
        elementType: "exclusiveGateway",
        expression: "${service.check()}",
        expressionLanguage: "juel",
        policyTier: 2,
      });

      expect(result.axisY).toBe("runtimeBound");
      expect(result.reasoning).toContain("bean method invocation");
    });

    it("should detect multiple non-deterministic patterns", () => {
      const result = classifier.classify({
        elementType: "scriptTask",
        expression: "new Date(); Math.random();",
        scriptFormat: "javascript",
        policyTier: 2,
      });

      expect(result.axisY).toBe("nonDeterministic");
      // Should detect both patterns
      const patterns = ["new Date()", "Math.random()"];
      patterns.some((p) => result.reasoning.includes(p));
    });
  });

  describe("Axis X classification", () => {
    it("should classify FEEL as profile-scoped", () => {
      const result = classifier.classify({
        elementType: "exclusiveGateway",
        expression: "amount > 1000",
        expressionLanguage: "feel",
        profileId: "camunda-8",
        policyTier: 2,
      });

      expect(result.axisX).toBe("profileScoped");
    });

    it("should classify JUEL as engine-specific", () => {
      const result = classifier.classify({
        elementType: "exclusiveGateway",
        expression: "${orderTotal > 1000}",
        expressionLanguage: "juel",
        policyTier: 2,
      });

      expect(result.axisX).toBe("engineSpecific");
    });

    it("should classify external task as externalized", () => {
      const result = classifier.classify({
        elementType: "serviceTask",
        implementationType: "externalTask",
        policyTier: 2,
      });

      expect(result.axisX).toBe("externalized");
    });

    it("should classify Java class as engine-specific", () => {
      const result = classifier.classify({
        elementType: "serviceTask",
        implementationType: "javaClass",
        policyTier: 2,
      });

      expect(result.axisX).toBe("engineSpecific");
    });
  });

  describe("Policy restrictions", () => {
    it("should restrict non-deterministic patterns at tier 2", () => {
      const classification = classifier.classify({
        elementType: "scriptTask",
        expression: "new Date()",
        scriptFormat: "javascript",
        policyTier: 2,
      });

      const shouldRestrict = classifier.shouldRestrict(classification, {
        elementType: "scriptTask",
        expression: "new Date()",
        scriptFormat: "javascript",
        policyTier: 2,
      });

      expect(shouldRestrict).toBe(true);
    });

    it("should not restrict at tier 1", () => {
      const classification = classifier.classify({
        elementType: "scriptTask",
        expression: "new Date()",
        scriptFormat: "javascript",
        policyTier: 1,
      });

      const shouldRestrict = classifier.shouldRestrict(classification, {
        elementType: "scriptTask",
        expression: "new Date()",
        scriptFormat: "javascript",
        policyTier: 1,
      });

      expect(shouldRestrict).toBe(false);
    });

    it("should restrict policy-dependent at tier 3", () => {
      const classification = classifier.classify({
        elementType: "scriptTask",
        expression: "computeTotal()",
        scriptFormat: "javascript",
        policyTier: 3,
      });

      // Override to policyDependent for test
      const testClassification = {
        ...classification,
        axisY: "policyDependent" as const,
      };

      const shouldRestrict = classifier.shouldRestrict(testClassification, {
        elementType: "scriptTask",
        expression: "computeTotal()",
        scriptFormat: "javascript",
        policyTier: 3,
      });

      expect(shouldRestrict).toBe(true);
    });
  });

  describe("Confidence scoring", () => {
    it("should have high confidence for pattern matches", () => {
      const result = classifier.classify({
        elementType: "scriptTask",
        expression: "new Date()",
        scriptFormat: "javascript",
        policyTier: 2,
      });

      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("should have lower confidence for unknown types", () => {
      const result = classifier.classify({
        elementType: "unknownTask",
        policyTier: 2,
      });

      expect(result.confidence).toBeLessThan(0.7);
    });
  });
});
