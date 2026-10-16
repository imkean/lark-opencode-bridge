# Fork notes

This is a personal fork of [YMaxwellHayes/lark-opencode-bridge](https://github.com/YMaxwellHayes/lark-opencode-bridge).
`upstream` points at the original; `origin` is this fork.

Kept deliberately separate from upstream files so the branch stays clean for a
possible upstream pull request.

## Divergence from upstream

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
