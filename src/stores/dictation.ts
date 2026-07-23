import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { DictationRecord } from "../types";

const PAGE_SIZE = 20;

interface DictationState {
  records: DictationRecord[];
  totalCount: number;
  searchQuery: string;
  isLoading: boolean;
  hasMore: boolean;

  loadHistory: (query?: string, reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  deleteRecord: (id: number) => Promise<void>;
}

export const useDictationStore = create<DictationState>((set, get) => ({
  records: [],
  totalCount: 0,
  searchQuery: "",
  isLoading: false,
  hasMore: false,

  loadHistory: async (query?: string, reset = true) => {
    const q = query ?? get().searchQuery;
    set({ isLoading: true });
    try {
      const [records, totalCount] = await Promise.all([
        invoke<DictationRecord[]>("get_dictation_history", {
          query: q || null,
          limit: PAGE_SIZE,
          offset: 0,
        }),
        invoke<number>("get_dictation_count", { query: q || null }),
      ]);
      set({
        records,
        totalCount,
        hasMore: records.length < totalCount,
        ...(reset ? { searchQuery: q } : {}),
      });
    } catch (e) {
      console.error("[dictation] loadHistory failed:", e);
    } finally {
      set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { records, searchQuery, totalCount, isLoading } = get();
    if (isLoading || records.length >= totalCount) return;
    set({ isLoading: true });
    try {
      const more = await invoke<DictationRecord[]>("get_dictation_history", {
        query: searchQuery || null,
        limit: PAGE_SIZE,
        offset: records.length,
      });
      set((s) => ({
        records: [...s.records, ...more],
        hasMore: s.records.length + more.length < s.totalCount,
      }));
    } catch (e) {
      console.error("[dictation] loadMore failed:", e);
    } finally {
      set({ isLoading: false });
    }
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
    void get().loadHistory(q);
  },

  deleteRecord: async (id) => {
    try {
      await invoke("delete_dictation", { id });
      set((s) => ({
        records: s.records.filter((r) => r.id !== id),
        totalCount: s.totalCount - 1,
      }));
    } catch (e) {
      console.error("[dictation] delete failed:", e);
    }
  },
}));
