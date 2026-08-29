# Ollama Cloud Usage Status -- Implementation Plan

Source spec: `.specs/ollama-usage-status/spec.md` (Draft). The spec is the
source of truth for requirements; this plan maps it to slices and tasks without
changing it.

## Research

- **Endpoint contract** (from `fgrehm/pi-ollama-cloud` `usage.ts`, an
  undocumented endpoint the extension already probes in production):
  `GET https://ollama.com/api/usage`, `Authorization: Bearer <key>`. Response
  is accepted iff `limits.session.usage` and `limits.weekly.usage` are finite
  0-1 cap fractions; `models[]`/`activity` are ignored. No reset timestamps
  exist, so windows render without countdowns. **Verified live 2026-08-29**
  (probe returned `usage: 0.313 / 0.445` fractions; no reset fields anywhere
  incl. `/v1` headers and sibling endpoints).
- **pi's key resolution**: `modelRegistry.getApiKeyForProvider("ollama-cloud")`
  covers auth.json credentials and `$OLLAMA_API_KEY` apiKey expansion;
  pi-ollama-cloud's own resolution adds `?? process.env.OLLAMA_API_KEY`,
  which spec REQ-003 adopts.
- **Host architecture** (`extensions/status-line/`): provider support = union
  member + alias + TTL + fetcher entry in `usage/fetch.ts` (`normalizeProvider`
  -> `PROVIDER_FETCHERS`, cached by `fetchProviderQuotas` with fibonacci
  backoff) -> windows formatted by `usage/format.ts` (preferred labels already
  `["5h","7d"]`; `limitValue === 100` renders remaining-percent only). Zero
  changes to `index.ts` are needed: `"ollama-cloud"` flows through the same
  `refreshForContext` path as the four existing providers. Small `index.ts`
  revisions were later accepted in Slice 4: the eligibility call passes
  `ctx.model?.id` (the `:cloud` gate) - see Slice 4.
- **Test conventions**: `node --test "extensions/**/*.test.mjs"` (Node >= 23.6,
  native TS import), `globalThis.fetch` swapped inside try/finally,
  `makeAuth`/`makeCache` helpers already exist in `fetch.test.mjs`, and
  `index.test.mjs` has a `makeContext`/`makeExtensionApi` harness that drives
  the installed extension through events.
- **Load-bearing existing tests** (must keep passing, untouched):
  `isSupportedProvider("ollama") === false` and the index-level
  unsupported-provider test that switches to provider `"ollama"`. The exact-key
  alias table (applied after `toLowerCase`) cannot collide with
  `"ollama-cloud"`.

## Reuse

- `usage/helpers.ts`: `fetchJson` (15s timeout, error-kind classification),
  `failure`/`success` result constructors, `QuotaAuth`.
- `usage/fetch.ts`: normalizer table, `PROVIDER_TTLS_MS`,
  `PROVIDER_FETCHERS`, `fetchProviderQuotas` (TTL cache + pending dedupe +
  fibonacci backoff) -- all reused untouched.
- `usage/format.ts`: `formatStatusLineQuotaStatus` needs no changes;
  `formatQuotaCountdown` already returns `undefined` for absent/non-positive
  `resetsAt`.
- Test helpers: `makeAuth`, `makeCache` (fetch.test.mjs), `makeContext`,
  `makeExtensionApi`, `deferred` (index.test.mjs).
- No new dependencies; no new test utilities.

## Invariants and security boundaries

- API key never logged/echoed in statuses, errors, or test fixtures; tests
  capture headers only in local describe scope. Cache stores results only.
- `Authorization: Bearer ...` header built only when a key resolves (never
  `Bearer undefined`).
- Requests hit the endpoint only through `fetchProviderQuotas` (<= 1 fetch per
  5 min steady state, fibonacci backoff on failure); no code path bypasses the
  cache (REQ-007).
- No runtime dependency on the `pi-ollama-cloud` package (self-contained
  provider module).
- `ctx.hasUI` guard and the generation counter in `index.ts` remain untouched;
  this plan changes no orchestration code.
- Business rules (shape validation, fraction -> percent mapping, limited
  flagging) live in the provider data plane (`usage/providers/ollama_cloud.ts`,
  pure functions), not in the extension lifecycle adapter (`index.ts`), so they
  stay unit-testable without extension context and framework-independent.
- Layer check: `index.ts` (adapter) is untouched; all change is confined to the
  usage data plane and its tables. No workflow/domain split is introduced --
  the repo keeps its existing provider-plugin shape.

## Quality gates

Existing tooling, no new rules (eslint policy already enforces the user's
constraints):

- `pnpm lint` = `biome check .` (tabs, width 120, `noExplicitAny: error`;
  scope includes `*.md`, so the README edit is lint-covered) `&& eslint .`
  (types: max-lines 150/file, max-lines-per-function 50, max-params 3,
  no-empty without allowEmptyCatch, no `.only`; `tseslint.configs.strict`).
- `pnpm typecheck` = `tsc --noEmit` (strict, NodeNext). Adding the
  `"ollama-cloud"` union member makes tsc force-complete the
  `Record<SupportedQuotaProvider, ...>` entries (`PROVIDER_TTLS_MS`,
  `PROVIDER_FETCHERS`) -- typecheck is the enforcement mechanism for complete
  registration.
- `pnpm test` = `node --test "extensions/**/*.test.mjs"`.

## Definition of done

- All seven spec ACs covered by tests (trace below); `pnpm lint`, `pnpm test`,
  `pnpm typecheck` pass clean.
- Regression claim (REQ-010 / AC-007) is mechanically checkable: changes to
  `providers.test.mjs`, `fetch.test.mjs`, `index.test.mjs` are strictly
  additive -- new imports and appended tests; every existing assertion remains
  byte-identical. Reviewable by diff.
- README updated per REQ-011 and passes `pnpm lint`.
- Non-gating manual smoke confirms the 0-1 fraction assumption against the
  live API (see Final verification).

## Assumptions

- `usage` is a 0-1 fraction of the plan cap, not a percent -- probed by
  pi-ollama-cloud's `usage.ts` (`usagePercent` applies
  `Math.round(usage * 100)`); the smoke step verifies.
- pi registers the provider id as exactly `"ollama-cloud"` (from
  pi-ollama-cloud's `registerProvider` call), so `ctx.model.provider` matches
  the alias key after lowercasing.
- `process.env.OLLAMA_API_KEY` may be non-empty on developer machines, so every
  key-sensitive test stubs it (save/clear/restore in try/finally), mirroring
  the PATH-stub pattern already in `fetch.test.mjs`.

## Risks

- Risk: undocumented endpoint changes shape/disappears. Mitigation: minimal
  validation (REQ-004) -> failure + backoff + warning; bounded request rate.
- Risk: fraction-vs-percent misreading renders wrong percentages. Mitigation:
  the extraneous-fields/realistic fixture asserts 0.34 -> `66%` (not `34%`),
  plus the live smoke.
- Risk: flaky key-dependent tests on machines with `OLLAMA_API_KEY` set.
  Mitigation: mandatory env stub/restore discipline per test.
- Risk: duplicate usage rendering when pi-ollama-cloud's own `usageStatus` is
  enabled. Mitigation: README guidance (REQ-011).

## Dependencies

None. No new npm dependencies; no peer-dependency changes; the
`pi-ollama-cloud` package is deliberately not imported (spec non-goal).
Licensing review: not applicable.

## Decisions

- **D1 -- Self-contained provider module** (user decision during spec):
  `usage/providers/ollama_cloud.ts` calls the API directly, same as the other
  four providers, instead of dynamic-importing pi-ollama-cloud's exported
  `fetchUsage`/`getCloudApiKey`. Tradeoff: ~40 duplicated lines of probe
  logic vs. no cross-package coupling and no behavior change when that
  package is absent.
- **D2 -- Render through the unchanged formatter** (user decision): windows
  with `limitValue: 100` yield remaining-percent-only output (`66% 55%`),
  byte-consistent with Anthropic. No `QuotaWindow` display-flag additions.
- **D3 -- Invalid shape fails rather than returning empty windows**:
  `parseOllamaUsage` returns `[]` when either required usage field is missing
  or non-finite; the fetcher converts `windows.length === 0` (for a 200
  response) into `failure("Unexpected response shape...", "http")`. This is a
  deliberate deviation from anthropic's always-success parser (REQ-004
  requires both fields; an empty-window success would silently render the
  warning `quota fetch failed` anyway, but a `failure` result is what engages
  the documented backoff path). Kind mapping: `config` = credential problems,
  `http` = unexpected response from a reachable server, `network` = transport;
  a 200 body whose `.json()` rejects keeps `fetchJson`'s existing `network`
  classification -- documented by one focused test.
- **D4 -- Env fallback lives inside the fetcher** (`auth.getApiKey(...) ??
  process.env.OLLAMA_API_KEY`), matching pi-ollama-cloud's `getCloudApiKey`
  resolution order (REQ-003) and keeping `QuotaAuth` unchanged.
- **D5 -- Additive-only test changes** in the three shared test files so the
  regression claim stays diff-checkable.
- **D6 -- No timer-based refresh**: existing event-driven refresh + 5-min TTL
  already caps request rate (REQ-007, spec non-goal).

## Out of scope

- pi-ollama-cloud's own status bar, colored quota bars, activity-cost display,
  local `ollama` provider support, timer-driven refresh (all spec non-goals).
- Any change to `index.ts`, `footer.ts`, `formatters.ts`, or the formatter.

---

## Slice 1: Ollama Cloud usage surfaces in the footer

**Goal:** With an `ollama-cloud` model active, `turn_end`/`session_start`
produce the quota status `66% 55%` for `{session: 0.34, weekly: 0.45}`, and
`0% ! 0% !` at cap -- through the real `installStatusLine` path.

**Acceptance criteria:** AC-001 and AC-002 observable through the live
extension path; REQ-001/004/005/006 foundations in place by end of slice.

### Task 1.1: Relax `QuotaWindow.resetsAt` to optional [1]
**Do:** In `extensions/status-line/usage/types.ts`, change `resetsAt: Date`
to `resetsAt?: Date` in `QuotaWindow`. Revise here (2024-08 execution):
strict tsc narrows `formatQuotaCountdown`'s `resetAt` to `number | undefined`,
so `usage/format.ts`'s guard gains an explicit `resetAt === undefined` check
first — behavior-identical (the previous `!Number.isFinite(resetAt)` already
returned `undefined` for absent values), type-honest only. `format.test.mjs`
covered the regression without modification.
**Context:** Must land before Task 1.2 so Ollama windows can omit `resetsAt`.
Strict-mode tsc will surface any structured assignment that breaks (none
expected -- relaxation is purely additive for existing writers).
**Tests:** None (type-only). Covered by the full suite staying green in
Task 1.3's verification.
**Verify:** `pnpm typecheck` -- exits 0 with no errors; existing provider
sources compile unchanged against the relaxed type.

### Task 1.2: Add `ollama_cloud.ts` provider module with parser [3]
**Do:** Create `extensions/status-line/usage/providers/ollama_cloud.ts`:
- Types: `OllamaUsageResponse` (minimal: `limits.session.usage`,
  `limits.weekly.usage`), consumed unknown-typed.
- `parseOllamaUsage(data: unknown): QuotaWindow[]` -- returns `[]` unless both
  `limits.session.usage` and `limits.weekly.usage` are finite numbers
  (REQ-004); otherwise two windows in order: `limits.session` -> `{label:
  "5h", usedPercent: clamp(round(usage*100), 0, 100), usedValue: usedPercent,
  limitValue: 100, limited: usage >= 1.0}` (no `resetsAt`), then
  `limits.weekly` -> `{label: "7d", ...}` (REQ-005/REQ-006). Ignore all other
  fields. Keep the module under the eslint policy (~80 lines expected).
- `fetchOllamaCloudQuotas(auth: QuotaAuth): Promise<QuotasResult>` -- key =
  `await auth.getApiKey("ollama-cloud") ?? process.env.OLLAMA_API_KEY` (env
  read lazily, only after the registry misses); no key ->
  `failure("No Ollama Cloud API key found", "config")` with zero HTTP calls
  (REQ-003); else `fetchJson("https://ollama.com/api/usage", {method: "GET",
  headers: {Authorization: `Bearer ${key}`}})`; non-ok ->
  `failure(result.message, result.kind)`; ok -> parse, and `windows.length ===
  0` -> `failure("Unexpected response shape...", "http")` (Decision D3),
  else `success("ollama-cloud", windows)`.
**Context:** Header is only attached when `key` is truthy (never `Bearer
undefined`). Do not mirror pi-ollama-cloud's `isUsageLimit` models[]/
activity validation -- only the two consumed fields gate acceptance.
**Tests:** Append to `extensions/status-line/usage/providers.test.mjs`
(additive per D5): happy path (order `5h`,`7d`, values); realistic full
response with `models[]`, `activity.cost`, `period`, unknown keys -> exactly
two windows and 0.34 -> usedPercent 34 (fraction guard); clamp at usage 1.7
-> 100 + `limited`; usage exactly 1.0 -> `limited`; 0 usage -> 0, not
`limited`; missing window / non-finite usage -> `[]`.
**Verify:** `node --test extensions/status-line/usage/providers.test.mjs` --
all ollama parse tests pass; existing parser tests unchanged and green.

### Task 1.3: Register the provider and prove the endpoint contract [2]
**Do:** In `extensions/status-line/usage/fetch.ts`: add `"ollama-cloud"` to
`SupportedQuotaProvider` (types.ts union), set `PROVIDER_TTLS_MS["ollama-cloud"]
= 5 * 60_000` (REQ-007), add `PROVIDER_FETCHERS["ollama-cloud"]:
fetchOllamaCloudQuotas`, and `PROVIDER_ALIASES["ollama-cloud"] = "ollama-cloud"`
(REQ-001; `"ollama"` stays absent). In `fetch.test.mjs`, append: URL + Bearer
header capture (pattern: the anthropic endpoint test).
**Context:** tsc forces both `Record` tables to gain the new key -- registration
completeness is compiler-enforced.
**Tests:** `isSupportedProvider("ollama-cloud") === true`,
`isSupportedProvider("OLLAMA-Cloud") === true`, existing
`isSupportedProvider("ollama") === false` untouched and still passing; captured
request URL is `https://ollama.com/api/usage` and the `Authorization` header
starts with `Bearer ` (never the literal key in an assertion message).
**Verify:** `node --test extensions/status-line/usage/fetch.test.mjs` &&
`pnpm typecheck` -- green; missing-table-entry mistakes would fail typecheck.

### Task 1.4: Prove the footer rendering through the installed extension [2]
**Do:** Append to `extensions/status-line/index.test.mjs` (additive per D5):
- AC-001: `makeContext("ollama-cloud", ...)` (registry returns a token),
  `session_start` + `turn_end` with `globalThis.fetch` mocked to the 0.34/0.45
  response -> the last status is the string `"66% 55%"` (no countdown suffix).
- AC-002: same harness with usage 1.0/1.0 -> `"0% ! 0% !"`.
**Context:** Reuse the existing `deferred()`/`makeContext` harness; fetch
mocks must include `text: async () => ""` alongside `ok`/`status`/`json`, as
in the existing tests.
**Tests:** The two tests above; these exercise the live extension path
(normalizer -> cache -> fetcher -> format -> `setStatus`), so no new
production code.
**Verify:** `node --test extensions/status-line/index.test.mjs` -- new tests
green; existing six tests pass unmodified.

**Slice 1 verification:** `pnpm typecheck && node --test
extensions/status-line/usage/providers.test.mjs
extensions/status-line/usage/fetch.test.mjs
extensions/status-line/index.test.mjs` -- all green, zero edits to
`index.ts`/`format.ts`, existing test diff strictly additive.

---

## Slice 2: Degradation, caching, and key handling

**Goal:** No key -> zero HTTP + warning status; flaky/broken endpoint ->
failure kinds preserved + backoff; steady state bounded to one fetch per
5 minutes.

**Acceptance criteria:** AC-003 (both halves), AC-004, AC-005, AC-006
covered by tests.

### Task 2.1: Fetcher failure-path and cache tests [2]
**Do:** Append to `extensions/status-line/usage/fetch.test.mjs` (additive only):
- No key and cleared `OLLAMA_API_KEY` env -> `kind: "config"`, `calls === 0`
  (AC-003 fetcher half).
- Registry miss but `OLLAMA_API_KEY` set -> one request; env stubbed
  save/clear/restore in try/finally (REQ-003, advisor point 1).
- 200 with missing `limits.weekly.usage` -> failure, kind `"http"` (AC-005).
- 200 whose `json()` rejects -> failure, kind `"network"` (edge case, D3 note).
- 401 response -> failure, kind `"http"`, message preserved (REQ-008).
- Two sequential `fetchProviderQuotas` calls on `"ollama-cloud"` within the
  5-min TTL -> `calls === 1` (AC-004; pattern: the existing anthropic cache
  test with an ollama-shaped response).
- Config failure (no key) twice -> still zero calls, failure cached
  (pattern: existing codex missing-token test).
**Context:** All env mutations via save/restore; every fetch mock includes
`text: async () => ""`.
**Tests:** The seven cases above.
**Verify:** `node --test extensions/status-line/usage/fetch.test.mjs` -- green;
missing-token/backoff tests for other providers untouched.

### Task 2.2: Extension-level degradation status [1]
**Do:** Append to `extensions/status-line/index.test.mjs`:
- AC-003 status half: `makeContext` variant whose `getApiKeyForProvider`
  resolves `undefined`, `OLLAMA_API_KEY` stub-cleared -> after `turn_end`,
  statuses contain `"quota fetch failed (ollama-cloud)"` (the warning path in
  `setErrorStatus`), zero fetch calls (spy).
- AC-006: new test (do not modify the existing one) -- `makeContext("ollama",
  ...)`, fetch spy in place -> `model_select` resolves, spy call count 0,
  status `undefined`.
**Context:** Env stub/restore discipline same as Task 2.1.
**Tests:** The two tests above.
**Verify:** `node --test extensions/status-line/index.test.mjs` -- green.

**Slice 2 verification:** `node --test extensions/status-line/usage/fetch.test.mjs
extensions/status-line/index.test.mjs` -- degradation and caching behavior
proven; remaining AC-004/005/006 evidence now in the suite.

---

## Slice 3: Docs and final regression

**Goal:** README reflects the fifth provider and the double-render guidance;
regression claim (AC-007/REQ-010) is provable.

**Acceptance criteria:** README names Ollama Cloud and the
`/ollama-usage-status` guidance; AC-007 evidenced by the additive-only diff
check in Final verification.

### Task 3.1: Update README [1]
**Do:** In `README.md`: extend the footer bullet to include Ollama Cloud, e.g.
"Remaining provider quota and reset time for Anthropic, Google Antigravity,
OpenAI Codex, and GitHub Copilot, plus Ollama Cloud session (5h) and weekly
(7d) caps (Ollama exposes no per-window reset times)". Add one sentence noting
that if the `pi-ollama-cloud` extension's own opt-in usage status
(`/ollama-usage-status`) is enabled, leave it off (or expect usage rendered
twice on two surfaces).
**Context:** README is inside Biome's check scope (`*.md` in
`biome.json.files`), so run lint after editing.
**Tests:** None (docs only).
**Verify:** `pnpm lint` -- biome passes including markdown; `pnpm test` --
full suite green.

---

## Slice 4: Local `ollama` provider gate + auth.json credential chain

**Goal:** Ollama Cloud usage renders for the local `ollama` provider when the
active model is a `:cloud` proxy, with the key resolved from the registry,
auth.json, or `OLLAMA_API_KEY`; non-cloud local models stay silent.

**Acceptance criteria:** AC-008 and the revised AC-006/AC-009 from the spec
revision.

### Task 4.1: Revise spec and plan [1]
**Do:** Spec non-goal flip (local `ollama` in scope, `:cloud`-gated), REQ-001/
REQ-003/AC-006/AC-008/AC-009 revisions, open question resolved with probe
evidence. Plan gains this slice.
**Verify:** review of both artifacts.

### Task 4.2: Gate + credential chain [2]
**Do:**
- `usage/fetch.ts`: `normalizeProvider(provider, modelId?)` - `"ollama"`
  (case-insensitive) returns `"ollama-cloud"` iff `modelId` ends `:cloud`,
  else `undefined`; other names go through `PROVIDER_ALIASES` ungated (no new
  alias entry - the gate is a conditional, not a table row).
  `fetchProviderQuotas` calls `normalizeProvider(rawProvider, auth.modelId)`.
- `extensions/status-line/index.ts`: `refreshStatus` calls
  `normalizeProvider(rawProvider, ctx.model?.id)` (the naturalization point;
  without it the gate is dead code - index clears the status before fetch).
- `usage/providers/ollama_cloud.ts`: key chain extends to
  `getApiKey("ollama-cloud") -> credentialApiKey(getCredential("ollama-cloud")) -> env`.
**Context:** pi's `getApiKeyForProvider` never throws (verified; returns
`undefined` for unregistered providers), so no try/catch wrapper is added.
`readStoredCredential` returns the raw auth.json entry or `undefined`.
**Tests:** see Task 4.3.
**Verify:** `pnpm typecheck`.

### Task 4.3: Tests [2]
**Do:** Append (additive):
- `fetch.test.mjs`: normalization matrix (ollama+:cloud -> ollama-cloud;
  ollama+local -> undefined; ollama w/o id -> undefined; ollama-cloud
  ungated); auth.json-credential fetch (Bearer from credential, registry
  miss, env unset); `fetchProviderQuotas` by raw `"ollama"` with `:cloud`
  modelId (success via shared "ollama-cloud" cache plane, single fetch across
  two calls).
- `index.test.mjs`: local `ollama` + `context.model.id =
  "glm-5.3-flash:cloud"` + key renders `"66% 55%"`; same with no key ->
  warning `"quota fetch failed (ollama-cloud)"`; env stubs save/clear/restore.
**Context:** existing AC-006 test (no model id) stays untouched and green.
**Verify:** scoped `node --test` on both files.

### Task 4.4: README + final gates + commit [1]
**Do:** README provider bullet gains local `ollama` support and the auth.json
`"ollama-cloud"` setup; pointer that the local server does not proxy usage.
Run the trio, additive-diff check, commit
`feat(status-line): show Ollama Cloud usage for local ollama cloud models`.

**Slice 4 verification:** `pnpm lint && pnpm typecheck && pnpm test` green;
`git diff` shows index.ts carrying exactly the one `normalizeProvider`
call-site change.

---

## Final verification

1. `pnpm lint && pnpm typecheck && pnpm test` -- all green (DoD trio).
2. Regression: `git diff --stat` on the three shared test files shows
   appends only; `providers.test.mjs`, `fetch.test.mjs`, `index.test.mjs`
   existing assertions byte-identical (AC-007, REQ-010); `git diff` on
   `index.ts` and `helpers.ts` is empty; `format.ts` carries only the Task 1.1
   guard revision (one line, behavior-identical).
3. Requirement trace check: every REQ-001..011 and AC-001..007 maps to a task
   or verification here (REQ-001->1.3, REQ-002->1.2+1.3, REQ-003->1.2+2.1,
   REQ-004->1.2, REQ-005->1.2+1.4, REQ-006->1.2+1.4, REQ-007->1.3+2.1,
   REQ-008->2.1+2.2, REQ-009->1.1, REQ-010->slices 1-3 regression, REQ-011->
   3.1; AC-001->1.4, AC-002->1.4, AC-003->2.1+2.2, AC-004->2.1, AC-005->2.1,
   AC-006->2.2, AC-007->Final 2).
4. Non-gating manual smoke (needs a real key): `curl -s -H "Authorization:
   Bearer $OLLAMA_API_KEY" https://ollama.com/api/usage | jq '.limits'` --
   confirms `usage` values are 0-1 fractions; optionally run
   `pi -e ./extensions/status-line/index.ts --model ollama-cloud/<model>` and
   eyeball the footer. Do not commit any key or captured response.