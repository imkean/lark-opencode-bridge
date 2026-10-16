# Fork notes

This is a personal fork of [YMaxwellHayes/lark-opencode-bridge](https://github.com/YMaxwellHayes/lark-opencode-bridge).
`upstream` points at the original; `origin` is this fork.

Kept deliberately separate from upstream files so the branch stays clean for a
possible upstream pull request.

## Divergence from upstream

### `Support opencode 2.x (API version auto-detection)`

Upstream only speaks opencode's v1 API, so opencode 2.x fails immediately with
`POST /session failed: 405 Method Not Allowed` (2.x moved every endpoint under
`/api`, requires HTTP Basic auth, renamed routes, wraps responses in `{ data }`,
changed the prompt body and replaced the event taxonomy).

This fork translates at the two edges and leaves the internals on the v1 shape:

- `src/opencode/v2.ts` (new) — path mapping (method-aware: v2 splits prompting
  from reading messages), response unwrapping/reshaping, and `translateV2Event()`
  mapping the v2 event taxonomy back onto the v1 envelopes `normalize()` expects.
  Also `detectApiVersion()`.
- `src/opencode/client.ts` — `apiVersion`/`password` options; `fetchJson` rewrites
  paths, adds Basic auth and normalises responses. v2 has no synchronous prompt,
  so `prompt()` applies model/agent via their own endpoints, admits the prompt,
  then waits for the turn's `type:"idle"` marker and returns the last assistant
  message carrying text. `replyPermission` resolves the owning session first.
- `src/opencode/events.ts` — same options; translates v2 events before normalising
  and before the session filter.
- `src/opencode/server.ts` — captures the `server password` line `opencode serve`
  prints on stdout (needed for Basic auth; redacted from the log).
- `src/config.ts` — `opencodeApiVersion: "auto" | "v1" | "v2"` (default `auto`).

Detection notes (both were real traps on 2.0.30, worth keeping in mind):
`/api/health` does **not** exist there — it 404s once authenticated — and root
`/session` answers 200 on v2 as well because `opencode serve` also hosts a web UI.
`/api/session` is the reliable discriminator: 200/401/403 ⇒ v2, 404 ⇒ v1 — and v1
is only concluded after a positive JSON response on `/session`.

v1 behaviour is unchanged when `opencodeApiVersion` is `v1` or the probe finds v1.

Verified against opencode 2.0.30: provider/agent/session listing, session creation
in an explicit directory, the SSE stream feeding the streaming card
(`part:reasoning`, `part:text`, `part:tool`, `busy`→`idle`), the synchronous prompt
path, history and delete. 41 unit tests.

### `Honour larkProfile for all lark-cli calls, and in preflight`

`config.larkProfile` only reached `loadActiveLarkCredentials()`, so it pinned the
WebSocket app and nothing else:

- `runPreflight()` called `hasLarkAppConfigured()` with **no argument**, so it
  validated the *active* lark-cli profile instead of the configured one. With two
  apps registered and the machine default on the other one, `run` exited 1 with
  `飞书应用未配置` even though `larkProfile` was valid. (`doctor` had the same gap.)
- `LarkSender`, `LarkChats` and `LarkAttachmentFetcher` spawned lark-cli with no
  `--profile` (and no `LARK_APP_ID`), so replies, chat creation and attachment
  downloads ran as whatever profile happened to be active. `fetchBotOpenId()`
  accepted a profile but its caller never passed one — hence a startup log
  showing the configured appId alongside another app's `bot open_id`.

Fix: thread `config.larkProfile` through those components plus both
`runPreflight()` call sites, and inject the flag in a single place per client via
the new `withProfile()` helper (`src/lark/cli-args.ts`).

Files: `src/lark/cli-args.ts` (new), `src/lark/sender.ts`, `src/lark/chats.ts`,
`src/lark/attach.ts`, `src/core/bridge.ts`, `src/preflight.ts`, `src/cli.ts`.

Verified: `npm run typecheck`, `npm test` (22/22), `npm run build`, and live —
with the machine's default lark-cli profile set to a *different* app, the bridge
logs the correct `bot open_id` for `larkProfile` and starts without
`--skip-preflight`.

## Working with this fork

```bash
npm install
npm run build
npm link            # global `lark-opencode-bridge` now points here
```

Restore the published package with:

```bash
npm unlink -g lark-opencode-bridge && npm i -g lark-opencode-bridge@latest
```

## Re-syncing with upstream

```bash
git checkout main
git fetch upstream
git rebase upstream/main      # or: git merge upstream/main
npm install && npm run build && npm test
```

If a divergence commit has been merged upstream, drop it here rather than
replaying it.
