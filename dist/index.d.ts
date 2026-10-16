interface BridgeConfig {
    /** Default working directory passed to opencode for new sessions. */
    defaultCwd?: string;
    /** opencode model id, e.g. "anthropic/claude-3-5-sonnet" or "openrouter/..."; SDK default if absent. */
    model?: string;
    /** opencode agent name (e.g. "build" | "plan"). */
    agent?: string;
    /** opencode serve port (auto-spawned). */
    opencodePort: number;
    /** opencode serve host. */
    opencodeHost: string;
    /** If true, bridge will spawn `opencode serve` itself. Otherwise expects an external server. */
    manageOpencodeServer: boolean;
    /** Identity used for lark-cli (`--as bot` or `--as user`). */
    larkIdentity: "bot" | "user";
    /** Allowlist of open_ids that may talk to the bot. Empty = anyone. */
    allowedSenderOpenIds: string[];
    /** Allowlist of chat_ids the bot will respond in (groups only). Empty = all. */
    allowedChatIds: string[];
    /** When non-empty, only these open_ids may run sensitive slash commands. */
    adminOpenIds: string[];
    /** When true (default), group messages require @bot unless /spawn chat. */
    requireGroupMention: boolean;
    /** Reply style. `reply`: thread reply with markdown. `card`: interactive card. */
    replyStyle: "reply" | "card";
    /** lark-cli profile name (or appId) to use. Defaults to the active profile. */
    larkProfile?: string;
    /** When true, the bridge reacts to doc-comment @mentions. Requires the
     * Lark app to be subscribed to `drive.notice.comment_add_v1` events. */
    handleDocComments: boolean;
    /** Auto-abort opencode runs with no activity for this many minutes. 0 = off. */
    idleTimeoutMinutes: number;
    /** Batch rapid messages in the same chat before sending one prompt (ms). */
    messageBatchMs: number;
    /**
     * opencode API generation. "auto" probes the server (opencode 2.x serves
     * under `/api` and needs Basic auth). Defaults to "v1" for safety when the
     * server cannot be reached at startup.
     */
    opencodeApiVersion: "auto" | "v1" | "v2";
}
declare function loadConfig(): Promise<BridgeConfig>;
declare function saveConfig(cfg: BridgeConfig): Promise<void>;

interface BridgeOptions {
    config: BridgeConfig;
    larkCliPath?: string;
    opencodePath?: string;
}
declare class Bridge {
    private readonly opts;
    private consumer;
    private credentials;
    private botOpenId;
    private readonly sender;
    private readonly chats;
    private readonly attach;
    private readonly comments;
    private readonly server;
    private client;
    private apiVersion;
    private opencodePassword;
    private readonly sessions;
    private readonly workspaces;
    private readonly perChat;
    private readonly pendingQueues;
    private readonly docInflight;
    private readonly seenEventIds;
    private keepalive;
    private mediaCleanupStop;
    private stopping;
    constructor(opts: BridgeOptions);
    start(opts?: {
        force?: boolean;
    }): Promise<void>;
    stop(): Promise<void>;
    private handleInbound;
    private handleMessage;
    private getQueue;
    private preemptChat;
    private dispatchBatch;
    private isBotMentioned;
    private handleReconnect;
    private handleTimeout;
    private handleDoctor;
    private startIdleWatchdog;
    private stopIdleWatchdog;
    private handleSlash;
    private handleConfigForm;
    private handleCardAction;
    /**
     * Validate a user-supplied model id and, when it lacks a provider prefix,
     * try to auto-complete it by matching against opencode's known providers.
     *
     * Returns either:
     *  - `{ ok: true, modelId, autoCompleted }` — a full `provider/model` ready
     *    to store in `rt.model`. `autoCompleted` is true when we filled in the
     *    provider prefix for the user.
     *  - `{ ok: false, message }` — a markdown error to send back to the chat
     *    (unknown model, ambiguous match, or opencode unreachable).
     */
    private resolveModelId;
    /**
     * Render `/model list` output. Queries opencode's `/config/providers` for
     * the current providers + models, marks the chat's effective selection,
     * and posts a markdown list back to Lark.
     */
    private handleModelList;
    /** Render `/agents` — list opencode agents and mark the chat's selection. */
    private handleAgentsList;
    /**
     * `/sessions` — list opencode sessions visible to this server. We don't
     * implement switching (each Lark chat is bound 1:1 to its own session
     * via `chat_id`), but listing is useful for debugging stale sessions.
     */
    private handleSessionsList;
    /** `/compact` — opencode `POST /session/{id}/summarize`. */
    private handleCompact;
    /** `/share` — opencode `POST /session/{id}/share`. */
    private handleShare;
    /** `/unshare` — opencode `DELETE /session/{id}/share`. */
    private handleUnshare;
    /**
     * `/undo` — revert the most recent user message. opencode wants the
     * `messageID` to roll back to, so we fetch the message list and pick
     * the last user message.
     */
    private handleUndo;
    /** `/redo` — opencode `POST /session/{id}/unrevert`. */
    private handleRedo;
    /**
     * `/init` — analyse the project and create/refresh AGENTS.md. The opencode
     * init endpoint is anchored to a user message, so we route this through the
     * normal prompt path (with a canned instruction) which is simpler and works
     * across both reply-mode and card-mode.
     */
    private handleInit;
    /**
     * Resolve the chat's effective {providerID, modelID} for endpoints that
     * require a model parameter (`/compact`, `/init`). Returns undefined when
     * the chat has no model set anywhere.
     */
    private resolveModelForApi;
    /**
     * `/spawn <主题>` — spin up a fresh Lark group chat dedicated to one
     * opencode session.
     *
     * Flow:
     *   1. Only allowed in P2P chats — spawning a group from inside another
     *      group is confusing and would mix two audiences.
     *   2. Group name is prefixed with `[opencode]` so it's easy to spot in
     *      the user's chat list. The description carries machine-readable
     *      metadata (`bridge=lark-opencode-bridge`) plus the cwd and creator,
     *      acting as our "opencode tag" since Lark has no public chat-tag API.
     *   3. The originating user is invited (`--users`) and, when running as a
     *      bot, the bridge bot is set as chat manager so it can keep updating
     *      the chat later.
     *   4. A new opencode session is created with the chosen cwd and bound to
     *      the new chat_id; opencode's auto-generated session title will then
     *      sync back into the group name on the first response (see
     *      `maybeSyncGroupName`).
     *   5. We post a welcome card into the new chat and reply to the P2P
     *      with the link / chat_id.
     */
    private handleSpawn;
    private handleWs;
    private setChatCwd;
    /**
     * Resolve the working directory for a chat. Defensively ignores stored
     * values that aren't absolute paths (defends against past `/cd ?` typos
     * that wrote garbage into sessions.json).
     */
    private chatCwd;
    private ensureChatSession;
    private handlePrompt;
    private handlePromptCore;
    /**
     * For chats spawned via `/spawn`, fetch the opencode session's title once
     * it's been auto-generated (usually after the first prompt completes) and
     * rename the Lark group to match. We only do this once per chat to avoid
     * fighting with the user if they manually rename the group later.
     */
    private maybeSyncSpawnedChatName;
    private runWithReply;
    private runWithCard;
    private handleStop;
    private replyMarkdown;
    private handleComment;
    private dispatchComment;
    private getRt;
    /** User text plus quoted/replied message content when present. */
    private buildPromptText;
    private fetchQuotedMessageText;
}

/**
 * In-chat slash commands. We mirror the names used by opencode's TUI as
 * closely as possible (see https://opencode.ai/docs/tui/) so users who
 * already know opencode can drop straight into the bridge:
 *
 *   /help /new /clear /init /sessions /resume /continue
 *   /models /agents
 *   /compact /summarize /share /unshare /undo /redo
 *
 * Bridge-specific (no opencode TUI counterpart):
 *
 *   /cd /status /stop /workspaces (/ws)
 *
 * Aliases (e.g. `/model` → `/models`, `/ws` → `/workspaces`) are normalised
 * during parsing so callers only need to handle the canonical name.
 */
type SlashName = "help" | "new" | "init" | "sessions" | "models" | "agents" | "compact" | "share" | "unshare" | "undo" | "redo" | "cd" | "status" | "stop" | "spawn" | "workspaces" | "reconnect" | "timeout" | "doctor" | "config";
interface SlashCommand {
    name: SlashName;
    /** Original head as typed by the user (useful for the alias-aware help). */
    rawName: string;
    args: string[];
    raw: string;
}
/**
 * Parse a leading slash command from a chat message. Aliases are folded into
 * the canonical name. When the SDK batching layer merges a prior message with
 * a trailing `/command` line, we scan from the bottom up so `/help` still
 * works. Returns null when the message is not a slash command — callers
 * should treat that as a regular prompt.
 */
declare function parseSlash(input: string): SlashCommand | null;

export { Bridge, type BridgeConfig, type BridgeOptions, type SlashCommand, loadConfig, parseSlash, saveConfig };
