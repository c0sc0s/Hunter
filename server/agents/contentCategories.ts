import type { AgentContentCategory, AgentContentCategorySummary, LibraryItem } from "../../shared/types";
import { cleanText } from "../sources/url";

export function collectAgentContentCategories(items: Array<Pick<LibraryItem, "agentClassification">>): AgentContentCategorySummary[] {
  const byId = new Map<string, AgentContentCategorySummary>();

  for (const item of items) {
    const category = itemAgentContentCategory(item);
    if (!category) continue;

    const previous = byId.get(category.id);
    if (previous) {
      previous.count += 1;
      if (!previous.description && category.description) {
        previous.description = category.description;
      }
      continue;
    }

    byId.set(category.id, {
      id: category.id,
      label: category.label,
      description: category.description,
      count: 1
    });
  }

  return [...byId.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function itemAgentContentCategory(item: Pick<LibraryItem, "agentClassification">): AgentContentCategorySummary | undefined {
  const category = item.agentClassification?.classification.contentCategory;
  if (category?.id && category.label) {
    return {
      id: category.id,
      label: category.label,
      description: category.description,
      count: 1
    };
  }

  const legacyPrimaryCategory = item.agentClassification?.classification.primaryCategory;
  if (!legacyPrimaryCategory) return undefined;

  return {
    id: `legacy-${legacyPrimaryCategory}`,
    label: titleCase(legacyPrimaryCategory),
    count: 1
  };
}

export function needsAgentClassification(item: LibraryItem): boolean {
  if (item.enrichmentState === "processing" || item.enrichmentState === "failed") return false;

  const result = item.agentClassification;
  if (!result?.classification.contentCategory) return true;
  if (item.contentHash && result.contentHash !== item.contentHash) return true;
  return false;
}

export function normalizeAgentContentCategory(
  category: {
    label: string;
    description?: string;
    existingCategoryId?: string | null;
  },
  existingCategories: AgentContentCategorySummary[]
): AgentContentCategory {
  const matched = matchExistingCategory(category, existingCategories);
  if (matched) {
    return {
      id: matched.id,
      label: matched.label,
      description: matched.description || cleanText(category.description ?? "") || undefined,
      source: "existing"
    };
  }

  const label = normalizeCategoryLabel(category.label);
  return {
    id: slugifyCategory(label),
    label,
    description: cleanText(category.description ?? "").slice(0, 180) || undefined,
    source: "new"
  };
}

export function mergeAgentContentCategory(
  categories: AgentContentCategorySummary[],
  category: AgentContentCategory
): AgentContentCategorySummary[] {
  const byId = new Map(categories.map((summary) => [summary.id, { ...summary }]));
  const previous = byId.get(category.id);
  if (previous) {
    previous.count += 1;
    if (!previous.description && category.description) {
      previous.description = category.description;
    }
  } else {
    byId.set(category.id, {
      id: category.id,
      label: category.label,
      description: category.description,
      count: 1
    });
  }

  return [...byId.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function matchExistingCategory(
  category: { label: string; existingCategoryId?: string | null },
  existingCategories: AgentContentCategorySummary[]
): AgentContentCategorySummary | undefined {
  const requestedId = cleanText(category.existingCategoryId ?? "");
  if (requestedId) {
    const byId = existingCategories.find((existing) => existing.id === requestedId);
    if (byId) return byId;
  }

  const labelKey = normalizeCategoryLabel(category.label).toLowerCase();
  return existingCategories.find((existing) => existing.label.toLowerCase() === labelKey);
}

function normalizeCategoryLabel(value: string): string {
  return cleanText(value).replace(/\s+/g, " ").trim().slice(0, 48) || "Unsorted";
}

function slugifyCategory(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || `category-${hashString(label)}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function titleCase(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
