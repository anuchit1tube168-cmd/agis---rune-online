import assert from "node:assert/strict";
import test from "node:test";
import { AgentBrainV6, AGENTS } from "../../client/src/agentBrainV6.ts";

function completeCurrent(brain: AgentBrainV6) {
  const current = brain.snapshot().current;
  assert.ok(current, "expected an active task");
  const agent = current.agent;
  const action = current.action;

  let commands = brain.signal({ type: "arrived", agent });
  assert.ok(commands.some(c => c.kind === "face"), "arrival should request facing");

  commands = brain.signal({ type: "facing-ready", agent });
  assert.ok(commands.some(c => c.kind === "play" && c.clip === action), "facing should start action anticipation");

  commands = brain.signal({ type: "animation-event", agent, event: "anticipate" });
  assert.ok(commands.some(c => c.kind === "play" && c.clip === action), "anticipation should enter action");

  commands = brain.signal({ type: "animation-event", agent, event: "contact" });
  assert.ok(commands.some(c => c.kind === "event" && c.name === `${action}:contact`), "contact should emit gameplay event");

  brain.signal({ type: "animation-event", agent, event: "follow-through" });
  commands = brain.signal({ type: "animation-finished", agent, clip: action });
  assert.ok(commands.some(c => c.kind === "play" && c.clip === "Idle"), "finished action should recover to idle");

  brain.signal({ type: "animation-event", agent, event: "recover" });
}

test("Agent Brain V6 progresses an entire medical mission using events, not timers", () => {
  const brain = new AgentBrainV6();
  let guard = 64;

  while (brain.snapshot().phase !== "COMPLETED" && guard-- > 0) {
    assert.equal(brain.snapshot().stage, "NAVIGATE");
    completeCurrent(brain);
  }

  assert.ok(guard > 0, "mission should complete without a state deadlock");
  assert.equal(brain.snapshot().phase, "COMPLETED");
  assert.equal(brain.snapshot().stage, "IDLE");
  assert.equal(brain.snapshot().current, undefined);
});

test("FAIL_SAFE holds every agent and emits no treatment action", () => {
  const brain = new AgentBrainV6();
  const commands = brain.signal({ type: "interrupt", value: "FAIL_SAFE" });
  const holds = commands.filter(c => c.kind === "hold");

  assert.equal(holds.length, Object.keys(AGENTS).length);
  assert.ok(holds.every(c => c.kind === "hold" && c.reason === "FAIL_SAFE"));
  assert.equal(brain.snapshot().stage, "HELD");
});

test("PATIENT_CRITICAL preempts routine work and sends Triage + Medical to bedside", () => {
  const brain = new AgentBrainV6();
  const commands = brain.signal({ type: "interrupt", value: "PATIENT_CRITICAL" });
  const nav = commands.filter(c => c.kind === "navigate");

  assert.equal(nav.length, 2);
  assert.deepEqual(new Set(nav.map(c => c.kind === "navigate" ? c.agent : "")), new Set(["triage", "medical"]));
  assert.ok(nav.every(c => c.kind === "navigate" && c.speed === "run-short"));
});

test("blocked path keeps task goal and requests a replan", () => {
  const brain = new AgentBrainV6();
  const before = brain.snapshot().current;
  assert.ok(before);

  const commands = brain.signal({ type: "path-blocked", agent: before.agent });
  assert.ok(commands.some(c => c.kind === "event" && c.name === "replan-path"));
  assert.ok(commands.some(c => c.kind === "navigate"));
  assert.deepEqual(brain.snapshot().current, before);
});
