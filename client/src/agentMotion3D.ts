import * as THREE from "three";
import type { AgentId, BrainCommand, Vec2 } from "./agentBrain.ts";

export type AnimationMarkers = {
  anticipate?: number;
  contact?: number;
  followThrough?: number;
};

export type AgentMotionHooks = {
  arrived?: (agent: AgentId) => void;
  facingReady?: (agent: AgentId) => void;
  animationEvent?: (agent: AgentId, event: "anticipate" | "contact" | "follow-through") => void;
  animationFinished?: (agent: AgentId, clip: string) => void;
  pathBlocked?: (agent: AgentId) => void;
  ik?: (agent: AgentId, hand: "left" | "right", target: string | null) => void;
  look?: (agent: AgentId, target: string | null) => void;
};

export type PathProvider = (from: Vec2, to: Vec2, agent: AgentId) => Vec2[] | null;

const DEFAULT_MARKERS: Record<string, AnimationMarkers> = {
  Handoff: { anticipate: 0.18, contact: 0.56, followThrough: 0.78 },
  Assess: { anticipate: 0.12, contact: 0.46, followThrough: 0.82 },
  CheckVitals: { anticipate: 0.12, contact: 0.50, followThrough: 0.84 },
  BedsideCheck: { anticipate: 0.14, contact: 0.48, followThrough: 0.82 },
  Examine: { anticipate: 0.14, contact: 0.52, followThrough: 0.84 },
  Treat: { anticipate: 0.12, contact: 0.58, followThrough: 0.86 },
  CheckMonitor: { anticipate: 0.10, contact: 0.48, followThrough: 0.80 },
  AdjustIV: { anticipate: 0.12, contact: 0.55, followThrough: 0.84 },
  SendData: { anticipate: 0.16, contact: 0.58, followThrough: 0.84 },
  Approve: { anticipate: 0.18, contact: 0.55, followThrough: 0.82 },
  Reject: { anticipate: 0.18, contact: 0.55, followThrough: 0.82 },
  CloseCase: { anticipate: 0.15, contact: 0.56, followThrough: 0.82 },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function findClip(clips: THREE.AnimationClip[], name: string) {
  const key = norm(name);
  return clips.find(c => norm(c.name) === key)
    ?? clips.find(c => norm(c.name).includes(key))
    ?? clips.find(c => key.includes(norm(c.name)));
}

export class AgentAvatar3D {
  readonly mixer: THREE.AnimationMixer;
  readonly root: THREE.Object3D;
  readonly clips: THREE.AnimationClip[];
  readonly agent: AgentId;

  maxWalkSpeed = 1.8;
  maxRunSpeed = 3.0;
  acceleration = 4.5;
  deceleration = 6.5;
  turnRadiansPerSecond = THREE.MathUtils.degToRad(240);
  arrivalRadius = 0.6;
  crossFadeSeconds = 0.18;

  private velocity = 0;
  private path: Vec2[] = [];
  private currentAction?: THREE.AnimationAction;
  private currentClip = "Idle";
  private targetFacing?: THREE.Vector3;
  private markers: Record<string, AnimationMarkers> = { ...DEFAULT_MARKERS };
  private fired = new Set<string>();
  private blockedFor = 0;
  private lastPosition = new THREE.Vector3();
  private locomotionDistance = 0;
  private requestedSpeed: "walk" | "run-short" = "walk";
  private facingSignalSent = false;

  constructor(agent: AgentId, root: THREE.Object3D, clips: THREE.AnimationClip[], private hooks: AgentMotionHooks = {}) {
    this.agent = agent;
    this.root = root;
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(root);
    this.lastPosition.copy(root.position);
    this.mixer.addEventListener("finished", (e: any) => {
      const clip = e.action?.getClip?.()?.name ?? this.currentClip;
      this.hooks.animationFinished?.(this.agent, clip);
    });
    this.play("Idle", true, 0);
  }

  setMarkers(clip: string, markers: AnimationMarkers) { this.markers[clip] = markers; }

  navigate(path: Vec2[], arrivalRadius = this.arrivalRadius, speed: "walk" | "run-short" = "walk") {
    this.path = path.slice();
    this.arrivalRadius = arrivalRadius;
    this.requestedSpeed = speed;
    this.blockedFor = 0;
    this.play(speed === "run-short" ? "RunShort" : "Walk", true);
  }

  faceWorldPoint(point: THREE.Vector3) {
    this.targetFacing = point.clone();
    this.facingSignalSent = false;
    if (!this.path.length) this.play("Turn", true, 0.12);
  }

  stop() {
    this.path.length = 0;
    this.velocity = 0;
    this.play("Idle", true);
  }

  play(name: string, loop = false, fade = this.crossFadeSeconds) {
    const clip = findClip(this.clips, name);
    if (!clip) return false;
    const next = this.mixer.clipAction(clip);
    if (next === this.currentAction && this.currentClip === name) return true;

    next.enabled = true;
    next.reset();
    next.setEffectiveWeight(1);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;

    if (this.currentAction) next.crossFadeFrom(this.currentAction, fade, true);
    next.play();
    this.currentAction = next;
    this.currentClip = name;
    this.fired.clear();
    return true;
  }

  update(dt: number) {
    this.updateNavigation(dt);
    this.updateFacing(dt);
    this.mixer.update(dt);
    this.updateAnimationMarkers();
  }

  private updateNavigation(dt: number) {
    if (!this.path.length) {
      this.velocity = Math.max(0, this.velocity - this.deceleration * dt);
      return;
    }

    const next = this.path[0];
    const target = new THREE.Vector3(next.x, this.root.position.y, next.y);
    const delta = target.clone().sub(this.root.position);
    const distance = Math.hypot(delta.x, delta.z);

    if (distance <= this.arrivalRadius) {
      this.path.shift();
      if (!this.path.length) {
        this.velocity = 0;
        this.play("Idle", true);
        this.hooks.arrived?.(this.agent);
        return;
      }
      return;
    }

    const desiredSpeed = this.requestedSpeed === "run-short" ? this.maxRunSpeed : this.maxWalkSpeed;
    this.velocity = Math.min(desiredSpeed, this.velocity + this.acceleration * dt);
    const step = Math.min(distance, this.velocity * dt);
    delta.y = 0;
    delta.normalize();
    this.root.position.addScaledVector(delta, step);
    this.targetFacing = target;

    const moved = this.root.position.distanceTo(this.lastPosition);
    this.locomotionDistance += moved;
    if (moved < 0.002 && desiredSpeed > 0.1) this.blockedFor += dt; else this.blockedFor = 0;
    this.lastPosition.copy(this.root.position);

    // Animation time follows travelled distance so feet do not skate when speed changes.
    if (this.currentAction && (this.currentClip === "Walk" || this.currentClip === "RunShort")) {
      const stride = this.currentClip === "RunShort" ? 1.45 : 1.05;
      const cycle = this.currentAction.getClip().duration || 1;
      this.currentAction.time = ((this.locomotionDistance / stride) % 1) * cycle;
    }

    if (this.blockedFor > 0.75) {
      this.blockedFor = 0;
      this.hooks.pathBlocked?.(this.agent);
    }
  }

  private updateFacing(dt: number) {
    if (!this.targetFacing) return;
    const d = this.targetFacing.clone().sub(this.root.position);
    d.y = 0;
    if (d.lengthSq() < 1e-6) return;

    const targetYaw = Math.atan2(d.x, d.z);
    const targetQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetYaw);
    const angle = this.root.quaternion.angleTo(targetQ);
    const max = this.turnRadiansPerSecond * dt;
    this.root.quaternion.rotateTowards(targetQ, max);

    if (angle < THREE.MathUtils.degToRad(4) && !this.facingSignalSent) {
      this.facingSignalSent = true;
      this.hooks.facingReady?.(this.agent);
    }
  }

  private updateAnimationMarkers() {
    if (!this.currentAction) return;
    const clip = this.currentAction.getClip();
    if (!clip.duration || clip.duration <= 0) return;
    const p = Math.min(1, this.currentAction.time / clip.duration);
    const m = this.markers[this.currentClip];
    if (!m) return;

    const fire = (name: "anticipate" | "contact" | "follow-through", at?: number) => {
      if (at === undefined || p < at || this.fired.has(name)) return;
      this.fired.add(name);
      this.hooks.animationEvent?.(this.agent, name);
    };
    fire("anticipate", m.anticipate);
    fire("contact", m.contact);
    fire("follow-through", m.followThrough);
  }
}

export class AgentMotionWorld {
  private avatars = new Map<AgentId, AgentAvatar3D>();
  private namedTargets = new Map<string, THREE.Object3D>();

  constructor(private pathProvider: PathProvider, private hooks: AgentMotionHooks = {}) {}

  register(agent: AgentId, root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    const avatar = new AgentAvatar3D(agent, root, clips, this.hooks);
    this.avatars.set(agent, avatar);
    return avatar;
  }

  target(name: string, object: THREE.Object3D) { this.namedTargets.set(name, object); }

  apply(commands: BrainCommand[]) {
    for (const command of commands) {
      const avatar = this.avatars.get(command.agent);
      if (!avatar) continue;

      if (command.kind === "navigate") {
        const from = { x: avatar.root.position.x, y: avatar.root.position.z };
        const path = this.pathProvider(from, command.to, command.agent);
        if (!path?.length) { this.hooks.pathBlocked?.(command.agent); continue; }
        avatar.navigate(path, command.arrivalRadius, command.speed);
      } else if (command.kind === "face") {
        const target = this.namedTargets.get(command.target);
        if (target) avatar.faceWorldPoint(target.getWorldPosition(new THREE.Vector3()));
      } else if (command.kind === "play") {
        avatar.play(command.clip, !!command.loop, command.crossFade);
      } else if (command.kind === "look") {
        this.hooks.look?.(command.agent, command.target);
      } else if (command.kind === "ik") {
        this.hooks.ik?.(command.agent, command.hand, command.target);
      } else if (command.kind === "hold") {
        avatar.stop();
      }
    }
  }

  update(dt: number) { for (const avatar of this.avatars.values()) avatar.update(dt); }
}
