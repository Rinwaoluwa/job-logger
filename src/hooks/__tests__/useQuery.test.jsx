import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQuery } from "../useQuery.js";

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("useQuery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fetches at once on mount and debounces later dependency changes", async () => {
    const fetcher = vi.fn(async (q) => `result:${q}`);
    const { result, rerender } = renderHook(
      ({ q }) => useQuery((signal) => fetcher(q, signal), [q], { debounceMs: 250 }),
      { initialProps: { q: "a" } },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    await flush();
    expect(result.current.data).toBe("result:a");
    expect(result.current.loading).toBe(false);

    rerender({ q: "ab" });
    rerender({ q: "abc" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(249); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe("abc");
    // The previous data stays on screen while the new request is out.
    expect(result.current.data).toBe("result:a");
    expect(result.current.fetching).toBe(true);
    await flush();
    expect(result.current.data).toBe("result:abc");
    expect(result.current.fetching).toBe(false);
  });

  it("aborts the request in flight and ignores its late reply", async () => {
    const pending = [];
    const fetcher = vi.fn((q, signal) => new Promise((resolve) => pending.push({ q, signal, resolve })));
    const { result, rerender } = renderHook(
      ({ q }) => useQuery((signal) => fetcher(q, signal), [q], { debounceMs: 100 }),
      { initialProps: { q: "a" } },
    );
    rerender({ q: "b" });
    act(() => { vi.advanceTimersByTime(100); });
    expect(pending).toHaveLength(2);
    expect(pending[0].signal.aborted).toBe(true);

    await act(async () => { pending[1].resolve("B"); });
    expect(result.current.data).toBe("B");
    await act(async () => { pending[0].resolve("A"); });
    expect(result.current.data).toBe("B");
  });

  it("reload() runs immediately and an error is reported without losing the data", async () => {
    let fail = false;
    const fetcher = vi.fn(async () => { if (fail) throw new Error("boom"); return "ok"; });
    const { result } = renderHook(() => useQuery(() => fetcher(), [], { debounceMs: 250 }));
    await flush();
    expect(result.current.data).toBe("ok");
    fail = true;
    act(() => result.current.reload());
    expect(fetcher).toHaveBeenCalledTimes(2);
    await flush();
    expect(result.current.error).toBe("boom");
    expect(result.current.data).toBe("ok");
  });

  it("does nothing while disabled", () => {
    const fetcher = vi.fn(async () => "x");
    renderHook(() => useQuery(() => fetcher(), [], { enabled: false }));
    expect(fetcher).not.toHaveBeenCalled();
  });
});
