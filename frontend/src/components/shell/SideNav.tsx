import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../../hooks/useAuth";

/**
 * SideNav — the app's primary navigation (DESIGN.md §5 Navigation).
 * surface-chrome plane, 240px wide, Label-type items, ink-muted at rest. The
 * active item is conveyed by an accent-subtle fill, ink-strong weight, and a
 * 6px accent status dot, NEVER by a left side stripe (DESIGN.md §6 Don'ts).
 */
interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Match only on exact path (e.g. home "/"). */
  end?: boolean;
  adminOnly?: boolean;
}

const items: NavItem[] = [
  {
    to: "/",
    label: "Simulations",
    end: true,
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2 6h12" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    to: "/assets",
    label: "Asset Library",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="6" cy="6" r="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3 12l3-3 2.5 2.5L11 8l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: "/admin/impersonation-presets",
    label: "Impersonation presets",
    adminOnly: true,
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="2" width="10" height="12" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/admin/observability",
    label: "Observability",
    adminOnly: true,
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const itemBase =
  "group flex items-center gap-2 rounded-ds-sm px-3 py-2 text-label transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-chrome";

export default function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin } = useAuth();
  const visible = items.filter((item) => !item.adminOnly || isAdmin);

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 p-3">
      {visible.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `${itemBase} ${
              isActive
                ? "bg-accent-subtle text-ink-strong"
                : "text-ink-muted hover:bg-surface-sunken hover:text-ink-body"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span aria-hidden="true" className="shrink-0">
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
              {/* Accent status dot marks the active item (with fill + weight),
                  never a left stripe. */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-ds-full bg-accent"
                />
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
