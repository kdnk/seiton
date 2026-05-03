type FocusableWindow = {
  on(event: "focus", handler: () => void): void;
  webContents: {
    isLoading(): boolean;
    send(channel: "seiton:window-focused"): void;
  };
};

export function attachReloadOnFocus(window: FocusableWindow): void {
  window.on("focus", () => {
    if (window.webContents.isLoading()) return;
    window.webContents.send("seiton:window-focused");
  });
}
