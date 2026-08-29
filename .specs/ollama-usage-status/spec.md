# Ollama Cloud Usage Status Spec

## Status

Draft

## Problem

Status Line shows remaining provider quota (5h/7d windows) for Anthropic, Google
Antigravity, OpenAI Codex, and GitHub Copilot, but renders nothing when the
active model comes from the `ollama-cloud` provider (registered by the
`pi-ollama-cloud` extension). Users of Ollama Cloud subscription plans get no
visibility in the footer into how much of their 5-hour and 7-day caps they have
consumed, even though Ollama exposes that data on an API endpoint.

## Users and stakeholders

- Pi users running Ollama Cloud models through the `pi-ollama-cloud` provider
  extension who also use the Status Line footer.
- Status Line maintainer: must not absorb upstream instability of an
  undocumented endpoint into Tail-visible crashes or unbounded request rates.

## Goals

- While an `ollama-cloud` model is active, the footer's quota section shows the
  remaining percentage for the Ollama session (5h) and weekly (7d) windows.
- Ollama Cloud becomes a first-class provider in the existing provider
  architecture (normalizer -> fetcher table -> TTL cache -> windows -> footer
  format), with no new npm dependencies.
- Request rate against the undocumented endpoint is bounded by the existing
  cache TTL and failure backoff, and failures degrade to the existing warning
  status instead of breaking the footer.

## Non-goals

- No runtime dependency on the `pi-ollama-cloud` package (self-contained
  provider module, same pattern as the other four providers).
- No duplicate rendering of pi-ollama-cloud's own colored usage bar; the built
  footer stays plain text and consistent with the existing format.
- No display of the 4-week activity cost (`activity.cost`) - it has no known
  cap and does not fit the `QuotaWindow` model.
- No support for the local `ollama` provider (`ollama launch pi`): it has no
  cloud quota to report from pi.
- No timer-driven background refresh: Status Line stays event-driven
  (session_start / turn_end / model_select) with the TTL cache deciding when
  the network is hit.

## Current behavior

- `normalizeProvider()` in `extensions/status-line/usage/fetch.ts` returns
  `undefined` for `"ollama-cloud"`, so `refreshStatus()` in
  `extensions/status-line/index.ts` clears the quota status and shows nothing.
- `QuotaWindow` in `extensions/status-line/usage/types.ts` requires
  `resetsAt: Date`; the footer countdown is suppressed for non-positive/absent
  timestamps by `formatQuotaCountdown()` in `usage/format.ts`.
- The formatter's preferred window labels are already `["5h", "7d"]`
  (`usage/format.ts`), and `limitValue === 100` renders as remaining-percent
  only - the exact format chosen for Ollama.

## Desired behavior

When `ctx.model.provider` is `ollama-cloud` (case-insensitive), the footer
shows the Ollama Cloud session and weekly usage as remaining percentages,
fetched from `https://ollama.com/api/usage` with the user's Ollama Cloud API
key. Everything else - caching, backoff, error status, provider switching -
behaves exactly like the existing four providers.

## Requirements

- REQ-001: The provider normalizer recognizes `"ollama-cloud"` (and case
  variants) as a supported quota provider; the local `"ollama"` provider name
  remains unrecognized.
- REQ-002: Usage data is fetched with a single request: `GET
  https://ollama.com/api/usage` with an `Authorization: Bearer <key>` header,
  through the existing `fetchJson` helper (15s timeout, existing error-kind
  classification).
- REQ-003: The API key resolves first via
  `auth.getApiKey("ollama-cloud")` (pi's model registry, which covers auth.json
  credentials and `$OLLAMA_API_KEY` expansion), then falls back to the
  `OLLAMA_API_KEY` environment variable. With no key resolved, no HTTP request
  is made and the fetch fails with kind `config`.
- REQ-004: A response is accepted only if `limits.session.usage` and
  `limits.weekly.usage` are finite numbers. All other fields (per-model
  request counts, activity cost, period metadata) are ignored; their shape
  never causes a failure.
- REQ-005: Windows map as `limits.session` -> label `5h` and `limits.weekly` ->
  label `7d`, so the existing preferred-window selection renders session first,
  weekly second. Each window carries `usedPercent = clamp(round(usage * 100),
  0, 100)`, `usedValue = usedPercent`, `limitValue = 100`, and no `resetsAt`
  (suppressing the countdown).
- REQ-006: A window whose usage fraction is >= 1.0 (cap reached or exceeded)
  is marked `limited: true`, producing the existing `!` marker in the footer.
- REQ-007: Successful results are cached for 5 minutes (same TTL philosophy as
  pi-ollama-cloud's 5-minute refresh); failures flow through the existing
  fibonacci backoff. All fetches go through `fetchProviderQuotas` so no code
  path bypasses the cache.
- REQ-008: Failures surface as the existing warning status
  `quota fetch failed (ollama-cloud)`; error kinds (`config`, `http`,
  `timeout`, `network`) are preserved from `fetchJson` and no new kinds are
  introduced.
- REQ-009: `QuotaWindow.resetsAt` becomes optional (`resetsAt?: Date`). This is
  a pure type relaxation; existing providers and formatter behavior are
  unchanged (`formatQuotaCountdown` already skips non-finite/absent values).
- REQ-010: No observable behavior change for the anthropic, openai-codex,
  github-copilot, and google-antigravity providers.
- REQ-011: The README provider list gains Ollama Cloud, plus a note advising
  that pi-ollama-cloud's own opt-in `usageStatus` bar be left off so usage is
  not rendered twice.

## Invariants and security boundaries

- The API key is never logged, echoed into statuses/errors, or embedded in
  test fixtures; the cache stores fetch results only, never credentials.
- `Authorization: Bearer ...` is sent only when a key is present (never
  `Bearer undefined`).
- No runtime dependency on the `pi-ollama-cloud` package; the endpoint is hit
  only through the cached path (at most one request per 5 minutes in steady
  state, backoff on failures).
- The `ctx.hasUI` guard is unchanged: no fetching in print/json/rpc modes.
- The existing generation counter prevents stale async results from a previous
  provider/model from overwriting the current status.

## Definition of done

- `pnpm lint`, `pnpm test`, and `pnpm typecheck` pass.
- Unit tests cover: response parsing (minimal valid, missing window, non-finite
  usage, out-of-range fraction incl. clamping and `limited`), key resolution
  order and the no-key `config` failure with zero HTTP calls, failure-kind
  mapping (401/429/404/5xx via `fetchJson`), provider normalization table, and
  formatting end-to-end (`5h`/`7d` selected, countdown absent, `!` when
  limited).
- Existing provider tests pass unmodified (regression signal for REQ-009/010).
- README updated per REQ-011.

## Acceptance criteria

- AC-001: Given an active `ollama-cloud` model, a resolvable key, and a
  response `{limits: {session: {usage: 0.34}, weekly: {usage: 0.45}}}`, when a
  `turn_end` fires, then the footer renders `66% 55%` with no countdown text.
- AC-002: Given the same context with `{session: {usage: 1.0}, weekly:
  {usage: 1.0}}`, then the footer renders `0% ! 0% !`.
- AC-003: Given no key in the model registry or `OLLAMA_API_KEY`, when a
  refresh runs, then zero HTTP requests are made and the warning status
  `quota fetch failed (ollama-cloud)` is shown.
- AC-004: Given a successful fetch less than 5 minutes old, when another
  refresh triggers, then no second HTTP request occurs (cache hit).
- AC-005: Given a 200 response lacking `limits.weekly.usage`, then the result
  is a failure, the warning status shows, and the next attempt obeys the
  failure backoff rather than refetching immediately.
- AC-006: Given the active provider is local `ollama`, then no status is set
  and no request is made.
- AC-007: Given the four pre-existing providers, then all footer outputs are
  byte-identical to the pre-change behavior.

## Edge cases

- Usage fraction > 1 (server anomaly or over-cap): percent clamps to 100 and
  the window is `limited`.
- Usage fraction exactly 1.0: `limited` marker applies (cap reached).
- Extraneous response fields (`models[]`, `activity`, unknown keys): ignored
  entirely.
- Malformed JSON body with HTTP 200: fails through `fetchJson`'s existing
  error classification with a preserved message; warning status shown.
- Key present only via `OLLAMA_API_KEY` env (registry misses): fetch proceeds
  with the env key, matching pi-ollama-cloud's resolution order.
- Rapid model switches between supported providers: only the newest
  generation may write a status (existing guard).

## Constraints

- The endpoint is undocumented and may change or disappear without notice;
  the feature must degrade to the warning status and never crash or spam the
  API (pi-ollama-cloud documents the same risk against the same endpoint).
- Key handling follows pi 0.80.8+ conventions (no `AuthStorage` import;
  registry-based resolution).
- Repo tooling: strict TypeScript, Biome lint/format, existing test layout.

## Risks and mitigations

- Risk: The undocumented `/api/usage` response shape changes or the endpoint
  disappears. Mitigation: accept only the two consumed fields (REQ-004),
  degrade to warning + backoff (REQ-008), and document the assumption below.
- Risk: Fraction-vs-percent misreading of the `usage` field would render wrong
  percentages. Mitigation: clamping bounds the error; verify against the live
  API with a real key during implementation (pi-ollama-cloud's formatter
  treats it as a 0-1 fraction).
- Risk: Duplicate usage rendering if the user also enables pi-ollama-cloud's
  built-in status bar. Mitigation: README guidance in REQ-011; the two render
  on different surfaces (footer vs status row).

## Open questions

- Non-blocking: Ollama's period semantics (5h session / 7d weekly) are implied
  by pi-ollama-cloud's probing, not returned by the endpoint. If Ollama
  documents the endpoint or changes window lengths, revisit the hard-coded
  labels. Owner: repo maintainer.

## References

- https://github.com/fgrehm/pi-ollama-cloud - `usage.ts` (endpoint contract,
  validation, formatting), `index.ts` (refresh/throttle policy), `utils.ts`
  (key resolution, HTTP error mapping), `models.ts` (`OLLAMA_BASE` =
  `https://ollama.com`), README (status bar behavior and public usage API).
- `extensions/status-line/index.ts` - provider resolution, status lifecycle.
- `extensions/status-line/usage/fetch.ts` - normalizer, cache, backoff.
- `extensions/status-line/usage/helpers.ts` - `QuotaAuth`, `fetchJson`,
  `failure`/`success` constructors.
- `extensions/status-line/usage/types.ts` - `QuotaWindow`,
  `SupportedQuotaProvider`.
- `extensions/status-line/usage/format.ts` - window selection and countdown
  suppression.
- `extensions/status-line/usage/providers/anthropic.ts` - closest existing
  provider pattern (percent-utilization with `limitValue: 100`).