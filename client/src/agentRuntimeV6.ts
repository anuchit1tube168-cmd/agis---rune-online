import * as THREE from "three";
import { AgentBrainV6, type AgentId, type BrainCommand, type BrainSignal, type Interrupt, type MissionPhase } from "./agentBrainV6.ts";
import { AgentMotionWorldV6, type AgentMotionHooks, type PathProvider } from "./agentMotionV6.ts";

export type AgentRuntimeHooks = Omit<AgentMotionHooks, "signal"> & {
  state?: (snapshot: ReturnType<AgentBrainV6["snapshot"]>) => void;
  command?: (commands: BrainCommand[]) => void;
};

/** Event-driven bridge between mission planning and 3D motion. */
export class AgentRuntimeV6 {
  readonly brain = new AgentBrainV6();
  readonly motion: AgentMotionWorldV6;
  private hooks: AgentRuntimeHooks;
  private pending: BrainSignal[] = [];
  private flushing = false;
  private started = false;

  constructor(pathProvider: PathProvider, hooks: AgentRuntimeHooks = {}) {
    this.hooks = hooks;
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
  registerTarget(name: string, object: THREE.Object3D) { this.motion.target(name, object); }
  start(phase: MissionPhase = "NEW") { this.started = true; this.brain.setPhase(phase); this.sync(); }
  setPhase(phase: MissionPhase) { this.brain.setPhase(phase); this.sync(); }
  patientCritical(active = true) { this.brain.setInterrupt(active ? "PATIENT_CRITICAL" : "NONE"); this.sync(); }
  failSafe(active = true) { this.brain.setInterrupt(active ? "FAIL_SAFE" : "NONE"); this.sync(); }
  interrupt(value: Interrupt) { this.brain.setInterrupt(value); this.sync(); }
  update(dtSeconds: number) { this.motion.update(Math.min(Math.max(dtSeconds, 0), .1)); }
  snapshot() { return this.brain.snapshot(); }

  private enqueue(signal: BrainSignal) {
    this.pending.push(signal);
    if (!this.flushing) queueMicrotask(() => this.flushSignals());
  }

  private flushSignals() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let budget = 128;
      while (this.pending.length && budget-- > 0) {
        const signal = this.pending.shift()!;
        this.apply(this.brain.signal(signal));
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
    if (!commands.length) { this.hooks.state?.(this.brain.snapshot()); return; }
    this.hooks.command?.(commands);
    this.motion.apply(commands);
    this.hooks.state?.(this.brain.snapshot());
  }
}

/** Flat-floor fallback for prototypes; replace with A*/
export const directPathProvider: PathProvider = (_from, to) => [{ x: to.x, y: to.y }];
