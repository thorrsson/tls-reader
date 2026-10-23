export type DesktopCommand =
  | "sign-in" | "sign-out" | "show-library" | "refresh-library"
  | "reading-settings" | "table-of-contents" | "bookmarks" | "view-grid" | "view-list";

export type DesktopState = {
  authenticated: boolean;
  busy: boolean;
  reading: boolean;
  readerReady: boolean;
  catalogView: "grid" | "list";
};

declare global {
  interface Window {
    tlsDesktop?: {
      onCommand(callback: (command: DesktopCommand) => void): () => void;
      reportState(state: DesktopState): void;
    };
  }
}
