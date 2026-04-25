import type { SeitonApi } from "../../electron/preload";

declare global {
  interface Window {
    seiton?: SeitonApi;
  }
}
