/**
 * opencode **v2** API adaptation.
 *
 * opencode 2.x moved every endpoint under `/api`, requires HTTP Basic auth
 * (`opencode:<password>`), renamed several routes, reshaped every response into
 * a `{ data }` envelope, changed the prompt body, and replaced the event
 * taxonomy. The rest of the bridge is written against the v1 shape, so we
 * translate at the two edges — requests/responses and the SSE stream — and keep
 * the internals unchanged.
 *
 * Verified against opencode 2.0.30.
 */
import { createLogger } from "../log.js";

const log = createLogger("opencode.v2");

export type ApiVersion = "v1" | "v2";

// ────────────────────────────────────────────────────────── request mapping

/**
 * Rewrite a logical (v1) path to the v2 wire path. Returns `null` for routes
 * that have no v2 equivalent. Method-aware: v2 splits prompting (`POST …/prompt`)
 * from reading messages (`GET …/message`) on what v1 treated as one path.
 */
export function mapPath(v1Path: string, method = "GET"): string | null {
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
        return null; // no v2 equivalent
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
  if (pathOnly.startsWith("/permission/")) return null; // handled via session scope
  return `/api${pathOnly}${q}`;
}

function splitQuery(p: string): [string, string] {
  const i = p.indexOf("?");
  return i === -1 ? [p, ""] : [p.slice(0, i), p.slice(i + 1)];
}

// ────────────────────────────────────────────────────── response normalising

/** v2 wraps every JSON response in `{ data: … }` (lists add `cursor`). */
export function unwrapData(json: unknown): unknown {
  if (json && typeof json === "object" && "data" in (json as Record<string, unknown>)) {
    return (json as Record<string, unknown>).data;
  }
  return json;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** `GET /session` → the v1 array of `{ id, title, directory }`. */
export function normalizeSessions(json: unknown): unknown {
  const data = unwrapData(json);
  if (!Array.isArray(data)) return [];
  return data.map((s) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const loc = (o.location ?? {}) as Record<string, unknown>;
    return { id: str(o.id), title: str(o.title), directory: str(loc.directory) };
  });
}

/** `POST /session` → `{ id, title, directory }`. */
export function normalizeSession(json: unknown): unknown {
  const o = (unwrapData(json) ?? {}) as Record<string, unknown>;
  const loc = (o.location ?? {}) as Record<string, unknown>;
  return { id: str(o.id), title: str(o.title), directory: str(loc.directory) };
}

/** `GET /agent` → the v1 array of `{ name, mode, description }`. */
export function normalizeAgents(json: unknown): unknown {
  const data = unwrapData(json);
  if (!Array.isArray(data)) return [];
  return data.map((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    return {
      name: str(o.id) ?? str(o.name),
      mode: str(o.mode) ?? "primary",
      description: str(o.description) ?? str(o.name),
    };
  });
}

/** `GET /config/providers` ← `GET /api/model` (a flat model list). */
export function normalizeProviders(json: unknown): unknown {
  const data = unwrapData(json);
  if (!Array.isArray(data)) return { providers: [], default: {} };
  const byProvider = new Map<string, { id: string; name: string; models: Record<string, unknown> }>();
  for (const raw of data) {
    const m = (raw ?? {}) as Record<string, unknown>;
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

/** v2 message shape (`type`, `content[]`, `text`) → v1 `{ info, parts }`. */
export function toV1Message(m: Record<string, unknown>): {
  info: { id?: string; role?: string; time?: unknown };
  parts: Record<string, unknown>[];
} {
  const parts: Record<string, unknown>[] = [];
  const type = str(m.type);
  if (type === "user") {
    if (typeof m.text === "string") parts.push({ type: "text", text: m.text });
  } else if (Array.isArray(m.content)) {
    for (const c of m.content as Record<string, unknown>[]) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "text") parts.push({ type: "text", text: str(c.text) ?? "" });
      else if (c.type === "tool") {
        parts.push({ type: "tool", tool: str(c.name), state: { status: str(c.status), input: c.input } });
      }
    }
  }
  return { info: { id: str(m.id), role: type, time: m.time }, parts };
}

/** `GET /session/{id}/message` → the v1 array of `{ info, parts }`. */
export function normalizeMessages(json: unknown): unknown {
  const data = unwrapData(json);
  if (!Array.isArray(data)) return [];
  return data.map((m) => toV1Message((m ?? {}) as Record<string, unknown>));
}

/** Plain text out of a v2 assistant message's `content[]`. */
export function messageText(m: Record<string, unknown> | undefined): string {
  if (!m || !Array.isArray(m.content)) return "";
  return (m.content as Record<string, unknown>[])
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

// ────────────────────────────────────────────────────────── event translating

type Envelope = { type: string; properties: Record<string, unknown> };

function part(
  sessionID: unknown,
  messageID: unknown,
  partID: string,
  partBody: Record<string, unknown>,
  extra?: Record<string, unknown>,
): Envelope {
  return {
    type: "message.part.updated",
    properties: {
      part: { id: partID, sessionID, messageID, ...partBody },
      ...(extra ?? {}),
    },
  };
}

/**
 * Translate one v2 event into the v1 envelopes the bridge's `normalize()`
 * already understands. The shim did exactly this; keep the two in step.
 */
export function translateV2Event(ev: Record<string, unknown>): Envelope[] {
  const t = str(ev?.type);
  const d = (ev?.data ?? {}) as Record<string, unknown>;
  if (!t) return [];

  switch (t) {
    case "server.connected":
      return [{ type: "server.connected", properties: {} }];

    case "session.step.started":
      return d.assistantMessageID
        ? [
            {
              type: "message.updated",
              properties: {
                info: { id: d.assistantMessageID, sessionID: d.sessionID, role: "assistant" },
              },
            },
          ]
        : [];

    case "session.inbox.enqueued": {
      const item = (d.item ?? {}) as Record<string, unknown>;
      return item.type === "user" && d.inboxID
        ? [
            {
              type: "message.updated",
              properties: { info: { id: d.inboxID, sessionID: d.sessionID, role: "user" } },
            },
          ]
        : [];
    }

    case "session.execution.started":
      return [{ type: "session.status", properties: { sessionID: d.sessionID, status: { type: "busy" } } }];

    case "session.execution.succeeded":
    case "session.execution.interrupted":
      return [{ type: "session.status", properties: { sessionID: d.sessionID, status: { type: "idle" } } }];

    case "session.execution.failed": {
      const err = (d.error ?? {}) as Record<string, unknown>;
      const msg = str(err.message) ?? str(d.message) ?? "execution failed";
      return [
        { type: "session.error", properties: { sessionID: d.sessionID, error: { message: msg } } },
        { type: "session.status", properties: { sessionID: d.sessionID, status: { type: "idle" } } },
      ];
    }

    case "session.text.delta":
      return [
        part(d.sessionID, d.assistantMessageID, `text-${d.ordinal ?? 0}`, { type: "text" }, {
          delta: str(d.delta) ?? "",
        }),
      ];

    case "session.reasoning.delta":
      return [
        part(d.sessionID, d.assistantMessageID, `reasoning-${d.ordinal ?? 0}`, { type: "reasoning" }, {
          delta: str(d.delta) ?? "",
        }),
      ];

    case "session.tool.called":
      return [
        part(d.sessionID, d.assistantMessageID, String(d.id), {
          type: "tool",
          tool: d.name,
          state: { status: "running", input: d.input },
        }),
      ];

    case "session.tool.success":
      return [
        part(d.sessionID, d.assistantMessageID, String(d.id), {
          type: "tool",
          tool: d.name,
          state: { status: "completed" },
          text: contentToText(d.content),
        }),
      ];

    case "session.tool.failed": {
      const err = (d.error ?? {}) as Record<string, unknown>;
      return [
        part(d.sessionID, d.assistantMessageID, String(d.id), {
          type: "tool",
          tool: d.name,
          state: { status: "error" },
          text: str(err.message) ?? contentToText(d.content),
        }),
      ];
    }

    default:
      // Permission prompts: v2 event names vary by build, so match defensively.
      if (/permission/i.test(t) && (d.sessionID || d.id || d.requestID)) {
        return [
          {
            type: "permission.asked",
            properties: {
              sessionID: d.sessionID,
              id: d.id ?? d.requestID ?? d.permissionID,
              permission: d.permission ?? d.name ?? d.type ?? "permission",
            },
          },
        ];
      }
      if (t !== "project.updated" && t !== "session.usage.updated") {
        // Most v2 chatter (capability/UI notifications) is simply irrelevant to
        // the bridge; logging it drowns the useful lines.
        if (!BENIGN_V2_EVENTS.has(t)) log.debug(`untranslated v2 event: ${t}`);
      }
      return [];
  }
}

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as Record<string, unknown>[])
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

/**
 * v2 events that are expected and carry nothing the bridge acts on. Kept as a
 * list (rather than a prefix rule) so a genuinely new *session* event still gets
 * logged when opencode changes.
 */
const BENIGN_V2_EVENTS = new Set([
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
  "project.updated",
]);

/**
 * Probe which API generation a server speaks.
 *
 * Deliberately avoids two traps found on opencode 2.0.30:
 *   - `/api/health` does **not** exist there (it 404s once authenticated), so
 *     "404 ⇒ v1" is wrong;
 *   - root `/session` answers 200 on v2 too, because `opencode serve` also hosts
 *     a web UI — so it must be checked as *JSON*, not by status alone.
 *
 * `GET /api/session` is the reliable discriminator: 200/401/403 ⇒ v2, 404 ⇒ v1.
 */
export async function detectApiVersion(
  baseUrl: string,
  password?: string | null,
): Promise<ApiVersion> {
  const headers: Record<string, string> = {};
  if (password) {
    headers.authorization = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const api = await fetch(`${baseUrl}/api/session`, {
        headers,
        signal: AbortSignal.timeout(3_000),
      });
      // 401/403 still prove the v2 surface exists (it just wants credentials).
      if (api.status !== 404) return "v2";

      // No /api surface — confirm v1 positively: the API answers JSON, whereas
      // v2's web UI answers HTML on the same path.
      const legacy = await fetch(`${baseUrl}/session`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3_000),
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
    `cannot determine the opencode API version at ${baseUrl} ` +
      `(${(lastError as Error)?.message ?? lastError}). ` +
      `Set "opencodeApiVersion" to "v1" or "v2" to skip detection.`,
  );
}
