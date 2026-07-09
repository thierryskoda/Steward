/**
 * Shell state: noProjects, noSelection, starting, ready, startupError from projects count, selected root, and runtime status.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { getShellState } from "./shell-state.js";

const noStatus = null;
const loading = true;
const notLoading = false;
const notStarting = false;

describe("getShellState", () => {
  it("returns noProjects when projects count is 0", () => {
    assert.strictEqual(getShellState(0, null, noStatus, notLoading, notStarting), "noProjects");
    assert.strictEqual(
      getShellState(0, undefined, noStatus, notLoading, notStarting),
      "noProjects"
    );
  });

  it("returns noSelection when projects exist but no selected root", () => {
    assert.strictEqual(getShellState(1, null, noStatus, notLoading, notStarting), "noSelection");
    assert.strictEqual(getShellState(2, "", noStatus, notLoading, notStarting), "noSelection");
    assert.strictEqual(
      getShellState(1, undefined, noStatus, notLoading, notStarting),
      "noSelection"
    );
  });

  it("returns starting when selected root is set and status loading or not running", () => {
    assert.strictEqual(getShellState(1, "/x", noStatus, loading, notStarting), "starting");
    assert.strictEqual(getShellState(1, "/x", noStatus, notLoading, notStarting), "starting");
    assert.strictEqual(
      getShellState(
        1,
        "/x",
        { state: "starting", pid: 1, startedAt: 0, lastHeartbeatAt: 0, lastError: null },
        notLoading,
        notStarting
      ),
      "starting"
    );
  });

  it("returns starting when starting mutation is pending", () => {
    assert.strictEqual(getShellState(1, "/x", noStatus, notLoading, true), "starting");
  });

  it("returns stopped when selected root and status is stopped", () => {
    assert.strictEqual(
      getShellState(1, "/x", noStatus, notLoading, notStarting, "stopped"),
      "stopped"
    );
  });

  it("returns ready when selected root and runtime state running", () => {
    assert.strictEqual(
      getShellState(
        1,
        "/x",
        { state: "running", pid: 1, startedAt: 0, lastHeartbeatAt: 0, lastError: null },
        notLoading,
        notStarting
      ),
      "ready"
    );
  });

  it("returns startupError when selected root and runtime state error", () => {
    assert.strictEqual(
      getShellState(
        1,
        "/x",
        { state: "error", pid: 1, startedAt: 0, lastHeartbeatAt: 0, lastError: "Failed" },
        notLoading,
        notStarting
      ),
      "startupError"
    );
  });

  it("returns needsConfig when selected root and runtime state needs-config", () => {
    assert.strictEqual(
      getShellState(
        1,
        "/x",
        { state: "needs-config", pid: 1, startedAt: 0, lastHeartbeatAt: 0, lastError: null },
        notLoading,
        notStarting
      ),
      "needsConfig"
    );
  });
});
