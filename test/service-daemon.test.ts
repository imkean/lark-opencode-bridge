import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { systemdUnit, windowsTaskXml } from "../src/service/daemon.js";

describe("windowsTaskXml", () => {
  const xml = windowsTaskXml({ larkCli: "C:\\bin\\lark-cli.cmd", opencode: "C:\\bin\\opencode.cmd" }, "C:\\work");

  it("is a well-formed UTF-16 scheduled task", () => {
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-16"\?>/);
    assert.match(xml, /<Task version="1\.2"/);
    assert.match(xml, /<LogonTrigger>/);
  });

  it("runs the bridge via cmd with the binary flags and log redirection", () => {
    assert.match(xml, /<Command>cmd\.exe<\/Command>/);
    assert.match(xml, /lark-opencode-bridge\.mjs/);
    assert.match(xml, /run/);
    // schtasks XML escapes the redirection operators.
    assert.match(xml, /1&gt;&gt;/);
    assert.match(xml, /service\.stdout\.log/);
    assert.match(xml, /service\.stderr\.log/);
    assert.match(xml, /--lark-cli/);
    assert.match(xml, /--opencode/);
  });

  it("restarts on crash but not on clean exit", () => {
    // RestartOnFailure mirrors launchd KeepAlive{SuccessfulExit:false} / systemd Restart=always.
    assert.match(xml, /<RestartOnFailure>/);
    assert.match(xml, /<Interval>PT1M<\/Interval>/);
  });
});

describe("systemdUnit", () => {
  const unit = systemdUnit({ larkCli: "/usr/bin/lark-cli", opencode: "/usr/bin/opencode" }, "/home/u/project");

  it("pins the working directory", () => {
    // Without this, systemd --user would run the daemon in $HOME, and a chat
    // with no /cd would opencode in the home directory instead of the project.
    assert.match(unit, /^WorkingDirectory=\/home\/u\/project$/m);
  });

  it("unsets proxy variables", () => {
    // The Feishu SDK honours *_proxy; a non-tunnelling proxy makes every call
    // fail with "400 The plain HTTP request was sent to HTTPS port".
    const line = unit.match(/^UnsetEnvironment=(.*)$/m)?.[1] ?? "";
    for (const key of ["http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) {
      assert.ok(line.split(/\s+/).includes(key), `missing ${key}`);
    }
  });

  it("keeps restart semantics and PATH", () => {
    assert.match(unit, /^Restart=always$/m);
    assert.match(unit, /^Environment=PATH=\S+/m);
    assert.match(unit, /^WantedBy=default\.target$/m);
  });
});

describe("windowsTaskXml working directory", () => {
  it("sets the task's working directory", () => {
    const xml = windowsTaskXml(
      { larkCli: "C:\\bin\\lark-cli.cmd", opencode: "C:\\bin\\opencode.cmd" },
      "C:\\work\\project",
    );
    assert.match(xml, /<WorkingDirectory>C:\\work\\project<\/WorkingDirectory>/);
  });
});
