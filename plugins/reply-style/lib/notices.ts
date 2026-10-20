// Notices the mod prints through $.ui.log (the host prefixes the mod name), and the session guard behind the inactive notice.

export const VERSION_STORE_KEY = "lastSeenVersion";

export function versionNoticeText(running: string, tested: string): string {
  return `tested on Claude Code ${tested}, running ${running}. Replies may show as plain text.`;
}

/** A notice when the running version is neither the tested one nor the one last seen. */
export function decideVersionNotice(running: string, tested: string, lastSeen: string | null): { notice: string | null; lastSeen: string } {
  const notice = running !== tested && running !== lastSeen ? versionNoticeText(running, tested) : null;
  return { notice, lastSeen: running };
}

export const INACTIVE_NOTICE = "inactive in this session; replies show as plain markdown.";

export type SessionGuard = {
  start(e: { isInteractive: boolean; surface: string | null }): void;
  renderRan(): void;
  renderFailed(): void;
  /** INACTIVE_NOTICE at most once per session, else null. */
  turnEnded(answer: string): string | null;
};

/**
 * The inactive check. A render hook that threw is known at once, so the first turn end after
 * it prints the notice. A render hook that never ran is an absence, and the host may raise
 * `turn.complete` before the final reply's `ui.render` (4 of 39 captured replies), so the answer
 * is only recorded and checked at the next turn end: a one-turn delay (plan I-7 fallback).
 */
export function createSessionGuard(): SessionGuard {
  let armed = false;
  let notified = false;
  let ran = false;
  let failed = false;
  let pendingAnswer = "";
  return {
    start(e) {
      armed = e.isInteractive && e.surface === "terminal";
      notified = false;
      ran = false;
      failed = false;
      pendingAnswer = "";
    },
    renderRan() {
      ran = true;
    },
    renderFailed() {
      failed = true;
    },
    turnEnded(answer) {
      if (!armed || notified) return null;
      const missing = pendingAnswer !== "" && !ran;
      pendingAnswer = answer;
      if (failed || missing) {
        notified = true;
        return INACTIVE_NOTICE;
      }
      return null;
    },
  };
}

/** The work's result, or undefined when it has not settled within `ms` (or it threw). */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  const timers = globalThis as unknown as { setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (id: unknown) => void };
  const quiet = work.catch(() => undefined);
  if (typeof timers.setTimeout !== "function") return quiet;
  return new Promise<T | undefined>((resolve) => {
    const id = timers.setTimeout!(() => resolve(undefined), ms);
    void quiet.then((value) => {
      timers.clearTimeout?.(id);
      resolve(value);
    });
  });
}
