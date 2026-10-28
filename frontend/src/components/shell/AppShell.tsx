import { useState } from "react";
import { Outlet } from "react-router-dom";
import TopBar from "./TopBar";
import SideNav from "./SideNav";
import AuthorizationContextBar from "./AuthorizationContextBar";

/**
 * AppShell — the shared application frame for authenticated, standard-content
 * screens (STORY-AP7.1). Composes the TopBar, the persistent Authorization
 * Context Bar, and the SideNav, then renders the active route via <Outlet />.
 *
 * Every screen wrapped in this shell inherits one header, one nav, and the
 * standing authorization signal ("Consistency is an affordance"; "the
 * authorization boundary is visible by design").
 *
 * Full-screen editor workspaces (EmailerPage, MaskEditorPage) intentionally
 * keep their own dedicated chrome and are NOT wrapped here; they use the
 * Two-Pane Editor Shell signature component (later chunk).
 */
export default function AppShell() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col bg-surface-base text-ink-body">
      <TopBar onToggleNav={() => setNavOpen((v) => !v)} navOpen={navOpen} />
      <AuthorizationContextBar />

      <div className="flex min-h-0 flex-1">
        {/* Persistent side nav on md+; an off-canvas sheet on small screens. */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface-chrome md:block">
          <SideNav />
        </aside>

        {navOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
              className="absolute inset-0 bg-ink-strong/30"
            />
            <aside className="absolute inset-y-0 left-0 w-60 overflow-y-auto border-r border-border-subtle bg-surface-chrome shadow-overlay">
              <SideNav onNavigate={() => setNavOpen(false)} />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
