// RTAFNC Agent Brain V6 — clean-room, event-driven game AI.
// Planner is deliberately independent from navigation, animation and renderer.

export type AgentId = "dispatch" | "triage" | "medical" | "documentation" | "auditor";
export type MissionPhase = "NEW" | "DISPATCHED" | "TRIAGE" | "TREATMENT" | "DOCUMENTATION" | "AUDIT" | "COMPLETED";
export type Interrupt = "NONE" | "PATIENT_CRITICAL" | "FAIL_SAFE";
export type Vec2 = { x: number; y: number };
export type MotionStage = "IDLE" | "NAVIGATE" | "ARRIVE_FACE" | "ANTICIPATE" | "ACTION" | "CONTACT" | "FOLLOW_THROUGH" | "RECOVER" | "HELD";

export type BrainCommand =
  | { kind: "navigate"; agent: AgentId; to: Vec2; arrivalRadius: number; speed: "walk" | "run-short" }
  | { kind: "face"; agent: AgentId; target: string }
  | { kind: "play"; agent: AgentId; clip: string; crossFade: number; loop?: boolean }
  | { kind: "look"; agent: AgentId; target: string | null }
  | { kind: "ik"; agent: AgentId; hand: "left" | "right"; target: string | null }
  | { kind: "hold"; agent: AgentId; reason: string }
  | { kind: "event"; agent: AgentId; name: string; payload?: unknown };

export type BrainSignal =
  | { type: "arrived"; agent: AgentId }
  | { type: "facing-ready"; agent: AgentId }
  | { type: "animation-event"; agent: AgentId; event: "anticipate" | "contact" | "follow-through" | "recover" }
  | { type: "animation-finished"; agent: AgentId; clip: string }
  | { type: "path-blocked"; agent: AgentId }
  | { type: "interrupt"; value: Interrupt };

export type AgentDefinition = { id: AgentId; home: Vec2; walkSpeed: number; runSpeed: number; arrivalRadius: number; clips: string[] };
export type Task = { phase: MissionPhase; agent: AgentId; action: string; zone: keyof typeof ZONES | "home"; target?: string; arrivalRadius?: number; critical?: boolean };

export const ZONES = {
  handoff: { x: 2, y: 2 }, bedLeft: { x: 4, y: 4 }, bedRight: { x: 6, y: 4 },
  terminal: { x: 7, y: 2 }, audit: { x: 9, y: 2 }, standby: { x: 5, y: 7 },
} as const;

export const AGENTS: Record<AgentId, AgentDefinition> = {
  dispatch: { id: "dispatch", home: { x: 1, y: 1 }, walkSpeed: 1.9, runSpeed: 3.1, arrivalRadius: .75, clips: ["Idle","Turn","Walk","RunShort","ReceiveCall","TypeConsole","PointRoute","Handoff","Talk"] },
  triage: { id: "triage", home: { x: 3, y: 1 }, walkSpeed: 1.8, runSpeed: 3.0, arrivalRadius: .65, clips: ["Idle","Turn","Walk","RunShort","Acknowledge","Assess","CheckVitals","ReadTablet","Handoff","Talk"] },
  medical: { id: "medical", home: { x: 5, y: 1 }, walkSpeed: 1.75, runSpeed: 3.0, arrivalRadius: .55, clips: ["Idle","Turn","Walk","RunShort","BedsideCheck","Examine","Treat","CheckMonitor","AdjustIV","Handoff","Talk"] },
  documentation: { id: "documentation", home: { x: 7, y: 1 }, walkSpeed: 1.7, runSpeed: 2.8, arrivalRadius: .7, clips: ["Idle","Turn","Walk","TypeRecord","ReviewChart","SendData","ConfirmNote"] },
  auditor: { id: "auditor", home: { x: 9, y: 1 }, walkSpeed: 1.65, runSpeed: 2.7, arrivalRadius: .75, clips: ["Idle","Turn","Walk","ReviewFile","InspectMetrics","Approve","Reject","CloseCase"] },
};

const TASKS: Record<MissionPhase, Task[]> = {
  NEW: [
    { phase:"NEW", agent:"dispatch", action:"ReceiveCall", zone:"home" },
    { phase:"NEW", agent:"dispatch", action:"TypeConsole", zone:"home" },
    { phase:"NEW", agent:"dispatch", action:"PointRoute", zone:"handoff", target:"triage" },
    { phase:"NEW", agent:"dispatch", action:"Handoff", zone:"handoff", target:"triage" },
  ],
  DISPATCHED: [
    { phase:"DISPATCHED", agent:"triage", action:"Acknowledge", zone:"handoff", target:"dispatch" },
    { phase:"DISPATCHED", agent:"triage", action:"ReadTablet", zone:"bedLeft", target:"patient" },
  ],
  TRIAGE: [
    { phase:"TRIAGE", agent:"triage", action:"Assess", zone:"bedLeft", target:"patient", critical:true },
    { phase:"TRIAGE", agent:"triage", action:"CheckVitals", zone:"bedLeft", target:"patient", critical:true },
    { phase:"TRIAGE", agent:"triage", action:"Handoff", zone:"handoff", target:"medical" },
  ],
  TREATMENT: [
    { phase:"TREATMENT", agent:"medical", action:"BedsideCheck", zone:"bedRight", target:"patient", critical:true },
    { phase:"TREATMENT", agent:"medical", action:"Examine", zone:"bedRight", target:"patient", critical:true },
    { phase:"TREATMENT", agent:"medical", action:"Treat", zone:"bedRight", target:"patient", critical:true },
    { phase:"TREATMENT", agent:"medical", action:"CheckMonitor", zone:"bedRight", target:"monitor", critical:true },
    { phase:"TREATMENT", agent:"medical", action:"Handoff", zone:"terminal", target:"documentation" },
  ],
  DOCUMENTATION: [
    { phase:"DOCUMENTATION", agent:"documentation", action:"TypeRecord", zone:"terminal" },
    { phase:"DOCUMENTATION", agent:"documentation", action:"ReviewChart", zone:"terminal" },
    { phase:"DOCUMENTATION", agent:"documentation", action:"SendData", zone:"terminal", target:"auditor" },
    { phase:"DOCUMENTATION", agent:"documentation", action:"ConfirmNote", zone:"terminal" },
  ],
  AUDIT: [
    { phase:"AUDIT", agent:"auditor", action:"ReviewFile", zone:"audit" },
    { phase:"AUDIT", agent:"auditor", action:"InspectMetrics", zone:"audit" },
    { phase:"AUDIT", agent:"auditor", action:"Approve", zone:"audit" },
    { phase:"AUDIT", agent:"auditor", action:"CloseCase", zone:"audit" },
  ],
  COMPLETED: [],
};

const PHASE_ORDER: MissionPhase[] = ["NEW","DISPATCHED","TRIAGE","TREATMENT","DOCUMENTATION","AUDIT","COMPLETED"];
const zoneOf = (t: Task): Vec2 => t.zone === "home" ? AGENTS[t.agent].home : ZONES[t.zone];

export class AgentBrainV6 {
  phase: MissionPhase = "NEW";
  interrupt: Interrupt = "NONE";
  private queue: Task[] = [];
  private current?: Task;
  private stage: MotionStage = "IDLE";

  constructor() { this.replan(); }
  snapshot() { return { phase:this.phase, interrupt:this.interrupt, stage:this.stage, current:this.current, queued:this.queue.length }; }

  setPhase(phase: MissionPhase) { this.phase = phase; this.interrupt = "NONE"; this.replan(); }
  setInterrupt(value: Interrupt) { this.interrupt = value; value === "FAIL_SAFE" ? this.stage = "HELD" : this.replan(); }

  signal(signal: BrainSignal): BrainCommand[] {
    if (signal.type === "interrupt") { this.setInterrupt(signal.value); return this.commands(); }
    if (signal.type === "path-blocked") {
      if (this.current?.agent !== signal.agent) return [];
      this.stage = "NAVIGATE";
      return [{ kind:"event", agent:signal.agent, name:"replan-path" }, ...this.commands()];
    }
    if (!this.current || signal.agent !== this.current.agent) return [];

    if (signal.type === "arrived" && this.stage === "NAVIGATE") this.stage = "ARRIVE_FACE";
    else if (signal.type === "facing-ready" && this.stage === "ARRIVE_FACE") this.stage = "ANTICIPATE";
    else if (signal.type === "animation-event" && signal.event === "anticipate" && this.stage === "ANTICIPATE") this.stage = "ACTION";
    else if (signal.type === "animation-event" && signal.event === "contact" && this.stage === "ACTION") this.stage = "CONTACT";
    else if (signal.type === "animation-event" && signal.event === "follow-through" && (this.stage === "CONTACT" || this.stage === "ACTION")) this.stage = "FOLLOW_THROUGH";
    else if (signal.type === "animation-finished" && signal.clip === this.current.action) this.stage = "RECOVER";
    else if (signal.type === "animation-event" && signal.event === "recover" && this.stage === "RECOVER") this.advanceTask();
    return this.commands();
  }

  commands(): BrainCommand[] {
    if (this.interrupt === "FAIL_SAFE") return (Object.keys(AGENTS) as AgentId[]).map(agent => ({ kind:"hold", agent, reason:"FAIL_SAFE" }));
    if (this.interrupt === "PATIENT_CRITICAL") return this.criticalCommands();
    if (!this.current) return [];

    const t = this.current, def = AGENTS[t.agent], target = t.target ?? t.zone;
    switch (this.stage) {
      case "NAVIGATE": return [{ kind:"navigate", agent:t.agent, to:zoneOf(t), arrivalRadius:t.arrivalRadius ?? def.arrivalRadius, speed:t.critical ? "run-short" : "walk" }];
      case "ARRIVE_FACE": return [{ kind:"play", agent:t.agent, clip:"Turn", crossFade:.14 }, { kind:"face", agent:t.agent, target }, { kind:"look", agent:t.agent, target }];
      case "ANTICIPATE": return [{ kind:"play", agent:t.agent, clip:t.action, crossFade:.18 }, { kind:"look", agent:t.agent, target }];
      case "ACTION": return [{ kind:"play", agent:t.agent, clip:t.action, crossFade:.12 }, { kind:"look", agent:t.agent, target }, ...this.hands(t)];
      case "CONTACT": return [{ kind:"event", agent:t.agent, name:`${t.action}:contact`, payload:{ target } }, { kind:"look", agent:t.agent, target }, ...this.hands(t)];
      case "FOLLOW_THROUGH": return [{ kind:"play", agent:t.agent, clip:t.action, crossFade:.08 }, { kind:"look", agent:t.agent, target }];
      case "RECOVER": return [{ kind:"play", agent:t.agent, clip:"Idle", crossFade:.2, loop:true }, { kind:"look", agent:t.agent, target:null }, { kind:"ik", agent:t.agent, hand:"left", target:null }, { kind:"ik", agent:t.agent, hand:"right", target:null }];
      default: return [];
    }
  }

  private hands(t: Task): BrainCommand[] {
    if (["Treat","Examine","CheckVitals","BedsideCheck"].includes(t.action)) return [{ kind:"ik", agent:t.agent, hand:"right", target:"patient" }];
    if (t.action === "AdjustIV") return [{ kind:"ik", agent:t.agent, hand:"right", target:"iv" }];
    if (t.action === "Handoff") return [{ kind:"ik", agent:t.agent, hand:"right", target:t.target ?? null }];
    if (/Tablet|Chart|File|Record|Metrics/.test(t.action)) return [{ kind:"ik", agent:t.agent, hand:"left", target:"tablet" }];
    return [];
  }

  private criticalCommands(): BrainCommand[] {
    return [
      { kind:"navigate", agent:"triage", to:ZONES.bedLeft, arrivalRadius:.55, speed:"run-short" },
      { kind:"navigate", agent:"medical", to:ZONES.bedRight, arrivalRadius:.5, speed:"run-short" },
      { kind:"look", agent:"triage", target:"patient" }, { kind:"look", agent:"medical", target:"patient" },
      { kind:"event", agent:"medical", name:"preempt-lower-priority-work" },
    ];
  }

  private replan() {
    if (this.interrupt === "FAIL_SAFE") return;
    if (this.interrupt === "PATIENT_CRITICAL") { this.stage = "NAVIGATE"; return; }
    this.queue = [...TASKS[this.phase]];
    this.current = this.queue.shift();
    this.stage = this.current ? "NAVIGATE" : "IDLE";
  }

  private advanceTask() {
    this.current = this.queue.shift();
    if (this.current) { this.stage = "NAVIGATE"; return; }
    const i = PHASE_ORDER.indexOf(this.phase);
    this.phase = PHASE_ORDER[Math.min(i + 1, PHASE_ORDER.length - 1)];
    this.queue = [...TASKS[this.phase]];
    this.current = this.queue.shift();
    this.stage = this.current ? "NAVIGATE" : "IDLE";
  }
}

export const MOTION_CONTRACT_V6 = {
  plannerHz:4, navigationReplanMs:120, renderHz:60, crossFadeSeconds:.18,
  turnDegreesPerSecond:240, acceleration:4.5, deceleration:6.5,
  positionCorrection:"exponential-blend", footPhase:"distance-driven",
  animationLayers:["locomotion","upper-body-task","look-at","hands-ik","face"],
  interruptPriority:["FAIL_SAFE","PATIENT_CRITICAL","TREATMENT","TRIAGE","HANDOFF","DOCUMENTATION","AUDIT","IDLE"],
} as const;
