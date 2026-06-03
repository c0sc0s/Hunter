import { performance } from "node:perf_hooks";
import type { RecognitionTiming } from "../shared/types";

type TimedPhase = "sourceAdapterMs" | "contentSignalsMs";

export function createRecognitionTimer(clock: () => number = () => performance.now()) {
  const startedAt = clock();
  const phases: Record<TimedPhase, number> = {
    sourceAdapterMs: 0,
    contentSignalsMs: 0
  };

  return {
    async measure<T>(phase: TimedPhase, operation: () => Promise<T>): Promise<T> {
      const phaseStartedAt = clock();
      try {
        return await operation();
      } finally {
        phases[phase] += elapsed(phaseStartedAt, clock());
      }
    },

    snapshot(): RecognitionTiming {
      const totalMs = elapsed(startedAt, clock());
      const sourceAdapterMs = phases.sourceAdapterMs;
      const contentSignalsMs = phases.contentSignalsMs;

      return normalizeRecognitionTiming({
        totalMs,
        sourceAdapterMs,
        contentSignalsMs,
        itemBuildMs: Math.max(0, totalMs - sourceAdapterMs - contentSignalsMs)
      });
    }
  };
}

export function normalizeRecognitionTiming(input: Partial<RecognitionTiming>): RecognitionTiming {
  const sourceAdapterMs = normalizeMs(input.sourceAdapterMs);
  const contentSignalsMs = normalizeMs(input.contentSignalsMs);
  const itemBuildMs = normalizeMs(input.itemBuildMs);
  const totalMs = Math.max(normalizeMs(input.totalMs), sourceAdapterMs + contentSignalsMs + itemBuildMs);

  return {
    totalMs,
    sourceAdapterMs,
    contentSignalsMs,
    itemBuildMs
  };
}

function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}

function normalizeMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
