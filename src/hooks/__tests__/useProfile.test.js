import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/storyIndex.js", () => ({
  buildStoryIndex: vi.fn((profile) => ({ byId: new Map(), for: profile })),
}));

import { buildStoryIndex } from "../../lib/storyIndex.js";
import { indexFor } from "../useProfile.jsx";

describe("indexFor", () => {
  it("builds the story index once per profile object, however many readers ask", () => {
    const profile = { roles: [] };
    const a = indexFor(profile);
    const b = indexFor(profile);
    expect(a).toBe(b);
    expect(buildStoryIndex).toHaveBeenCalledTimes(1);

    const other = { roles: [] };
    expect(indexFor(other)).not.toBe(a);
    expect(buildStoryIndex).toHaveBeenCalledTimes(2);
    expect(indexFor(null)).toBeNull();
  });
});
