/**
 * Inject a lark-cli `--profile` before the command arguments.
 *
 * `config.larkProfile` pins the bridge to a specific app, but lark-cli itself
 * has no notion of that: every invocation that does not carry `--profile`
 * falls back to whatever profile is *active* on the machine. That made
 * `larkProfile` effective only for the WebSocket credentials — outgoing
 * replies, chat creation and attachment downloads silently ran as another app.
 *
 * Funnel every spawn through this helper so the configured profile applies
 * everywhere.
 */
export function withProfile(profile: string | undefined, args: string[]): string[] {
  return profile ? ["--profile", profile, ...args] : args;
}
