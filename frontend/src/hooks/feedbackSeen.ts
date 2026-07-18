/**
 * Per-user "last time I opened the Feedback tab" timestamp, stored in
 * localStorage (per browser). Drives the "new since your last visit" highlight
 * and the nav unread dot.
 */

function keyFor(user: string | null): string {
  return `feedback-seen:${user ?? "anon"}`;
}

export function getFeedbackLastSeen(user: string | null): string | null {
  try {
    return localStorage.getItem(keyFor(user));
  } catch {
    return null;
  }
}

export function setFeedbackLastSeen(user: string | null, iso: string): void {
  try {
    localStorage.setItem(keyFor(user), iso);
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
}
