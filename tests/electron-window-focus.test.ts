import { describe, expect, it, vi } from "vitest";
import { attachReloadOnFocus } from "../electron/window-focus";

describe("attachReloadOnFocus", () => {
  it("notifies the renderer whenever the window gains focus", () => {
    const handlers = new Map<string, () => void>();
    const send = vi.fn();
    const isLoading = vi.fn().mockReturnValue(false);

    attachReloadOnFocus({
      on(event, handler) {
        handlers.set(event, handler);
      },
      webContents: { isLoading, send }
    });

    handlers.get("focus")?.();

    expect(send).toHaveBeenCalledWith("seiton:window-focused");
  });

  it("does not notify while the current page is still loading", () => {
    const handlers = new Map<string, () => void>();
    const send = vi.fn();
    const isLoading = vi.fn().mockReturnValue(true);

    attachReloadOnFocus({
      on(event, handler) {
        handlers.set(event, handler);
      },
      webContents: { isLoading, send }
    });

    handlers.get("focus")?.();

    expect(send).not.toHaveBeenCalled();
  });
});
