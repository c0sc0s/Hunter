import { useLayoutEffect, useMemo, useState } from "react";

const DEFAULT_MIN_COLUMN_WIDTH = 280;
const DEFAULT_MAX_COLUMN_WIDTH = 320;
const DEFAULT_GAP = 14;

type MasonryOptions = {
  gap?: number;
  maxColumnWidth?: number;
  minColumnWidth?: number;
};

export function useResponsiveMasonry<T>(items: T[], estimateWeight: (item: T) => number, options: MasonryOptions = {}) {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const gap = options.gap ?? DEFAULT_GAP;
  const minColumnWidth = options.minColumnWidth ?? DEFAULT_MIN_COLUMN_WIDTH;
  const maxColumnWidth = options.maxColumnWidth ?? DEFAULT_MAX_COLUMN_WIDTH;

  useLayoutEffect(() => {
    if (!containerElement) {
      return;
    }

    const updateWidth = () => {
      setContainerWidth(Math.round(containerElement.getBoundingClientRect().width));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(containerElement);
    return () => observer.disconnect();
  }, [containerElement]);

  const metrics = useMemo(
    () => getMasonryMetrics(containerWidth, { gap, maxColumnWidth, minColumnWidth }),
    [containerWidth, gap, maxColumnWidth, minColumnWidth]
  );

  const columns = useMemo(() => {
    const nextColumns = Array.from({ length: metrics.columnCount }, () => [] as T[]);
    const columnWeights = Array.from({ length: metrics.columnCount }, () => 0);

    for (const item of items) {
      const targetColumn = columnWeights.indexOf(Math.min(...columnWeights));
      nextColumns[targetColumn]?.push(item);
      columnWeights[targetColumn] += Math.max(1, estimateWeight(item)) + 1;
    }

    return nextColumns;
  }, [estimateWeight, items, metrics.columnCount]);

  return {
    columnWidth: metrics.columnWidth,
    columns,
    containerWidth,
    gap,
    setContainerElement
  };
}

function getMasonryMetrics(
  containerWidth: number,
  {
    gap,
    maxColumnWidth,
    minColumnWidth
  }: {
    gap: number;
    maxColumnWidth: number;
    minColumnWidth: number;
  }
) {
  if (containerWidth <= 0) {
    return { columnCount: 1, columnWidth: maxColumnWidth };
  }

  const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)));
  const availableColumnWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;
  return {
    columnCount,
    columnWidth: Math.min(maxColumnWidth, Math.max(0, availableColumnWidth))
  };
}
