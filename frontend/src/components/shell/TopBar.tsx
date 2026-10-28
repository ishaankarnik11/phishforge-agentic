import UserMenu from "../UserMenu";
import Wordmark from "./Wordmark";

/**
 * TopBar — the app header (DESIGN.md §5 Navigation). surface-chrome, 56px tall,
 * 1px border-subtle bottom. Holds the PhishForge wordmark, a mobile menu
 * toggle, and the user menu. The Authorization Context Bar sits directly below
 * it (rendered by AppShell).
 */
export default function TopBar({
  onToggleNav,
  navOpen,
}: {
  onToggleNav: () => void;
  navOpen: boolean;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-chrome px-md">
      {/* Mobile nav toggle: hidden on md+, where the side nav is persistent. */}
      <button
        type="button"
        onClick={onToggleNav}
        aria-label={navOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={navOpen}
        className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-ds-sm text-ink-body transition-colors duration-fast hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 md:hidden"
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
          <path d="M3.5 6h13M3.5 10h13M3.5 14h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <Wordmark />

      <div className="ml-auto flex items-center gap-2">
        <UserMenu />
      </div>
    </header>
  );
}
