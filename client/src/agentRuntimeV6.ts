import * as THREE from "three";
import { AgentBrainV6, type AgentId, type BrainCommand, type BrainSignal, type Interrupt, type MissionPhase } from "./agentBrainV6.ts";
import { AgentMotionWorldV6, type AgentMotionHooks, type PathProvider } from "./agentMotionV6.ts";

export type AgentRuntimeHooks = Omit<AgentMotionHooks, "signal"> & {
  state?: (snapshot: ReturnType<AgentBrainV6["snapshot"]>) => void;
  command?: (commands: BrainCommand[]) => void;
};

/**
 * Event-driven coordinator between mission planning and 3D animation.
 * No fixed mission timer is used: each next step waits for a real motion/animation signal.
 */
export class AgentRuntimeV6 {
  readonly brain = new AgentBrainV6();
  readonly motion: AgentMotionWorldV6;

  private pending: BrainSignal[] = [];
  private flushing = false;
  private started = false;

  constructor(pathProvider: PathProvider, private hooks: AgentRuntimeHooks = {}) {
    this.motion = new AgentMotionWorldV6(pathProvider, {
      ik: hooks.ik,
      look: hooks.look,
      event: hooks.event,
      signal: signal => this.enqueue(signal),
    });
  }

  registerAgent(agent: AgentId, root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    const avatar = this.motion.register(agent, root, clips);
    if (this.started) this.sync();
    return avatar;
  }

  registerTarget(name: string, object: THREE.Object3D) {
    this.motion.target(name, object);
  }

  start(phase: MissionPhase = "NEW") {
    this.started = true;
    this.brain.setPhase(phase);
    this.sync();
  }

  setPhase(phase: MissionPhase) {
    this.brain.setPhase(phase);
    this.sync();
  }

  patientCritical(active = true) {
    this.brain.setInterrupt(active ? "PATIENT_CRITICAL" : "NONE");
    this.sync();
  }

  failSafe(active = true) {
    this.brain.setInterrupt(active ? "FAIL_SAFE" : "NONE");
    this.sync();
  }

  interrupt(value: Interrupt) {
    this.brain.setInterrupt(value);
    this.sync();
  }

  update(dtSeconds: number) {
    this.motion.update(Math.min(Math.max(dtSeconds, 0), .1));
  }

  snapshot() { return this.brain.snapshot(); }

  private enqueue(signal: BrainSignal) {
    this.pending.push(signal);
    if (!this.flushing) queueMicrotask(() => this.flushSignals());
  }

  private flushSignals() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      // Hard cap protects against a malformed model repeatedly emitting the same marker.
      let budget = 128;
      while (this.pending.length && budget-- > 0) {
        const signal = this.pending.shift()!;
        const commands = this.brain.signal(signal);
        this.apply(commands);
      }
      if (budget <= 0) {
        this.pending.length = 0;
        this.brain.setInterrupt("FAIL_SAFE");
        this.apply(this.brain.commands());
        this.hooks.event?.("medical", "brain-signal-loop-guard");
      }
    } finally {
      this.flushing = false;
      this.hooks.state?.(this.brain.snapshot());
    }
  }

  private sync() { this.apply(this.brain.commands()); }

  private apply(commands: BrainCommand[]) {
    if (!commands.length) {
      this.hooks.state?.(this.brain.snapshot());
      return;
    }
    this.hooks.command?.(commands);
    this.motion.apply(commands);
    this.hooks.state?.(this.brain.snapshot());
  }
}

/**
 * Convenience adapter for a flat X/Z clinic floor. Replace this with a navmesh/A* provider
 * once obstacle geometry is loaded. It intentionally returns only the goal, while the
 * production provider must return a collision-safe route.
 */
export const directPathProvider: PathProvider = (_from, to) => [{ x: to.x, y: to.y }];
