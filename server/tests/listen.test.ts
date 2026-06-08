import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { PortExhaustedError, listenOnFirstAvailable, parsePortPreferences } from "../listen.js";

test("parsePortPreferences: default falls back to 4317", () => {
  assert.deepEqual(parsePortPreferences({}), [4317]);
});

test("parsePortPreferences: PORT env overrides default", () => {
  assert.deepEqual(parsePortPreferences({ PORT: "5555" }), [5555]);
});

test("parsePortPreferences: HUNTER_PORT_RANGE expands inclusively", () => {
  assert.deepEqual(parsePortPreferences({ HUNTER_PORT_RANGE: "4317-4319" }), [4317, 4318, 4319]);
});

test("parsePortPreferences: HUNTER_PORT_RANGE wins over PORT", () => {
  assert.deepEqual(parsePortPreferences({ HUNTER_PORT_RANGE: "4000-4001", PORT: "9999" }), [4000, 4001]);
});

test("parsePortPreferences: rejects malformed range", () => {
  assert.throws(() => parsePortPreferences({ HUNTER_PORT_RANGE: "not-a-range" }), /must be/);
});

test("parsePortPreferences: rejects inverted range", () => {
  assert.throws(() => parsePortPreferences({ HUNTER_PORT_RANGE: "4319-4317" }), /invalid range/);
});

test("parsePortPreferences: rejects oversized range", () => {
  assert.throws(() => parsePortPreferences({ HUNTER_PORT_RANGE: "4317-9000" }), /span > 32/);
});

test("parsePortPreferences: rejects invalid PORT", () => {
  assert.throws(() => parsePortPreferences({ PORT: "abc" }), /valid port/);
});

test("listenOnFirstAvailable: binds the first available port and falls through EADDRINUSE", async () => {
  // Occupy a port with a sacrificial app, then ask listenOnFirstAvailable to
  // try [occupied, occupied+1]. It should land on occupied+1.
  const blocker = express();
  const blockerServer = await new Promise<import("node:http").Server>((resolve, reject) => {
    const s = blocker.listen(0, "127.0.0.1");
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });
  const address = blockerServer.address();
  if (!address || typeof address === "string") throw new Error("unexpected address");
  const occupied = address.port;

  try {
    const target = express();
    const result = await listenOnFirstAvailable(target, [occupied, occupied + 1]);
    try {
      assert.equal(result.port, occupied + 1, "should skip occupied port");
    } finally {
      await new Promise<void>((resolve) => result.server.close(() => resolve()));
    }
  } finally {
    await new Promise<void>((resolve) => blockerServer.close(() => resolve()));
  }
});

test("listenOnFirstAvailable: throws PortExhaustedError when all ports occupied", async () => {
  // Bind two adjacent ports manually, then ask listenOnFirstAvailable to try
  // exactly those two. Both should fail with EADDRINUSE, surfacing as
  // PortExhaustedError.
  const a = express();
  const aServer = await new Promise<import("node:http").Server>((resolve, reject) => {
    const s = a.listen(0, "127.0.0.1");
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });
  const aAddress = aServer.address();
  if (!aAddress || typeof aAddress === "string") throw new Error("unexpected");
  const aPort = aAddress.port;

  // Find a second free port and immediately occupy it.
  const b = express();
  const bServer = await new Promise<import("node:http").Server>((resolve, reject) => {
    const s = b.listen(0, "127.0.0.1");
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });
  const bAddress = bServer.address();
  if (!bAddress || typeof bAddress === "string") throw new Error("unexpected");
  const bPort = bAddress.port;

  try {
    const target = express();
    await assert.rejects(
      () => listenOnFirstAvailable(target, [aPort, bPort]),
      (err: unknown) => {
        assert.ok(err instanceof PortExhaustedError);
        assert.deepEqual((err as PortExhaustedError).tried, [aPort, bPort]);
        return true;
      }
    );
  } finally {
    await new Promise<void>((resolve) => aServer.close(() => resolve()));
    await new Promise<void>((resolve) => bServer.close(() => resolve()));
  }
});
