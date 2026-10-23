type TimerHandle = ReturnType<typeof setTimeout>;

type TimerScheduler = {
  setTimeout: (callback: () => void, delay: number) => TimerHandle;
  clearTimeout: (timer: TimerHandle) => void;
};

export class ProgressSaveQueue {
  private timer: TimerHandle | null = null;
  private pendingPayload: string | null = null;
  private lastSentPayload: string | null = null;
  private lastSuccessfullySavedPayload: string | null = null;
  private readonly inFlightPayloads = new Set<string>();

  constructor(
    private readonly save: (payload: string, keepalive: boolean) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly scheduler: TimerScheduler = {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer),
    },
    private readonly delay = 700,
  ) {}

  queue(payload: string): "queued" | "already-saved" | "already-in-flight" {
    this.clearPending();
    this.pendingPayload = null;

    if (payload === this.lastSentPayload) {
      if (this.inFlightPayloads.has(payload)) {
        return "already-in-flight";
      }
      if (this.lastSuccessfullySavedPayload === payload) {
        return "already-saved";
      }
    }

    this.pendingPayload = payload;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.sendPending(false);
    }, this.delay);
    return "queued";
  }

  flush() {
    this.clearPending();
    this.sendPending(true);
  }

  private clearPending() {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private sendPending(keepalive: boolean) {
    const payload = this.pendingPayload;
    this.pendingPayload = null;

    if (payload === null || payload === this.lastSentPayload) {
      return;
    }

    this.lastSentPayload = payload;
    this.inFlightPayloads.add(payload);
    let savePromise: Promise<void>;
    try {
      savePromise = this.save(payload, keepalive);
    } catch (error) {
      this.handleSaveFailure(payload, error);
      return;
    }
    void savePromise.then(
      () => {
        this.inFlightPayloads.delete(payload);
        if (this.lastSentPayload === payload) {
          this.lastSuccessfullySavedPayload = payload;
        }
      },
      (error: unknown) => this.handleSaveFailure(payload, error),
    );
  }

  private handleSaveFailure(payload: string, error: unknown) {
    this.inFlightPayloads.delete(payload);
    if (this.lastSentPayload === payload) {
      this.lastSentPayload = null;
    }
    this.onError(error);
  }
}

export const canApplyServerProgress = (
  revisionAtRequestStart: number,
  currentLocalRevision: number,
  hadPendingLocalProgress: boolean,
  hasPendingLocalProgress: boolean,
) =>
  !hadPendingLocalProgress &&
  !hasPendingLocalProgress &&
  revisionAtRequestStart === currentLocalRevision;

export const getReaderRuntimeState = <
  TError extends { context?: string | null; errorName?: string | null },
  TPublication,
  TProfile,
  TLocalDataKey,
>({
  error,
  isLoading,
  publication,
  profile,
  localDataKey,
  isPositionReady,
}: {
  error: TError | null;
  isLoading: boolean;
  publication: TPublication | null;
  profile: TProfile | null;
  localDataKey: TLocalDataKey | null;
  isPositionReady: boolean;
}) => {
  if (error) {
    return { status: "error" as const, error };
  }
  if (isLoading || !publication || !profile || !localDataKey || !isPositionReady) {
    return { status: "loading" as const };
  }
  return {
    status: "ready" as const,
    publication,
    profile,
    localDataKey,
  };
};
