import type { Config } from "tailwindcss";

/**
 * PhishForge design-system wiring (STORY-AP0.2).
 *
 * Utilities reference CSS custom properties via the var(--token) indirection
 * rather than hard-coded values. That indirection is what lets dark mode swap
 * automatically: the vars are redefined under [data-theme="dark"] /
 * prefers-color-scheme in src/index.css, so e.g. `bg-surface-base` resolves to
 * the dark value with no class changes.
 *
 * darkMode uses the attribute strategy so `dark:` variants key off
 * [data-theme="dark"] and an in-app toggle can drive them.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          active: "var(--color-accent-active)",
          subtle: "var(--color-accent-subtle)",
          border: "var(--color-accent-border)",
        },
        "on-accent": "var(--color-on-accent)",
        surface: {
          base: "var(--color-surface-base)",
          raised: "var(--color-surface-raised)",
          sunken: "var(--color-surface-sunken)",
          chrome: "var(--color-surface-chrome)",
        },
        border: {
          subtle: "var(--color-border-subtle)",
          default: "var(--color-border-default)",
          strong: "var(--color-border-strong)",
        },
        ink: {
          strong: "var(--color-ink-strong)",
          body: "var(--color-ink-body)",
          muted: "var(--color-ink-muted)",
          faint: "var(--color-ink-faint)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          subtle: "var(--color-success-subtle)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          subtle: "var(--color-warning-subtle)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          subtle: "var(--color-danger-subtle)",
        },
        info: {
          DEFAULT: "var(--color-info)",
          subtle: "var(--color-info-subtle)",
        },
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
      // Type scale per DESIGN.md §3, as [size, { lineHeight, fontWeight,
      // letterSpacing }] tuples. The `mono` size pairs with font-mono.
      fontSize: {
        display: [
          "1.75rem",
          { lineHeight: "1.2", fontWeight: "600", letterSpacing: "-0.01em" },
        ],
        headline: [
          "1.375rem",
          { lineHeight: "1.25", fontWeight: "600", letterSpacing: "-0.01em" },
        ],
        title: [
          "1.0625rem",
          { lineHeight: "1.3", fontWeight: "600", letterSpacing: "normal" },
        ],
        body: [
          "0.9375rem",
          { lineHeight: "1.5", fontWeight: "400", letterSpacing: "normal" },
        ],
        label: [
          "0.8125rem",
          { lineHeight: "1.2", fontWeight: "500", letterSpacing: "0.01em" },
        ],
        caption: [
          "0.6875rem",
          { lineHeight: "1.2", fontWeight: "600", letterSpacing: "0.06em" },
        ],
        mono: [
          "0.875rem",
          { lineHeight: "1.5", fontWeight: "400", letterSpacing: "normal" },
        ],
      },
      // Namespaced under `ds-*` (rounded-ds-sm, rounded-ds-md, ...) on purpose:
      // Tailwind's default rounded-sm/md/lg differ in value from these tokens,
      // and existing screens use the defaults. Namespacing exposes the design
      // radii without restyling inherited components. The full pill is also
      // exposed as `ds-full` for consistency (it matches the default anyway).
      borderRadius: {
        "ds-xs": "var(--radius-xs)",
        "ds-sm": "var(--radius-sm)",
        "ds-md": "var(--radius-md)",
        "ds-lg": "var(--radius-lg)",
        "ds-full": "var(--radius-full)",
      },
      spacing: {
        "2xs": "var(--space-2xs)",
        xs: "var(--space-xs)",
        sm: "var(--space-sm)",
        md: "var(--space-md)",
        lg: "var(--space-lg)",
        xl: "var(--space-xl)",
        "2xl": "var(--space-2xl)",
        "3xl": "var(--space-3xl)",
      },
      boxShadow: {
        raise: "var(--shadow-raise)",
        overlay: "var(--shadow-overlay)",
        dialog: "var(--shadow-dialog)",
      },
      transitionTimingFunction: {
        "ease-out": "var(--ease-out)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
    },
  },
  plugins: [],
};

export default config;
