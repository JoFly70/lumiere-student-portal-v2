import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { describe, expect, it } from "vitest";
import {
  createInformationalAcademicSnapshot,
  type InformationalAcademicSnapshotInput,
  type InformationalAcademicSnapshotOutput,
} from "@shared/informational-academic-snapshot";

const context = {
  studentId: "student-1",
  programAssignmentId: "assignment-1",
  programVersionId: "program-version-1",
} as const;

const occurrence = (
  occurrenceKind = "recorded-credit",
  occurrenceId = "occurrence-1",
  value: unknown = { amount: 3, course: "MATH-101" },
) => ({ occurrenceKind, occurrenceId, value });

const validInput = (): InformationalAcademicSnapshotInput => ({
  context,
  contractVersion: "phase-4a-contract-1",
  schemaVersion: "academic-snapshot-1",
  asOf: "2025-01-01T00:00:00.000Z",
  occurrences: [occurrence()],
});

const create = (
  input: InformationalAcademicSnapshotInput,
): InformationalAcademicSnapshotOutput =>
  createInformationalAcademicSnapshot(input);

const success = (input = validInput()) => {
  const output = create(input);
  expect(output.status).toBe("ACCEPTED");
  if (output.status !== "ACCEPTED") throw new Error("expected success");
  return output;
};

const rejection = (input: unknown) => {
  const output = create(input as InformationalAcademicSnapshotInput);
  expect(output.status).toBe("MANUAL_REVIEW");
  return output;
};

const frozenTree = (value: unknown, seen = new Set<object>()): void => {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) frozenTree(descriptor.value, seen);
  }
};

describe("createInformationalAcademicSnapshot", () => {
  it("creates an informational-only envelope with deterministic fingerprint", () => {
    const output = success();

    expect(output).toMatchObject({
      projectionKind: "INFORMATIONAL_ONLY",
      contractVersion: "phase-4a-contract-1",
      schemaVersion: "academic-snapshot-1",
      context,
      asOf: "2025-01-01T00:00:00.000Z",
      snapshotFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      inputAccounting: {
        projectionKind: "INFORMATIONAL_ONLY",
        occurrences: [{
          occurrenceKind: "recorded-credit",
          occurrenceId: "occurrence-1",
          value: { amount: 3, course: "MATH-101" },
        }],
      },
    });
  });

  it("is stable for occurrence shuffles and object-key order", () => {
    const left = success({
      ...validInput(),
      occurrences: [
        occurrence("z-kind", "z-id", { z: 1, a: { y: true, x: null } }),
        occurrence("a-kind", "a-id", { b: [2, 1], a: "value" }),
      ],
    });
    const right = success({
      ...validInput(),
      occurrences: [
        occurrence("a-kind", "a-id", { a: "value", b: [2, 1] }),
        occurrence("z-kind", "z-id", { a: { x: null, y: true }, z: 1 }),
      ],
    });

    expect(right.snapshotFingerprint).toBe(left.snapshotFingerprint);
    expect(right.inputAccounting).toEqual(left.inputAccounting);
    expect(left.inputAccounting.occurrences.map((item) => item.occurrenceId))
      .toEqual(["a-id", "z-id"]);
  });

  it("changes fingerprint for content, each context identity, and versions", () => {
    const baseline = success().snapshotFingerprint;
    expect(success({
      ...validInput(),
      occurrences: [occurrence("recorded-credit", "occurrence-1", { amount: 4 })],
    }).snapshotFingerprint).not.toBe(baseline);
    for (const field of ["studentId", "programAssignmentId", "programVersionId"] as const) {
      expect(success({
        ...validInput(),
        context: { ...context, [field]: `${context[field]}-changed` },
      }).snapshotFingerprint).not.toBe(baseline);
    }
    expect(success({ ...validInput(), contractVersion: "phase-4a-contract-2" })
      .snapshotFingerprint).not.toBe(baseline);
    expect(success({ ...validInput(), schemaVersion: "academic-snapshot-2" })
      .snapshotFingerprint).not.toBe(baseline);
  });

  it("retains duplicate multiplicity and excludes asOf from the fingerprint", () => {
    const one = success({ ...validInput(), occurrences: [occurrence()] });
    const two = success({ ...validInput(), occurrences: [occurrence(), occurrence()] });
    expect(two.snapshotFingerprint).not.toBe(one.snapshotFingerprint);
    expect(two.inputAccounting.occurrences).toHaveLength(2);

    const later = success({
      ...validInput(),
      asOf: "2026-02-03T04:05:06.789Z",
    });
    expect(later.snapshotFingerprint).toBe(one.snapshotFingerprint);
    expect(later.asOf).not.toBe(one.asOf);
  });

  it("canonicalizes ordering deterministically and preserves own __proto__ data", () => {
    const value = JSON.parse(
      '{"__proto__":{"polluted":true},"nested":{"__proto__":{"kept":1}}}',
    ) as Record<string, unknown>;
    const output = success({ ...validInput(), occurrences: [occurrence("kind", "id", value)] });
    const projected = output.inputAccounting.occurrences[0].value as Record<string, unknown>;

    expect(Object.hasOwn(projected, "__proto__")).toBe(true);
    expect(Object.hasOwn(projected.nested as object, "__proto__")).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(projected)).toBeNull();
  });

  it("deep-freezes all success output and does not mutate input", () => {
    const input = validInput();
    const before = structuredClone(input);
    const output = success(input);
    frozenTree(output);
    expect(input).toEqual(before);
    expect(Object.isFrozen(output.context)).toBe(true);
    expect(Object.isFrozen(output.inputAccounting.occurrences)).toBe(true);
  });

  it("accepts empty occurrences", () => {
    const output = success({ ...validInput(), occurrences: [] });
    expect(output.inputAccounting.occurrences).toEqual([]);
  });

  it.each([
    ["blank student", { ...context, studentId: " " }],
    ["blank assignment", { ...context, programAssignmentId: "" }],
    ["blank program version", { ...context, programVersionId: "\t" }],
  ] as const)("rejects %s context identity", (_label, invalidContext) => {
    const output = rejection({ ...validInput(), context: invalidContext });
    expect(output.diagnostics.map((item) => item.reason)).toContain(
      "INVALID_CONTEXT_IDENTITY",
    );
  });

  it.each([
    ["blank contract", { contractVersion: " " }],
    ["blank schema", { schemaVersion: "" }],
  ] as const)("rejects %s", (_label, version) => {
    const output = rejection({ ...validInput(), ...version });
    expect(output.diagnostics.map((item) => item.reason)).toContain(
      "INVALID_VERSION",
    );
  });

  it("rejects blank occurrence identities", () => {
    const output = rejection({
      ...validInput(),
      occurrences: [
        occurrence("", "id"),
        occurrence("kind", " "),
      ],
    });
    expect(output.diagnostics.map((item) => item.reason)).toContain(
      "INVALID_OCCURRENCE_IDENTITY",
    );
    expect(output.inputAccounting.occurrences).toEqual([
      { occurrenceKind: "kind", occurrenceId: " " },
      { occurrenceKind: "", occurrenceId: "id" },
    ]);
  });

  it.each([
    "2025-01-01",
    "2025-01-01T00:00:00Z",
    "2025-01-01T00:00:00.000+00:00",
    "not-a-timestamp",
  ])("rejects non-canonical asOf %s", (asOf) => {
    expect(rejection({ ...validInput(), asOf }).diagnostics.map((item) => item.reason))
      .toContain("INVALID_AS_OF");
  });

  it.each([
    ["undefined", undefined],
    ["function", () => "nope"],
    ["symbol", Symbol("opaque")],
    ["bigint", 1n],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["date", new Date("2025-01-01T00:00:00.000Z")],
    ["regexp", /opaque/],
    ["map", new Map([["key", "value"]])],
    ["set", new Set(["value"])],
    ["class instance", new (class Opaque { value = 1 })()],
  ] as const)("rejects non-JSON opaque %s", (_label, value) => {
    expect(rejection({
      ...validInput(),
      occurrences: [_label === "undefined"
        ? { ...occurrence("kind", "id"), value }
        : occurrence("kind", "id", value)],
    }).diagnostics.map((item) => item.reason)).toContain("INVALID_JSON_VALUE");
  });

  it("rejects cycles, sparse arrays, symbol keys, and custom prototypes", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(rejection({
      ...validInput(),
      occurrences: [occurrence("kind", "cycle", cycle)],
    }).diagnostics.map((item) => item.reason)).toContain("INVALID_JSON_VALUE");

    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(rejection({
      ...validInput(),
      occurrences: [occurrence("kind", "sparse", sparse)],
    }).diagnostics.map((item) => item.reason)).toContain("INVALID_JSON_VALUE");

    const symbolKey = { value: 1, [Symbol("metadata")]: "not-json" };
    expect(rejection({
      ...validInput(),
      occurrences: [occurrence("kind", "symbol", symbolKey)],
    }).diagnostics.map((item) => item.reason)).toContain("INVALID_JSON_VALUE");

    const custom = Object.create({ inherited: true }) as Record<string, unknown>;
    custom.value = 1;
    expect(rejection({
      ...validInput(),
      occurrences: [occurrence("kind", "prototype", custom)],
    }).diagnostics.map((item) => item.reason)).toContain("INVALID_JSON_VALUE");
  });

  it("rejects accessors without invoking a getter and non-enumerable properties", () => {
    let invoked = false;
    const accessor = {};
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get() {
        invoked = true;
        return "must not be read";
      },
    });
    expect(rejection({
      ...validInput(),
      occurrences: [occurrence("kind", "accessor", accessor)],
    }).diagnostics.map((item) => item.reason)).toContain("INVALID_JSON_VALUE");
    expect(invoked).toBe(false);

    const hidden = { visible: true };
    Object.defineProperty(hidden, "hidden", { enumerable: false, value: true });
    expect(rejection({
      ...validInput(),
      occurrences: [occurrence("kind", "hidden", hidden)],
    }).diagnostics.map((item) => item.reason)).toContain("INVALID_JSON_VALUE");
  });

  it("rejects malformed top-level structures fail-closed and deterministically", () => {
    const malformed = [
      null,
      undefined,
      {},
      { ...validInput(), occurrences: null },
      { ...validInput(), occurrences: {} },
    ];
    for (const input of malformed) {
      const first = rejection(input);
      const second = rejection(input);
      expect(second).toEqual(first);
      frozenTree(first);
    }
  });

  it("rejects duplicate or malformed structural fields without throwing", () => {
    const occurrenceWithExtra = {
      ...occurrence(),
      extra: true,
    };
    expect(rejection({
      ...validInput(),
      occurrences: [occurrenceWithExtra],
    }).status).toBe("MANUAL_REVIEW");

    const occurrenceWithAccessor = {};
    Object.defineProperties(occurrenceWithAccessor, {
      occurrenceKind: { enumerable: true, value: "kind" },
      occurrenceId: {
        enumerable: true,
        get() {
          throw new Error("must not invoke");
        },
      },
      value: { enumerable: true, value: null },
    });
    expect(rejection({
      ...validInput(),
      occurrences: [occurrenceWithAccessor],
    }).status).toBe("MANUAL_REVIEW");
  });

  it("includes only safely accessible structural kind/id accounting on rejection", () => {
    const bad = {
      occurrenceKind: "visible-kind",
      occurrenceId: "visible-id",
      value: undefined,
    };
    const output = rejection({ ...validInput(), occurrences: [bad] });
    expect(output.inputAccounting.occurrences).toEqual([{
      occurrenceKind: "visible-kind",
      occurrenceId: "visible-id",
    }]);
    expect(output.diagnostics[0]).toMatchObject({
      projectionKind: "INFORMATIONAL_ONLY",
      status: "MANUAL_REVIEW",
    });
  });

  it("uses SHA-256 over the versioned context and canonical occurrences only", () => {
    const output = success({
      ...validInput(),
      occurrences: [occurrence("kind", "id", { z: 1, a: true })],
    });
    const canonical = JSON.stringify({
      context: {
        programAssignmentId: "assignment-1",
        programVersionId: "program-version-1",
        studentId: "student-1",
      },
      contractVersion: "phase-4a-contract-1",
      occurrences: [{
        occurrenceId: "id",
        occurrenceKind: "kind",
        value: { a: true, z: 1 },
      }],
      schemaVersion: "academic-snapshot-1",
    });
    const expected = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    expect(output.snapshotFingerprint).toBe(expected);
  });

  it("requires the top-level input to have exactly its own enumerable data keys", () => {
    const extra = { ...validInput(), unexpected: true };
    const ownProto = { ...validInput() };
    Object.defineProperty(ownProto, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "metadata",
      writable: true,
    });
    const missing = { ...validInput() } as Record<string, unknown>;
    delete missing.asOf;
    const symbol = { ...validInput(), [Symbol("metadata")]: true };
    const accessor = { ...validInput() };
    Object.defineProperty(accessor, "asOf", {
      configurable: true,
      enumerable: true,
      get: () => "2025-01-01T00:00:00.000Z",
    });
    const hidden = { ...validInput() };
    Object.defineProperty(hidden, "asOf", {
      configurable: true,
      enumerable: false,
      value: "2025-01-01T00:00:00.000Z",
    });

    for (const malformed of [extra, ownProto, missing, symbol, accessor, hidden]) {
      expect(rejection(malformed).status).toBe("MANUAL_REVIEW");
    }
  });

  it("requires context to have exactly its own enumerable data keys", () => {
    const extra = { ...context, unexpected: true };
    const ownProto = { ...context };
    Object.defineProperty(ownProto, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "metadata",
      writable: true,
    });
    const missing = { ...context } as Record<string, unknown>;
    delete missing.studentId;
    const symbol = { ...context, [Symbol("metadata")]: true };
    const accessor = { ...context };
    Object.defineProperty(accessor, "studentId", {
      configurable: true,
      enumerable: true,
      get: () => "student-1",
    });
    const hidden = { ...context };
    Object.defineProperty(hidden, "studentId", {
      configurable: true,
      enumerable: false,
      value: "student-1",
    });

    for (const malformedContext of [extra, ownProto, missing, symbol, accessor, hidden]) {
      expect(rejection({ ...validInput(), context: malformedContext }).status)
        .toBe("MANUAL_REVIEW");
    }
  });

  it("accepts valid null-prototype input, context, and occurrence records", () => {
    const nullContext = Object.assign(Object.create(null), context);
    const nullOccurrence = Object.assign(Object.create(null), occurrence());
    const nullInput = Object.assign(Object.create(null), {
      ...validInput(),
      context: nullContext,
      occurrences: [nullOccurrence],
    });

    expect(success(nullInput).status).toBe("ACCEPTED");
  });

  it("validates occurrence container descriptors before reading any entries", () => {
    const extra = [...validInput().occurrences] as unknown[] & Record<string, unknown>;
    extra.extra = true;
    const symbol = [...validInput().occurrences] as unknown[] & Record<symbol, unknown>;
    symbol[Symbol("metadata")] = true;
    const hidden = [...validInput().occurrences];
    Object.defineProperty(hidden, "0", {
      configurable: true,
      enumerable: false,
      value: hidden[0],
      writable: true,
    });
    let indexGetterInvoked = false;
    const getter = [...validInput().occurrences];
    Object.defineProperty(getter, "0", {
      configurable: true,
      enumerable: true,
      get() {
        indexGetterInvoked = true;
        return validInput().occurrences[0];
      },
    });
    let iteratorInvoked = false;
    const iterator = [...validInput().occurrences];
    Object.defineProperty(iterator, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      value: () => {
        iteratorInvoked = true;
        throw new Error("iterator must not be consumed");
      },
    });
    const customPrototype = [...validInput().occurrences];
    Object.setPrototypeOf(customPrototype, { custom: true });

    for (const occurrences of [extra, symbol, hidden, getter, iterator, customPrototype]) {
      expect(rejection({ ...validInput(), occurrences }).status).toBe("MANUAL_REVIEW");
    }
    expect(indexGetterInvoked).toBe(false);
    expect(iteratorInvoked).toBe(false);
  });

  it("rejects occurrence container and structural proxies before proxy traps run", () => {
    let containerTrapInvoked = false;
    const container = new Proxy([...validInput().occurrences], {
      ownKeys() {
        containerTrapInvoked = true;
        throw new Error("proxy reflection must not run");
      },
    });
    let topTrapInvoked = false;
    const top = new Proxy(validInput(), {
      ownKeys() {
        topTrapInvoked = true;
        throw new Error("proxy reflection must not run");
      },
    });
    let contextTrapInvoked = false;
    const proxiedContext = new Proxy(context, {
      ownKeys() {
        contextTrapInvoked = true;
        throw new Error("proxy reflection must not run");
      },
    });
    let occurrenceTrapInvoked = false;
    const proxiedOccurrence = new Proxy(occurrence(), {
      ownKeys() {
        occurrenceTrapInvoked = true;
        throw new Error("proxy reflection must not run");
      },
    });

    expect(nodeTypes.isProxy(container)).toBe(true);
    expect(nodeTypes.isProxy(top)).toBe(true);
    expect(nodeTypes.isProxy(proxiedContext)).toBe(true);
    expect(nodeTypes.isProxy(proxiedOccurrence)).toBe(true);
    expect(rejection({ ...validInput(), occurrences: container }).status)
      .toBe("MANUAL_REVIEW");
    expect(rejection(top).status).toBe("MANUAL_REVIEW");
    expect(rejection({ ...validInput(), context: proxiedContext }).status)
      .toBe("MANUAL_REVIEW");
    expect(rejection({ ...validInput(), occurrences: [proxiedOccurrence] }).status)
      .toBe("MANUAL_REVIEW");
    expect(containerTrapInvoked).toBe(false);
    expect(topTrapInvoked).toBe(false);
    expect(contextTrapInvoked).toBe(false);
    expect(occurrenceTrapInvoked).toBe(false);
  });

  it("rejects nested opaque proxies before reflection and keeps rejection frozen", () => {
    let nestedTrapInvoked = false;
    const nested = new Proxy({ unsafe: true }, {
      ownKeys() {
        nestedTrapInvoked = true;
        throw new Error("proxy reflection must not run");
      },
    });
    const input = {
      ...validInput(),
      occurrences: [occurrence("kind", "proxy", { nested })],
    };
    const before = input.occurrences[0].value;
    const output = rejection(input);
    expect(nestedTrapInvoked).toBe(false);
    expect(output).toEqual(rejection(input));
    frozenTree(output);
    expect(input.occurrences[0].value).toBe(before);
  });

  it("accepts shared non-cyclic references while preserving opaque array order sensitivity", () => {
    const shared = { label: "shared" };
    const sharedOutput = success({
      ...validInput(),
      occurrences: [occurrence("first", "one", { shared }), occurrence("second", "two", { shared })],
    });
    expect(sharedOutput.status).toBe("ACCEPTED");

    const forward = success({
      ...validInput(),
      occurrences: [occurrence("array", "order", ["first", "second"])],
    });
    const reverse = success({
      ...validInput(),
      occurrences: [occurrence("array", "order", ["second", "first"])],
    });
    expect(forward.snapshotFingerprint).not.toBe(reverse.snapshotFingerprint);
  });
});