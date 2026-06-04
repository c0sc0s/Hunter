import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type FeatureStatus = "ready" | "in_progress" | "blocked" | "done" | "cancelled";

type Feature = {
  id: string;
  title: string;
  status: FeatureStatus;
  scope: string[];
  outOfScope: string[];
  dependencies: string[];
  definitionOfDone: string[];
  verification: Array<{ command: string; proves: string }>;
  evidence: Array<Record<string, unknown>>;
  next: string;
};

type FeatureList = {
  version: number;
  updatedAt: string;
  statusValues: FeatureStatus[];
  features: Feature[];
};

const requiredFiles = [
  "AGENTS.md",
  "CONTEXT.md",
  "docs/INDEX.md",
  "docs/HARNESS.md",
  "feature-list.json",
  "progress.md",
  "session-handoff.md"
];

for (const file of requiredFiles) {
  await assertReadable(file);
}

const featureList = JSON.parse(await readFile("feature-list.json", "utf8")) as FeatureList;
assert.equal(featureList.version, 1, "feature-list.json version must be 1");
assert.ok(Array.isArray(featureList.features), "feature-list.json must contain features");
assert.ok(featureList.features.length > 0, "feature-list.json must contain at least one feature");

const featureIds = new Set<string>();
for (const feature of featureList.features) {
  assertFeature(feature);
  assert.equal(featureIds.has(feature.id), false, `duplicate feature id: ${feature.id}`);
  featureIds.add(feature.id);
}

for (const feature of featureList.features) {
  for (const dependency of feature.dependencies) {
    assert.ok(featureIds.has(dependency), `${feature.id} depends on unknown feature ${dependency}`);
  }
}

const active = featureList.features.filter((feature) => feature.status === "in_progress");
const ready = featureList.features.filter((feature) => feature.status === "ready");
const done = featureList.features.filter((feature) => feature.status === "done");
const cancelled = featureList.features.filter((feature) => feature.status === "cancelled");

console.log(
  `harness assets ok: ${featureList.features.length} features (${active.length} active, ${ready.length} ready, ${done.length} done, ${cancelled.length} cancelled)`
);
if (active.length) {
  console.log(`active: ${active.map((feature) => feature.id).join(", ")}`);
}

async function assertReadable(file: string): Promise<void> {
  const content = await readFile(file, "utf8");
  assert.ok(content.trim().length > 0, `${file} must not be empty`);
}

function assertFeature(feature: Feature): void {
  assert.ok(feature.id, "feature id is required");
  assert.ok(feature.title, `${feature.id} title is required`);
  assert.ok(["ready", "in_progress", "blocked", "done", "cancelled"].includes(feature.status), `${feature.id} has invalid status`);
  assertNonEmptyArray(feature.scope, `${feature.id} scope`);
  assert.ok(Array.isArray(feature.outOfScope), `${feature.id} outOfScope must be an array`);
  assert.ok(Array.isArray(feature.dependencies), `${feature.id} dependencies must be an array`);
  assertNonEmptyArray(feature.definitionOfDone, `${feature.id} definitionOfDone`);
  assert.ok(Array.isArray(feature.evidence), `${feature.id} evidence must be an array`);
  assert.ok(feature.next, `${feature.id} next is required`);
  assert.ok(feature.verification.length > 0, `${feature.id} must include verification commands`);

  for (const item of feature.verification) {
    assert.ok(item.command, `${feature.id} verification command is required`);
    assert.ok(item.proves, `${feature.id} verification proves is required`);
  }
}

function assertNonEmptyArray(value: string[], label: string): void {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.length > 0, `${label} must not be empty`);
}
