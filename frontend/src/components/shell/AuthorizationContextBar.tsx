/**
 * AuthorizationContextBar — PhishForge's signature component and the visible
 * form of the "authorization boundary is visible by design" principle
 * (DESIGN.md §5, PRODUCT.md principle 3).
 *
 * A slim, persistent, low-emphasis strip stating the current work is an
 * authorized, consented simulation. Visual: info-subtle background, info text,
 * a single functional shield-check line icon (not decorative shield-and-lock
 * imagery), Caption type. It is always present on authenticated screens, never
 * dismissible to the point of disappearing, and MUST NOT borrow danger or
 * warning color: this is context, not an alarm.
 *
 * There is no engagement/client scope data model in this POC, so the label is
 * a static, honest statement rather than fabricated scope detail.
 */
export default function AuthorizationContextBar() {
  return (
    <div
      role="note"
      aria-label="Authorization context"
      data-testid="authorization-context-bar"
      className="flex items-center gap-2 border-b border-border-subtle bg-info-subtle px-md py-1.5 text-info"
    >
      <ShieldCheckIcon />
      <span className="text-caption">Authorized simulation</span>
      <span
        className="text-caption font-normal normal-case tracking-normal text-info/80"
        // Honest, non-fabricated context: no client/engagement scope exists in
        // this POC, so we state the standing boundary without inventing data.
      >
        consented security-awareness testing only
      </span>
    </div>
  );
}

function ShieldCheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M8 1.75 13 3.5v3.75c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5V3.5L8 1.75Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M5.75 8 7.25 9.5 10.25 6.25"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
