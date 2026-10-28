# STORY-7.6 QA Review

**Verdict:** APPROVE
**Reviewer:** qa-reviewer
**Date:** 2026-04-25
**Branch:** `sprint-6/STORY-7.6-logout-user-menu`
**Head commit:** `a5f3775095bfbd783f6b6003b0f8e1252f9d8b4d`
**Worktree reviewed:** `<repo>/.claude/worktrees/story-7.6`

> Pre-merge note (orchestrator): JSDOM cannot exercise focus, click-outside, or
> the actual `localStorage` round-trip end-to-end. Before declaring Done, please
> run a manual browser click-through: log in, open the dropdown on Home / Brief
> / Editor, click Log out, confirm landing on `/login` and that
> `localStorage.access_token` is gone. The unit tests cover the wiring; the
> click-through is the sanity check for the wiring being installed correctly.

## Acceptance criteria mapping

| PRD AC | Evidence |
| --- | --- |
| User menu visible on Home / Brief / Editor | `<UserMenu />` rendered in `HomePage.tsx:190`, `BriefPage.tsx:271`, `EmailerPage.tsx:563`. Component returns `null` when `user` is falsy (`UserMenu.tsx:85`), so unauthenticated edge cases are inert. |
| Shows logged-in user's name | `UserMenu.tsx:31-32` renders `email.split("@")[0]` as the display name and the full email in the dropdown header at `UserMenu.tsx:138`. AuthContext only exposes `{ email }` decoded from the JWT `sub` (`AuthContext.tsx:14, 47-51`). See "Deviation from PRD" below — the spec said "from `/api/v1/auth/me`"; the specialist intentionally did not add that call to avoid changing the auth context API. Acceptable for POC. |
| "Log out" clears token + resets auth state + redirects to /login | `handleLogout` (`UserMenu.tsx:40-44`) calls `logout()` then `navigate("/login")`. `AuthContext.logout` (`AuthContext.tsx:61-64`) does `localStorage.removeItem("access_token")` and `setToken(null)`. Test `calls logout and navigates to /login when Log out is clicked` (`UserMenu.test.tsx:96-110`) asserts both the spy was called once and that the test renderer landed on the `/login` route. |
| Post-login redirect /login → / | `LoginPage.tsx:12-14` still has `<Navigate to="/" replace />` (UAT hotfix preserved — file untouched in this PR per scope discipline). New regression test `redirects authenticated users from /login to / (home)` at `LoginPage.test.tsx:138-145` seeds `localStorage.access_token` and asserts the `home-page` testid renders. The earlier `redirects to / (home) on successful login` test (`:120-136`) re-asserts the post-submit redirect. |
| Brief / Editor "Back to emailers" link | `BriefPage.test.tsx:77-87` and `EmailerPage.test.tsx:138-151` both `getByRole("link", { name: /back to emailers/i })` and assert `href="/"`. Underlying links exist at `BriefPage.tsx:279-287` (visible "← Back to emailers" text-link) and `EmailerPage.tsx:292-301` (icon-link with `aria-label="Back to emailers"`). Both resolve to "/" via React Router. |
| Tests for all of the above | 5 new UserMenu tests + 3 regression assertions (1 in LoginPage.test, 1 in BriefPage.test, 1 in EmailerPage.test). |

## Quality gates

- [x] `pnpm run lint` — PASS (zero warnings; `--max-warnings 0`)
- [x] `pnpm run build` — PASS (`tsc --noEmit && vite build` green; the only output is the pre-existing chunk-size warning, unrelated)
- [x] `pnpm test -- --run` — **149/149 tests pass across 16 files** (5 new UserMenu tests included). Some `act(...)` warnings appear from `EmailerPage.test.tsx`'s `capturedEditorInit` callback path — these are pre-existing on master, predate this PR, and don't fail tests; out of scope for 7.6.
- [x] No new TODOs / FIXMEs introduced
- [x] No new test skips
- [x] No integration tests added to default run
- [x] Backend untouched — no migrations, no `pytest`, no `mypy` impact
- [x] Coverage on new code — informally, all 6 logical branches of `UserMenu` are touched by the 5 tests: name render, open, logout invocation + navigation, Escape close, unauthenticated null. The `aria-expanded="false"` initial state, the `aria-expanded="true"` after-open state, and the focus-return on Escape are all asserted. The pointerdown/outside-click handler is the only path NOT directly exercised in JSDOM (see "Notes" below).

## Deep verification

### Accessibility wiring (AC-1 quality)

Read `UserMenu.tsx` end-to-end:

- Trigger button has `type="button"`, `aria-haspopup="menu"`, `aria-expanded={open}` (boolean, dynamic), `aria-controls={menuId}` referencing the dropdown's `id`, and `aria-label` containing the full email — so screen readers disambiguate even though the visible text shows only the local-part. (`UserMenu.tsx:93-101`)
- Dropdown has `role="menu"` and `aria-label="Account menu"` (`:131-132`).
- "Log out" item has `role="menuitem"` (`:143`).
- Escape close: stops propagation and calls `close()`, which both clears state and refocuses the trigger (`:50-55, 34-38`). Verified by `closes the menu when Escape is pressed`.
- Click-outside close: pointerdown listener checks the event target against both `menuRef` and `buttonRef` (`:57-66`); will not close when clicking inside the menu, which is correct.
- First menuitem auto-focuses on open (`:77-83`). This is good keyboard UX. Note: the implementation does **not** trap arrow-key navigation between menu items — but there's only one menu item ("Log out"), so this is moot today. If a "Profile" or "Settings" item gets added later, arrow-key handling will need to be added.

### LoginPage scope discipline

Confirmed `git diff master...HEAD -- frontend/src/pages/LoginPage.tsx` is empty. The UAT hotfix `<Navigate to="/" replace />` from commit `e1a5d4b` is preserved. Specialist correctly avoided touching the file given Ishaan's WIP there.

### AuthContext scope discipline

Confirmed `git diff master...HEAD -- frontend/src/contexts/AuthContext.tsx` is empty. No new fields, no `/auth/me` plumbing, no breaking changes to the context shape. UserMenu consumes `user` and `logout` only.

### Test isolation in the new tests

`UserMenu.test.tsx` mounts the component inside `<AuthContext.Provider value={...}>` directly rather than `<AuthProvider>`. This is the correct pattern for testing the consumer in isolation — it avoids touching `localStorage` and lets the test verify that `logout` is called by mocking it. The passing tests prove the wiring without leaking real auth state across tests.

`BriefPage.test.tsx` and `HomePage.test.tsx` switch from no-provider to `<AuthProvider>` wrapping. This now means they read real `localStorage` for token init. With the JSDOM default of empty `localStorage`, `useAuth()` returns `{ user: null, isAuthenticated: false }`, and `UserMenu` renders `null`. The page-level tests therefore are not testing the UserMenu — only that pages don't crash with the provider in place. That's intentional and adequate; UserMenu has its own dedicated suite.

`EmailerPage.test.tsx` injects an authenticated `AuthContext.Provider` with `user: { email: "priya@acmebank.example" }`. This means the UserMenu trigger is actually rendered in those tests. Combined with the new mocks for `ChatPanel` and `ShareLinkDialog`, the existing test cases still pass without role/name collisions (the only `getByRole("button", { name: /history/i })` etc. queries continue to find the right buttons).

### Conflict risk vs the parallel STORY-2.6 worktree

`<repo>/.claude/worktrees/story-2.6` is also live and (per docs/SPRINT_BOARD.md) targets the asset-upload UI in `BriefPage.tsx`. Both stories edit `BriefPage.tsx`. STORY-7.6's edits are confined to:
- One new import (`UserMenu`)
- New top-bar `<header>` block prepended to the JSX (lines 264-273)

Whichever story merges second will need a small rebase but no logical merge conflict. Not a blocker for 7.6.

## Deviations from PRD

1. **User name source.** PRD AC (line 544) reads "Shows logged-in user's name (from `/api/v1/auth/me`)." The implementation reads from the AuthContext, which only carries the email decoded from the JWT `sub`, and synthesizes a display name as `email.split("@")[0]`. **Flagged but not blocking.** Rationale: (a) the auth context shape was deliberately frozen for this story; (b) `/api/v1/auth/me` would require backend work outside the S-sized scope; (c) for a POC with bank-domain emails (e.g. `priya@acmebank.example`), the local-part is a usable first-name approximation; (d) the full email is shown in the dropdown header for disambiguation. Recommend filing a follow-up to surface the real display name once `/auth/me` exists or once the JWT carries `name` in claims.

2. **No shared `AppHeader` extraction.** Each page keeps its bespoke top bar; UserMenu is dropped in three places. **Acceptable** — extracting AppHeader is a larger refactor and was explicitly out of scope per the story prompt.

## Notes for orchestrator

- Manual click-through is required before marking Done (see top banner). JSDOM cannot validate the actual `localStorage` clear or the post-navigate URL bar.
- 2.6 is on a parallel worktree that also edits `BriefPage.tsx`. Whichever lands second gets a trivial rebase; flag it then, not now.
- The Editor top bar is now packed: Undo, Redo, Save, Export, Share preview, Chat, History, Generate, separator, UserMenu. On narrower viewports this will overflow. Out of scope for 7.6 but worth noting for a future polish story.
- `act(...)` warnings in `EmailerPage.test.tsx` predate this PR (the `capturedEditorInit` synchronous callback path); not introduced by 7.6.

## Verdict

**APPROVE.** All four ACs are met. Tests are real assertions against real wiring (`logout` spy is called; navigation lands on `/login`-routed component; both back-links resolve to `/`). Lint, build, and full test suite are clean. Scope is honored. The `/auth/me` deviation is documented and justified for POC.

Orchestrator should still run a manual browser click-through (open dropdown, log out, confirm landing on /login + localStorage cleared) before declaring Done.
