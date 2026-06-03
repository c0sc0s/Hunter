import assert from "node:assert/strict";
import { createRecognitionTimer, normalizeRecognitionTiming } from "../recognitionTiming";

let now = 100;
const timer = createRecognitionTimer(() => now);

const extracted = await timer.measure("sourceAdapterMs", async () => {
  now += 12.4;
  return "content";
});

assert.equal(extracted, "content");

await timer.measure("contentSignalsMs", async () => {
  now += 3.2;
});

now += 4.4;

assert.deepEqual(timer.snapshot(), {
  totalMs: 20,
  sourceAdapterMs: 12,
  contentSignalsMs: 3,
  itemBuildMs: 4
});

assert.deepEqual(
  normalizeRecognitionTiming({
    totalMs: 5,
    sourceAdapterMs: 6,
    contentSignalsMs: Number.NaN,
    itemBuildMs: -3
  }),
  {
    totalMs: 6,
    sourceAdapterMs: 6,
    contentSignalsMs: 0,
    itemBuildMs: 0
  }
);

console.log("recognition timing fixtures passed");
