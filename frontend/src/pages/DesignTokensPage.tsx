import { useState } from "react";

/**
 * Dev-only design-token preview (STORY-AP0.2).
 *
 * Renders swatches, the type scale, the button vocabulary, and the signature
 * Authorization Context Bar so qa can eyeball the token layer. Everything here
 * is built only from the design tokens wired in tailwind.config.ts, so it
 * doubles as a smoke test that the var(--token) indirection resolves and that
 * dark mode swaps. It is mounted only when import.meta.env.DEV is true (see
 * App.tsx) and touches no existing screen.
 */

type ThemeChoice = "system" | "light" | "dark";

const SURFACES = [
  ["surface-base", "bg-surface-base"],
  ["surface-raised", "bg-surface-raised"],
  ["surface-sunken", "bg-surface-sunken"],
  ["surface-chrome", "bg-surface-chrome"],
] as const;

const INKS = [
  ["ink-strong", "text-ink-strong"],
  ["ink-body", "text-ink-body"],
  ["ink-muted", "text-ink-muted"],
  ["ink-faint", "text-ink-faint"],
] as const;

const ACCENTS = [
  ["accent", "bg-accent"],
  ["accent-hover", "bg-accent-hover"],
  ["accent-active", "bg-accent-active"],
  ["accent-subtle", "bg-accent-subtle"],
  ["accent-border", "bg-accent-border"],
] as const;

const SEMANTICS = [
  ["success", "bg-success", "text-success", "bg-success-subtle"],
  ["warning", "bg-warning", "text-warning", "bg-warning-subtle"],
  ["danger", "bg-danger", "text-danger", "bg-danger-subtle"],
  ["info", "bg-info", "text-info", "bg-info-subtle"],
] as const;

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export default function DesignTokensPage() {
  const [theme, setTheme] = useState<ThemeChoice>("system");

  function applyTheme(next: ThemeChoice) {
    setTheme(next);
    const root = document.documentElement;
    if (next === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", next);
    }
  }

  return (
    <div className="min-h-screen bg-surface-base p-2xl font-sans text-ink-body">
      <div className="mx-auto max-w-5xl space-y-2xl">
        <header className="space-y-md">
          <div className="flex items-center justify-between gap-md">
            <h1 className="text-display text-ink-strong">
              PhishForge design tokens
            </h1>
            <div
              className="flex gap-2xs rounded-ds-md bg-surface-sunken p-2xs"
              role="group"
              aria-label="Theme"
            >
              {(["system", "light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => applyTheme(t)}
                  className={
                    "rounded-ds-sm px-sm py-2xs text-label capitalize transition-colors duration-fast ease-out " +
                    (theme === t
                      ? "bg-surface-raised text-ink-strong shadow-raise"
                      : "text-ink-muted")
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Authorization Context Bar (signature component) */}
          <div className="inline-flex items-center gap-xs rounded-ds-sm bg-info-subtle px-sm py-2xs text-info">
            <ShieldCheckIcon />
            <span className="text-caption uppercase">
              Authorized simulation
            </span>
            <span className="text-label normal-case text-info">
              ClientCo / M365 engagement
            </span>
          </div>
        </header>

        {/* Accent ramp */}
        <Section title="Accent (Signal Indigo)">
          <div className="flex flex-wrap gap-md">
            {ACCENTS.map(([name, bg]) => (
              <Swatch key={name} name={name} className={bg} />
            ))}
          </div>
        </Section>

        {/* Surfaces */}
        <Section title="Surfaces">
          <div className="flex flex-wrap gap-md">
            {SURFACES.map(([name, bg]) => (
              <Swatch key={name} name={name} className={`${bg} border border-border-default`} />
            ))}
          </div>
        </Section>

        {/* Ink */}
        <Section title="Ink">
          <div className="space-y-xs">
            {INKS.map(([name, text]) => (
              <p key={name} className={`text-body ${text}`}>
                {name}. The steady instrument. no-reply@example.com
              </p>
            ))}
          </div>
        </Section>

        {/* Semantic */}
        <Section title="Semantic (state only)">
          <div className="flex flex-wrap gap-md">
            {SEMANTICS.map(([name, solid, , subtle]) => (
              <div
                key={name}
                className={`flex items-center gap-xs rounded-ds-full ${subtle} px-sm py-2xs`}
              >
                <span className={`h-2xs w-2xs rounded-ds-full ${solid}`} />
                <span className="text-caption uppercase text-ink-strong">
                  {name}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* Type scale */}
        <Section title="Type scale">
          <div className="space-y-sm">
            <p className="text-display text-ink-strong">Display 28</p>
            <p className="text-headline text-ink-strong">Headline 22</p>
            <p className="text-title text-ink-strong">Title 17</p>
            <p className="text-body text-ink-body">Body 15: default UI text.</p>
            <p className="text-label text-ink-muted">Label 13</p>
            <p className="text-caption uppercase text-ink-muted">Caption 11</p>
            <p className="font-mono text-mono text-ink-body">
              Mono 14: spoof@microsoftsupport.example
            </p>
          </div>
        </Section>

        {/* Buttons */}
        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-md">
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-ds-sm bg-accent px-[14px] text-label text-on-accent transition-colors duration-base ease-out hover:bg-accent-hover active:bg-accent-active"
            >
              Generate template
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-ds-sm border border-border-default bg-surface-raised px-[14px] text-label text-ink-body transition-colors duration-base ease-out hover:border-border-strong hover:bg-surface-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-ds-sm px-sm text-label text-ink-body transition-colors duration-base ease-out hover:bg-accent-subtle"
            >
              Ghost
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-ds-sm bg-danger px-[14px] text-label text-on-accent transition-colors duration-base ease-out"
            >
              Delete
            </button>
          </div>
        </Section>

        {/* Elevation */}
        <Section title="Elevation">
          <div className="flex flex-wrap gap-lg">
            {(
              [
                ["raise", "shadow-raise"],
                ["overlay", "shadow-overlay"],
                ["dialog", "shadow-dialog"],
              ] as const
            ).map(([name, shadow]) => (
              <div
                key={name}
                className={`rounded-ds-md border border-border-subtle bg-surface-raised px-lg py-md text-label text-ink-muted ${shadow}`}
              >
                shadow-{name}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-md">
      <h2 className="text-headline text-ink-strong">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="space-y-2xs">
      <div className={`h-16 w-28 rounded-ds-md ${className}`} />
      <span className="block text-label text-ink-muted">{name}</span>
    </div>
  );
}
