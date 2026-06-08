import type { SourceType } from "../shared/types";

export type FilterKey = "all" | "unread" | "read" | "favorite";
export type SourceFilter = "all" | SourceType;
export type ReadState = "unread" | "read";
