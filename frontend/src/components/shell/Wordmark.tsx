import { Link } from "react-router-dom";

/**
 * Wordmark — the PhishForge app identity (STORY-AP1.1 rebrand). A restrained
 * lockup: a single functional mark plus the wordmark in Title type. No
 * shield-and-lock decoration, no gradient text, no "hacker" iconography
 * (DESIGN.md §6 Don'ts). The mark is a simple anvil-spark glyph nodding to
 * "forge" without romanticizing attack.
 */
export default function Wordmark({ to = "/" }: { to?: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-ds-sm text-ink-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-chrome"
      aria-label="PhishForge home"
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-ds-sm bg-accent text-on-accent"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
          <path
            d="M2.5 10.5 9 4l3 3-6.5 6.5H2.5v-3Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M9 4l1.75-1.75a1.2 1.2 0 0 1 1.7 0l.8.8a1.2 1.2 0 0 1 0 1.7L12 6"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="text-title">PhishForge</span>
    </Link>
  );
}
