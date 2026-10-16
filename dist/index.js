// src/core/bridge.ts
import path9 from "path";

// src/log.ts
import { createWriteStream, mkdirSync } from "fs";
import { readdir, readFile, rm } from "fs/promises";
import path2 from "path";

// src/paths.ts
import os from "os";
import path from "path";
import fs from "fs/promises";
var ROOT_ENV = process.env.LARK_OPENCODE_HOME;
var HOME_DIR = ROOT_ENV ? path.resolve(ROOT_ENV) : path.join(os.homedir(), ".lark-opencode-bridge");
var CONFIG_PATH = path.join(HOME_DIR, "config.json");
var SESSIONS_PATH = path.join(HOME_DIR, "sessions.json");
var WORKSPACES_PATH = path.join(HOME_DIR, "workspaces.json");
var PROCESSES_PATH = path.join(HOME_DIR, "processes.json");
var SCOPES_PATH = path.join(HOME_DIR, "scopes-recommended.json");
var LOG_DIR = path.join(HOME_DIR, "logs");
var MEDIA_DIR = path.join(HOME_DIR, "media");
async function ensureHome() {
  await fs.mkdir(HOME_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

// src/log.ts
var LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
var LOG_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.LARK_OPENCODE_LOG_DAYS ?? 7) || 7
);
function currentLevel() {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVEL_ORDER[raw] ?? LEVEL_ORDER.info;
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
var stream = null;
var streamDate = null;
function getStream() {
  const today = ymd(/* @__PURE__ */ new Date());
  if (stream && streamDate === today) return stream;
  if (stream) {
    try {
      stream.end();
    } catch {
    }
  }
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    stream = createWriteStream(path2.join(LOG_DIR, `${today}.log`), { flags: "a" });
    streamDate = today;
    return stream;
  } catch {
    return null;
  }
}
function appendJsonLog(entry) {
  const s = getStream();
  if (!s) return;
  try {
    s.write(JSON.stringify(entry) + "\n");
  } catch {
  }
}
async function pruneOldLogs() {
  try {
    const files = await readdir(LOG_DIR);
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 864e5;
    for (const f of files) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const fileTime = (/* @__PURE__ */ new Date(`${f.slice(0, 10)}T00:00:00Z`)).getTime();
      if (Number.isFinite(fileTime) && fileTime < cutoff) {
        await rm(path2.join(LOG_DIR, f), { force: true }).catch(() => void 0);
      }
    }
  } catch {
  }
}
async function recentLogEntries(limit = 200, levelFilter) {
  const today = ymd(/* @__PURE__ */ new Date());
  const yesterday = ymd(new Date(Date.now() - 864e5));
  const entries = [];
  for (const day of [yesterday, today]) {
    try {
      const raw = await readFile(path2.join(LOG_DIR, `${day}.log`), "utf8");
      for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          if (!levelFilter || levelFilter.has(e.level)) entries.push(e);
        } catch {
        }
      }
    } catch {
    }
  }
  return entries.slice(-limit);
}
function write(level, scope, msg, extra) {
  const entry = { ts: nowIso(), level, scope, msg };
  if (extra !== void 0) entry.extra = extra;
  appendJsonLog(entry);
  if (LEVEL_ORDER[level] < currentLevel()) return;
  const line = `[${entry.ts}] ${level.toUpperCase().padEnd(5)} ${scope.padEnd(14)} ${msg}`;
  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  out.write(line + "\n");
  if (extra !== void 0) {
    out.write(typeof extra === "string" ? extra + "\n" : JSON.stringify(extra) + "\n");
  }
}
function createLogger(scope) {
  return {
    debug: (msg, extra) => write("debug", scope, msg, extra),
    info: (msg, extra) => write("info", scope, msg, extra),
    warn: (msg, extra) => write("warn", scope, msg, extra),
    error: (msg, extra) => write("error", scope, msg, extra)
  };
}

// src/config.ts
import fs2 from "fs/promises";
var DEFAULT = {
  opencodePort: 4096,
  opencodeHost: "127.0.0.1",
  manageOpencodeServer: true,
  larkIdentity: "bot",
  allowedSenderOpenIds: [],
  allowedChatIds: [],
  adminOpenIds: [],
  requireGroupMention: true,
  replyStyle: "reply",
  handleDocComments: true,
  idleTimeoutMinutes: 30,
  messageBatchMs: 600,
  opencodeApiVersion: "auto"
};
async function loadConfig() {
  await ensureHome();
  try {
    const raw = await fs2.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT, ...parsed };
  } catch (err) {
    if (err?.code === "ENOENT") {
      await saveConfig(DEFAULT);
      return DEFAULT;
    }
    throw err;
  }
}
async function saveConfig(cfg) {
  await ensureHome();
  await fs2.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

// src/config-access.ts
var ADMIN_SLASH_COMMANDS = /* @__PURE__ */ new Set([
  "config",
  "reconnect",
  "doctor",
  "cd",
  "workspaces",
  "spawn"
]);
function parseIdList(raw) {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
function joinIdList(ids) {
  return ids.join(", ");
}
function isUserAllowed(cfg, openId) {
  if (!cfg.allowedSenderOpenIds.length) return true;
  return cfg.allowedSenderOpenIds.includes(openId);
}
function isChatAllowed(cfg, chatId, chatType) {
  if (chatType === "p2p") return true;
  if (!cfg.allowedChatIds.length) return true;
  return cfg.allowedChatIds.includes(chatId);
}
function isAdmin(cfg, openId) {
  if (!cfg.adminOpenIds.length) return true;
  return cfg.adminOpenIds.includes(openId);
}

// src/card/config-card.ts
function configFormOptsFromBridge(cfg) {
  return {
    replyStyle: cfg.replyStyle,
    idleTimeoutMinutes: cfg.idleTimeoutMinutes,
    messageBatchMs: cfg.messageBatchMs,
    handleDocComments: cfg.handleDocComments,
    requireGroupMention: cfg.requireGroupMention,
    allowedUsers: joinIdList(cfg.allowedSenderOpenIds),
    allowedChats: joinIdList(cfg.allowedChatIds),
    admins: joinIdList(cfg.adminOpenIds)
  };
}
function configFormCard(opts) {
  return {
    schema: "2.0",
    config: { summary: { content: "\u504F\u597D\u8BBE\u7F6E" } },
    body: {
      elements: [
        {
          tag: "markdown",
          content: "\u2699\uFE0F **\u504F\u597D\u8BBE\u7F6E**\n\n\u8C03\u6574 bridge \u884C\u4E3A\u3002\u63D0\u4EA4\u540E**\u7ACB\u5373\u751F\u6548**\uFF08\u65E0\u9700\u91CD\u542F\uFF09\uFF0C\u5E76\u5199\u5165 `~/.lark-opencode-bridge/config.json`\u3002"
        },
        { tag: "hr" },
        {
          tag: "form",
          name: "config_form",
          elements: [
            {
              tag: "markdown",
              content: "**\u6D88\u606F\u56DE\u590D\u65B9\u5F0F**\n_reply\uFF1A\u8DD1\u5B8C\u540E\u4E00\u6761 markdown \u56DE\u590D_\n_card\uFF1A\u6D41\u5F0F\u4EA4\u4E92\u5361\u7247\uFF08\u63A8\u8350\uFF09_"
            },
            {
              tag: "select_static",
              name: "reply_style",
              initial_option: opts.replyStyle,
              options: [
                { text: { tag: "plain_text", content: "reply\uFF08\u7EBF\u7A0B markdown\uFF09" }, value: "reply" },
                { text: { tag: "plain_text", content: "card\uFF08\u6D41\u5F0F\u5361\u7247\uFF09" }, value: "card" }
              ]
            },
            {
              tag: "markdown",
              content: "\n**\u5168\u5C40\u7A7A\u95F2\u8D85\u65F6\uFF08\u5206\u949F\uFF09**\n_opencode \u957F\u65F6\u95F4\u65E0\u8F93\u51FA\u5219\u81EA\u52A8\u4E2D\u65AD\uFF1B0 = \u5173\u95ED\u3002\u53EF\u88AB `/timeout` \u6309\u804A\u5929\u8986\u76D6_"
            },
            {
              tag: "input",
              name: "idle_timeout_minutes",
              default_value: String(opts.idleTimeoutMinutes),
              placeholder: { tag: "plain_text", content: "30" },
              input_type: "text"
            },
            {
              tag: "markdown",
              content: "\n**\u6D88\u606F\u6279\u5904\u7406\u95F4\u9694\uFF08\u6BEB\u79D2\uFF09**\n_\u540C\u4E00\u804A\u5929\u5FEB\u901F\u8FDE\u53D1\u65F6\u5408\u5E76\u4E3A\u4E00\u6B21 prompt\uFF1B0 = \u4E0D\u7B49\u5F85_"
            },
            {
              tag: "input",
              name: "message_batch_ms",
              default_value: String(opts.messageBatchMs),
              placeholder: { tag: "plain_text", content: "600" },
              input_type: "text"
            },
            {
              tag: "markdown",
              content: "\n**\u4E91\u6587\u6863\u8BC4\u8BBA @bot**\n_\u5F00\u542F\uFF1A\u6587\u6863\u8BC4\u8BBA\u91CC @bot \u4F1A\u4EA4\u7ED9 opencode \u5E76\u56DE\u5E16_"
            },
            {
              tag: "select_static",
              name: "handle_doc_comments",
              initial_option: opts.handleDocComments ? "yes" : "no",
              options: [
                { text: { tag: "plain_text", content: "\u5F00\u542F" }, value: "yes" },
                { text: { tag: "plain_text", content: "\u5173\u95ED" }, value: "no" }
              ]
            },
            {
              tag: "markdown",
              content: "\n**\u7FA4\u91CC\u9700\u8981 @ bot**\n_\u662F(\u9ED8\u8BA4)\uFF1A\u666E\u901A\u7FA4\u9700 @ \u624D\u56DE\u590D\uFF1B`/spawn` \u7FA4\u4ECD\u514D @_\n_\u5426\uFF1A\u7FA4\u5185\u4EFB\u610F\u6D88\u606F\u90FD\u8DEF\u7531\u5230 opencode_"
            },
            {
              tag: "select_static",
              name: "require_mention_in_group",
              initial_option: opts.requireGroupMention ? "yes" : "no",
              options: [
                { text: { tag: "plain_text", content: "\u662F(\u9ED8\u8BA4)" }, value: "yes" },
                { text: { tag: "plain_text", content: "\u5426" }, value: "no" }
              ]
            },
            { tag: "hr" },
            {
              tag: "markdown",
              content: "\u{1F512} **\u8BBF\u95EE\u63A7\u5236**\uFF08\u7559\u7A7A = \u4E0D\u9650\u5236\uFF09\n\nopen_id / chat_id \u53EF\u4ECE\u65E5\u5FD7 `~/.lark-opencode-bridge/logs/` \u91CC\u67E5\u770B sender / chat \u5B57\u6BB5\u3002"
            },
            {
              tag: "markdown",
              content: "\n**\u7528\u6237\u767D\u540D\u5355**\uFF08`allowedSenderOpenIds`\uFF0C\u82F1\u6587\u9017\u53F7\u5206\u9694\uFF09"
            },
            {
              tag: "input",
              name: "allowed_users",
              default_value: opts.allowedUsers,
              placeholder: { tag: "plain_text", content: "ou_xxx, ou_yyy\uFF08\u7559\u7A7A=\u4E0D\u9650\u5236\uFF09" },
              input_type: "text"
            },
            {
              tag: "markdown",
              content: "\n**\u7FA4\u767D\u540D\u5355**\uFF08`allowedChatIds`\uFF0C\u4EC5\u9650\u5236\u7FA4\uFF1B\u79C1\u804A\u4E0D\u53D7\u6B64\u7EA6\u675F\uFF09"
            },
            {
              tag: "input",
              name: "allowed_chats",
              default_value: opts.allowedChats,
              placeholder: { tag: "plain_text", content: "oc_xxx\uFF08\u7559\u7A7A=\u6240\u6709\u7FA4\uFF09" },
              input_type: "text"
            },
            {
              tag: "markdown",
              content: "\n**\u7BA1\u7406\u5458**\uFF08`adminOpenIds`\uFF09\n_\u9650\u5236 `/config` `/reconnect` `/doctor` `/cd` `/workspaces` `/spawn`\uFF1B\u7559\u7A7A=\u4E0D\u9650\u5236_"
            },
            {
              tag: "input",
              name: "admins",
              default_value: opts.admins,
              placeholder: { tag: "plain_text", content: "ou_xxx\uFF08\u7559\u7A7A=\u4E0D\u9650\u5236\uFF09" },
              input_type: "text"
            },
            {
              tag: "column_set",
              flex_mode: "flow",
              horizontal_spacing: "small",
              columns: [
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      name: "submit_btn",
                      text: { tag: "plain_text", content: "\u63D0\u4EA4" },
                      type: "primary",
                      form_action_type: "submit",
                      behaviors: [{ type: "callback", value: { cmd: "config.submit" } }]
                    }
                  ]
                },
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      name: "cancel_btn",
                      text: { tag: "plain_text", content: "\u53D6\u6D88" },
                      behaviors: [{ type: "callback", value: { cmd: "config.cancel" } }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  };
}
function configSavedCard(opts) {
  const summarizeList = (raw) => {
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return items.length === 0 ? "_(\u4E0D\u9650\u5236)_" : `${items.length} \u9879`;
  };
  return {
    schema: "2.0",
    config: { summary: { content: "\u504F\u597D\u5DF2\u4FDD\u5B58" } },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `\u2705 **\u504F\u597D\u5DF2\u4FDD\u5B58**

**\u56DE\u590D\u65B9\u5F0F**\uFF1A\`${opts.replyStyle}\`
**\u5168\u5C40\u7A7A\u95F2\u8D85\u65F6**\uFF1A\`${opts.idleTimeoutMinutes > 0 ? `${opts.idleTimeoutMinutes} \u5206\u949F` : "\u5173\u95ED"}\`
**\u6D88\u606F\u6279\u5904\u7406**\uFF1A\`${opts.messageBatchMs} ms\`
**\u6587\u6863\u8BC4\u8BBA**\uFF1A\`${opts.handleDocComments ? "\u5F00\u542F" : "\u5173\u95ED"}\`
**\u7FA4\u91CC\u9700\u8981 @**\uFF1A\`${opts.requireGroupMention ? "\u662F" : "\u5426"}\`

\u{1F512} **\u8BBF\u95EE\u63A7\u5236**
**\u7528\u6237\u767D\u540D\u5355**\uFF1A${summarizeList(opts.allowedUsers)}
**\u7FA4\u767D\u540D\u5355**\uFF1A${summarizeList(opts.allowedChats)}
**\u7BA1\u7406\u5458**\uFF1A${summarizeList(opts.admins)}

\u4E0B\u4E00\u6761\u6D88\u606F\u5F00\u59CB\u751F\u6548\u3002`
        }
      ]
    }
  };
}
function configCancelledCard() {
  return {
    schema: "2.0",
    config: { summary: { content: "\u5DF2\u53D6\u6D88" } },
    body: {
      elements: [{ tag: "markdown", content: "\u5DF2\u53D6\u6D88\uFF0C\u672A\u505A\u4EFB\u4F55\u4FEE\u6539\u3002" }]
    }
  };
}
function configErrorCard(message) {
  return {
    schema: "2.0",
    config: { summary: { content: "\u4FDD\u5B58\u5931\u8D25" } },
    body: {
      elements: [{ tag: "markdown", content: `\u274C **\u672A\u80FD\u4FDD\u5B58**

${message}` }]
    }
  };
}

// src/config-form.ts
function applyConfigForm(cfg, form, operatorOpenId, currentChatId, chatType) {
  const replyStyle = form.reply_style === "card" ? "card" : "reply";
  const idleRaw = (form.idle_timeout_minutes ?? "").trim();
  const idleTimeoutMinutes = idleRaw === "" ? cfg.idleTimeoutMinutes : Number(idleRaw);
  if (!Number.isFinite(idleTimeoutMinutes) || idleTimeoutMinutes < 0 || idleTimeoutMinutes > 120) {
    return { ok: false, error: "\u5168\u5C40\u7A7A\u95F2\u8D85\u65F6\u987B\u4E3A 0\u2013120 \u7684\u6574\u6570\uFF080 = \u5173\u95ED\uFF09\u3002" };
  }
  const batchRaw = (form.message_batch_ms ?? "").trim();
  const messageBatchMs = batchRaw === "" ? cfg.messageBatchMs : Number(batchRaw);
  if (!Number.isFinite(messageBatchMs) || messageBatchMs < 0 || messageBatchMs > 1e4) {
    return { ok: false, error: "\u6D88\u606F\u6279\u5904\u7406\u95F4\u9694\u987B\u4E3A 0\u201310000 \u7684\u6574\u6570\uFF08\u6BEB\u79D2\uFF09\u3002" };
  }
  const handleDocComments = form.handle_doc_comments !== "no";
  const requireGroupMention = form.require_mention_in_group !== "no";
  const allowedSenderOpenIds = parseIdList(form.allowed_users ?? "");
  const allowedChatIds = parseIdList(form.allowed_chats ?? "");
  const adminOpenIds = parseIdList(form.admins ?? "");
  if (allowedSenderOpenIds.length && !allowedSenderOpenIds.includes(operatorOpenId)) {
    return {
      ok: false,
      error: "\u7528\u6237\u767D\u540D\u5355\u672A\u5305\u542B\u4F60\u81EA\u5DF1 \u2014 \u4FDD\u5B58\u540E\u4F1A\u65E0\u6CD5\u8DDF bot \u5BF9\u8BDD\u3002\u8BF7\u628A\u81EA\u5DF1\u7684 open_id \u52A0\u8FDB\u767D\u540D\u5355\uFF0C\u6216\u7559\u7A7A\u8868\u793A\u4E0D\u9650\u5236\u3002"
    };
  }
  if (adminOpenIds.length && !adminOpenIds.includes(operatorOpenId)) {
    return {
      ok: false,
      error: "\u7BA1\u7406\u5458\u540D\u5355\u672A\u5305\u542B\u4F60\u81EA\u5DF1 \u2014 \u4FDD\u5B58\u540E\u5C06\u65E0\u6CD5\u518D\u7528 `/config` \u7B49\u654F\u611F\u547D\u4EE4\u3002\u8BF7\u628A\u81EA\u5DF1\u7684 open_id \u52A0\u8FDB\u7BA1\u7406\u5458\uFF0C\u6216\u7559\u7A7A\u8868\u793A\u4E0D\u9650\u5236\u3002"
    };
  }
  if (chatType === "group" && currentChatId && allowedChatIds.length && !allowedChatIds.includes(currentChatId)) {
    return {
      ok: false,
      error: "\u7FA4\u767D\u540D\u5355\u672A\u5305\u542B\u5F53\u524D\u7FA4 \u2014 \u4FDD\u5B58\u540E\u672C\u7FA4\u5C06\u65E0\u6CD5\u89E6\u53D1 bot\u3002\u8BF7\u628A\u5F53\u524D chat_id \u52A0\u8FDB\u7FA4\u767D\u540D\u5355\uFF0C\u6216\u7559\u7A7A\u8868\u793A\u6240\u6709\u7FA4\u53EF\u7528\u3002"
    };
  }
  const next = {
    ...cfg,
    replyStyle,
    idleTimeoutMinutes,
    messageBatchMs,
    handleDocComments,
    requireGroupMention,
    allowedSenderOpenIds,
    allowedChatIds,
    adminOpenIds
  };
  return { ok: true, cfg: next, formOpts: configFormOptsFromBridge(next) };
}

// src/lark/ws-consumer.ts
import { createLarkChannel, Domain } from "@larksuiteoapi/node-sdk";

// src/process/exec.ts
import crossSpawn from "cross-spawn";
import { existsSync } from "fs";
import path3 from "path";
var spawn = crossSpawn;
var spawnSync = crossSpawn.sync;
function resolveOnPath(name) {
  const isWin = process.platform === "win32";
  const finder = isWin ? "where" : "which";
  const res = spawnSync(finder, [name], { encoding: "utf8", env: process.env });
  if (res.status !== 0) return void 0;
  const lines = (res.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (isWin) {
    const exec = lines.find((l) => /\.(exe|cmd|bat|com)$/i.test(l));
    return exec ?? lines[0];
  }
  return lines[0];
}
var cachedLarkCli;
function resolveLarkCli(explicit, opts) {
  if (explicit) return explicit;
  if (!opts?.refresh && cachedLarkCli) return cachedLarkCli;
  cachedLarkCli = resolveLarkCliUncached();
  return cachedLarkCli;
}
function resolveLarkCliUncached() {
  if (process.platform === "win32") {
    const root = spawnSync("npm", ["root", "-g"], { encoding: "utf8", timeout: 3e4 });
    if (root.status === 0) {
      const exe = path3.join(root.stdout.trim(), "@larksuite", "cli", "bin", "lark-cli.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return resolveOnPath("lark-cli") ?? "lark-cli";
}

// src/lark/attach.ts
import fs3 from "fs/promises";
import path4 from "path";
import { pathToFileURL } from "url";

// src/lark/cli-args.ts
function withProfile(profile, args) {
  return profile ? ["--profile", profile, ...args] : args;
}

// src/lark/attach.ts
var log = createLogger("lark.attach");
var LarkAttachmentFetcher = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  /**
   * For a Lark message that is `image` or `file` (or post with attachments),
   * resolve the raw content, download each resource into MEDIA_DIR/<msgId>/,
   * and return FilePartInput-ready references.
   *
   * Returns an empty array for unsupported message types or on any failure
   * — callers should still process the text content even if attachments fail.
   */
  /**
   * Fetch plain text from a message by id. Used when the user quotes/replies
   * to another message so we can include the quoted content in the prompt.
   */
  async fetchMessageText(messageId) {
    try {
      const raw = await this.mget(messageId);
      const text = extractTextFromRawMessage(raw);
      return text.trim() || null;
    } catch (err) {
      log.warn(`mget ${messageId} failed: ${err.message}`);
      return null;
    }
  }
  async fetch(messageId, messageType) {
    if (!isSupported(messageType)) return [];
    let raw;
    try {
      raw = await this.mget(messageId);
    } catch (err) {
      log.warn(`mget ${messageId} failed: ${err.message}`);
      return [];
    }
    const refs = collectResourceRefs(raw, messageType);
    if (!refs.length) return [];
    const outDir = path4.join(MEDIA_DIR, messageId);
    await fs3.mkdir(outDir, { recursive: true });
    const results = [];
    for (const ref of refs) {
      try {
        const local = await this.download(messageId, ref, outDir);
        results.push(local);
      } catch (err) {
        log.warn(`download ${ref.fileKey} failed: ${err.message}`);
      }
    }
    return results;
  }
  async mget(messageId) {
    const args = [
      "im",
      "+messages-mget",
      "--message-ids",
      messageId,
      "--format",
      "json",
      "--as",
      this.opts.identity
    ];
    const out = await run(
      this.opts.larkCliPath ?? resolveLarkCli(),
      withProfile(this.opts.profile, args)
    );
    const json = safeJson(out);
    const msg = extractMessage(json);
    if (!msg) {
      log.warn(`mget ${messageId}: could not parse response envelope`);
      return {};
    }
    return msg;
  }
  async download(messageId, ref, outDir) {
    const filename = sanitiseName(ref.fileName ?? ref.fileKey);
    const safeName = filename || ref.fileKey;
    const relOut = path4.posix.join(path4.basename(outDir), safeName);
    const cwd = path4.dirname(outDir);
    const args = [
      "im",
      "+messages-resources-download",
      "--message-id",
      messageId,
      "--file-key",
      ref.fileKey,
      "--type",
      ref.type,
      "--output",
      relOut,
      "--as",
      this.opts.identity
    ];
    await run(this.opts.larkCliPath ?? resolveLarkCli(), withProfile(this.opts.profile, args), cwd);
    const absPath = path4.join(outDir, safeName);
    const stat = await fs3.stat(absPath).catch(() => null);
    return {
      filePath: absPath,
      url: pathToFileURL(absPath).href,
      filename: safeName,
      mime: inferMime(safeName, ref.type),
      size: stat?.size
    };
  }
};
function isSupported(type) {
  return type === "image" || type === "file" || type === "post";
}
function collectResourceRefs(raw, messageType) {
  const contentStr = messageContentString(raw);
  if (!contentStr) return [];
  let content;
  try {
    content = JSON.parse(contentStr);
  } catch {
    return [];
  }
  const refs = [];
  if (messageType === "image") {
    const key = pickString(content, ["image_key"]);
    if (key) refs.push({ fileKey: key, type: "image" });
  } else if (messageType === "file") {
    const key = pickString(content, ["file_key"]);
    if (key) {
      refs.push({
        fileKey: key,
        type: "file",
        fileName: pickString(content, ["file_name"])
      });
    }
  } else if (messageType === "post") {
    walkPost(content, refs);
  }
  return refs;
}
function walkPost(node, refs) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkPost(item, refs);
    return;
  }
  if (typeof node !== "object") return;
  const rec = node;
  if (rec.tag === "img" && typeof rec.image_key === "string") {
    refs.push({ fileKey: rec.image_key, type: "image" });
  }
  if (rec.tag === "file" && typeof rec.file_key === "string") {
    refs.push({
      fileKey: rec.file_key,
      type: "file",
      fileName: pickString(rec, ["file_name"])
    });
  }
  for (const value of Object.values(rec)) {
    if (typeof value === "object" && value !== null) walkPost(value, refs);
  }
}
function messageContentString(raw) {
  if (typeof raw.content === "string" && raw.content) return raw.content;
  if (typeof raw.body?.content === "string" && raw.body.content) return raw.body.content;
  return void 0;
}
function extractTextFromRawMessage(raw) {
  const contentStr = messageContentString(raw);
  if (!contentStr) return "";
  if (!contentStr.startsWith("{")) return contentStr;
  let content;
  try {
    content = JSON.parse(contentStr);
  } catch {
    return contentStr;
  }
  if (typeof content === "object" && content !== null) {
    const rec = content;
    if (typeof rec.text === "string") return rec.text;
  }
  const postText = flattenPostText(content);
  return postText || contentStr;
}
function flattenPostText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node.map(flattenPostText).filter(Boolean).join("");
  }
  if (typeof node !== "object") return "";
  const rec = node;
  if (typeof rec.text === "string" && (rec.tag === "text" || rec.tag === "a" || rec.tag === "md")) {
    return rec.text;
  }
  const parts = [];
  for (const value of Object.values(rec)) {
    const t = flattenPostText(value);
    if (t) parts.push(t);
  }
  return parts.join("\n");
}
function extractMessage(json) {
  if (!json) return null;
  const pickFirst = (items) => {
    if (!Array.isArray(items) || !items[0] || typeof items[0] !== "object") return null;
    return items[0];
  };
  if (Array.isArray(json)) return pickFirst(json);
  if (typeof json !== "object") return null;
  const rec = json;
  const direct = pickFirst(rec.items) ?? pickFirst(rec.messages);
  if (direct) return direct;
  if (rec.data && typeof rec.data === "object") {
    const dataRec = rec.data;
    const nested = pickFirst(dataRec.items) ?? pickFirst(dataRec.messages);
    if (nested) return nested;
  }
  if (rec.body || rec.content || rec.message_id) return rec;
  return null;
}
function pickString(obj, path10) {
  let cur = obj;
  for (const key of path10) {
    if (cur && typeof cur === "object" && key in cur) {
      cur = cur[key];
    } else {
      return void 0;
    }
  }
  return typeof cur === "string" ? cur : void 0;
}
function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function sanitiseName(name) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return /^(con|nul|prn|aux|com[1-9]|lpt[1-9])(\.|$)/i.test(safe) ? `_${safe}` : safe;
}
function inferMime(name, type) {
  const ext = path4.extname(name).slice(1).toLowerCase();
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    log: "text/plain",
    csv: "text/csv",
    zip: "application/zip"
  };
  if (ext && map[ext]) return map[ext];
  return type === "image" ? "image/png" : "application/octet-stream";
}
function run(bin, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    proc.stdout.on("data", (c) => out.push(c));
    proc.stderr.on("data", (c) => err.push(c));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} ${args[0]} ${args[1]} (code=${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

// src/lark/ws-consumer.ts
var log2 = createLogger("lark.ws");
var LarkWsConsumer = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  _channel = null;
  /** Exposed so callers can call channel.updateCard() for streaming patches. */
  get channel() {
    return this._channel;
  }
  async start() {
    const { appId, appSecret, brand } = this.opts.credentials;
    log2.info(`starting LarkChannel appId=${appId} brand=${brand}`);
    const ch = createLarkChannel({
      appId,
      appSecret,
      domain: brand === "lark" ? Domain.Lark : Domain.Feishu,
      source: "lark-opencode-bridge",
      // Keep raw comment payloads so we can distinguish new top-level comments
      // from replies via notice_meta.notice_type.
      includeRawEvent: true,
      // SDK PolicyGate defaults requireMention=true, which drops every group
      // message that doesn't @ the bot before our handler ever runs. Feishu
      // *does* deliver those messages (verified via lark-cli event consume);
      // we want bridge-level control instead: /spawn groups accept all messages,
      // other groups still require an @ (see handleMessage in bridge.ts).
      policy: { requireMention: false },
      // Disable the 600ms text batching window. Without this, a welcome card
      // or other prior message in the same chat can be merged with the user's
      // `/help`, producing "welcome…\n\n/help" which no longer parses as a
      // slash command and gets sent to opencode instead.
      safety: { batch: { text: { delayMs: 0 } } }
    });
    this._channel = ch;
    ch.on({
      message: (msg) => {
        try {
          const evt = adaptMessage(msg);
          if (evt) this.opts.onMessage(evt);
        } catch (err) {
          log2.warn(`message adapt failed: ${err.message}`);
        }
      },
      cardAction: (evt) => {
        try {
          const value = evt.action?.value;
          const chatId = value?.chatId ?? evt.chatId;
          if (!chatId) return;
          const cmd = typeof value?.cmd === "string" ? value.cmd : "";
          if (cmd === "stop") {
            log2.info(`stop callback for chatId=${chatId}`);
            this.opts.onStop(chatId);
            return;
          }
          if (!cmd) return;
          const raw = evt.raw;
          const chatType = evt.chatType === "p2p" ? "p2p" : "group";
          this.opts.onCardAction({
            cmd,
            chatId,
            messageId: evt.messageId,
            operatorOpenId: evt.operator.openId,
            chatType,
            formValue: raw?.action?.form_value
          });
        } catch (err) {
          log2.warn(`cardAction handler failed: ${err.message}`);
        }
      },
      comment: (evt) => {
        try {
          const mapped = adaptComment(evt);
          if (mapped) this.opts.onComment(mapped);
        } catch (err) {
          log2.warn(`comment adapt failed: ${err.message}`);
        }
      },
      error: (err) => {
        log2.error(`channel error: ${err.message}`);
      },
      reconnecting: () => {
        log2.warn("channel reconnecting\u2026");
      }
    });
    await ch.connect();
    log2.info("LarkChannel connected");
  }
  async stop() {
    const ch = this._channel;
    if (!ch) return;
    this._channel = null;
    try {
      await ch.disconnect();
    } catch (err) {
      log2.warn(`disconnect failed: ${err.message}`);
    }
  }
  /** Manual WS reconnect (/reconnect). */
  async reconnect() {
    const ch = this._channel;
    if (!ch) throw new Error("LarkChannel not started");
    log2.info("manual reconnect requested");
    await ch.disconnect();
    await ch.connect();
    log2.info("LarkChannel reconnected");
  }
  connectionSummary() {
    const st = this._channel?.getConnectionStatus();
    if (!st) return "not connected";
    return `state=${st.state} reconnectAttempts=${st.reconnectAttempts}`;
  }
  /** Fetch quoted/replied message text via the SDK (same auth as WS). */
  async fetchMessageText(messageId) {
    const ch = this._channel;
    if (!ch) return null;
    try {
      const res = await ch.rawClient.im.v1.message.get({
        path: { message_id: messageId }
      });
      const item = res.data?.items?.[0];
      if (!item?.body?.content) {
        log2.warn(
          `message.get ${messageId}: empty body (code=${res.code ?? "?"} msg=${res.msg ?? ""})`
        );
        return null;
      }
      const text = extractTextFromRawMessage({
        msg_type: item.msg_type,
        body: item.body
      });
      return text.trim() || null;
    } catch (err) {
      log2.warn(`message.get ${messageId} failed: ${err.message}`);
      return null;
    }
  }
};
function adaptMessage(msg) {
  const mentions = msg.mentions.map((m) => ({
    key: m.key,
    openId: m.openId,
    name: m.name ?? ""
  }));
  return {
    kind: "message",
    type: "im.message.receive_v1",
    event_id: msg.messageId,
    message_id: msg.messageId,
    chat_id: msg.chatId,
    chat_type: msg.chatType === "p2p" ? "p2p" : "group",
    sender_id: msg.senderId,
    message_type: msg.rawContentType,
    content: msg.content,
    create_time: String(msg.createTime),
    mentions,
    reply_to_message_id: resolveReplyToMessageId(msg)
  };
}
function resolveReplyToMessageId(msg) {
  if (msg.replyToMessageId) return msg.replyToMessageId;
  const raw = msg.raw;
  const parent = raw?.message?.parent_id;
  return parent && parent !== "0" ? parent : void 0;
}
function adaptComment(evt) {
  if (!evt.fileToken || !evt.commentId) return null;
  const raw = rawCommentEvent(evt);
  const noticeType = readString(raw.notice_meta?.notice_type) ?? (evt.replyId ? "add_reply" : "add_comment");
  return {
    kind: "comment",
    type: "drive.notice.comment_add_v1",
    event_id: `${noticeType}:${evt.commentId}:${evt.replyId ?? ""}:${evt.timestamp}`,
    file_token: evt.fileToken,
    file_type: evt.fileType ?? "doc",
    comment_id: evt.commentId,
    reply_id: evt.replyId ?? "",
    is_mentioned: evt.mentionedBot,
    notice_type: noticeType,
    from_open_id: evt.operator?.openId,
    to_open_id: readString(raw.notice_meta?.to_user_id?.open_id),
    create_time: String(evt.timestamp)
  };
}
function rawCommentEvent(evt) {
  return evt.raw && typeof evt.raw === "object" ? evt.raw : {};
}
function readString(value) {
  return typeof value === "string" && value ? value : void 0;
}

// src/lark/sender.ts
var log3 = createLogger("lark.send");
var LarkSender = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  reply(o) {
    const args = [
      "im",
      "+messages-reply",
      "--message-id",
      o.messageId,
      "--as",
      this.opts.identity
    ];
    if (o.markdown) {
      args.push("--markdown", o.markdown);
    } else if (o.text) {
      args.push("--text", o.text);
    } else {
      return Promise.reject(new Error("reply requires markdown or text"));
    }
    if (o.replyInThread) args.push("--reply-in-thread");
    return this.runVoid(args);
  }
  send(o) {
    const args = ["im", "+messages-send", "--chat-id", o.chatId, "--as", this.opts.identity];
    if (o.markdown) {
      args.push("--markdown", o.markdown);
    } else if (o.text) {
      args.push("--text", o.text);
    } else {
      return Promise.reject(new Error("send requires markdown or text"));
    }
    return this.runVoid(args);
  }
  /**
   * Send an interactive card to a chat. Returns the new message_id from
   * lark-cli's response so callers can patch it later for streaming updates.
   */
  async sendCard(chatId, card) {
    const args = [
      "im",
      "+messages-send",
      "--chat-id",
      chatId,
      "--msg-type",
      "interactive",
      "--content",
      JSON.stringify(card),
      "--as",
      this.opts.identity
    ];
    const stdout = await this.run(args);
    try {
      const parsed = JSON.parse(stdout);
      const messageId = parsed?.data?.message_id ?? parsed?.message_id ?? parsed?.data?.message?.message_id;
      if (!messageId) throw new Error(`no message_id in lark-cli response: ${stdout.slice(0, 400)}`);
      return messageId;
    } catch (err) {
      throw new Error(`failed to parse lark-cli response: ${err.message}`);
    }
  }
  /**
   * Patch the content of an interactive card message. There is no
   * `lark-cli im messages patch` shortcut, so we use the generic api command.
   */
  patchCard(o) {
    const args = [
      "api",
      "PATCH",
      `/open-apis/im/v1/messages/${o.messageId}`,
      "--data",
      JSON.stringify({ content: JSON.stringify(o.card) }),
      "--as",
      this.opts.identity
    ];
    return this.runVoid(args);
  }
  runVoid(args) {
    return this.run(args).then(() => void 0);
  }
  run(args) {
    const bin = this.opts.larkCliPath ?? resolveLarkCli();
    const argv = withProfile(this.opts.profile, args);
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, argv, { stdio: ["ignore", "pipe", "pipe"] });
      const stdout = [];
      const stderr = [];
      proc.stdout.on("data", (c) => stdout.push(c));
      proc.stderr.on("data", (c) => stderr.push(c));
      proc.on("error", reject);
      proc.on("exit", (code) => {
        const out = Buffer.concat(stdout).toString("utf8");
        const err = Buffer.concat(stderr).toString("utf8");
        if (code === 0) {
          resolve(out);
        } else {
          log3.error(`lark-cli ${args[0]} ${args[1]} failed (code=${code}): ${err.trim() || out.trim()}`);
          reject(new Error(`lark-cli failed (code=${code}): ${err.trim() || out.trim()}`));
        }
      });
    });
  }
};

// src/lark/chats.ts
var log4 = createLogger("lark.chats");
var LarkChats = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  async create(input2) {
    const name = clip(input2.name, 60);
    const description = input2.description ? clip(input2.description, 100) : void 0;
    const args = [
      "im",
      "+chat-create",
      "--as",
      this.opts.identity,
      "--name",
      name,
      "--type",
      input2.chatType ?? "private",
      "--chat-mode",
      "group"
    ];
    if (description) args.push("--description", description);
    if (input2.userOpenIds?.length) {
      args.push("--users", input2.userOpenIds.join(","));
    }
    if (input2.setBotManager && this.opts.identity === "bot") {
      args.push("--set-bot-manager");
    }
    const stdout = await this.run(args);
    const parsed = safeJson2(stdout);
    const chatId = pickString2(parsed, ["data", "chat_id"]) ?? pickString2(parsed, ["chat_id"]);
    if (!chatId) {
      throw new Error(`chat-create returned no chat_id: ${stdout.slice(0, 400)}`);
    }
    log4.info(`created chat ${chatId} name=${JSON.stringify(name)}`);
    return { chatId, raw: parsed };
  }
  /** Update the group's name. Used to sync opencode session title → group name. */
  async updateName(chatId, name) {
    await this.run([
      "im",
      "+chat-update",
      "--as",
      this.opts.identity,
      "--chat-id",
      chatId,
      "--name",
      clip(name, 60)
    ]);
  }
  run(args) {
    const bin = this.opts.larkCliPath ?? resolveLarkCli();
    const argv = withProfile(this.opts.profile, args);
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, argv, { stdio: ["ignore", "pipe", "pipe"] });
      const stdout = [];
      const stderr = [];
      proc.stdout.on("data", (c) => stdout.push(c));
      proc.stderr.on("data", (c) => stderr.push(c));
      proc.on("error", reject);
      proc.on("exit", (code) => {
        const out = Buffer.concat(stdout).toString("utf8");
        const err = Buffer.concat(stderr).toString("utf8");
        if (code === 0) {
          resolve(out);
        } else {
          log4.error(
            `lark-cli ${args[0]} ${args[1]} failed (code=${code}): ${err.trim() || out.trim()}`
          );
          reject(
            new Error(`lark-cli failed (code=${code}): ${err.trim() || out.trim()}`)
          );
        }
      });
    });
  }
};
function clip(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "\u2026";
}
function safeJson2(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { _rawText: text };
  }
}
function pickString2(obj, path10) {
  let cur = obj;
  for (const k of path10) {
    if (cur && typeof cur === "object" && k in cur) {
      cur = cur[k];
    } else {
      return void 0;
    }
  }
  return typeof cur === "string" ? cur : void 0;
}

// src/lark/feishu-app-client.ts
import { AppType, Client, Domain as Domain2, LoggerLevel } from "@larksuiteoapi/node-sdk";
var noopLogger = {
  error: () => {
  },
  warn: () => {
  },
  info: () => {
  },
  debug: () => {
  },
  trace: () => {
  }
};
function createFeishuAppClient(opts) {
  return new Client({
    appId: opts.appId,
    appSecret: opts.appSecret,
    appType: AppType.SelfBuild,
    domain: opts.brand === "lark" ? Domain2.Lark : Domain2.Feishu,
    ...opts.quiet ? { logger: noopLogger, loggerLevel: LoggerLevel.fatal } : {}
  });
}

// src/lark/comments.ts
var log5 = createLogger("lark.comm");
var SUPPORTED_FILE_TYPES = /* @__PURE__ */ new Set(["doc", "docx", "sheet", "file"]);
var CommentFetcher = class {
  constructor(opts = {}) {
    this.opts = opts;
    if (opts.credentials) this.client = createFeishuAppClient(opts.credentials);
  }
  opts;
  client = null;
  setCredentials(credentials) {
    this.client = createFeishuAppClient({ ...credentials, quiet: true });
  }
  async fetchThread(fileToken, commentId, fileType) {
    const client = this.requireClient();
    const target = await resolveCommentTarget(client, fileToken, fileType);
    return fetchThreadForTarget(client, target, commentId);
  }
  async postReply(fileToken, commentId, fileType, text) {
    const client = this.requireClient();
    const target = await resolveCommentTarget(client, fileToken, fileType);
    const url = `/open-apis/drive/v1/files/${encodeURIComponent(target.fileToken)}/comments/${encodeURIComponent(commentId)}/replies?file_type=${encodeURIComponent(target.fileType)}`;
    try {
      await client.request({
        method: "POST",
        url,
        data: {
          content: {
            elements: [{ type: "text_run", text_run: { text } }]
          }
        }
      });
      return;
    } catch (err) {
      const code = apiErrorCode(err);
      if (code !== 1069302) throw err;
      log5.warn(`comment ${commentId} rejects thread reply (1069302), posting top-level`);
    }
    await client.request({
      method: "POST",
      url: `/open-apis/drive/v1/files/${encodeURIComponent(target.fileToken)}/comments`,
      params: { file_type: target.fileType },
      data: {
        reply_list: {
          replies: [{ content: { elements: [{ type: "text_run", text_run: { text } }] } }]
        }
      }
    });
  }
  /**
   * Add or remove an emoji reaction on a comment reply (e.g. "Typing" / 敲代码 to
   * acknowledge that the bot received the @mention). Best-effort: callers should
   * not let a reaction failure abort the main reply flow.
   */
  async reactToReply(fileToken, fileType, replyId, reactionType, action = "add") {
    const client = this.requireClient();
    const target = await resolveCommentTarget(client, fileToken, fileType);
    await client.drive.v2.commentReaction.updateReaction({
      path: { file_token: target.fileToken },
      params: { file_type: target.fileType },
      data: { action, reply_id: replyId, reaction_type: reactionType }
    });
  }
  requireClient() {
    if (!this.client) {
      throw new Error("CommentFetcher not initialized \u2014 bridge credentials missing");
    }
    return this.client;
  }
};
async function resolveCommentTarget(client, fileToken, fileType) {
  const normalized = fileType.trim().toLowerCase();
  if (!SUPPORTED_FILE_TYPES.has(normalized) && normalized !== "wiki") {
    throw new Error(`unsupported file_type=${fileType}`);
  }
  if (normalized === "wiki") {
    const res = await client.wiki.v2.space.getNode({
      params: { token: fileToken, obj_type: "wiki" }
    });
    const node = res.data?.node;
    const objToken = node?.obj_token;
    const objType = node?.obj_type?.toLowerCase();
    if (objToken && objType && SUPPORTED_FILE_TYPES.has(objType)) {
      log5.info(`wiki node ${fileToken} \u2192 ${objType}/${objToken}`);
      return { fileToken: objToken, fileType: objType };
    }
    throw new Error(`wiki node ${fileToken} could not be resolved to a supported doc type`);
  }
  return { fileToken, fileType: normalized };
}
async function fetchThreadForTarget(client, target, commentId) {
  const fromList = await findCommentViaList(client, target, commentId);
  if (fromList) {
    log5.debug(`thread ${commentId}: ${fromList.replies.length} reply/replies (via list)`);
    return {
      file_token: target.fileToken,
      comment_id: commentId,
      quote: fromList.quote,
      replies: fromList.replies
    };
  }
  const res = await client.drive.v1.fileComment.get({
    params: { file_type: target.fileType },
    path: { file_token: target.fileToken, comment_id: commentId }
  });
  const replies = mapReplies(res.data?.reply_list?.replies);
  log5.debug(`thread ${commentId}: ${replies.length} reply/replies (via get)`);
  return {
    file_token: target.fileToken,
    comment_id: commentId,
    quote: typeof res.data?.quote === "string" ? res.data.quote : void 0,
    replies
  };
}
async function findCommentViaList(client, target, commentId) {
  let pageToken;
  for (let page = 0; page < 10; page++) {
    const res = await client.drive.v1.fileComment.list({
      params: {
        file_type: target.fileType,
        page_size: 100,
        ...pageToken ? { page_token: pageToken } : {}
      },
      path: { file_token: target.fileToken }
    });
    const items = res.data?.items ?? [];
    const hit = items.find((it) => it.comment_id === commentId);
    if (hit) {
      return {
        quote: typeof hit.quote === "string" ? hit.quote : void 0,
        replies: mapReplies(hit.reply_list?.replies)
      };
    }
    if (!res.data?.has_more || !res.data.page_token) break;
    pageToken = res.data.page_token;
  }
  return null;
}
function mapReplies(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => flattenReply(r));
}
function flattenReply(r) {
  const replyId = typeof r.reply_id === "string" ? r.reply_id : typeof r.id === "string" ? r.id : "";
  const content = r.content ?? {};
  const elements = Array.isArray(content.elements) ? content.elements : [];
  const parts = [];
  const mentions = [];
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const rec = el;
    if (rec.type === "text_run") {
      const tr = rec.text_run;
      parts.push(typeof tr?.text === "string" ? tr.text : "");
    } else if (rec.type === "at") {
      const at = rec.at;
      const openId = typeof at?.user_id === "string" ? at.user_id : void 0;
      const name = typeof at?.name === "string" ? at.name : void 0;
      const key = typeof at?.key === "string" ? at.key : "@user";
      mentions.push({ key, open_id: openId, name });
      parts.push(name ? `@${name}` : "@");
    } else if (rec.type === "docs_link") {
      const link = rec.docs_link;
      parts.push(typeof link?.url === "string" ? link.url : "");
    }
  }
  return {
    reply_id: replyId,
    user_id: typeof r.user_id === "string" ? r.user_id : void 0,
    open_id: typeof r.open_id === "string" ? r.open_id : void 0,
    text: parts.join("").trim(),
    mentions,
    raw: r
  };
}
function apiErrorCode(err) {
  const rec = err;
  return rec.response?.data?.code;
}

// src/lark/credentials.ts
import fs5 from "fs/promises";
import os2 from "os";
import path6 from "path";

// src/lark/bridge-secrets.ts
import fs4 from "fs/promises";
import path5 from "path";
var log6 = createLogger("secrets");
var SECRETS_PATH = path5.join(HOME_DIR, "secrets.json");
async function readBridgeSecrets() {
  try {
    const raw = await fs4.readFile(SECRETS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { apps: parsed.apps ?? [] };
  } catch {
    return { apps: [] };
  }
}
async function loadBridgeSecret(opts) {
  const { apps } = await readBridgeSecrets();
  if (opts.profile) {
    const byProfile = apps.find((a) => a.profile === opts.profile);
    if (byProfile) return byProfile;
  }
  if (opts.appId) {
    const byApp = apps.find((a) => a.appId === opts.appId);
    if (byApp) return byApp;
  }
  return null;
}

// src/lark/credentials.ts
var log7 = createLogger("lark.cred");
var LARK_CONFIG_PATH = path6.join(os2.homedir(), ".lark-cli", "config.json");
async function readLarkConfig() {
  try {
    const raw = await fs5.readFile(LARK_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `cannot read lark-cli config at ${LARK_CONFIG_PATH}: ${err.message}`
    );
  }
}
function resolveLarkApp(cfg, profileOrAppId) {
  const target = profileOrAppId ?? cfg.currentApp;
  const apps = cfg.apps ?? [];
  if (!apps.length) {
    throw new Error(
      "no apps registered in lark-cli config \u2014 run `lark-cli profile add` first"
    );
  }
  return apps.find((a) => a.name === target || a.appId === target) ?? apps.find((a) => a.name === cfg.currentApp || a.appId === cfg.currentApp) ?? apps[0];
}
async function loadActiveLarkCredentials(opts) {
  const cfg = await readLarkConfig();
  const match = resolveLarkApp(cfg, opts?.profileOrAppId);
  const appSecret = await readAppSecret(match, opts?.appSecretOverride);
  return {
    appId: match.appId,
    appSecret,
    brand: match.brand ?? "feishu",
    profile: match.name ?? match.appId
  };
}
async function readAppSecret(app, override) {
  if (override?.trim()) {
    log7.info(`using app secret from CLI for ${app.appId}`);
    return override.trim();
  }
  const envSecret = process.env.LARK_APP_SECRET;
  if (envSecret) {
    log7.info(`using LARK_APP_SECRET from env for ${app.appId}`);
    return envSecret;
  }
  const stored = await loadBridgeSecret({
    appId: app.appId,
    profile: app.name ?? app.appId
  });
  if (stored?.appSecret) {
    log7.info(`loaded app secret for ${app.appId} from bridge secrets file`);
    return stored.appSecret;
  }
  const secretRef = app.appSecret;
  if (secretRef?.source === "keychain" && secretRef.id) {
    const secret = readKeychainLegacy(secretRef.id);
    if (secret) {
      log7.info(`loaded app secret for ${app.appId} from macOS Keychain`);
      return secret;
    }
  }
  throw new Error(formatMissingSecretHelp(app));
}
function formatMissingSecretHelp(app) {
  const profile = app.name ?? app.appId;
  return `cannot resolve app secret for ${app.appId} (profile=${profile}).
Modern lark-cli stores secrets in an encrypted keyring (not readable via \`security\`).
Fix one of these:
  1. Re-run setup (saves secret to ~/.lark-opencode-bridge/secrets.json)
  2. Export: \`export LARK_APP_SECRET=<secret>\` from https://open.feishu.cn/app/${app.appId}/cert
  3. For configure only: \`npm run bridge -- configure --profile ${profile}\` (uses lark-cli api)
  4. Re-add profile: \`echo '<secret>' | lark-cli profile add --name ${profile} --app-id ${app.appId} --app-secret-stdin\``;
}
function readKeychainLegacy(service) {
  if (!service || process.platform !== "darwin") return null;
  const res = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8"
  });
  const out = (res.stdout || "").trim();
  if (!out) {
    if (res.stderr) log7.debug(`keychain ${service}: ${res.stderr.trim()}`);
    return null;
  }
  return out;
}
function fetchBotOpenId(opts) {
  const bin = opts.larkCliPath ?? resolveLarkCli();
  const args = ["api", "GET", "/open-apis/bot/v3/info", "--as", "bot"];
  if (opts.profile) args.unshift("--profile", opts.profile);
  const res = spawnSync(bin, args, { encoding: "utf8" });
  if (res.status !== 0) {
    log7.warn(`bot info lookup failed: ${(res.stderr || "").trim()}`);
    return null;
  }
  try {
    const parsed = JSON.parse(res.stdout);
    const data = parsed.data ?? parsed;
    const bot = data.bot ?? data;
    const openId = bot.open_id;
    if (typeof openId === "string") return openId;
  } catch (err) {
    log7.warn(`bot info parse failed: ${err.message}`);
  }
  return null;
}

// src/lark/keepalive.ts
var log8 = createLogger("lark.keepalive");
var WsKeepalive = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  timer = null;
  staleSince = null;
  start() {
    const intervalMs = this.opts.intervalMs ?? 3e4;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  tick() {
    const ch = this.opts.channel();
    if (!ch) return;
    const status = ch.getConnectionStatus();
    if (!status) return;
    const state = status.state ?? "unknown";
    const healthy = state === "connected";
    if (healthy) {
      this.staleSince = null;
      return;
    }
    const now = Date.now();
    if (!this.staleSince) {
      this.staleSince = now;
      log8.warn(`websocket unhealthy: state=${state}`);
      return;
    }
    const staleMs = this.opts.staleMs ?? 12e4;
    if (now - this.staleSince >= staleMs) {
      log8.error(`websocket stale for ${Math.round((now - this.staleSince) / 1e3)}s`);
      this.opts.onStale?.();
      this.staleSince = now;
    }
  }
};

// src/opencode/server.ts
var log9 = createLogger("opencode.srv");
var CRASH_WINDOW_MS = 5 * 6e4;
var MAX_CRASHES_PER_WINDOW = 3;
var RESTART_DELAYS_MS = [2e3, 5e3, 15e3];
var OpencodeServer = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  proc = null;
  stopped = false;
  /** True when we attached to an already-running serve (did not spawn). */
  reused = false;
  /** Timestamps of recent unexpected exits, for crash-loop detection. */
  crashes = [];
  /** Password `opencode serve` prints on stdout; needed for v2 Basic auth. */
  serverPassword = null;
  get baseUrl() {
    return `http://${this.opts.host}:${this.opts.port}`;
  }
  /** Server password captured from the child's stdout (v2 auth). */
  get password() {
    return this.serverPassword;
  }
  async start() {
    if (this.proc || this.reused) return;
    if (await this.isReachable()) {
      this.reused = true;
      log9.info(`reusing existing opencode serve at ${this.baseUrl}`);
      return;
    }
    this.spawnServe();
    await this.waitForReady();
  }
  spawnServe() {
    const bin = this.opts.opencodePath ?? "opencode";
    const args = ["serve", "--port", String(this.opts.port), "--hostname", this.opts.host];
    log9.info(`spawn ${bin} ${args.join(" ")}`);
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;
    let boot = "";
    proc.stdout.on("data", (c) => {
      const text = c.toString("utf8");
      boot += text;
      const m = boot.match(/server password (\S+)/);
      if (m && !this.serverPassword) {
        this.serverPassword = m[1];
        log9.debug(`captured opencode server password`);
      }
      log9.debug(text.replace(/server password \S+/, "server password <redacted>").trim());
    });
    proc.stderr.on("data", (c) => log9.warn(c.toString("utf8").trim()));
    proc.on("exit", (code, signal) => {
      log9.warn(`opencode serve exited (code=${code}, signal=${signal})`);
      this.proc = null;
      if (!this.stopped) this.handleUnexpectedExit();
    });
    proc.on("error", (err) => {
      log9.error(`opencode serve error: ${err.message}`);
    });
  }
  /**
   * opencode serve can be killed by the environment (OOM, or on Windows a
   * crash of the Bun runtime — e.g. endpoint-security DLLs injected into the
   * process are a known segfault cause, oven-sh/bun#20014). Restart with
   * backoff instead of taking the whole bridge down; only give up on a
   * genuine crash loop.
   */
  handleUnexpectedExit() {
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < CRASH_WINDOW_MS).concat(now);
    if (this.crashes.length >= MAX_CRASHES_PER_WINDOW) {
      log9.error(
        `opencode serve crashed ${this.crashes.length} times in ${CRASH_WINDOW_MS / 6e4} min \u2014 giving up. \u8FD9\u901A\u5E38\u662F opencode \u81EA\u8EAB\u5728\u672C\u673A\u5D29\u6E83\uFF08Windows \u4E0A\u5E38\u89C1\u8BF1\u56E0\uFF1A\u7EC8\u7AEF\u5B89\u5168/\u5BA1\u8BA1\u8F6F\u4EF6\u6CE8\u5165 DLL \u5BFC\u81F4 Bun \u6BB5\u9519\u8BEF\uFF09\u3002\u8BF7\u5148\u5355\u72EC\u8FD0\u884C \`opencode serve\` \u786E\u8BA4\u80FD\u7A33\u5B9A\u542F\u52A8\u3002`
      );
      process.exit(1);
    }
    const delay = RESTART_DELAYS_MS[Math.min(this.crashes.length - 1, RESTART_DELAYS_MS.length - 1)];
    log9.warn(`opencode serve died unexpectedly \u2014 restarting in ${delay / 1e3}s (attempt ${this.crashes.length}/${MAX_CRASHES_PER_WINDOW})`);
    setTimeout(() => {
      if (this.stopped) return;
      this.spawnServe();
      void this.waitForReady().then(() => log9.info("opencode serve restarted")).catch((err) => log9.error(`opencode serve restart failed: ${err.message}`));
    }, delay).unref();
  }
  stop() {
    this.stopped = true;
    if (this.reused) return;
    if (this.proc && !this.proc.killed) {
      if (process.platform === "win32" && this.proc.pid) {
        spawnSync("taskkill", ["/pid", String(this.proc.pid), "/t", "/f"], { stdio: "ignore" });
      } else {
        this.proc.kill("SIGTERM");
      }
    }
    this.proc = null;
  }
  async isReachable() {
    try {
      const res = await fetch(`${this.baseUrl}/doc`, { signal: AbortSignal.timeout(2e3) });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }
  async waitForReady() {
    const deadline = Date.now() + (this.opts.readyTimeoutMs ?? 15e3);
    while (Date.now() < deadline) {
      if (await this.isReachable()) {
        log9.info(`opencode serve ready at ${this.baseUrl}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(
      `opencode serve did not become ready at ${this.baseUrl} (is port ${this.opts.port} in use?)`
    );
  }
};

// src/opencode/v2.ts
var log10 = createLogger("opencode.v2");
function mapPath(v1Path, method = "GET") {
  const [pathOnly, query] = splitQuery(v1Path);
  const q = query ? `?${query}` : "";
  const m = pathOnly.match(/^\/session\/([^/]+)\/(.+)$/);
  if (m) {
    const [, id, rest] = m;
    const base = `/session/${id}`;
    switch (rest) {
      case "abort":
        return `/api${base}/interrupt`;
      case "summarize":
        return `/api${base}/compact${q}`;
      case "revert":
        return `/api${base}/revert/stage`;
      case "unrevert":
        return `/api${base}/revert/clear`;
      case "message":
      case "prompt":
      case "prompt_async":
        return `/api${base}/${method === "POST" ? "prompt" : "message"}${q}`;
      case "init":
      case "share":
        return null;
      // no v2 equivalent
      default:
        return `/api${base}/${rest}${q}`;
    }
  }
  if (pathOnly === "/session") return `/api/session${q}`;
  if (pathOnly === "/session-status") return `/api/session/active${q}`;
  if (pathOnly === "/agent") return `/api/agent${q}`;
  if (pathOnly === "/config/providers") return `/api/model${q}`;
  if (pathOnly === "/event") return `/api/event${q}`;
  if (pathOnly === "/doc") return `/doc${q}`;
  if (pathOnly.startsWith("/permission/")) return null;
  return `/api${pathOnly}${q}`;
}
function splitQuery(p) {
  const i = p.indexOf("?");
  return i === -1 ? [p, ""] : [p.slice(0, i), p.slice(i + 1)];
}
function unwrapData(json) {
  if (json && typeof json === "object" && "data" in json) {
    return json.data;
  }
  return json;
}
var str = (v) => typeof v === "string" ? v : void 0;
function normalizeSessions(json) {
  const data = unwrapData(json);
  if (!Array.isArray(data)) return [];
  return data.map((s) => {
    const o = s ?? {};
    const loc = o.location ?? {};
    return { id: str(o.id), title: str(o.title), directory: str(loc.directory) };
  });
}
function normalizeSession(json) {
  const o = unwrapData(json) ?? {};
  const loc = o.location ?? {};
  return { id: str(o.id), title: str(o.title), directory: str(loc.directory) };
}
function normalizeAgents(json) {
  const data = unwrapData(json);
  if (!Array.isArray(data)) return [];
  return data.map((a) => {
    const o = a ?? {};
    return {
      name: str(o.id) ?? str(o.name),
      mode: str(o.mode) ?? "primary",
      description: str(o.description) ?? str(o.name)
    };
  });
}
function normalizeProviders(json) {
  const data = unwrapData(json);
  if (!Array.isArray(data)) return { providers: [], default: {} };
  const byProvider = /* @__PURE__ */ new Map();
  for (const raw of data) {
    const m = raw ?? {};
    const pid = str(m.providerID) ?? "unknown";
    const mid = str(m.modelID) ?? str(m.id);
    if (!mid) continue;
    let p = byProvider.get(pid);
    if (!p) {
      p = { id: pid, name: pid, models: {} };
      byProvider.set(pid, p);
    }
    p.models[mid] = { id: mid, name: str(m.name) ?? mid };
  }
  return { providers: [...byProvider.values()], default: {} };
}
function toV1Message(m) {
  const parts = [];
  const type = str(m.type);
  if (type === "user") {
    if (typeof m.text === "string") parts.push({ type: "text", text: m.text });
  } else if (Array.isArray(m.content)) {
    for (const c of m.content) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "text") parts.push({ type: "text", text: str(c.text) ?? "" });
      else if (c.type === "tool") {
        parts.push({ type: "tool", tool: str(c.name), state: { status: str(c.status), input: c.input } });
      }
    }
  }
  return { info: { id: str(m.id), role: type, time: m.time }, parts };
}
function normalizeMessages(json) {
  const data = unwrapData(json);
  if (!Array.isArray(data)) return [];
  return data.map((m) => toV1Message(m ?? {}));
}
function part(sessionID, messageID, partID, partBody, extra) {
  return {
    type: "message.part.updated",
    properties: {
      part: { id: partID, sessionID, messageID, ...partBody },
      ...extra ?? {}
    }
  };
}
function translateV2Event(ev) {
  const t = str(ev?.type);
  const d = ev?.data ?? {};
  if (!t) return [];
  switch (t) {
    case "server.connected":
      return [{ type: "server.connected", properties: {} }];
    case "session.step.started":
      return d.assistantMessageID ? [
        {
          type: "message.updated",
          properties: {
            info: { id: d.assistantMessageID, sessionID: d.sessionID, role: "assistant" }
          }
        }
      ] : [];
    case "session.inbox.enqueued": {
      const item = d.item ?? {};
      return item.type === "user" && d.inboxID ? [
        {
          type: "message.updated",
          properties: { info: { id: d.inboxID, sessionID: d.sessionID, role: "user" } }
        }
      ] : [];
    }
    case "session.execution.started":
      return [{ type: "session.status", properties: { sessionID: d.sessionID, status: { type: "busy" } } }];
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return [{ type: "session.status", properties: { sessionID: d.sessionID, status: { type: "idle" } } }];
    case "session.execution.failed": {
      const err = d.error ?? {};
      const msg = str(err.message) ?? str(d.message) ?? "execution failed";
      return [
        { type: "session.error", properties: { sessionID: d.sessionID, error: { message: msg } } },
        { type: "session.status", properties: { sessionID: d.sessionID, status: { type: "idle" } } }
      ];
    }
    case "session.text.delta":
      return [
        part(d.sessionID, d.assistantMessageID, `text-${d.ordinal ?? 0}`, { type: "text" }, {
          delta: str(d.delta) ?? ""
        })
      ];
    case "session.reasoning.delta":
      return [
        part(d.sessionID, d.assistantMessageID, `reasoning-${d.ordinal ?? 0}`, { type: "reasoning" }, {
          delta: str(d.delta) ?? ""
        })
      ];
    case "session.tool.called":
      return [
        part(d.sessionID, d.assistantMessageID, String(d.id), {
          type: "tool",
          tool: d.name,
          state: { status: "running", input: d.input }
        })
      ];
    case "session.tool.success":
      return [
        part(d.sessionID, d.assistantMessageID, String(d.id), {
          type: "tool",
          tool: d.name,
          state: { status: "completed" },
          text: contentToText(d.content)
        })
      ];
    case "session.tool.failed": {
      const err = d.error ?? {};
      return [
        part(d.sessionID, d.assistantMessageID, String(d.id), {
          type: "tool",
          tool: d.name,
          state: { status: "error" },
          text: str(err.message) ?? contentToText(d.content)
        })
      ];
    }
    default:
      if (/permission/i.test(t) && (d.sessionID || d.id || d.requestID)) {
        return [
          {
            type: "permission.asked",
            properties: {
              sessionID: d.sessionID,
              id: d.id ?? d.requestID ?? d.permissionID,
              permission: d.permission ?? d.name ?? d.type ?? "permission"
            }
          }
        ];
      }
      if (t !== "project.updated" && t !== "session.usage.updated") {
        if (!BENIGN_V2_EVENTS.has(t)) log10.debug(`untranslated v2 event: ${t}`);
      }
      return [];
  }
}
function contentToText(content) {
  if (!Array.isArray(content)) return "";
  return content.filter((c) => c && c.type === "text" && typeof c.text === "string").map((c) => c.text).join("");
}
var BENIGN_V2_EVENTS = /* @__PURE__ */ new Set([
  "mcp.status.changed",
  "mcp.resources.changed",
  "mcp.tools.changed",
  "integration.updated",
  "provider.updated",
  "model.updated",
  "vcs.branch.updated",
  "agent.updated",
  "command.updated",
  "skill.updated",
  "plugin.updated",
  "websearch.updated",
  "reference.updated",
  "session.instructions.updated",
  "session.inbox.delivered",
  "session.step.streamed",
  "session.step.ended",
  "session.text.started",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.ended",
  "session.usage.updated",
  "project.updated"
]);
async function detectApiVersion(baseUrl, password) {
  const headers = {};
  if (password) {
    headers.authorization = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
  }
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const api = await fetch(`${baseUrl}/api/session`, {
        headers,
        signal: AbortSignal.timeout(3e3)
      });
      if (api.status !== 404) return "v2";
      const legacy = await fetch(`${baseUrl}/session`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3e3)
      });
      const type = legacy.headers.get("content-type") ?? "";
      if (legacy.ok && type.includes("json")) return "v1";
      lastError = new Error(`inconclusive: /api/session=${api.status} /session=${legacy.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `cannot determine the opencode API version at ${baseUrl} (${lastError?.message ?? lastError}). Set "opencodeApiVersion" to "v1" or "v2" to skip detection.`
  );
}

// src/opencode/client.ts
var log11 = createLogger("opencode.cli");
var SessionNotFoundError = class extends Error {
  constructor(sessionId) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
};
var OpencodeClient = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  /**
   * List all opencode sessions visible to this server (the cwd-scoped
   * `GET /session`, not the cross-project `/experimental/session`).
   */
  async listSessions() {
    const res = await this.fetchJson("GET", "/session");
    if (!Array.isArray(res)) return [];
    const out = [];
    for (const s of res) {
      if (!s || typeof s !== "object") continue;
      const id = pickString3(s, ["id"]);
      if (!id) continue;
      out.push({
        id,
        title: pickString3(s, ["title"]),
        directory: pickString3(s, ["directory"])
      });
    }
    return out;
  }
  /** List available agents (`GET /agent`). */
  async listAgents() {
    const res = await this.fetchJson("GET", "/agent");
    if (!Array.isArray(res)) return [];
    const out = [];
    for (const a of res) {
      if (!a || typeof a !== "object") continue;
      const name = pickString3(a, ["name"]);
      if (!name) continue;
      out.push({
        name,
        mode: pickString3(a, ["mode"]),
        description: pickString3(a, ["description"])
      });
    }
    return out;
  }
  /**
   * Compact (a.k.a. `/summarize` in the TUI) the given session. opencode
   * requires the provider/model to use for the summary pass — we resolve it
   * from the chat's current model selection.
   */
  async summarizeSession(sessionId, model) {
    await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/summarize`,
      { providerID: model.providerID, modelID: model.modelID }
    );
  }
  /**
   * Initialise (or refresh) AGENTS.md for the session's cwd. Returns the
   * messageID we asked the server to anchor against, so the caller can show
   * progress / poll for completion.
   */
  async initSession(sessionId, model, messageID) {
    await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/init`,
      { providerID: model.providerID, modelID: model.modelID, messageID }
    );
  }
  /** Create a public share link for the session; returns the URL when known. */
  async shareSession(sessionId) {
    const res = await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/share`
    );
    return extractShareUrl(res);
  }
  /** Remove the share link. */
  async unshareSession(sessionId) {
    await this.fetchJson(
      "DELETE",
      `/session/${encodeURIComponent(sessionId)}/share`
    );
  }
  /**
   * Revert (undo) the most recent user message. opencode requires the
   * messageID of the message we want to roll back to — we look it up via
   * `/session/{id}/message` and use the last user message.
   */
  async revertSession(sessionId, messageID) {
    await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/revert`,
      { messageID }
    );
  }
  /** Restore all previously reverted messages. */
  async unrevertSession(sessionId) {
    await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/unrevert`
    );
  }
  /**
   * Pull the message list for a session, used by `/undo` to find the latest
   * user message id.
   */
  async listMessages(sessionId) {
    const res = await this.fetchJson(
      "GET",
      `/session/${encodeURIComponent(sessionId)}/message`
    );
    if (!Array.isArray(res)) return [];
    const out = [];
    for (const item of res) {
      if (!item || typeof item !== "object") continue;
      const info = item.info;
      const target = info && typeof info === "object" ? info : item;
      const id = pickString3(target, ["id"]);
      const role = pickString3(target, ["role"]);
      if (!id) continue;
      out.push({ id, role });
    }
    return out;
  }
  async createSession(title, directory) {
    const search = directory ? `?directory=${encodeURIComponent(directory)}` : "";
    const body = title ? { title } : {};
    const res = await this.fetchJson("POST", `/session${search}`, body);
    const id = pickString3(res, ["id"]);
    if (!id) {
      throw new Error(
        `opencode createSession: no id in response: ${JSON.stringify(res).slice(0, 300)}`
      );
    }
    return {
      id,
      title: pickString3(res, ["title"]),
      directory: pickString3(res, ["directory"])
    };
  }
  async deleteSession(id) {
    await this.fetchJson("DELETE", `/session/${encodeURIComponent(id)}`);
  }
  async abortSession(id) {
    try {
      await this.fetchJson("POST", `/session/${encodeURIComponent(id)}/abort`);
    } catch (err) {
      log11.warn(`abort failed: ${err.message}`);
    }
  }
  /**
   * Enumerate the providers and models opencode currently has configured.
   * Maps to `GET /config/providers`, whose response is:
   *
   * ```json
   * {
   *   "providers": [
   *     { "id": "ccapi", "name": "ccapiv1",
   *       "models": { "qwen3.7-max": { "id": "qwen3.7-max", "name": "qwen3.7-max" } } }
   *   ],
   *   "default": { "ccapi": "qwen3.7-max" }
   * }
   * ```
   */
  async listProviders() {
    const res = await this.fetchJson("GET", "/config/providers");
    if (!res || typeof res !== "object") return [];
    const obj = res;
    const rawProviders = Array.isArray(obj.providers) ? obj.providers : [];
    const defaults = obj.default && typeof obj.default === "object" ? obj.default : {};
    const result = [];
    for (const p of rawProviders) {
      if (!p || typeof p !== "object") continue;
      const provider = p;
      const id = typeof provider.id === "string" ? provider.id : void 0;
      if (!id) continue;
      const name = typeof provider.name === "string" ? provider.name : id;
      const modelsField = provider.models && typeof provider.models === "object" ? provider.models : {};
      const models = [];
      for (const [modelKey, m] of Object.entries(modelsField)) {
        if (!m || typeof m !== "object") {
          models.push({ id: modelKey, name: modelKey });
          continue;
        }
        const mi = m;
        const modelId = typeof mi.id === "string" ? mi.id : modelKey;
        const modelName = typeof mi.name === "string" ? mi.name : modelId;
        models.push({ id: modelId, name: modelName });
      }
      models.sort((a, b) => a.id.localeCompare(b.id));
      const def = defaults[id];
      result.push({
        id,
        name,
        models,
        defaultModelId: typeof def === "string" ? def : void 0
      });
    }
    result.sort((a, b) => a.id.localeCompare(b.id));
    return result;
  }
  /**
   * Answer a pending permission request. Leave `directory` unset for the global
   * permission queue emitted by `/event`; it may not be scoped to the session cwd.
   */
  async replyPermission(requestID, reply, directory) {
    if (this.opts.apiVersion === "v2") {
      const list = await this.fetchJson("GET", "/permission/request");
      const hit = (list ?? []).find(
        (x) => x?.id === requestID || x?.requestID === requestID
      );
      const sid = typeof hit?.sessionID === "string" ? hit.sessionID : void 0;
      if (!sid) throw new Error(`permission ${requestID} not found`);
      await this.fetchJson(
        "POST",
        `/session/${encodeURIComponent(sid)}/permission/${encodeURIComponent(requestID)}/reply`,
        { decision: reply }
      );
      return;
    }
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : "";
    await this.fetchJson(
      "POST",
      `/permission/${encodeURIComponent(requestID)}/reply${qs}`,
      { reply }
    );
  }
  async prompt(o) {
    if (this.opts.apiVersion === "v2") return this.promptV2(o, true);
    const body = this.buildPromptBody(o);
    const path10 = `/session/${encodeURIComponent(o.sessionId)}/message`;
    const res = await this.fetchJson("POST", path10, body, o.signal);
    return { text: extractText(res), raw: res };
  }
  /**
   * Kick off a prompt without holding the HTTP connection open for the
   * lifetime of the run. opencode returns 204 immediately. Callers should
   * watch SSE `/event` for `session.status: idle` to know when the run is
   * complete. Use this for card-mode streaming so a long-running prompt
   * (e.g. one that triggers the `question` tool) doesn't blow Node fetch's
   * default 5-minute idle timeout.
   */
  async promptAsync(o) {
    if (this.opts.apiVersion === "v2") {
      await this.promptV2(o, false);
      return;
    }
    const body = this.buildPromptBody(o);
    const path10 = `/session/${encodeURIComponent(o.sessionId)}/prompt_async`;
    await this.fetchJson("POST", path10, body, o.signal);
  }
  /**
   * v2 has no synchronous prompt and no `prompt_async`: everything is admitted
   * through the same endpoint and model/agent are session-scoped, so we apply
   * them first. When `awaitReply`, wait for the turn to finish (v2 emits a
   * `type:"idle"` message) and return the last assistant message that has text —
   * a turn is several assistant messages and tool-only steps carry no text.
   */
  async promptV2(o, awaitReply) {
    const sid = encodeURIComponent(o.sessionId);
    const agent = o.agent ?? this.opts.agent;
    const model = parseModel(o.model ?? this.opts.model);
    if (model) {
      await this.fetchJson("POST", `/session/${sid}/model`, {
        model: { id: model.modelID, providerID: model.providerID }
      });
    }
    if (agent) await this.fetchJson("POST", `/session/${sid}/agent`, { agent });
    const watermark = await this.messageWatermark(o.sessionId);
    await this.fetchJson("POST", `/session/${sid}/message`, { parts: o.parts }, o.signal);
    if (!awaitReply) return { text: "", raw: void 0 };
    const deadline = Date.now() + (this.opts.requestTimeoutMs ?? 20 * 6e4);
    let last;
    let sawActive = false;
    while (Date.now() < deadline) {
      await sleep(700);
      const msgs = await this.fetchJson("GET", `/session/${sid}/message`);
      const fresh = (msgs ?? []).filter((m) => (m?.info?.time?.created ?? 0) > watermark);
      const withText = fresh.filter((m) => extractText(m).trim());
      if (withText.length) last = withText[withText.length - 1];
      if (fresh.some((m) => m?.info?.role === "idle")) break;
      let active = false;
      try {
        const a = await this.fetchJson("GET", "/session-status");
        active = Boolean(a?.[o.sessionId]);
      } catch {
      }
      if (active) sawActive = true;
      else if (sawActive) {
        log11.warn(`run for ${o.sessionId} left the active set without idle \u2014 returning partial`);
        break;
      }
    }
    return { text: last ? extractText(last) : "", raw: last };
  }
  /** Highest `time.created` currently visible for a session (v2 turn watermark). */
  async messageWatermark(sessionId) {
    const msgs = await this.fetchJson(
      "GET",
      `/session/${encodeURIComponent(sessionId)}/message`
    );
    let max = 0;
    for (const m of msgs ?? []) max = Math.max(max, m?.info?.time?.created ?? 0);
    return max;
  }
  buildPromptBody(o) {
    const body = { parts: o.parts };
    const agent = o.agent ?? this.opts.agent;
    const model = parseModel(o.model ?? this.opts.model);
    if (agent) body.agent = agent;
    if (model) body.model = model;
    if (o.tools) body.tools = o.tools;
    return body;
  }
  async fetchJson(method, path10, body, signal) {
    const v2 = this.opts.apiVersion === "v2";
    const wirePath = v2 ? mapPath(path10, method) : path10;
    if (wirePath === null) {
      throw new Error(`opencode v2 has no equivalent for ${method} ${path10}`);
    }
    const url = `${this.opts.baseUrl}${wirePath}`;
    const headers = { "content-type": "application/json" };
    if (v2 && this.opts.password) {
      headers.authorization = "Basic " + Buffer.from(`opencode:${this.opts.password}`).toString("base64");
    }
    const init = { method, headers };
    if (body !== void 0) init.body = JSON.stringify(v2 ? adaptBody(path10, method, body) : body);
    if (signal) {
      init.signal = signal;
    } else if (this.opts.requestTimeoutMs) {
      init.signal = AbortSignal.timeout(this.opts.requestTimeoutMs);
    }
    log11.debug(`${method} ${path10}${v2 ? ` \u2192 ${wirePath}` : ""}`);
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 404 && text.includes("Session not found")) {
        throw new SessionNotFoundError(path10);
      }
      throw new Error(
        `opencode ${method} ${path10} failed: ${res.status} ${res.statusText} \u2014 ${text.slice(0, 400)}`
      );
    }
    if (!text.trim()) return {};
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { _rawText: text };
    }
    return v2 ? normalizeResponse(path10, method, json) : json;
  }
};
function adaptBody(v1Path, method, body) {
  const [pathOnly, query] = v1Path.split("?");
  const b = body ?? {};
  if (method === "POST" && pathOnly === "/session") {
    const out = { ...b };
    const dir = query ? new URLSearchParams(query).get("directory") : null;
    if (dir && !out.location) out.location = { directory: dir };
    return out;
  }
  if (method === "POST" && /\/message$/.test(pathOnly) && Array.isArray(b.parts)) {
    return { text: promptPartsToText(b.parts) };
  }
  if (method === "POST" && /\/revert$/.test(pathOnly)) return { messageID: b.messageID };
  return body;
}
function promptPartsToText(parts) {
  return parts.filter((p) => p && p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n");
}
function normalizeResponse(v1Path, method, json) {
  const [pathOnly] = v1Path.split("?");
  if (method === "GET" && pathOnly === "/session") return normalizeSessions(json);
  if (method === "POST" && pathOnly === "/session") return normalizeSession(json);
  if (method === "GET" && pathOnly === "/agent") return normalizeAgents(json);
  if (method === "GET" && pathOnly === "/config/providers") return normalizeProviders(json);
  if (method === "GET" && /^\/session\/[^/]+\/message$/.test(pathOnly)) {
    return normalizeMessages(json);
  }
  return unwrapData(json);
}
function parseModel(input2) {
  if (!input2) return void 0;
  const idx = input2.indexOf("/");
  if (idx <= 0 || idx === input2.length - 1) {
    throw new Error(`invalid model "${input2}" \u2014 expected "providerID/modelID"`);
  }
  return { providerID: input2.slice(0, idx), modelID: input2.slice(idx + 1) };
}
function extractShareUrl(res) {
  if (!res || typeof res !== "object") return void 0;
  const r = res;
  if (r.share && typeof r.share === "object") {
    const u = r.share.url;
    if (typeof u === "string") return u;
  }
  if (typeof r.url === "string") return r.url;
  return void 0;
}
function pickString3(obj, path10) {
  let cur = obj;
  for (const key of path10) {
    if (cur && typeof cur === "object" && key in cur) {
      cur = cur[key];
    } else {
      return void 0;
    }
  }
  return typeof cur === "string" ? cur : void 0;
}
function extractText(res) {
  if (!res || typeof res !== "object") return "";
  const partsField = res.parts;
  if (!Array.isArray(partsField)) return "";
  const buckets = [];
  for (const part2 of partsField) {
    if (part2 && typeof part2 === "object" && part2.type === "text" && typeof part2.text === "string") {
      buckets.push(part2.text);
    }
  }
  return buckets.join("").trim();
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/opencode/events.ts
import { EventEmitter } from "events";
var log12 = createLogger("opencode.evt");
var OpencodeEventStream = class extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
  }
  opts;
  controller = new AbortController();
  closed = false;
  async start() {
    const v2 = this.opts.apiVersion === "v2";
    const url = `${this.opts.baseUrl}${v2 ? "/api/event" : "/event"}`;
    const headers = { accept: "text/event-stream" };
    if (v2 && this.opts.password) {
      headers.authorization = "Basic " + Buffer.from(`opencode:${this.opts.password}`).toString("base64");
    }
    log12.debug(`SSE \u2192 ${url} (session=${this.opts.sessionID ?? "*"})`);
    const res = await fetch(url, {
      headers,
      signal: this.controller.signal
    });
    if (!res.ok || !res.body) {
      throw new Error(`opencode SSE ${url} failed: ${res.status} ${res.statusText}`);
    }
    void this.pump(res.body);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
  }
  async pump(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf8");
    let buffer = "";
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleBlock(block);
        }
      }
    } catch (err) {
      if (!this.closed) {
        const msg = err?.message ?? String(err);
        log12.warn(`SSE pump error: ${msg}`);
        this.emit("event", { kind: "error", message: msg });
      }
    } finally {
      this.emit("close");
    }
  }
  handleBlock(block) {
    const lines = block.split("\n");
    let dataLine = null;
    for (const raw of lines) {
      const line = raw.replace(/^\r$|\r$/g, "");
      if (line.startsWith("data:")) {
        dataLine = (dataLine ?? "") + line.slice(5).trimStart();
      }
    }
    if (!dataLine) return;
    if (dataLine === "[DONE]") return;
    let envelope;
    try {
      envelope = JSON.parse(dataLine);
    } catch {
      log12.debug(`non-JSON SSE: ${dataLine.slice(0, 100)}`);
      return;
    }
    const envelopes = this.opts.apiVersion === "v2" ? translateV2Event(envelope) : [envelope];
    for (const env of envelopes) {
      this.handleEnvelope(env);
    }
  }
  handleEnvelope(envelope) {
    this.emit("raw", envelope);
    const norm = normalize(envelope);
    if (!norm) return;
    if (!this.opts.noFilter && this.opts.sessionID && !this.matchesSession(norm)) {
      return;
    }
    this.emit("event", norm);
  }
  matchesSession(evt) {
    const target = this.opts.sessionID;
    if (!target) return true;
    switch (evt.kind) {
      case "message":
      case "part":
      case "status":
      case "permission":
        return evt.sessionID === target;
      case "error":
        return !evt.sessionID || evt.sessionID === target;
      case "connected":
      case "raw":
        return true;
    }
  }
};
function normalize(env) {
  if (env.type === "server.connected") return { kind: "connected" };
  if (env.type === "message.updated") {
    const info = env.properties.info;
    if (!info) return null;
    const sessionID = typeof info.sessionID === "string" ? info.sessionID : void 0;
    const messageID = typeof info.id === "string" ? info.id : void 0;
    const role = typeof info.role === "string" ? info.role : void 0;
    if (!sessionID || !messageID || !role) return null;
    return { kind: "message", sessionID, messageID, role };
  }
  if (env.type === "session.status") {
    const sessionID = pickString4(env.properties, ["sessionID"]);
    const status = pickString4(env.properties, ["status", "type"]) ?? pickString4(env.properties, ["status"]) ?? "unknown";
    if (!sessionID) return null;
    return { kind: "status", sessionID, status };
  }
  if (env.type === "session.error" || env.type === "error") {
    const sessionID = pickString4(env.properties, ["sessionID"]);
    const message = pickString4(env.properties, ["error", "message"]) ?? pickString4(env.properties, ["message"]) ?? JSON.stringify(env.properties).slice(0, 200);
    return { kind: "error", sessionID, message };
  }
  if (env.type === "permission.asked") {
    const props = env.properties;
    const sessionID = typeof props.sessionID === "string" ? props.sessionID : void 0;
    const requestID = typeof props.id === "string" ? props.id : void 0;
    const permission = typeof props.permission === "string" ? props.permission : "(unknown)";
    log12.info(`permission.asked: requestID=${requestID} permission=${permission}`);
    if (!sessionID || !requestID) return null;
    return { kind: "permission", sessionID, requestID };
  }
  if (env.type === "message.part.updated") {
    const part2 = env.properties.part;
    if (!part2) return null;
    const sessionID = typeof part2.sessionID === "string" ? part2.sessionID : void 0;
    const messageID = typeof part2.messageID === "string" ? part2.messageID : void 0;
    const partID = typeof part2.id === "string" ? part2.id : void 0;
    const partType = typeof part2.type === "string" ? part2.type : void 0;
    if (!sessionID || !messageID || !partID || !partType) return null;
    const state = part2.state && typeof part2.state === "object" ? part2.state : void 0;
    const toolInput = state?.input ?? part2.input ?? part2.args ?? part2.params;
    return {
      kind: "part",
      sessionID,
      messageID,
      partID,
      partType,
      text: typeof part2.text === "string" ? part2.text : void 0,
      delta: pickString4(env.properties, ["delta"]),
      toolName: pickString4(part2, ["tool"]),
      toolState: pickString4(part2, ["state", "status"]) ?? pickString4(part2, ["state"]),
      toolInput: toolInput && typeof toolInput === "object" ? toolInput : void 0
    };
  }
  return { kind: "raw", envelope: env };
}
function pickString4(obj, path10) {
  let cur = obj;
  for (const key of path10) {
    if (cur && typeof cur === "object" && key in cur) {
      cur = cur[key];
    } else {
      return void 0;
    }
  }
  return typeof cur === "string" ? cur : void 0;
}

// src/session.ts
import fs6 from "fs/promises";
var EMPTY = { sessions: {}, cwds: {}, spawned: {} };
var SessionStore = class {
  state = EMPTY;
  loaded = false;
  writeQueue = Promise.resolve();
  async load() {
    if (this.loaded) return;
    await ensureHome();
    try {
      const raw = await fs6.readFile(SESSIONS_PATH, "utf8");
      const parsed = JSON.parse(raw);
      this.state = {
        sessions: parsed.sessions ?? {},
        cwds: parsed.cwds ?? {},
        spawned: parsed.spawned ?? {}
      };
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
      this.state = { sessions: {}, cwds: {}, spawned: {} };
    }
    this.loaded = true;
  }
  getSession(chatId) {
    return this.state.sessions[chatId];
  }
  setSession(chatId, sessionId) {
    this.state.sessions[chatId] = sessionId;
    this.flush();
  }
  clearSession(chatId) {
    delete this.state.sessions[chatId];
    this.flush();
  }
  getCwd(chatId) {
    return this.state.cwds[chatId];
  }
  setCwd(chatId, cwd) {
    this.state.cwds[chatId] = cwd;
    this.flush();
  }
  clearCwd(chatId) {
    delete this.state.cwds[chatId];
    this.flush();
  }
  /** True if the chat was created via `/spawn` and is bridge-managed. */
  isSpawned(chatId) {
    return Object.prototype.hasOwnProperty.call(this.state.spawned, chatId);
  }
  getSpawnedMeta(chatId) {
    return this.state.spawned[chatId];
  }
  markSpawned(chatId, meta = {}) {
    this.state.spawned[chatId] = { ...this.state.spawned[chatId], ...meta };
    this.flush();
  }
  setSpawnedTitleSynced(chatId, synced) {
    if (!this.state.spawned[chatId]) return;
    this.state.spawned[chatId].titleSynced = synced;
    this.flush();
  }
  flush() {
    const snapshot = JSON.stringify(this.state, null, 2) + "\n";
    this.writeQueue = this.writeQueue.then(() => fs6.writeFile(SESSIONS_PATH, snapshot, "utf8")).catch(() => void 0);
  }
};

// src/workspace.ts
import fs7 from "fs/promises";
import path7 from "path";
var EMPTY2 = { workspaces: {} };
var WorkspaceStore = class {
  state = EMPTY2;
  loaded = false;
  writeQueue = Promise.resolve();
  async load() {
    if (this.loaded) return;
    await ensureHome();
    try {
      const raw = await fs7.readFile(WORKSPACES_PATH, "utf8");
      const parsed = JSON.parse(raw);
      this.state = { workspaces: parsed.workspaces ?? {} };
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
      this.state = { workspaces: {} };
    }
    this.loaded = true;
  }
  list() {
    return Object.entries(this.state.workspaces).map(([name, info]) => ({ name, ...info })).sort((a, b) => a.name.localeCompare(b.name));
  }
  get(name) {
    const entry = this.state.workspaces[name];
    return entry ? { name, ...entry } : void 0;
  }
  save(name, dir) {
    const resolved = path7.resolve(dir);
    const next = {
      path: resolved,
      createdAt: this.state.workspaces[name]?.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
    };
    this.state.workspaces[name] = next;
    this.flush();
    return { name, ...next };
  }
  remove(name) {
    if (!(name in this.state.workspaces)) return false;
    delete this.state.workspaces[name];
    this.flush();
    return true;
  }
  flush() {
    const snapshot = JSON.stringify(this.state, null, 2) + "\n";
    this.writeQueue = this.writeQueue.then(() => fs7.writeFile(WORKSPACES_PATH, snapshot, "utf8")).catch(() => void 0);
  }
};
var NAME_RE = /^[A-Za-z0-9._-]{1,40}$/;
function validateWorkspaceName(name) {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `invalid workspace name "${name}" \u2014 use 1\u201340 chars of letters/digits/._-`
    );
  }
}

// src/slash.ts
var ALIASES = {
  clear: "new",
  summarize: "compact",
  resume: "sessions",
  continue: "sessions",
  model: "models",
  agent: "agents",
  ws: "workspaces",
  group: "spawn",
  \u62C9\u7FA4: "spawn"
};
var CANONICAL = /* @__PURE__ */ new Set([
  "help",
  "new",
  "init",
  "sessions",
  "models",
  "agents",
  "compact",
  "share",
  "unshare",
  "undo",
  "redo",
  "cd",
  "status",
  "stop",
  "spawn",
  "workspaces",
  "reconnect",
  "timeout",
  "doctor",
  "config"
]);
function parseSlashLine(input2) {
  const trimmed = input2.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  if (!body) return null;
  const [head, ...rest] = body.split(/\s+/);
  if (!head) return null;
  const lower = head.toLowerCase();
  const canonical = ALIASES[lower] ?? (CANONICAL.has(lower) ? lower : null);
  if (!canonical) return null;
  return { name: canonical, rawName: lower, args: rest, raw: trimmed };
}
function parseSlash(input2) {
  const trimmed = input2.trim();
  if (!trimmed) return null;
  const direct = parseSlashLine(trimmed);
  if (direct) return direct;
  const lines = trimmed.split(/\n+/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const hit = parseSlashLine(lines[i] ?? "");
    if (hit) return hit;
  }
  return null;
}
var HELP_TEXT = [
  "**lark-opencode-bridge** \u5E2E\u52A9\u4ECB\u7ECD",
  "",
  "**\u4F1A\u8BDD\u76F8\u5173**",
  "- `/help` \u2014\u2014 \u663E\u793A\u8FD9\u4EFD\u5E2E\u52A9",
  "- `/new` \uFF08\u522B\u540D `/clear`\uFF09\u2014\u2014 \u5F00\u4E00\u4E2A\u5168\u65B0\u4F1A\u8BDD\uFF0C\u6E05\u7A7A\u5F53\u524D\u804A\u5929\u7684\u4E0A\u4E0B\u6587",
  "- `/init` \u2014\u2014 \u8BA9 opencode \u5206\u6790\u4ED3\u5E93\u5E76\u751F\u6210 / \u66F4\u65B0\u6839\u76EE\u5F55\u7684 `AGENTS.md`",
  "- `/sessions` \uFF08\u522B\u540D `/resume`\u3001`/continue`\uFF09\u2014\u2014 \u5217\u51FA opencode \u5DF2\u6709\u4F1A\u8BDD",
  "- `/compact` \uFF08\u522B\u540D `/summarize`\uFF09\u2014\u2014 \u538B\u7F29\u5F53\u524D\u4F1A\u8BDD\u5386\u53F2\uFF0C\u4FDD\u7559\u5173\u952E\u4FE1\u606F\u3001\u91CA\u653E\u4E0A\u4E0B\u6587",
  "- `/share` \u2014\u2014 \u7ED9\u5F53\u524D\u4F1A\u8BDD\u751F\u6210\u4E00\u4E2A\u516C\u5F00\u5206\u4EAB\u94FE\u63A5\uFF08\u53EF\u53D1\u7ED9\u522B\u4EBA\u67E5\u770B\uFF09",
  "- `/unshare` \u2014\u2014 \u64A4\u9500\u4E0A\u9762\u751F\u6210\u7684\u5206\u4EAB\u94FE\u63A5",
  "- `/undo` \u2014\u2014 \u64A4\u9500\u4E0A\u4E00\u6761\u7528\u6237\u6D88\u606F\uFF0C\u8FDE\u5E26\u5B83\u4EA7\u751F\u7684\u6587\u4EF6\u6539\u52A8\u4E00\u8D77\u56DE\u6EDA",
  "- `/redo` \u2014\u2014 \u64A4\u9500 `/undo`\uFF0C\u628A\u521A\u88AB\u56DE\u6EDA\u7684\u5185\u5BB9\u518D\u6062\u590D\u56DE\u6765",
  "- `/stop` \u2014\u2014 \u4E2D\u65AD\u5F53\u524D\u6B63\u5728\u8DD1\u7684\u4EFB\u52A1\uFF08\u76F8\u5F53\u4E8E\u6309 esc\uFF09",
  "- `/reconnect` \u2014\u2014 \u624B\u52A8\u91CD\u8FDE\u98DE\u4E66 WebSocket\uFF08\u65E0\u9700\u91CD\u542F bridge\uFF09",
  "- `/timeout [\u5206\u949F]` \u2014\u2014 \u67E5\u770B\u6216\u8BBE\u7F6E\u672C\u804A\u5929\u65E0\u8F93\u51FA\u81EA\u52A8\u4E2D\u65AD\u65F6\u95F4\uFF080 = \u5173\u95ED\uFF09",
  "- `/doctor [\u63CF\u8FF0]` \u2014\u2014 \u6839\u636E\u6700\u8FD1 bridge \u65E5\u5FD7\u8BA9 opencode \u5E2E\u4F60\u81EA\u67E5\u95EE\u9898",
  "- `/config` \u2014\u2014 \u6253\u5F00\u504F\u597D\u8BBE\u7F6E\u5361\u7247\uFF08\u56DE\u590D\u65B9\u5F0F\u3001\u8BBF\u95EE\u63A7\u5236\u3001\u7FA4 @ \u7B56\u7565\u7B49\uFF09",
  "",
  "**\u6A21\u578B\u4E0E Agent**",
  "- `/models` \uFF08\u522B\u540D `/model`\uFF09\u2014\u2014 \u5217\u51FA opencode \u5F53\u524D\u53EF\u7528\u7684\u6240\u6709 provider \u548C\u6A21\u578B",
  "- `/models <provider/model>` \u2014\u2014 \u5207\u6362\u672C\u804A\u5929\u4F7F\u7528\u7684\u6A21\u578B\uFF1B\u53EA\u5199\u6A21\u578B\u540D\u65F6\u4F1A\u81EA\u52A8\u8865\u5168 provider \u524D\u7F00",
  "- `/agents` \uFF08\u522B\u540D `/agent`\uFF09\u2014\u2014 \u5217\u51FA\u53EF\u7528\u7684 agent\uFF08`build`\u3001`plan` \u7B49\uFF09",
  "- `/agents <name>` \u2014\u2014 \u5207\u6362\u672C\u804A\u5929\u4F7F\u7528\u7684 agent",
  "",
  "**\u6865\u63A5\u7279\u6709**",
  "- `/cd <\u7EDD\u5BF9\u8DEF\u5F84>` \u2014\u2014 \u628A\u672C\u804A\u5929\u7684\u5DE5\u4F5C\u76EE\u5F55\u5207\u5230\u6307\u5B9A\u8DEF\u5F84\uFF08\u4F1A\u91CD\u5EFA\u4F1A\u8BDD\uFF09",
  "- `/status` \u2014\u2014 \u67E5\u770B\u5F53\u524D\u4F1A\u8BDD id\u3001\u5DE5\u4F5C\u76EE\u5F55\u3001agent\u3001\u6A21\u578B\u7B49\u72B6\u6001",
  "- `/spawn <\u4E3B\u9898>` \uFF08\u522B\u540D `/group`\u3001`/\u62C9\u7FA4`\uFF09\u2014\u2014 \u53EA\u80FD\u5728 P2P \u79C1\u804A\u7528\uFF1B\u81EA\u52A8\u65B0\u5EFA\u4E00\u4E2A\u5E26 `[opencode]` \u524D\u7F00\u7684\u7FA4\u804A\uFF08\u4EE5\u4E3B\u9898\u4E3A\u540D\uFF09\uFF0C\u628A\u4F60\u548C\u673A\u5668\u4EBA\u62C9\u8FDB\u53BB\uFF0C\u5E76\u7ED1\u5B9A\u4E00\u4E2A\u65B0\u7684 opencode \u4F1A\u8BDD",
  "- `/workspaces` \uFF08\u522B\u540D `/ws`\uFF09\u2014\u2014 \u7BA1\u7406\u5E38\u7528\u5DE5\u4F5C\u76EE\u5F55\u7684\u5FEB\u6377\u522B\u540D",
  "  - `/workspaces list` \u2014\u2014 \u5217\u51FA\u5DF2\u4FDD\u5B58\u7684\u5DE5\u4F5C\u76EE\u5F55",
  "  - `/workspaces save <\u540D\u5B57> [\u8DEF\u5F84]` \u2014\u2014 \u628A\u5F53\u524D cwd\uFF08\u6216\u6307\u5B9A\u8DEF\u5F84\uFF09\u4FDD\u5B58\u4E3A\u4E00\u4E2A\u547D\u540D\u5DE5\u4F5C\u76EE\u5F55",
  "  - `/workspaces use <\u540D\u5B57>` \u2014\u2014 \u5207\u5230\u6307\u5B9A\u5DE5\u4F5C\u76EE\u5F55\uFF08\u4F1A\u91CD\u5EFA\u4F1A\u8BDD\uFF09",
  "  - `/workspaces rm <\u540D\u5B57>` \u2014\u2014 \u5220\u9664\u4E00\u4E2A\u4FDD\u5B58\u7684\u5DE5\u4F5C\u76EE\u5F55",
  "",
  "\u5C0F\u63D0\u793A\uFF1A\u76F4\u63A5 @ \u673A\u5668\u4EBA\u53D1\u6D88\u606F\u5C31\u662F\u666E\u901A\u5BF9\u8BDD\uFF1B\u5E26\u56FE\u7247/\u6587\u4EF6\u7684\u6D88\u606F\u4F1A\u81EA\u52A8\u4F5C\u4E3A\u9644\u4EF6\u4EA4\u7ED9 opencode\u3002"
].join("\n");

// src/card/agent-event.ts
var OpencodeAgentAdapter = class {
  textVersions = /* @__PURE__ */ new Map();
  seenTools = /* @__PURE__ */ new Set();
  sawBusy = false;
  /** messageID → role (populated by message.updated SSE events) */
  messageRoles = /* @__PURE__ */ new Map();
  /** messageID → buffered AgentEvents (role not yet known) */
  pendingParts = /* @__PURE__ */ new Map();
  translate(evt, sessionID) {
    if (evt.kind === "status") {
      if (evt.sessionID !== sessionID) return [];
      if (evt.status === "busy") {
        this.sawBusy = true;
        return [];
      }
      if (this.sawBusy && evt.status === "idle") return [{ type: "done" }];
      return [];
    }
    if (evt.kind === "error") {
      return [{ type: "error", message: evt.message ?? "unknown error" }];
    }
    if (evt.kind === "message" && evt.sessionID === sessionID) {
      this.messageRoles.set(evt.messageID, evt.role);
      if (evt.role === "assistant") {
        const buffered = this.pendingParts.get(evt.messageID) ?? [];
        this.pendingParts.delete(evt.messageID);
        return buffered;
      }
      this.pendingParts.delete(evt.messageID);
      return [];
    }
    if (evt.kind === "part" && evt.sessionID === sessionID) {
      const role = this.messageRoles.get(evt.messageID);
      if (role === void 0) {
        const translated = this.translatePart(evt);
        if (translated.length > 0) {
          const buf = this.pendingParts.get(evt.messageID) ?? [];
          buf.push(...translated);
          this.pendingParts.set(evt.messageID, buf);
        }
        return [];
      }
      if (role !== "assistant") return [];
      return this.translatePart(evt);
    }
    return [];
  }
  translatePart(evt) {
    const { partID, partType, text = "", delta, toolName, toolState } = evt;
    if (partType === "text" || partType === "reasoning") {
      let d = delta ?? "";
      if (!d) {
        const prev = this.textVersions.get(partID) ?? "";
        d = text.startsWith(prev) ? text.slice(prev.length) : text;
      }
      this.textVersions.set(partID, text);
      if (!d) return [];
      return [{ type: partType === "text" ? "text" : "thinking", delta: d }];
    }
    if (partType === "tool") {
      const events = [];
      if (!this.seenTools.has(partID)) {
        this.seenTools.add(partID);
        events.push({ type: "tool_use", id: partID, name: toolName ?? "tool", input: evt.toolInput });
      }
      const isDone = toolState === "done" || toolState === "completed" || toolState === "success";
      const isError = toolState === "error" || toolState === "failed";
      if (isDone || isError) {
        events.push({ type: "tool_result", id: partID, output: text, isError });
      }
      return events;
    }
    return [];
  }
};

// src/card/run-state.ts
var initialState = {
  blocks: [],
  reasoning: { content: "", active: false },
  footer: "thinking",
  terminal: "running"
};
function closeStreamingText(blocks) {
  return blocks.map((b) => b.kind === "text" && b.streaming ? { ...b, streaming: false } : b);
}
function reduce(state, evt) {
  switch (evt.type) {
    case "text": {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.kind === "text" && last.streaming) {
        return {
          ...state,
          blocks: [...state.blocks.slice(0, -1), { ...last, content: last.content + evt.delta }],
          reasoning: { ...state.reasoning, active: false },
          footer: "streaming"
        };
      }
      return {
        ...state,
        blocks: [...state.blocks, { kind: "text", content: evt.delta, streaming: true }],
        reasoning: { ...state.reasoning, active: false },
        footer: "streaming"
      };
    }
    case "thinking":
      return {
        ...state,
        reasoning: { content: state.reasoning.content + evt.delta, active: true },
        footer: "thinking"
      };
    case "tool_use": {
      const tool = { id: evt.id, name: evt.name, status: "running", input: evt.input };
      return {
        ...state,
        blocks: [...closeStreamingText(state.blocks), { kind: "tool", tool }],
        reasoning: { ...state.reasoning, active: false },
        footer: "tool_running"
      };
    }
    case "tool_result": {
      const blocks = state.blocks.map((b) => {
        if (b.kind !== "tool" || b.tool.id !== evt.id) return b;
        return {
          ...b,
          tool: {
            ...b.tool,
            status: evt.isError ? "error" : "done",
            output: evt.output || void 0
          }
        };
      });
      return { ...state, blocks };
    }
    case "error":
      return { ...state, terminal: "error", errorMsg: evt.message, footer: null };
    case "done":
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        terminal: "done",
        footer: null
      };
    default:
      return state;
  }
}
function markInterrupted(state) {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: "interrupted",
    footer: null
  };
}
function finalizeIfRunning(state) {
  if (state.terminal !== "running") return state;
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: "done",
    footer: null
  };
}

// src/card/tool-render.ts
var OUTPUT_MAX = 800;
function toolHeaderText(tool) {
  const suffix = tool.status === "done" ? "" : tool.status === "error" ? " \xB7 \u51FA\u9519" : " \xB7 \u8FD0\u884C\u4E2D";
  return `**${tool.name}**${suffix}`;
}
function toolBodyMd(tool) {
  if (tool.output) {
    const out = truncate(tool.output, OUTPUT_MAX);
    return tool.status === "error" ? `\`\`\`
${out}
\`\`\`` : `\`\`\`
${out}
\`\`\``;
  }
  return tool.status === "running" ? "_\u8FD0\u884C\u4E2D_" : "_\u65E0\u8F93\u51FA_";
}
function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

// src/card/run-renderer.ts
var REASONING_MAX = 1e3;
var COLLAPSE_TOOL_THRESHOLD = 3;
var TEXT_BLOCK_MAX = 8e3;
function renderCard(state, meta) {
  const elements = [];
  if (state.reasoning.content) {
    elements.push(reasoningPanel(state.reasoning.content, state.reasoning.active));
  }
  for (const group of groupBlocks(state.blocks)) {
    if (group.kind === "text") {
      if (group.content.trim()) elements.push(mdEl(truncate2(group.content, TEXT_BLOCK_MAX)));
    } else {
      elements.push(...renderToolGroup(group.tools, state.terminal !== "running"));
    }
  }
  if (state.terminal === "interrupted") {
    elements.push(noteMd("_\u5DF2\u4E2D\u65AD_"));
  } else if (state.terminal === "error" && state.errorMsg) {
    elements.push(noteMd(`_\u51FA\u9519\uFF1A${state.errorMsg}_`));
  } else if (state.terminal === "done" && elements.length === 0) {
    elements.push(noteMd("_\uFF08\u672A\u8FD4\u56DE\u5185\u5BB9\uFF09_"));
  }
  if (state.terminal === "running") {
    if (state.footer) elements.push(footerStatusEl(state.footer));
    elements.push(stopButton(meta.chatId));
  } else {
    const tags = [];
    if (meta.agent) tags.push(`agent \xB7 ${meta.agent}`);
    if (meta.model) tags.push(`model \xB7 ${meta.model}`);
    if (tags.length) {
      elements.push({ tag: "hr" });
      elements.push({ tag: "markdown", content: tags.join("    "), text_size: "notation" });
    }
  }
  return {
    schema: "2.0",
    config: {
      streaming_mode: state.terminal === "running",
      summary: { content: summaryText(state) }
    },
    body: { elements }
  };
}
function* groupBlocks(blocks) {
  let toolBuf = [];
  for (const b of blocks) {
    if (b.kind === "tool") {
      toolBuf.push(b.tool);
    } else {
      if (toolBuf.length > 0) {
        yield { kind: "tools", tools: toolBuf };
        toolBuf = [];
      }
      yield { kind: "text", content: b.content };
    }
  }
  if (toolBuf.length > 0) yield { kind: "tools", tools: toolBuf };
}
function renderToolGroup(tools, finalized) {
  if (tools.length === 0) return [];
  if (tools.length < COLLAPSE_TOOL_THRESHOLD) return tools.map((t) => toolPanel(t, false));
  if (finalized) return [collapsedToolSummary(tools)];
  const prior = tools.slice(0, -1);
  const latest = tools[tools.length - 1];
  return [...prior.length ? [collapsedToolSummary(prior)] : [], toolPanel(latest, true)];
}
function reasoningPanel(content, active) {
  return collapsiblePanel({
    title: active ? "**\u6B63\u5728\u63A8\u7406**" : "**\u601D\u8003\u8FC7\u7A0B**",
    expanded: active,
    border: "grey",
    body: truncate2(content, REASONING_MAX)
  });
}
function toolPanel(tool, expanded) {
  return collapsiblePanel({
    title: toolHeaderText(tool),
    expanded,
    border: tool.status === "error" ? "red" : "grey",
    body: toolBodyMd(tool) || "_\u65E0\u8F93\u51FA_"
  });
}
function collapsedToolSummary(tools) {
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: panelHeader(`**${tools.length} \u4E2A\u5DE5\u5177\u8C03\u7528**`),
    border: { color: "grey", corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: "8px 8px 8px 8px",
    elements: [
      {
        tag: "markdown",
        content: tools.map((t) => `- ${toolHeaderText(t)}`).join("\n"),
        text_size: "notation"
      }
    ]
  };
}
function collapsiblePanel(opts) {
  return {
    tag: "collapsible_panel",
    expanded: opts.expanded,
    header: panelHeader(opts.title),
    border: { color: opts.border, corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: "8px 8px 8px 8px",
    elements: [{ tag: "markdown", content: opts.body, text_size: "notation" }]
  };
}
function panelHeader(titleMd) {
  return {
    title: { tag: "markdown", content: titleMd },
    vertical_align: "center",
    icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
    icon_position: "follow_text",
    icon_expanded_angle: -180
  };
}
function mdEl(content) {
  return { tag: "markdown", content };
}
function noteMd(content) {
  return { tag: "markdown", content, text_size: "notation" };
}
function stopButton(chatId) {
  return {
    tag: "button",
    text: { tag: "plain_text", content: "\u7EC8\u6B62" },
    type: "danger",
    behaviors: [{ type: "callback", value: { cmd: "stop", chatId } }]
  };
}
function footerStatusEl(status) {
  const text = status === "thinking" ? "\u6B63\u5728\u601D\u8003" : status === "tool_running" ? "\u6B63\u5728\u8C03\u7528\u5DE5\u5177" : "\u6B63\u5728\u8F93\u51FA";
  return noteMd(`_${text}_`);
}
function summaryText(state) {
  if (state.terminal === "interrupted") return "\u5DF2\u4E2D\u65AD";
  if (state.terminal === "error") return "\u51FA\u9519";
  if (state.terminal === "done") return "\u5DF2\u5B8C\u6210";
  if (state.footer === "tool_running") return "\u6B63\u5728\u8C03\u7528\u5DE5\u5177";
  if (state.footer === "streaming") return "\u6B63\u5728\u8F93\u51FA";
  return "\u601D\u8003\u4E2D";
}
function truncate2(s, max) {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}

// src/lark/types.ts
function isMessageEvent(e) {
  return e.kind === "message";
}
function isCommentEvent(e) {
  return e.kind === "comment";
}

// src/core/pending-queue.ts
var log13 = createLogger("queue");
var ChatPendingQueue = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  pending = [];
  timer = null;
  flushing = false;
  enqueue(evt) {
    this.pending.push(evt);
    if (this.opts.onPreempt) this.opts.onPreempt();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.batchMs);
  }
  /** Immediately flush any pending messages (e.g. on shutdown). */
  async drain() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
  /**
   * Drop all queued messages without firing onFlush. Used on shutdown where
   * we'd rather lose a few user messages than block SIGTERM for minutes on
   * a full opencode round-trip.
   */
  discard() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const n = this.pending.length;
    this.pending = [];
    if (n) log13.info(`discarded ${n} pending message(s) on shutdown`);
  }
  get pendingCount() {
    return this.pending.length;
  }
  async flush() {
    this.timer = null;
    if (this.flushing || !this.pending.length) return;
    this.flushing = true;
    const batch = this.pending.splice(0);
    log13.info(`flushing batch of ${batch.length} message(s)`);
    try {
      await this.opts.onFlush(batch);
    } catch (err) {
      log13.error(`batch flush failed: ${err.message}`);
    } finally {
      this.flushing = false;
      if (this.pending.length) void this.flush();
    }
  }
};

// src/core/idle-watchdog.ts
var log14 = createLogger("idle");
var IdleWatchdog = class {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  lastActivity = Date.now();
  timer = null;
  active = false;
  start() {
    if (this.opts.timeoutMinutes <= 0) return;
    this.active = true;
    this.touch();
    const pollMs = this.opts.pollMs ?? 15e3;
    this.timer = setInterval(() => void this.check(), pollMs);
  }
  stop() {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  touch() {
    this.lastActivity = Date.now();
  }
  async check() {
    if (!this.active || this.opts.timeoutMinutes <= 0) return;
    const limitMs = this.opts.timeoutMinutes * 6e4;
    if (Date.now() - this.lastActivity < limitMs) return;
    log14.warn(`idle timeout (${this.opts.timeoutMinutes}m) \u2014 aborting run`);
    this.touch();
    await this.opts.onTimeout();
  }
};

// src/media/cleanup.ts
import fs8 from "fs/promises";
import path8 from "path";
var log15 = createLogger("media.cleanup");
var DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
var DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1e3;
async function pruneOldMedia(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  let removed = 0;
  try {
    const entries = await fs8.readdir(MEDIA_DIR, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeMs;
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dir = path8.join(MEDIA_DIR, ent.name);
      try {
        const stat = await fs8.stat(dir);
        if (stat.mtimeMs < cutoff) {
          await fs8.rm(dir, { recursive: true, force: true });
          removed++;
        }
      } catch {
      }
    }
    if (removed) log15.info(`pruned ${removed} media dir(s) older than ${maxAgeMs / 36e5}h`);
  } catch {
  }
  return removed;
}
function startMediaCleanupLoop(opts) {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  void pruneOldMedia(maxAgeMs);
  const timer = setInterval(() => void pruneOldMedia(maxAgeMs), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}

// src/process/registry.ts
import fs9 from "fs/promises";
var log16 = createLogger("process");
var mutationQueue = Promise.resolve();
function mutate(fn) {
  const next = mutationQueue.then(() => fn());
  mutationQueue = next.then(
    () => void 0,
    () => void 0
  );
  return next;
}
async function registerProcess(entry) {
  await ensureHome();
  await mutate(async () => {
    const reg = await readRegistry();
    reg.entries = reg.entries.filter((e) => isAlive(e.pid));
    reg.entries.push({
      pid: entry.pid,
      startedAt: entry.startedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      appId: entry.appId,
      label: entry.label
    });
    await writeRegistry(reg);
  });
}
async function unregisterProcess(pid) {
  await mutate(async () => {
    const reg = await readRegistry();
    reg.entries = reg.entries.filter((e) => e.pid !== pid);
    await writeRegistry(reg);
  });
}
async function listProcesses() {
  return mutate(async () => {
    const reg = await pruneDead(await readRegistry());
    await writeRegistry(reg);
    return reg.entries;
  });
}
async function findConflicts(appId) {
  const alive = await listProcesses();
  if (!appId) return alive.filter((e) => e.pid !== process.pid);
  return alive.filter((e) => e.appId === appId && e.pid !== process.pid);
}
function isAlive(pid) {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
async function killProcess(pid, signal = "SIGTERM") {
  if (!isAlive(pid)) return false;
  if (process.platform === "win32") {
    const res = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { encoding: "utf8" });
    if (res.status === 0) return true;
    log16.warn(`taskkill ${pid} failed: ${(res.stderr || res.stdout || "").trim()}`);
    return false;
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    log16.warn(`kill ${pid} failed: ${err.message}`);
    return false;
  }
}
async function readRegistry() {
  await ensureHome();
  try {
    const raw = await fs9.readFile(PROCESSES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { entries: parsed.entries ?? [] };
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { entries: [] };
    }
    throw err;
  }
}
async function writeRegistry(reg) {
  const tmp = `${PROCESSES_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs9.writeFile(tmp, JSON.stringify(reg, null, 2) + "\n", "utf8");
  try {
    await fs9.rename(tmp, PROCESSES_PATH);
  } catch (err) {
    await fs9.rm(tmp, { force: true }).catch(() => void 0);
    throw err;
  }
}
async function pruneDead(reg) {
  return { entries: reg.entries.filter((e) => isAlive(e.pid)) };
}

// src/process/conflicts.ts
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
var log17 = createLogger("process");
async function resolveConflicts(conflicts, opts) {
  if (!conflicts.length) return { action: "continue", killed: [] };
  if (opts?.force) {
    log17.warn(`${conflicts.length} other bridge instance(s) running \u2014 continuing (--force)`);
    return { action: "continue", killed: [] };
  }
  if (!input.isTTY) {
    log17.warn(`${conflicts.length} other bridge instance(s) running \u2014 continuing (non-interactive)`);
    return { action: "continue", killed: [] };
  }
  log17.warn("Another bridge instance is already running:");
  for (const e of conflicts) {
    log17.warn(`  pid=${e.pid} since=${e.startedAt} label=${e.label}`);
  }
  process.stdout.write(
    "\n[c]ontinue anyway  [k]ill old instance(s)  [a]bort startup: "
  );
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question("")).trim().toLowerCase();
    if (answer === "k" || answer === "kill") {
      const killed = [];
      for (const e of conflicts) {
        if (await killProcess(e.pid)) killed.push(e.pid);
      }
      await waitForDeath(killed, 5e3);
      log17.info(`killed ${killed.length} old instance(s)`);
      return { action: "kill", killed };
    }
    if (answer === "a" || answer === "abort") {
      return { action: "abort", killed: [] };
    }
    return { action: "continue", killed: [] };
  } finally {
    rl.close();
  }
}
async function waitForDeath(pids, timeoutMs) {
  if (pids.length === 0) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((p) => !isAlive(p))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const pid of pids) {
    if (isAlive(pid)) {
      log17.warn(`pid=${pid} still alive after ${timeoutMs}ms \u2014 sending SIGKILL`);
      await killProcess(pid, "SIGKILL");
    }
  }
  await new Promise((r) => setTimeout(r, 200));
}

// src/core/bridge.ts
var log18 = createLogger("bridge");
var CARD_PATCH_INTERVAL_MS = 800;
var PROMPT_TOOLS = { question: false };
var COMMENT_ACK_REACTION = "Typing";
var Bridge = class {
  constructor(opts) {
    this.opts = opts;
    const { config } = opts;
    this.sender = new LarkSender({
      identity: config.larkIdentity,
      larkCliPath: opts.larkCliPath,
      profile: config.larkProfile
    });
    this.chats = new LarkChats({
      identity: config.larkIdentity,
      larkCliPath: opts.larkCliPath,
      profile: config.larkProfile
    });
    this.attach = new LarkAttachmentFetcher({
      identity: config.larkIdentity,
      larkCliPath: opts.larkCliPath,
      profile: config.larkProfile
    });
    this.comments = new CommentFetcher();
    this.server = config.manageOpencodeServer ? new OpencodeServer({
      host: config.opencodeHost,
      port: config.opencodePort,
      opencodePath: opts.opencodePath
    }) : null;
    this.client = new OpencodeClient({
      baseUrl: `http://${config.opencodeHost}:${config.opencodePort}`,
      agent: config.agent,
      model: config.model,
      requestTimeoutMs: 10 * 6e4,
      apiVersion: this.apiVersion
    });
  }
  opts;
  consumer = null;
  credentials = null;
  botOpenId = null;
  sender;
  chats;
  attach;
  comments;
  server;
  client;
  apiVersion = "v1";
  opencodePassword = null;
  sessions = new SessionStore();
  workspaces = new WorkspaceStore();
  perChat = /* @__PURE__ */ new Map();
  pendingQueues = /* @__PURE__ */ new Map();
  docInflight = /* @__PURE__ */ new Map();
  seenEventIds = /* @__PURE__ */ new Set();
  keepalive = null;
  mediaCleanupStop = null;
  stopping = false;
  async start(opts) {
    void pruneOldLogs();
    this.mediaCleanupStop = startMediaCleanupLoop();
    await this.sessions.load();
    await this.workspaces.load();
    if (this.server) await this.server.start();
    const { config } = this.opts;
    const configured = config.opencodeApiVersion ?? "auto";
    this.opencodePassword = this.server?.password ?? process.env.OPENCODE_PASSWORD ?? null;
    const baseUrl = `http://${config.opencodeHost}:${config.opencodePort}`;
    this.apiVersion = configured === "auto" ? await detectApiVersion(baseUrl, this.opencodePassword) : configured;
    log18.info(
      `opencode API: ${this.apiVersion}${this.opencodePassword ? " (password auth)" : ""}`
    );
    this.client = new OpencodeClient({
      baseUrl,
      agent: config.agent,
      model: config.model,
      requestTimeoutMs: 10 * 6e4,
      apiVersion: this.apiVersion,
      password: this.opencodePassword ?? void 0
    });
    this.credentials = await loadActiveLarkCredentials({
      profileOrAppId: this.opts.config.larkProfile
    });
    this.comments.setCredentials(this.credentials);
    const conflicts = await findConflicts(this.credentials.appId);
    const resolution = await resolveConflicts(conflicts, { force: opts?.force });
    if (resolution.action === "abort") {
      throw new Error("startup aborted \u2014 another bridge instance is running");
    }
    await registerProcess({
      pid: process.pid,
      appId: this.credentials.appId,
      label: "run"
    });
    log18.info(
      `lark credentials: appId=${this.credentials.appId} profile=${this.credentials.profile ?? "(none)"}`
    );
    this.botOpenId = fetchBotOpenId({
      larkCliPath: this.opts.larkCliPath,
      profile: this.opts.config.larkProfile
    });
    log18.info(`bot open_id: ${this.botOpenId ?? "(unknown \u2014 group mention detection degraded)"}`);
    this.consumer = new LarkWsConsumer({
      credentials: this.credentials,
      onMessage: (evt) => void this.handleInbound(evt),
      onComment: (evt) => void this.handleInbound(evt),
      onCardAction: (payload) => void this.handleCardAction(payload),
      onStop: (chatId) => this.handleStop(chatId)
    });
    await this.consumer.start();
    this.keepalive = new WsKeepalive({
      channel: () => this.consumer?.channel ?? null,
      onStale: () => {
        log18.warn("websocket stale \u2014 auto-reconnecting");
        void this.consumer?.reconnect().catch((err) => {
          log18.error(`auto-reconnect failed: ${err.message}`);
        });
      }
    });
    this.keepalive.start();
    log18.info("bridge ready \u2014 listening for IM messages & doc comments");
  }
  async stop() {
    this.stopping = true;
    this.keepalive?.stop();
    this.mediaCleanupStop?.();
    for (const q of this.pendingQueues.values()) q.discard();
    for (const rt of this.perChat.values()) {
      rt.idleWatchdog?.stop();
      rt.abort?.abort();
    }
    await this.consumer?.stop().catch(() => void 0);
    if (this.server) this.server.stop();
    await unregisterProcess(process.pid);
  }
  async handleInbound(evt) {
    if (this.stopping) return;
    if (this.seenEventIds.has(evt.event_id)) {
      log18.debug(`skip duplicate event_id=${evt.event_id}`);
      return;
    }
    this.seenEventIds.add(evt.event_id);
    if (this.seenEventIds.size > 5e3) {
      const first = this.seenEventIds.values().next().value;
      if (first) this.seenEventIds.delete(first);
    }
    if (isMessageEvent(evt)) {
      await this.handleMessage(evt);
      return;
    }
    if (isCommentEvent(evt)) {
      await this.handleComment(evt);
      return;
    }
  }
  // ---------------------------------------------------------------------
  // IM message branch
  // ---------------------------------------------------------------------
  async handleMessage(evt) {
    log18.info(
      `inbound msg chat=${evt.chat_id} type=${evt.chat_type} sender=${evt.sender_id} mentions=${evt.mentions.length} spawned=${this.sessions.isSpawned(evt.chat_id)} reply_to=${evt.reply_to_message_id ?? "-"}`
    );
    if (this.botOpenId && evt.sender_id === this.botOpenId) {
      log18.debug(`skip bot-originated message ${evt.message_id}`);
      return;
    }
    const cfg = this.opts.config;
    if (!isUserAllowed(cfg, evt.sender_id)) {
      log18.info(`drop sender=${evt.sender_id} chat=${evt.chat_id} (not allowlisted)`);
      return;
    }
    if (!isChatAllowed(cfg, evt.chat_id, evt.chat_type === "p2p" ? "p2p" : "group")) {
      log18.info(`drop chat=${evt.chat_id} (not allowlisted)`);
      return;
    }
    if (evt.chat_type === "group" && !this.sessions.isSpawned(evt.chat_id) && cfg.requireGroupMention && !this.isBotMentioned(evt)) {
      log18.info(
        `drop group msg without mention chat=${evt.chat_id} (not a /spawn chat)`
      );
      return;
    }
    const text = stripMentions(extractTextContent(evt), evt.mentions);
    const slash = text ? parseSlash(text) : null;
    if (slash) {
      await this.handleSlash(evt, slash);
      return;
    }
    this.getQueue(evt.chat_id).enqueue(evt);
  }
  getQueue(chatId) {
    let q = this.pendingQueues.get(chatId);
    if (!q) {
      q = new ChatPendingQueue({
        batchMs: this.opts.config.messageBatchMs,
        onPreempt: () => this.preemptChat(chatId),
        onFlush: (evts) => this.dispatchBatch(evts)
      });
      this.pendingQueues.set(chatId, q);
    }
    return q;
  }
  preemptChat(chatId) {
    const rt = this.perChat.get(chatId);
    const sessionId = this.sessions.getSession(chatId);
    if (!rt?.abort) return;
    log18.info(`preempt: aborting in-flight run for chat=${chatId}`);
    rt.abort.abort();
    if (sessionId) void this.client.abortSession(sessionId).catch(() => void 0);
  }
  async dispatchBatch(evts) {
    if (!evts.length) return;
    const primary = evts[evts.length - 1];
    const textParts = [];
    for (const evt of evts) {
      const userText = stripMentions(extractTextContent(evt), evt.mentions);
      const slash = userText ? parseSlash(userText) : null;
      if (slash) {
        await this.handleSlash(evt, slash);
        return;
      }
      const text = await this.buildPromptText(evt, userText);
      if (text) textParts.push(text);
    }
    const combined = textParts.join("\n\n---\n\n");
    const attachments = [];
    for (const evt of evts) {
      const refs = await this.attach.fetch(evt.message_id, evt.message_type);
      attachments.push(...refs);
    }
    if (!combined && attachments.length === 0) {
      log18.debug(`batch has no extractable content \u2014 skipping`);
      return;
    }
    await this.handlePrompt(primary, combined, attachments);
  }
  isBotMentioned(evt) {
    if (!evt.mentions.length) return false;
    if (this.botOpenId) {
      return evt.mentions.some((m) => m.openId === this.botOpenId);
    }
    return true;
  }
  async handleReconnect(evt) {
    try {
      await this.consumer?.reconnect();
      const summary = this.consumer?.connectionSummary() ?? "unknown";
      await this.replyMarkdown(evt, `WebSocket \u5DF2\u91CD\u8FDE\u3002

\`${summary}\``);
    } catch (err) {
      await this.replyMarkdown(evt, `\u91CD\u8FDE\u5931\u8D25\uFF1A${err.message}`);
    }
  }
  async handleTimeout(evt, rt, cmd) {
    const arg = cmd.args[0]?.trim();
    if (!arg) {
      const global = this.opts.config.idleTimeoutMinutes;
      const local = rt.idleTimeoutMinutes;
      const effective = local ?? global;
      await this.replyMarkdown(
        evt,
        [
          `**\u7A7A\u95F2\u8D85\u65F6**\uFF08\u65E0 opencode \u8F93\u51FA\u5219\u81EA\u52A8\u4E2D\u65AD\uFF09`,
          `- \u672C\u804A\u5929\uFF1A\`${local ?? "(\u4F7F\u7528\u5168\u5C40)"}\` \u5206\u949F`,
          `- \u5168\u5C40\u9ED8\u8BA4\uFF1A\`${global}\` \u5206\u949F\uFF080 = \u5173\u95ED\uFF09`,
          `- \u5F53\u524D\u751F\u6548\uFF1A\`${effective}\` \u5206\u949F`,
          "",
          "\u7528\u6CD5\uFF1A`/timeout 30` \u8BBE\u7F6E\u672C\u804A\u5929 30 \u5206\u949F\uFF1B`/timeout 0` \u5173\u95ED"
        ].join("\n")
      );
      return;
    }
    const n = Number(arg);
    if (!Number.isFinite(n) || n < 0) {
      await this.replyMarkdown(evt, "\u7528\u6CD5\uFF1A`/timeout <\u5206\u949F>`\uFF0C\u4F8B\u5982 `/timeout 30` \u6216 `/timeout 0`");
      return;
    }
    rt.idleTimeoutMinutes = n;
    await this.replyMarkdown(
      evt,
      n === 0 ? "\u672C\u804A\u5929\u7684\u7A7A\u95F2\u8D85\u65F6\u5DF2\u5173\u95ED\u3002" : `\u672C\u804A\u5929\u7684\u7A7A\u95F2\u8D85\u65F6\u5DF2\u8BBE\u4E3A **${n}** \u5206\u949F\u3002`
    );
  }
  async handleDoctor(evt, _rt, cmd) {
    const userNote = cmd.args.join(" ").trim();
    const logs = await recentLogEntries(180, /* @__PURE__ */ new Set(["warn", "error"]));
    const ws = this.consumer?.connectionSummary() ?? "unknown";
    const logText = logs.length === 0 ? "_(no warn/error log entries in the last 2 days)_" : logs.map((e) => `${e.ts} [${e.level}] ${e.scope}: ${e.msg}`).join("\n").slice(0, 12e3);
    const prompt = [
      "\u4F60\u662F lark-opencode-bridge \u7684\u81EA\u8BCA\u65AD\u52A9\u624B\u3002\u6839\u636E\u4EE5\u4E0B bridge \u65E5\u5FD7\u548C\u7528\u6237\u63CF\u8FF0\uFF0C",
      "\u7528\u4E2D\u6587\u7B80\u8981\u5206\u6790\u53EF\u80FD\u539F\u56E0\u5E76\u7ED9\u51FA\u53EF\u64CD\u4F5C\u7684\u4FEE\u590D\u6B65\u9AA4\uFF083-5 \u6761\u4EE5\u5185\uFF09\u3002",
      "",
      userNote ? `**\u7528\u6237\u63CF\u8FF0**\uFF1A${userNote}` : "",
      "",
      `**WebSocket**\uFF1A${ws}`,
      "",
      "**\u6700\u8FD1 warn/error \u65E5\u5FD7**\uFF1A",
      "```",
      logText,
      "```"
    ].filter(Boolean).join("\n");
    await this.handlePrompt(evt, prompt, []);
  }
  startIdleWatchdog(chatId, rt) {
    rt.idleWatchdog?.stop();
    const minutes = rt.idleTimeoutMinutes ?? this.opts.config.idleTimeoutMinutes;
    if (minutes <= 0) return;
    const watchdog = new IdleWatchdog({
      timeoutMinutes: minutes,
      onTimeout: async () => {
        log18.warn(`idle timeout for chat=${chatId}`);
        this.preemptChat(chatId);
        const sessionId = this.sessions.getSession(chatId);
        if (sessionId) await this.client.abortSession(sessionId).catch(() => void 0);
      }
    });
    rt.idleWatchdog = watchdog;
    watchdog.start();
  }
  stopIdleWatchdog(rt) {
    rt.idleWatchdog?.stop();
    rt.idleWatchdog = void 0;
  }
  async handleSlash(evt, cmd) {
    if (ADMIN_SLASH_COMMANDS.has(cmd.name) && !isAdmin(this.opts.config, evt.sender_id)) {
      await this.replyMarkdown(evt, "\u274C \u6B64\u547D\u4EE4\u4EC5\u7BA1\u7406\u5458\u53EF\u7528\u3002");
      return;
    }
    const rt = this.getRt(evt.chat_id);
    switch (cmd.name) {
      case "help":
        await this.replyMarkdown(evt, HELP_TEXT);
        return;
      case "new": {
        const oldId = this.sessions.getSession(evt.chat_id);
        this.sessions.clearSession(evt.chat_id);
        await this.replyMarkdown(
          evt,
          oldId ? `Session reset (previous: \`${oldId}\`).` : "No active session to reset."
        );
        return;
      }
      case "cd": {
        const target = cmd.args.join(" ").trim();
        if (!target) {
          await this.replyMarkdown(evt, "Usage: `/cd <absolute-path>`");
          return;
        }
        if (!path9.isAbsolute(target)) {
          await this.replyMarkdown(
            evt,
            `\`${target}\` \u4E0D\u662F\u7EDD\u5BF9\u8DEF\u5F84\u3002Usage: \`/cd <absolute-path>\``
          );
          return;
        }
        this.setChatCwd(evt.chat_id, target);
        await this.replyMarkdown(
          evt,
          `cwd set to \`${target}\` \u2014 session will be reinitialised on the next prompt.`
        );
        return;
      }
      case "status": {
        const sessionId = this.sessions.getSession(evt.chat_id) ?? "(none)";
        const cwd = this.chatCwd(evt.chat_id) ?? "(opencode default)";
        const agent = rt.agent ?? this.opts.config.agent ?? "(opencode default)";
        const model = rt.model ?? this.opts.config.model ?? "(opencode default)";
        const body = [
          `**chat_id**: \`${evt.chat_id}\``,
          `**session**: \`${sessionId}\``,
          `**cwd**: \`${cwd}\``,
          `**agent**: \`${agent}\``,
          `**model**: \`${model}\``,
          `**replyStyle**: \`${this.opts.config.replyStyle}\``,
          `**websocket**: \`${this.consumer?.connectionSummary() ?? "unknown"}\``,
          `**idleTimeout**: \`${rt.idleTimeoutMinutes ?? this.opts.config.idleTimeoutMinutes}\` min`
        ].join("\n");
        await this.replyMarkdown(evt, body);
        return;
      }
      case "stop": {
        const sessionId = this.sessions.getSession(evt.chat_id);
        if (sessionId) await this.client.abortSession(sessionId);
        if (rt.abort) {
          rt.abort.abort();
          await this.replyMarkdown(evt, "Cancelled the in-flight run.");
        } else {
          await this.replyMarkdown(evt, "Nothing in flight.");
        }
        return;
      }
      case "agents": {
        const v = cmd.args[0]?.trim();
        if (!v) {
          await this.handleAgentsList(evt, rt);
          return;
        }
        rt.agent = v;
        await this.replyMarkdown(evt, `Agent set to \`${v}\` for this chat.`);
        return;
      }
      case "models": {
        const sub = cmd.args[0]?.trim();
        if (!sub) {
          await this.handleModelList(evt, rt);
          return;
        }
        const resolved = await this.resolveModelId(sub);
        if (!resolved.ok) {
          await this.replyMarkdown(evt, resolved.message);
          return;
        }
        rt.model = resolved.modelId;
        const note = resolved.autoCompleted ? ` (auto-resolved from \`${sub}\`)` : "";
        await this.replyMarkdown(
          evt,
          `Model set to \`${resolved.modelId}\` for this chat.${note}`
        );
        return;
      }
      case "sessions":
        await this.handleSessionsList(evt);
        return;
      case "compact":
        await this.handleCompact(evt, rt);
        return;
      case "share":
        await this.handleShare(evt);
        return;
      case "unshare":
        await this.handleUnshare(evt);
        return;
      case "undo":
        await this.handleUndo(evt);
        return;
      case "redo":
        await this.handleRedo(evt);
        return;
      case "init":
        await this.handleInit(evt, rt);
        return;
      case "spawn":
        await this.handleSpawn(evt, cmd);
        return;
      case "workspaces":
        await this.handleWs(evt, cmd);
        return;
      case "reconnect":
        await this.handleReconnect(evt);
        return;
      case "timeout":
        await this.handleTimeout(evt, rt, cmd);
        return;
      case "doctor":
        await this.handleDoctor(evt, rt, cmd);
        return;
      case "config":
        await this.handleConfigForm(evt);
        return;
    }
  }
  async handleConfigForm(evt) {
    const opts = configFormOptsFromBridge(this.opts.config);
    const card = configFormCard(opts);
    try {
      await this.sender.sendCard(evt.chat_id, card);
    } catch (err) {
      await this.replyMarkdown(evt, `\u65E0\u6CD5\u53D1\u9001\u914D\u7F6E\u5361\u7247\uFF1A${err.message}`);
    }
  }
  async handleCardAction(payload) {
    const cfg = this.opts.config;
    if (!isUserAllowed(cfg, payload.operatorOpenId)) {
      log18.info(`cardAction drop operator=${payload.operatorOpenId} (not allowlisted)`);
      return;
    }
    if (payload.cmd === "config.cancel") {
      try {
        await this.sender.patchCard({
          messageId: payload.messageId,
          card: configCancelledCard()
        });
      } catch (err) {
        log18.warn(`config cancel patch failed: ${err.message}`);
      }
      return;
    }
    if (payload.cmd === "config.submit") {
      if (payload.chatType === "group" && !isChatAllowed(cfg, payload.chatId, "group")) {
        log18.info(`cardAction config.submit drop chat=${payload.chatId}`);
        return;
      }
      if (!isAdmin(cfg, payload.operatorOpenId)) {
        try {
          await this.sender.patchCard({
            messageId: payload.messageId,
            card: configErrorCard("\u274C \u4EC5\u7BA1\u7406\u5458\u53EF\u4FEE\u6539\u914D\u7F6E\u3002")
          });
        } catch {
        }
        return;
      }
      if (!payload.formValue) {
        try {
          await this.sender.patchCard({
            messageId: payload.messageId,
            card: configErrorCard("\u672A\u6536\u5230\u8868\u5355\u6570\u636E\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001 `/config`\u3002")
          });
        } catch {
        }
        return;
      }
      const result = applyConfigForm(
        cfg,
        payload.formValue,
        payload.operatorOpenId,
        payload.chatId,
        payload.chatType
      );
      if (!result.ok) {
        try {
          await this.sender.patchCard({
            messageId: payload.messageId,
            card: configErrorCard(result.error)
          });
        } catch (err) {
          log18.warn(`config error patch failed: ${err.message}`);
        }
        return;
      }
      this.opts.config = result.cfg;
      await saveConfig(result.cfg);
      log18.info("config updated via /config card");
      try {
        await this.sender.patchCard({
          messageId: payload.messageId,
          card: configSavedCard(result.formOpts)
        });
      } catch (err) {
        log18.warn(`config saved patch failed: ${err.message}`);
      }
    }
  }
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
  async resolveModelId(input2) {
    if (input2.includes("/")) {
      const slash = input2.indexOf("/");
      if (slash === 0 || slash === input2.length - 1) {
        return {
          ok: false,
          message: `\`${input2}\` is not a valid \`provider/model\` id. Try \`/model list\`.`
        };
      }
      return { ok: true, modelId: input2, autoCompleted: false };
    }
    let providers;
    try {
      providers = await this.client.listProviders();
    } catch (err) {
      return {
        ok: false,
        message: `\`${input2}\` is missing a provider prefix and I couldn't reach opencode to auto-resolve it (${err.message}). Use \`/model <provider/model>\`.`
      };
    }
    const matches = [];
    for (const p of providers) {
      if (p.models.some((m) => m.id === input2)) {
        matches.push(`${p.id}/${input2}`);
      }
    }
    if (matches.length === 1) {
      return { ok: true, modelId: matches[0], autoCompleted: true };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        message: `\`${input2}\` is ambiguous \u2014 matches: ${matches.map((m) => `\`${m}\``).join(", ")}. Please specify the provider explicitly.`
      };
    }
    return {
      ok: false,
      message: `No provider has a model named \`${input2}\`. Run \`/model list\` to see what's available.`
    };
  }
  /**
   * Render `/model list` output. Queries opencode's `/config/providers` for
   * the current providers + models, marks the chat's effective selection,
   * and posts a markdown list back to Lark.
   */
  async handleModelList(evt, rt) {
    let providers;
    try {
      providers = await this.client.listProviders();
    } catch (err) {
      await this.replyMarkdown(
        evt,
        `Failed to fetch providers from opencode: ${err.message}`
      );
      return;
    }
    if (!providers.length) {
      await this.replyMarkdown(
        evt,
        "No providers available from opencode. Ensure `opencode serve` is running and models are configured."
      );
      return;
    }
    const current = rt.model ?? this.opts.config.model;
    const lines = [`**Available models** (current: \`${current ?? "(opencode default)"}\`)`];
    for (const p of providers) {
      lines.push("");
      const header = p.name && p.name !== p.id ? `**${p.name}** (\`${p.id}\`)` : `**${p.id}**`;
      lines.push(header);
      if (!p.models.length) {
        lines.push("- _(no models)_");
        continue;
      }
      for (const m of p.models) {
        const fullId = `${p.id}/${m.id}`;
        const markers = [];
        if (current && current === fullId) markers.push("\u2190 current");
        if (p.defaultModelId && p.defaultModelId === m.id) markers.push("default");
        const tail = markers.length ? `  _(${markers.join(", ")})_` : "";
        const label = m.name && m.name !== m.id ? ` \u2014 ${m.name}` : "";
        lines.push(`- \`${fullId}\`${label}${tail}`);
      }
    }
    lines.push("");
    lines.push("Use `/model <provider/model>` to switch.");
    await this.replyMarkdown(evt, lines.join("\n"));
  }
  /** Render `/agents` — list opencode agents and mark the chat's selection. */
  async handleAgentsList(evt, rt) {
    let agents;
    try {
      agents = await this.client.listAgents();
    } catch (err) {
      await this.replyMarkdown(
        evt,
        `Failed to fetch agents from opencode: ${err.message}`
      );
      return;
    }
    if (!agents.length) {
      await this.replyMarkdown(evt, "No agents configured in opencode.");
      return;
    }
    const current = rt.agent ?? this.opts.config.agent;
    const lines = [`**Available agents** (current: \`${current ?? "(opencode default)"}\`)`, ""];
    for (const a of agents) {
      const tail = current && current === a.name ? "  _(\u2190 current)_" : "";
      const mode = a.mode ? ` _[${a.mode}]_` : "";
      const desc = a.description ? ` \u2014 ${a.description}` : "";
      lines.push(`- \`${a.name}\`${mode}${desc}${tail}`);
    }
    lines.push("");
    lines.push("Use `/agents <name>` to switch.");
    await this.replyMarkdown(evt, lines.join("\n"));
  }
  /**
   * `/sessions` — list opencode sessions visible to this server. We don't
   * implement switching (each Lark chat is bound 1:1 to its own session
   * via `chat_id`), but listing is useful for debugging stale sessions.
   */
  async handleSessionsList(evt) {
    let sessions;
    try {
      sessions = await this.client.listSessions();
    } catch (err) {
      await this.replyMarkdown(
        evt,
        `Failed to list sessions: ${err.message}`
      );
      return;
    }
    if (!sessions.length) {
      await this.replyMarkdown(evt, "No sessions yet.");
      return;
    }
    const currentForChat = this.sessions.getSession(evt.chat_id);
    const lines = [`**Sessions** (${sessions.length})`, ""];
    for (const s of sessions.slice(0, 25)) {
      const tail = s.id === currentForChat ? "  _(\u2190 this chat)_" : "";
      const title = s.title ? ` \u2014 ${s.title}` : "";
      const dir = s.directory ? ` \`${s.directory}\`` : "";
      lines.push(`- \`${s.id}\`${title}${dir}${tail}`);
    }
    if (sessions.length > 25) lines.push(`_\u2026 and ${sessions.length - 25} more_`);
    await this.replyMarkdown(evt, lines.join("\n"));
  }
  /** `/compact` — opencode `POST /session/{id}/summarize`. */
  async handleCompact(evt, rt) {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session to compact. Send a prompt first.");
      return;
    }
    const model = this.resolveModelForApi(rt);
    if (!model) {
      await this.replyMarkdown(
        evt,
        "`/compact` needs a model. Run `/models <provider/model>` first or set `config.model`."
      );
      return;
    }
    try {
      await this.client.summarizeSession(sessionId, model);
      await this.replyMarkdown(
        evt,
        `Compacting session \`${sessionId}\` with \`${model.providerID}/${model.modelID}\` \u2014 opencode will summarise in the background.`
      );
    } catch (err) {
      await this.replyMarkdown(evt, `Compact failed: ${err.message}`);
    }
  }
  /** `/share` — opencode `POST /session/{id}/share`. */
  async handleShare(evt) {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session to share. Send a prompt first.");
      return;
    }
    try {
      const url = await this.client.shareSession(sessionId);
      await this.replyMarkdown(
        evt,
        url ? `Session shared: ${url}` : `Session \`${sessionId}\` shared, but opencode didn't return a URL.`
      );
    } catch (err) {
      await this.replyMarkdown(evt, `Share failed: ${err.message}`);
    }
  }
  /** `/unshare` — opencode `DELETE /session/{id}/share`. */
  async handleUnshare(evt) {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session.");
      return;
    }
    try {
      await this.client.unshareSession(sessionId);
      await this.replyMarkdown(evt, `Session \`${sessionId}\` is no longer shared.`);
    } catch (err) {
      await this.replyMarkdown(evt, `Unshare failed: ${err.message}`);
    }
  }
  /**
   * `/undo` — revert the most recent user message. opencode wants the
   * `messageID` to roll back to, so we fetch the message list and pick
   * the last user message.
   */
  async handleUndo(evt) {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session to undo.");
      return;
    }
    let messages;
    try {
      messages = await this.client.listMessages(sessionId);
    } catch (err) {
      await this.replyMarkdown(evt, `Undo failed: ${err.message}`);
      return;
    }
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      await this.replyMarkdown(evt, "Nothing to undo \u2014 no user messages in this session.");
      return;
    }
    try {
      await this.client.revertSession(sessionId, lastUser.id);
      await this.replyMarkdown(
        evt,
        `Reverted message \`${lastUser.id}\` and its file changes. Use \`/redo\` to restore.`
      );
    } catch (err) {
      await this.replyMarkdown(evt, `Undo failed: ${err.message}`);
    }
  }
  /** `/redo` — opencode `POST /session/{id}/unrevert`. */
  async handleRedo(evt) {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session to redo.");
      return;
    }
    try {
      await this.client.unrevertSession(sessionId);
      await this.replyMarkdown(evt, "Restored previously reverted messages.");
    } catch (err) {
      await this.replyMarkdown(evt, `Redo failed: ${err.message}`);
    }
  }
  /**
   * `/init` — analyse the project and create/refresh AGENTS.md. The opencode
   * init endpoint is anchored to a user message, so we route this through the
   * normal prompt path (with a canned instruction) which is simpler and works
   * across both reply-mode and card-mode.
   */
  async handleInit(evt, _rt) {
    const cwd = this.chatCwd(evt.chat_id);
    const instruction = [
      "Initialize this project for opencode.",
      "Analyze the codebase structure, coding patterns, and conventions, then",
      "create (or update if one exists) an `AGENTS.md` file at the project root",
      `${cwd ? `(cwd: ${cwd})` : ""} summarising:`,
      "- what the project does",
      "- the tech stack and key dependencies",
      "- directory layout",
      "- how to build/test/run",
      "- coding conventions worth knowing",
      "",
      "Keep it concise and actionable."
    ].join("\n");
    await this.handlePrompt(evt, instruction, []);
  }
  /**
   * Resolve the chat's effective {providerID, modelID} for endpoints that
   * require a model parameter (`/compact`, `/init`). Returns undefined when
   * the chat has no model set anywhere.
   */
  resolveModelForApi(rt) {
    return parseModel(rt.model ?? this.opts.config.model);
  }
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
  async handleSpawn(evt, cmd) {
    if (evt.chat_type !== "p2p") {
      await this.replyMarkdown(
        evt,
        "`/spawn` \u53EA\u80FD\u5728 P2P \u79C1\u804A\u91CC\u4F7F\u7528\u3002\u8BF7\u5148\u79C1\u804A\u673A\u5668\u4EBA\u518D\u6267\u884C\u6B64\u547D\u4EE4\u3002"
      );
      return;
    }
    const topic = cmd.args.join(" ").trim();
    if (!topic) {
      await this.replyMarkdown(evt, "\u7528\u6CD5\uFF1A`/spawn <\u4E3B\u9898>`\uFF0C\u4F8B\u5982 `/spawn \u91CD\u6784 auth \u6A21\u5757`");
      return;
    }
    const cwd = this.chatCwd(evt.chat_id) ?? this.opts.config.defaultCwd;
    const groupName = formatGroupName(topic);
    const description = SPAWN_GROUP_DESCRIPTION;
    let newChatId;
    try {
      const result = await this.chats.create({
        name: groupName,
        description,
        userOpenIds: [evt.sender_id],
        chatType: "private",
        setBotManager: this.opts.config.larkIdentity === "bot"
      });
      newChatId = result.chatId;
      this.sessions.markSpawned(newChatId, { titleSynced: false });
    } catch (err) {
      await this.replyMarkdown(evt, formatChatCreateError(err));
      return;
    }
    let sessionId = null;
    try {
      if (cwd) this.sessions.setCwd(newChatId, cwd);
      const created = await this.client.createSession(`lark:${newChatId}`, cwd);
      sessionId = created.id;
      this.sessions.setSession(newChatId, sessionId);
      log18.info(`spawn: bound session ${sessionId} \u2192 chat ${newChatId}`);
    } catch (err) {
      log18.warn(`spawn: session creation failed: ${err.message}`);
    }
    const welcome = [
      `**\u6B22\u8FCE\u6765\u5230 \`[opencode]\` \u5DE5\u4F5C\u7FA4**`,
      "",
      `- \u4E3B\u9898\uFF1A${topic}`,
      `- cwd\uFF1A\`${cwd ?? "(opencode \u9ED8\u8BA4)"}\``,
      sessionId ? `- session\uFF1A\`${sessionId}\`` : null,
      "",
      "\u5728\u8FD9\u4E2A\u7FA4\u91CC**\u76F4\u63A5\u53D1\u6D88\u606F**\u5C31\u884C\uFF0C\u65E0\u9700 @ \u6211\uFF1B\u7FA4\u91CC\u6BCF\u4E2A\u4EBA\u53D1\u7684\u5185\u5BB9\u90FD\u4F1A\u8FDB\u5165\u540C\u4E00\u4E2A opencode \u4F1A\u8BDD\u3002",
      "",
      "\u5E38\u7528\u547D\u4EE4\uFF1A`/help` \u67E5\u770B\u5168\u90E8 \xB7 `/status` \u67E5\u770B\u72B6\u6001 \xB7 `/new` \u91CD\u7F6E\u4F1A\u8BDD \xB7 `/stop` \u4E2D\u65AD \xB7 `/models` \u5207\u6A21\u578B \xB7 `/cd <\u8DEF\u5F84>` \u6362\u76EE\u5F55"
    ].filter((x) => Boolean(x)).join("\n");
    try {
      await this.sender.send({ chatId: newChatId, markdown: welcome });
    } catch (err) {
      log18.warn(`spawn: welcome message failed: ${err.message}`);
    }
    await this.replyMarkdown(
      evt,
      [
        `\u5DF2\u521B\u5EFA\u7FA4\u804A **${groupName}**`,
        "",
        `- chat_id\uFF1A\`${newChatId}\``,
        sessionId ? `- session\uFF1A\`${sessionId}\`` : "- session\uFF1A_(opencode \u6682\u672A\u8FD4\u56DE\uFF0C\u4E0B\u6B21\u53D1\u6D88\u606F\u65F6\u4F1A\u91CD\u5EFA)_",
        "",
        "\u6211\u5DF2\u7ECF\u628A\u4F60\u62C9\u8FDB\u53BB\u4E86\uFF0C\u53BB\u65B0\u7FA4\u91CC @ \u6211\u7EE7\u7EED\u804A\u5427\u3002"
      ].join("\n")
    );
  }
  async handleWs(evt, cmd) {
    const [sub, ...rest] = cmd.args;
    const subcommand = (sub ?? "list").toLowerCase();
    const prefix = `/${cmd.rawName}`;
    if (subcommand === "list") {
      const items = this.workspaces.list();
      if (!items.length) {
        await this.replyMarkdown(evt, `No saved workspaces. Use \`${prefix} save <name> [path]\`.`);
        return;
      }
      const lines = items.map((w) => `- **${w.name}** \u2014 \`${w.path}\``);
      await this.replyMarkdown(evt, lines.join("\n"));
      return;
    }
    if (subcommand === "save") {
      const name = rest[0]?.trim();
      if (!name) {
        await this.replyMarkdown(evt, `Usage: \`${prefix} save <name> [path]\``);
        return;
      }
      try {
        validateWorkspaceName(name);
      } catch (err) {
        await this.replyMarkdown(evt, err.message);
        return;
      }
      const explicit = rest.slice(1).join(" ").trim();
      const dir = explicit || this.chatCwd(evt.chat_id) || process.cwd();
      const ws = this.workspaces.save(name, dir);
      await this.replyMarkdown(evt, `Saved workspace **${ws.name}** \u2192 \`${ws.path}\``);
      return;
    }
    if (subcommand === "use") {
      const name = rest[0]?.trim();
      if (!name) {
        await this.replyMarkdown(evt, `Usage: \`${prefix} use <name>\``);
        return;
      }
      const ws = this.workspaces.get(name);
      if (!ws) {
        await this.replyMarkdown(evt, `No workspace named **${name}**. Use \`${prefix} list\`.`);
        return;
      }
      this.setChatCwd(evt.chat_id, ws.path);
      await this.replyMarkdown(
        evt,
        `Switched to workspace **${name}** (\`${ws.path}\`) \u2014 session reset.`
      );
      return;
    }
    if (subcommand === "rm" || subcommand === "remove" || subcommand === "delete") {
      const name = rest[0]?.trim();
      if (!name) {
        await this.replyMarkdown(evt, `Usage: \`${prefix} rm <name>\``);
        return;
      }
      const removed = this.workspaces.remove(name);
      await this.replyMarkdown(
        evt,
        removed ? `Removed workspace **${name}**.` : `No workspace named **${name}**.`
      );
      return;
    }
    await this.replyMarkdown(
      evt,
      `Unknown \`${prefix}\` subcommand. Try \`list\`, \`save\`, \`use\`, \`rm\`.`
    );
  }
  setChatCwd(chatId, dir) {
    this.sessions.setCwd(chatId, dir);
    this.sessions.clearSession(chatId);
  }
  /**
   * Resolve the working directory for a chat. Defensively ignores stored
   * values that aren't absolute paths (defends against past `/cd ?` typos
   * that wrote garbage into sessions.json).
   */
  chatCwd(chatId) {
    const stored = this.sessions.getCwd(chatId);
    if (stored && path9.isAbsolute(stored)) return stored;
    return this.opts.config.defaultCwd;
  }
  async ensureChatSession(chatId) {
    let sessionId = this.sessions.getSession(chatId);
    if (!sessionId) {
      const cwd = this.chatCwd(chatId);
      const created = await this.client.createSession(`lark:${chatId}`, cwd);
      sessionId = created.id;
      this.sessions.setSession(chatId, sessionId);
      log18.info(`created opencode session ${sessionId} for chat ${chatId} (cwd=${cwd ?? "default"})`);
    }
    return sessionId;
  }
  async handlePrompt(evt, text, attachments) {
    const parts = [];
    if (text) parts.push({ type: "text", text });
    for (const a of attachments) {
      parts.push({ type: "file", mime: a.mime, url: a.url, filename: a.filename });
    }
    await this.handlePromptCore(evt, parts);
  }
  async handlePromptCore(evt, parts) {
    const rt = this.getRt(evt.chat_id);
    let sessionId = await this.ensureChatSession(evt.chat_id);
    rt.abort?.abort();
    rt.abort = new AbortController();
    this.startIdleWatchdog(evt.chat_id, rt);
    const run2 = (sid) => this.opts.config.replyStyle === "card" ? this.runWithCard(evt, sid, parts, rt) : this.runWithReply(evt, sid, parts, rt);
    try {
      await run2(sessionId);
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        log18.warn(`stale session ${sessionId} for chat ${evt.chat_id} \u2014 clearing and retrying`);
        this.sessions.clearSession(evt.chat_id);
        sessionId = await this.ensureChatSession(evt.chat_id);
        rt.abort = new AbortController();
        await run2(sessionId);
      } else {
        throw err;
      }
    } finally {
      this.stopIdleWatchdog(rt);
      void this.maybeSyncSpawnedChatName(evt.chat_id, sessionId).catch(
        (e) => log18.warn(`title sync failed: ${e.message}`)
      );
    }
  }
  /**
   * For chats spawned via `/spawn`, fetch the opencode session's title once
   * it's been auto-generated (usually after the first prompt completes) and
   * rename the Lark group to match. We only do this once per chat to avoid
   * fighting with the user if they manually rename the group later.
   */
  async maybeSyncSpawnedChatName(chatId, sessionId) {
    const meta = this.sessions.getSpawnedMeta(chatId);
    if (!meta || meta.titleSynced) return;
    await sleep2(2e3);
    let title;
    try {
      const sessions = await this.client.listSessions();
      title = sessions.find((s) => s.id === sessionId)?.title;
    } catch (err) {
      log18.debug(`title fetch failed: ${err.message}`);
      return;
    }
    if (!title) return;
    if (title.startsWith("lark:")) return;
    try {
      await this.chats.updateName(chatId, formatGroupName(title));
      this.sessions.setSpawnedTitleSynced(chatId, true);
      log18.info(`synced spawned chat ${chatId} \u2192 name="[opencode] ${title}"`);
    } catch (err) {
      log18.warn(`group rename failed: ${err.message}`);
    }
  }
  async runWithReply(evt, sessionId, parts, rt) {
    try {
      const result = await this.client.prompt({
        sessionId,
        parts,
        agent: rt.agent,
        model: rt.model,
        tools: PROMPT_TOOLS,
        signal: rt.abort?.signal
      });
      const reply = result.text || "_(opencode returned an empty response)_";
      await this.replyMarkdown(evt, reply);
    } catch (err) {
      if (err instanceof SessionNotFoundError) throw err;
      await this.replyMarkdown(evt, `**Error:** ${err.message}`);
    } finally {
      rt.abort = void 0;
    }
  }
  async runWithCard(evt, sessionId, parts, rt) {
    const meta = {
      chatId: evt.chat_id,
      agent: rt.agent ?? this.opts.config.agent,
      model: rt.model ?? this.opts.config.model
    };
    let state = initialState;
    let dirty = false;
    let messageId = null;
    try {
      messageId = await this.sender.sendCard(evt.chat_id, renderCard(state, meta));
    } catch (err) {
      log18.warn(`card send failed, falling back to reply mode: ${err.message}`);
      await this.runWithReply(evt, sessionId, parts, rt);
      return;
    }
    const adapter = new OpencodeAgentAdapter();
    const stream2 = new OpencodeEventStream({
      baseUrl: `http://${this.opts.config.opencodeHost}:${this.opts.config.opencodePort}`,
      sessionID: sessionId,
      apiVersion: this.apiVersion,
      password: this.opencodePassword ?? void 0
    });
    const answeredPermissions = /* @__PURE__ */ new Set();
    const completion = new Promise((resolve, reject) => {
      stream2.on("event", (e) => {
        rt.idleWatchdog?.touch();
        if (e.kind === "permission" && e.sessionID === sessionId) {
          if (answeredPermissions.has(e.requestID)) return;
          answeredPermissions.add(e.requestID);
          log18.info(`auto-approving permission ${e.requestID}`);
          void this.client.replyPermission(e.requestID, "always").catch((err) => {
            log18.warn(`permission auto-approve failed: ${err.message}`);
          });
          return;
        }
        const agentEvents = adapter.translate(e, sessionId);
        for (const ae of agentEvents) {
          state = reduce(state, ae);
          dirty = true;
          if (ae.type === "done") resolve();
          else if (ae.type === "error") reject(new Error(ae.message));
        }
      });
      stream2.on("close", () => resolve());
    });
    const abortListener = () => stream2.close();
    rt.abort?.signal.addEventListener("abort", abortListener);
    const ch = this.consumer?.channel;
    const patch = async () => {
      const card = renderCard(state, meta);
      try {
        if (ch) {
          await ch.updateCard(messageId, card);
        } else {
          await this.sender.patchCard({ messageId, card });
        }
      } catch (err) {
        log18.warn(`card patch failed: ${err.message}`);
      }
    };
    const patcher = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      rt.idleWatchdog?.touch();
      void patch();
    }, CARD_PATCH_INTERVAL_MS);
    const abortSignal = rt.abort?.signal;
    try {
      await stream2.start();
      await this.client.promptAsync({
        sessionId,
        parts,
        agent: rt.agent,
        model: rt.model,
        tools: PROMPT_TOOLS,
        signal: abortSignal
      });
      await completion;
      if (abortSignal?.aborted) {
        state = markInterrupted(state);
      } else {
        state = finalizeIfRunning(state);
      }
    } catch (err) {
      if (err instanceof SessionNotFoundError) throw err;
      if (err?.name === "AbortError" || abortSignal?.aborted) {
        state = markInterrupted(state);
      } else {
        const msg = err?.message ?? String(err);
        state = reduce(state, { type: "error", message: msg });
      }
    } finally {
      rt.abort?.signal.removeEventListener("abort", abortListener);
      rt.abort = void 0;
      clearInterval(patcher);
      stream2.close();
      await patch();
    }
  }
  handleStop(chatId) {
    const rt = this.perChat.get(chatId);
    if (rt?.abort) {
      log18.info(`stop button pressed for chat=${chatId}`);
      rt.abort.abort();
      const sessionId = this.sessions.getSession(chatId);
      if (sessionId) void this.client.abortSession(sessionId).catch(() => void 0);
    }
  }
  async replyMarkdown(evt, body) {
    try {
      await this.sender.reply({ messageId: evt.message_id, markdown: body });
    } catch (err) {
      log18.error(`reply failed: ${err.message}`);
    }
  }
  // ---------------------------------------------------------------------
  // Document comment branch
  // ---------------------------------------------------------------------
  async handleComment(evt) {
    if (!this.opts.config.handleDocComments) {
      log18.debug(`comment events disabled (config.handleDocComments=false)`);
      return;
    }
    if (!evt.is_mentioned) {
      log18.debug(`comment ${evt.comment_id} skipped \u2014 bot not mentioned`);
      return;
    }
    if (this.botOpenId && evt.from_open_id === this.botOpenId) {
      log18.debug(`comment ${evt.comment_id} skipped \u2014 sent by bot itself`);
      return;
    }
    if (evt.notice_type !== "add_comment" && evt.notice_type !== "add_reply") {
      log18.debug(`comment ${evt.comment_id} skipped \u2014 unsupported notice_type=${evt.notice_type}`);
      return;
    }
    if (evt.from_open_id && !isUserAllowed(this.opts.config, evt.from_open_id)) {
      log18.info(`drop comment from=${evt.from_open_id} (not allowlisted)`);
      return;
    }
    if (!evt.from_open_id && this.opts.config.allowedSenderOpenIds.length) {
      log18.info(`drop comment with unknown sender (allowlist active)`);
      return;
    }
    const queueKey = `doc:${evt.file_token}`;
    const previous = this.docInflight.get(queueKey) ?? Promise.resolve();
    const work = previous.then(() => this.dispatchComment(evt));
    this.docInflight.set(queueKey, work);
    try {
      await work;
    } finally {
      if (this.docInflight.get(queueKey) === work) this.docInflight.delete(queueKey);
    }
  }
  async dispatchComment(evt) {
    let thread;
    try {
      thread = await this.comments.fetchThread(evt.file_token, evt.comment_id, evt.file_type);
    } catch (err) {
      log18.warn(`comment fetch failed: ${err.message}`);
      return;
    }
    let targetReply = findTargetCommentReply(thread.replies, evt.reply_id);
    if (!targetReply && evt.reply_id) {
      await sleep2(500);
      try {
        thread = await this.comments.fetchThread(evt.file_token, evt.comment_id, evt.file_type);
        targetReply = findTargetCommentReply(thread.replies, evt.reply_id);
      } catch (err) {
        log18.warn(`comment refetch failed: ${err.message}`);
        return;
      }
    }
    if (!targetReply) {
      log18.warn(`comment thread ${evt.comment_id} has no readable replies`);
      return;
    }
    const question = stripCommentMentions(targetReply.text, this.botOpenId, targetReply.mentions);
    if (!question) {
      log18.info(`comment ${evt.comment_id} mention had no question text`);
      return;
    }
    try {
      await this.comments.reactToReply(
        evt.file_token,
        evt.file_type,
        targetReply.reply_id,
        COMMENT_ACK_REACTION
      );
    } catch (err) {
      log18.debug(`ack reaction on ${targetReply.reply_id} failed: ${err.message}`);
    }
    const docUrl = buildDocUrl(this.credentials?.brand ?? "feishu", evt.file_type, evt.file_token);
    const promptText = buildCommentPrompt({
      question,
      quote: thread.quote,
      fileType: evt.file_type,
      docUrl
    });
    const chatKey = `doc:${evt.file_token}`;
    const rt = this.getRt(chatKey);
    const ensureDocSession = async () => {
      let sid = this.sessions.getSession(chatKey);
      if (!sid) {
        const created = await this.client.createSession(
          `lark-doc:${evt.file_token}`,
          this.opts.config.defaultCwd
        );
        sid = created.id;
        this.sessions.setSession(chatKey, sid);
        log18.info(`created opencode session ${sid} for doc ${evt.file_token}`);
      }
      return sid;
    };
    const doPrompt = async (sid) => {
      const result = await this.client.prompt({
        sessionId: sid,
        parts: [{ type: "text", text: promptText }],
        agent: rt.agent,
        model: rt.model,
        tools: PROMPT_TOOLS
      });
      const replyText = (result.text || "(opencode returned an empty response)").slice(0, 2e3);
      await this.comments.postReply(evt.file_token, evt.comment_id, evt.file_type, replyText);
      log18.info(`replied to comment ${evt.comment_id} on ${evt.file_type}/${evt.file_token}`);
      try {
        await this.comments.reactToReply(
          evt.file_token,
          evt.file_type,
          targetReply.reply_id,
          COMMENT_ACK_REACTION,
          "delete"
        );
      } catch (err) {
        log18.debug(`clear ack reaction on ${targetReply.reply_id} failed: ${err.message}`);
      }
    };
    let sessionId = await ensureDocSession();
    try {
      await doPrompt(sessionId);
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        log18.warn(`stale session ${sessionId} for doc ${chatKey} \u2014 clearing and retrying`);
        this.sessions.clearSession(chatKey);
        sessionId = await ensureDocSession();
        try {
          await doPrompt(sessionId);
          return;
        } catch (retryErr) {
          err = retryErr;
        }
      }
      const msg = err.message ?? String(err);
      log18.error(`comment prompt/reply failed: ${msg}`);
      try {
        await this.comments.postReply(
          evt.file_token,
          evt.comment_id,
          evt.file_type,
          `[bridge error] ${msg}`.slice(0, 500)
        );
      } catch {
      }
    }
  }
  getRt(chatId) {
    let rt = this.perChat.get(chatId);
    if (!rt) {
      rt = {};
      this.perChat.set(chatId, rt);
    }
    return rt;
  }
  /** User text plus quoted/replied message content when present. */
  async buildPromptText(evt, userText) {
    const quoteId = evt.reply_to_message_id;
    if (!quoteId) return userText;
    const quoted = await this.fetchQuotedMessageText(quoteId);
    if (!quoted) {
      log18.info(`quoted message ${quoteId} has no extractable text`);
      return userText;
    }
    log18.info(`included quoted message ${quoteId} (${quoted.length} chars)`);
    const parts = [`[\u5F15\u7528\u6D88\u606F]
${quoted}`];
    if (userText) parts.push(`[\u7528\u6237\u6D88\u606F]
${userText}`);
    return parts.join("\n\n");
  }
  async fetchQuotedMessageText(messageId) {
    const fromSdk = await this.consumer?.fetchMessageText(messageId);
    if (fromSdk) return fromSdk;
    return this.attach.fetchMessageText(messageId);
  }
};
function extractTextContent(evt) {
  const c = evt.content?.trim() ?? "";
  if (!c) return "";
  if (c.startsWith("{")) {
    try {
      const parsed = JSON.parse(c);
      if (typeof parsed.text === "string") return parsed.text;
    } catch {
    }
  }
  return c;
}
function stripMentions(text, mentions) {
  let result = text;
  for (const m of mentions) {
    if (m.key && result.includes(m.key)) {
      result = result.split(m.key).join("");
    }
  }
  return result.trim();
}
function findTargetCommentReply(replies, replyId) {
  if (replyId) {
    return replies.find((reply) => reply.reply_id === replyId);
  }
  return replies[replies.length - 1];
}
function stripCommentMentions(text, botOpenId, mentions = []) {
  if (!text) return text;
  let result = text.trim();
  for (const mention of mentions) {
    if (botOpenId && mention.open_id && mention.open_id !== botOpenId) continue;
    for (const token of mentionTokens(mention)) {
      result = result.replace(new RegExp(`^\\s*${escapeRegex(token)}\\s*`, "u"), "");
      if (botOpenId && mention.open_id === botOpenId) {
        result = result.split(token).join("");
      }
    }
  }
  if (botOpenId) {
    result = result.replace(new RegExp(`@${escapeRegex(botOpenId)}`, "g"), "");
  }
  result = result.replace(/^(?:@[^\s@]+\s+)+/, "");
  return result.trim();
}
function mentionTokens(mention) {
  const tokens = [];
  if (mention.key) tokens.push(mention.key);
  if (mention.name) tokens.push(`@${mention.name}`);
  return tokens;
}
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildDocUrl(brand, fileType, fileToken) {
  const host = brand === "lark" ? "larksuite.com" : "feishu.cn";
  const pathByType = {
    doc: "docs",
    docx: "docx",
    sheet: "sheets",
    bitable: "base",
    slides: "slides",
    file: "file"
  };
  const seg = pathByType[fileType] ?? fileType;
  return `https://${host}/${seg}/${fileToken}`;
}
function formatGroupName(topic) {
  const prefix = "[opencode] ";
  const room = 60 - prefix.length;
  const clipped = topic.length > room ? topic.slice(0, room - 1) + "\u2026" : topic;
  return prefix + clipped;
}
function formatChatCreateError(err) {
  const msg = err.message ?? String(err);
  const isPermissionDenied = msg.includes("99991672") || /Permission denied/i.test(msg);
  if (isPermissionDenied) {
    return [
      "**\u521B\u5EFA\u7FA4\u804A\u5931\u8D25\uFF1A\u673A\u5668\u4EBA\u7F3A\u5C11\u300C\u521B\u5EFA\u7FA4\u300D\u7684\u6743\u9650**",
      "",
      "\u4FEE\u590D\u6B65\u9AA4\uFF1A",
      "1. \u6253\u5F00\u98DE\u4E66\u5F00\u653E\u5E73\u53F0 \u2192 \u4F60\u7684\u5E94\u7528 \u2192 **\u6743\u9650\u7BA1\u7406**",
      "2. \u7533\u8BF7\u6743\u9650\u70B9 `im:chat`\uFF08\u7FA4\u7EC4\uFF1A\u83B7\u53D6\u4E0E\u66F4\u65B0\u7FA4\u7EC4\u4FE1\u606F / \u521B\u5EFA/\u89E3\u6563\u7FA4\u7EC4 / \u9080\u8BF7/\u79FB\u9664\u7528\u6237\uFF09",
      "3. **\u7248\u672C\u7BA1\u7406\u4E0E\u53D1\u5E03** \u2192 \u521B\u5EFA\u65B0\u7248\u672C\u5E76\u53D1\u5E03\uFF08\u81EA\u5EFA\u5E94\u7528\u8FD8\u9700\u7BA1\u7406\u5458\u5BA1\u6279\uFF09",
      "4. \u91CD\u542F bridge \u540E\u518D\u6B21\u6267\u884C `/spawn`",
      "",
      "\u4E5F\u53EF\u4EE5\u5148\u7528\u4EE5\u4E0B\u547D\u4EE4\u76F4\u63A5\u9A8C\u8BC1\u6743\u9650\u662F\u5426\u5230\u4F4D\uFF1A",
      '`lark-cli api POST /open-apis/im/v1/chats --as bot --data \'{"name":"opencode test","chat_mode":"group","chat_type":"private"}\'`'
    ].join("\n");
  }
  return `\u521B\u5EFA\u7FA4\u804A\u5931\u8D25\uFF1A${msg}`;
}
var SPAWN_GROUP_DESCRIPTION = "[opencode] \u7FA4\u5185\u76F4\u63A5\u53D1\u6D88\u606F\u65E0\u9700 @\uFF1B\u5E38\u7528\uFF1A/help /new /status /stop /models /cd /undo";
function buildCommentPrompt(args) {
  const lines = [];
  lines.push(`You're answering a comment on a Lark ${args.fileType} document: ${args.docUrl}`);
  if (args.quote) {
    lines.push(`The comment is anchored to this excerpt:`);
    lines.push("");
    lines.push("> " + args.quote.replace(/\n/g, "\n> "));
  }
  lines.push("");
  lines.push(`Question from the comment:`);
  lines.push(args.question);
  lines.push("");
  lines.push(
    "Reply concisely (plain text under 2000 chars). The reader sees this as a Lark comment reply, so avoid markdown formatting."
  );
  return lines.join("\n");
}
export {
  Bridge,
  loadConfig,
  parseSlash,
  saveConfig
};
//# sourceMappingURL=index.js.map