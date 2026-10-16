import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapPath,
  normalizeAgents,
  normalizeMessages,
  normalizeProviders,
  normalizeSession,
  normalizeSessions,
  toV1Message,
  translateV2Event,
  unwrapData,
} from "../src/opencode/v2.js";

describe("mapPath", () => {
  it("prefixes the v2 API root", () => {
    assert.equal(mapPath("/session"), "/api/session");
    assert.equal(mapPath("/agent"), "/api/agent");
    assert.equal(mapPath("/config/providers"), "/api/model");
    assert.equal(mapPath("/event"), "/api/event");
  });

  it("keeps the query string", () => {
    assert.equal(mapPath("/session?directory=%2Ftmp"), "/api/session?directory=%2Ftmp");
  });

  it("splits prompting from reading messages by method", () => {
    // v1 used one path for both; v2 has /prompt and /message.
    assert.equal(mapPath("/session/abc/message", "POST"), "/api/session/abc/prompt");
    assert.equal(mapPath("/session/abc/message", "GET"), "/api/session/abc/message");
    assert.equal(mapPath("/session/abc/prompt_async", "POST"), "/api/session/abc/prompt");
  });

  it("renames the routes that changed", () => {
    assert.equal(mapPath("/session/abc/abort", "POST"), "/api/session/abc/interrupt");
    assert.equal(mapPath("/session/abc/summarize", "POST"), "/api/session/abc/compact");
    assert.equal(mapPath("/session/abc/revert", "POST"), "/api/session/abc/revert/stage");
    assert.equal(mapPath("/session/abc/unrevert", "POST"), "/api/session/abc/revert/clear");
  });

  it("reports routes with no v2 equivalent", () => {
    assert.equal(mapPath("/session/abc/share", "POST"), null);
    assert.equal(mapPath("/session/abc/init", "POST"), null);
  });
});

describe("response normalising", () => {
  it("unwraps the data envelope", () => {
    assert.deepEqual(unwrapData({ data: { id: "x" } }), { id: "x" });
    assert.deepEqual(unwrapData({ plain: 1 }), { plain: 1 });
  });

  it("maps sessions and flattens location.directory", () => {
    const out = normalizeSessions({
      data: [{ id: "s1", title: "t", location: { directory: "/repo" } }],
      cursor: {},
    });
    assert.deepEqual(out, [{ id: "s1", title: "t", directory: "/repo" }]);
  });

  it("maps a created session", () => {
    assert.deepEqual(normalizeSession({ data: { id: "s1", title: "t", location: { directory: "/x" } } }), {
      id: "s1",
      title: "t",
      directory: "/x",
    });
  });

  it("maps agents", () => {
    assert.deepEqual(normalizeAgents({ data: [{ id: "build", name: "Build" }] }), [
      { name: "build", mode: "primary", description: "Build" },
    ]);
  });

  it("regroups the flat model list into providers", () => {
    const out = normalizeProviders({
      data: [
        { providerID: "deepseek", modelID: "flash", name: "Flash" },
        { providerID: "deepseek", modelID: "pro", name: "Pro" },
        { providerID: "other", modelID: "m", name: "M" },
      ],
    }) as { providers: { id: string; models: Record<string, unknown> }[]; default: unknown };
    assert.deepEqual(Object.keys(out.providers[0]!.models), ["flash", "pro"]);
    assert.equal(out.providers.length, 2);
    assert.deepEqual(out.default, {});
  });

  it("maps v2 messages onto { info, parts }", () => {
    const out = normalizeMessages({
      data: [
        { id: "u1", type: "user", text: "hi", time: { created: 1 } },
        { id: "a1", type: "assistant", content: [{ type: "text", text: "yo" }], time: { created: 2 } },
        { id: "i1", type: "idle", time: { created: 3 } },
      ],
    }) as { info: { id: string; role: string }; parts: unknown[] }[];
    assert.equal(out[0]!.info.role, "user");
    assert.deepEqual(out[0]!.parts, [{ type: "text", text: "hi" }]);
    assert.equal(out[1]!.info.role, "assistant");
    assert.deepEqual(out[1]!.parts, [{ type: "text", text: "yo" }]);
    // idle is preserved: promptV2 uses it as the turn-end marker
    assert.equal(out[2]!.info.role, "idle");
  });

  it("keeps tool parts legible", () => {
    const m = toV1Message({
      id: "a1",
      type: "assistant",
      content: [{ type: "tool", name: "bash", status: "completed", input: { command: "ls" } }],
    });
    assert.deepEqual(m.parts[0], {
      type: "tool",
      tool: "bash",
      state: { status: "completed", input: { command: "ls" } },
    });
  });
});

describe("translateV2Event", () => {
  it("forwards the handshake", () => {
    assert.deepEqual(translateV2Event({ type: "server.connected", data: {} }), [
      { type: "server.connected", properties: {} },
    ]);
  });

  it("announces assistant messages so parts are not buffered forever", () => {
    const out = translateV2Event({
      type: "session.step.started",
      data: { sessionID: "s", assistantMessageID: "m" },
    });
    assert.equal(out[0]!.type, "message.updated");
    assert.deepEqual(out[0]!.properties.info, { id: "m", sessionID: "s", role: "assistant" });
  });

  it("maps execution state onto busy/idle", () => {
    assert.deepEqual(
      translateV2Event({ type: "session.execution.started", data: { sessionID: "s" } })[0]!.properties
        .status,
      { type: "busy" },
    );
    assert.deepEqual(
      translateV2Event({ type: "session.execution.succeeded", data: { sessionID: "s" } })[0]!
        .properties.status,
      { type: "idle" },
    );
  });

  it("emits error AND idle when a run fails", () => {
    const out = translateV2Event({
      type: "session.execution.failed",
      data: { sessionID: "s", error: { message: "boom" } },
    });
    assert.equal(out.length, 2);
    assert.equal(out[0]!.type, "session.error");
    assert.deepEqual(out[0]!.properties.error, { message: "boom" });
    assert.deepEqual(out[1]!.properties.status, { type: "idle" });
  });

  it("streams text as deltas only (the renderer accumulates)", () => {
    const out = translateV2Event({
      type: "session.text.delta",
      data: { sessionID: "s", assistantMessageID: "m", ordinal: 0, delta: "he" },
    });
    assert.equal(out[0]!.type, "message.part.updated");
    assert.equal(out[0]!.properties.part.id, "text-0");
    assert.equal(out[0]!.properties.delta, "he");
  });

  it("maps tool lifecycle with status and output", () => {
    const called = translateV2Event({
      type: "session.tool.called",
      data: { sessionID: "s", assistantMessageID: "m", id: "c1", name: "bash", input: { command: "ls" } },
    });
    assert.deepEqual(called[0]!.properties.part.state, { status: "running", input: { command: "ls" } });

    const ok = translateV2Event({
      type: "session.tool.success",
      data: { sessionID: "s", assistantMessageID: "m", id: "c1", content: [{ type: "text", text: "out" }] },
    });
    assert.deepEqual(ok[0]!.properties.part.state, { status: "completed" });
    assert.equal(ok[0]!.properties.part.text, "out");

    const failed = translateV2Event({
      type: "session.tool.failed",
      data: { sessionID: "s", assistantMessageID: "m", id: "c1", error: { message: "nope" } },
    });
    assert.deepEqual(failed[0]!.properties.part.state, { status: "error" });
    assert.equal(failed[0]!.properties.part.text, "nope");
  });

  it("ignores unrelated events without throwing", () => {
    assert.deepEqual(translateV2Event({ type: "project.updated", data: {} }), []);
    assert.deepEqual(translateV2Event({ data: {} }), []);
  });
});
