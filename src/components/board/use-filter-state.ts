"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EMPTY_FILTER_STATE,
  parseFilterState,
  serializeFilterState,
  type FilterState,
} from "@/lib/filters/schema";

export function useFilterState(): [FilterState, (patch: Partial<FilterState>) => void, () => void] {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const source = `${pathname}?${query}`;
  const [snapshot, setSnapshot] = useState(() => ({
    source,
    filters: parseFilterState(searchParams),
  }));
  let state = snapshot.filters;
  if (snapshot.source !== source) {
    state = parseFilterState(searchParams);
    setSnapshot({ source, filters: state });
  }
  const debounceRef = useRef<number | null>(null);

  function writeToUrl(next: FilterState) {
    const params = new URLSearchParams(query);
    ["assignee", "label", "priority", "due", "q"].forEach((key) => params.delete(key));
    serializeFilterState(next).forEach((value, key) => params.set(key, value));
    const suffix = params.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
  }

  function setFilter(patch: Partial<FilterState>) {
    const next = { ...state, ...patch };
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    setSnapshot({ source, filters: next });
    if (Object.keys(patch).length === 1 && "q" in patch) {
      debounceRef.current = window.setTimeout(() => writeToUrl(next), 250);
    } else {
      writeToUrl(next);
    }
  }

  function clearFilters() {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    setSnapshot({ source, filters: EMPTY_FILTER_STATE });
    writeToUrl(EMPTY_FILTER_STATE);
  }

  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    },
    [source],
  );
  return [state, setFilter, clearFilters];
}
