# QA Review — UAT Bug-Fix Batch

- **Branch:** `sprint-AP2/UAT-bugfixes`
- **Commit reviewed:** `c38d016`
- **Scope:** Frontend-only fixes for 3 UAT bugs (BUG-1, BUG-2, BUG-3)
- **Reviewer:** qa-reviewer
- **Date:** 2026-06-13

## Verdict: APPROVE

All three bug fixes are correct, complete, and consistent end-to-end. Build, lint,
and the full test suite (506 tests) pass. Diff is frontend-only plus the scoped
SPRINT_BOARD UAT-bugs section. No backend changes; no new TODO/FIXME; no test
weakening; the single `any` is `// justified:`.

---

## BUG-3 (HIGH) — preset slug-id typing — PASS

Root cause (frontend treated string-slug preset PKs as numbers → `/NaN → 404`) is
fully resolved and the slug typing is consistent end-to-end:

- `src/api/impersonationPresets.ts`: `ImpersonationPresetSummary.id` and
  `ImpersonationPresetDetail.id` are now `string`. `getPresetDetail`, `updatePreset`,
  `removePreset`, `uploadPresetLogo` take `id: string`;
  `copyLogoToEmailer(emailerId: number, presetId: string)` and the POST body sends
  `{ preset_id: presetId }` as the slug.
- `src/pages/BriefPage.tsx`: `<Select>` onChange passes the raw slug
  (`e.target.value === "" ? null : e.target.value`) — no `Number(...)`.
  `selectedPresetId`, `onLoadPreset`, and `handleLoadPreset` are `string | null`.
  `value={... String(selectedPresetId)}` is harmless string coercion of a string.
- `src/pages/ImpersonationPresetFormPage.tsx`: `editId = isEdit ? params.id ?? null : null`
  (raw param string), not `Number(params.id)`. `updatePreset`/`removePreset` mutation
  fns are typed `id: string`. `getPresetDetail(editId!)` is guarded by
  `enabled: isEdit && editId !== null`.

**End-to-end confirmation:** a real load of "Microsoft 365" now hits
`/impersonation-presets/microsoft-365` (verified by the updated unit assertions),
not `/NaN`.

**Grep sweep:** the only remaining `Number(...)` calls in `frontend/src` are on
emailer id (`EmailerPage.tsx`) and unrelated numeric form inputs (brush size,
dimension index, expiry days). None apply to a preset id. No `parseInt` on preset ids.

Tests updated with slug-id assertions across `impersonationPresets.test.ts`,
`BriefPage.test.tsx`, `ImpersonationPresetFormPage.test.tsx`,
`AdminImpersonationPresetsPage.test.tsx` (e.g. `getPresetDetail("microsoft-365")`,
`copyLogoToEmailer(55, "microsoft-365")`, `updateSpy ... "microsoft-365"`,
`preset-row-microsoft-365`). Assertions strengthened, not weakened.

## BUG-1 (Medium) — login error parsing — PASS

`src/api/auth.ts` adds `readErrorMessage()` which reads the body, JSON-parses it,
and returns the `detail` string, falling back to a generic
`Login failed: <status> <statusText>` message on empty/non-JSON/parse-error bodies.
`login` now throws `Error(message)` instead of the raw body text.

The `as any` used to walk the unknown FastAPI envelope before narrowing is annotated
`// justified:` with an `eslint-disable-next-line` and a `typeof detail === "string"`
narrow — acceptable.

Tests cover the three paths: JSON `detail` surfaced cleanly, non-JSON body falls back
to the generic message, empty body falls back to status text.

## BUG-2 (Low) — "emailer" → "simulation" copy — PASS

User-facing strings updated in `HomePage.tsx` (empty state, "Create new simulation",
"Loading simulations...", "Failed to load simulations", "No simulations match...",
count label singular/plural, `aria-label="Filter simulations"`) and `BriefPage.tsx`
("Back to simulations", "Create new simulation").

Scope correctly preserved: `Emailer*` types, `/emailers` routes, the `/emailers/{id}`
link, `["emailers"]`/`["emailerCost"]` query keys, `emailerId`, and API function names
(`listEmailers`, `getEmailerCost`) are unchanged. Remaining "Emailer" occurrences are
code identifiers/comments only. Pinned-copy tests updated to match.

---

## Definition of Done

| Check | Result |
|---|---|
| `pnpm build` (incl. tsc, TS strict) | PASS — built in ~13s; only pre-existing chunk-size advisory |
| `pnpm lint` (eslint, --max-warnings 0) | PASS — clean |
| `pnpm test` | PASS — 41 files, 506 passed, 0 failed, 0 skipped |
| No `any` without `// justified:` | PASS — single `any` in auth.ts is justified |
| Tests updated, not weakened | PASS — slug-id, `.detail`, simulation-copy matchers added/strengthened |
| No new TODO/FIXME | PASS |
| `git diff master --stat` frontend-only + SPRINT_BOARD | PASS — 11 frontend files + docs/SPRINT_BOARD.md |
| Backend untouched | PASS — no backend files in diff (pytest not run, per instructions) |

## Notes / non-blocking observations

- `auth.test.ts`'s local `mockFetchError` hardcodes `statusText: "Unauthorized"` for
  all statuses, so the BUG-1 fallback test asserts `"Login failed: 500 Unauthorized"`
  (status 500 with statusText "Unauthorized"). This is a pre-existing test-helper
  quirk; the assertion still correctly verifies the non-JSON fallback path. Not a blocker.
- SPRINT_BOARD entries show the three bugs as 🟡 In Progress — correct for a
  pre-merge state; orchestrator flips to ✅ Done on merge.
- The known parallel-load flakiness was not observed: this run was fully green on the
  first pass.
