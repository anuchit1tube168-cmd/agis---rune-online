import * as THREE from "three";
import { AGENTS, type AgentId, type BrainCommand, type BrainSignal, type Vec2 } from "./agentBrainV6.ts";

export type AnimationMarkers = { anticipate?: number; contact?: number; followThrough?: number };
export type AgentMotionHooks = {
  signal?: (signal: BrainSignal) => void;
  ik?: (agent: AgentId, hand: "left" | "right", target: string | null) => void;
  look?: (agent: AgentId, target: string | null) => void;
  event?: (agent: AgentId, name: string, payload?: unknown) => void;
};
export type PathProvider = (from: Vec2, to: Vec2, agent: AgentId) => Vec2[] | null;

const MARKERS: Record<string, AnimationMarkers> = {
  ReceiveCall:{anticipate:.12,contact:.52,followThrough:.82}, TypeConsole:{anticipate:.10,contact:.48,followThrough:.84},
  PointRoute:{anticipate:.12,contact:.52,followThrough:.82}, Handoff:{anticipate:.18,contact:.56,followThrough:.78},
  Acknowledge:{anticipate:.12,contact:.48,followThrough:.80}, ReadTablet:{anticipate:.10,contact:.52,followThrough:.84},
  Assess:{anticipate:.12,contact:.46,followThrough:.82}, CheckVitals:{anticipate:.12,contact:.50,followThrough:.84},
  BedsideCheck:{anticipate:.14,contact:.48,followThrough:.82}, Examine:{anticipate:.14,contact:.52,followThrough:.84},
  Treat:{anticipate:.12,contact:.58,followThrough:.86}, CheckMonitor:{anticipate:.10,contact:.48,followThrough:.80},
  AdjustIV:{anticipate:.12,contact:.55,followThrough:.84}, TypeRecord:{anticipate:.10,contact:.52,followThrough:.86},
  ReviewChart:{anticipate:.12,contact:.50,followThrough:.84}, SendData:{anticipate:.16,contact:.58,followThrough:.84},
  ConfirmNote:{anticipate:.12,contact:.52,followThrough:.82}, ReviewFile:{anticipate:.12,contact:.52,followThrough:.84},
  InspectMetrics:{anticipate:.12,contact:.52,followThrough:.84}, Approve:{anticipate:.18,contact:.55,followThrough:.82},
  Reject:{anticipate:.18,contact:.55,followThrough:.82}, CloseCase:{anticipate:.15,contact:.56,followThrough:.82},
};
const norm = (s:string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const dist2 = (a:Vec2,b:Vec2) => Math.hypot(a.x-b.x,a.y-b.y);
function findClip(clips:THREE.AnimationClip[], name:string) {
  const key=norm(name);
  return clips.find(c=>norm(c.name)===key) ?? clips.find(c=>norm(c.name).includes(key)) ?? clips.find(c=>key.includes(norm(c.name)));
}

export class AgentAvatarV6 {
  readonly mixer: THREE.AnimationMixer;
  readonly root: THREE.Object3D;
  readonly clips: THREE.AnimationClip[];
  readonly agent: AgentId;
  maxWalkSpeed:number; maxRunSpeed:number; arrivalRadius:number;
  acceleration=4.5; deceleration=6.5; turnRadiansPerSecond=THREE.MathUtils.degToRad(240); crossFadeSeconds=.18;

  private hooks: AgentMotionHooks;
  private velocity=0; private path:Vec2[]=[]; private currentAction?:THREE.AnimationAction; private currentClip="Idle";
  private targetFacing?:THREE.Vector3; private markers:Record<string,AnimationMarkers>={...MARKERS}; private fired=new Set<string>();
  private blockedFor=0; private lastPosition=new THREE.Vector3(); private locomotionDistance=0;
  private requestedSpeed:"walk"|"run-short"="walk"; private facingSignalSent=false;

  constructor(agent:AgentId, root:THREE.Object3D, clips:THREE.AnimationClip[], hooks:AgentMotionHooks={}) {
    const def=AGENTS[agent];
    this.agent=agent; this.root=root; this.clips=clips; this.hooks=hooks;
    this.maxWalkSpeed=def.walkSpeed; this.maxRunSpeed=def.runSpeed; this.arrivalRadius=def.arrivalRadius;
    this.mixer=new THREE.AnimationMixer(root); this.lastPosition.copy(root.position);
    this.mixer.addEventListener("finished", (e:any) => {
      const clip=e.action?.getClip?.()?.name ?? this.currentClip;
      this.hooks.signal?.({type:"animation-finished",agent:this.agent,clip});
    });
    this.play("Idle",true,0);
  }

  setMarkers(clip:string, markers:AnimationMarkers){ this.markers[clip]=markers; }
  navigate(path:Vec2[], arrivalRadius=this.arrivalRadius, speed:"walk"|"run-short"="walk"){
    this.path=path.slice(); this.arrivalRadius=arrivalRadius; this.requestedSpeed=speed; this.blockedFor=0;
    this.play(speed==="run-short"?"RunShort":"Walk",true);
  }
  faceWorldPoint(point:THREE.Vector3){ this.targetFacing=point.clone(); this.facingSignalSent=false; if(!this.path.length)this.play("Turn",true,.12); }
  stop(){ this.path.length=0; this.velocity=0; this.play("Idle",true); }

  play(name:string, loop=false, fade=this.crossFadeSeconds){
    const clip=findClip(this.clips,name);
    if(!clip){ this.hooks.event?.(this.agent,"missing-animation",{requested:name,available:this.clips.map(c=>c.name)}); return false; }
    const next=this.mixer.clipAction(clip);
    if(next===this.currentAction && this.currentClip===name)return true;
    const previous=this.currentClip;
    next.enabled=true; next.reset(); next.setEffectiveWeight(1); next.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1); next.clampWhenFinished=!loop;
    if(this.currentAction)next.crossFadeFrom(this.currentAction,fade,true);
    next.play(); this.currentAction=next; this.currentClip=name; this.fired.clear();
    if(name==="Idle" && previous!=="Idle") setTimeout(()=>this.hooks.signal?.({type:"animation-event",agent:this.agent,event:"recover"}),Math.max(120,fade*1000));
    return true;
  }

  update(dt:number){ this.updateNavigation(dt); this.updateFacing(dt); this.mixer.update(dt); this.updateMarkers(); }

  private updateNavigation(dt:number){
    if(!this.path.length){ this.velocity=Math.max(0,this.velocity-this.deceleration*dt); return; }
    const next=this.path[0], target=new THREE.Vector3(next.x,this.root.position.y,next.y), delta=target.clone().sub(this.root.position);
    const distance=Math.hypot(delta.x,delta.z);
    if(distance<=this.arrivalRadius){
      this.path.shift();
      if(!this.path.length){ this.velocity=0; this.play("Idle",true); this.hooks.signal?.({type:"arrived",agent:this.agent}); }
      return;
    }
    const desired=this.requestedSpeed==="run-short"?this.maxRunSpeed:this.maxWalkSpeed;
    this.velocity=Math.min(desired,this.velocity+this.acceleration*dt);
    const step=Math.min(distance,this.velocity*dt); delta.y=0; delta.normalize(); this.root.position.addScaledVector(delta,step); this.targetFacing=target;
    const moved=this.root.position.distanceTo(this.lastPosition); this.locomotionDistance+=moved;
    this.blockedFor=moved<.002&&desired>.1?this.blockedFor+dt:0; this.lastPosition.copy(this.root.position);
    if(this.currentAction&&(this.currentClip==="Walk"||this.currentClip==="RunShort")){
      const stride=this.currentClip==="RunShort"?1.45:1.05, cycle=this.currentAction.getClip().duration||1;
      this.currentAction.time=((this.locomotionDistance/stride)%1)*cycle;
    }
    if(this.blockedFor>.75){ this.blockedFor=0; this.hooks.signal?.({type:"path-blocked",agent:this.agent}); }
  }

  private updateFacing(dt:number){
    if(!this.targetFacing)return;
    const d=this.targetFacing.clone().sub(this.root.position); d.y=0; if(d.lengthSq()<1e-6)return;
    const yaw=Math.atan2(d.x,d.z), q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
    this.root.quaternion.rotateTowards(q,this.turnRadiansPerSecond*dt);
    if(this.root.quaternion.angleTo(q)<THREE.MathUtils.degToRad(4)&&!this.facingSignalSent){ this.facingSignalSent=true; this.hooks.signal?.({type:"facing-ready",agent:this.agent}); }
  }

  private updateMarkers(){
    if(!this.currentAction)return;
    const clip=this.currentAction.getClip(); if(!clip.duration)return;
    const p=Math.min(1,this.currentAction.time/clip.duration), m=this.markers[this.currentClip]; if(!m)return;
    const fire=(event:"anticipate"|"contact"|"follow-through",at?:number)=>{ if(at===undefined||p<at||this.fired.has(event))return; this.fired.add(event); this.hooks.signal?.({type:"animation-event",agent:this.agent,event}); };
    fire("anticipate",m.anticipate); fire("contact",m.contact); fire("follow-through",m.followThrough);
  }
}

export class AgentMotionWorldV6 {
  private avatars=new Map<AgentId,AgentAvatarV6>();
  private namedTargets=new Map<string,THREE.Object3D>();
  private pathProvider: PathProvider;
  private hooks: AgentMotionHooks;

  constructor(pathProvider:PathProvider, hooks:AgentMotionHooks={}){ this.pathProvider=pathProvider; this.hooks=hooks; }
  register(agent:AgentId,root:THREE.Object3D,clips:THREE.AnimationClip[]){ const a=new AgentAvatarV6(agent,root,clips,this.hooks); this.avatars.set(agent,a); this.namedTargets.set(agent,root); return a; }
  target(name:string,object:THREE.Object3D){ this.namedTargets.set(name,object); }
  apply(commands:BrainCommand[]){
    for(const c of commands){
      const a=this.avatars.get(c.agent); if(!a)continue;
      if(c.kind==="navigate"){
        const from={x:a.root.position.x,y:a.root.position.z};
        if(dist2(from,c.to)<=c.arrivalRadius){ queueMicrotask(()=>this.hooks.signal?.({type:"arrived",agent:c.agent})); continue; }
        const path=this.pathProvider(from,c.to,c.agent);
        if(!path?.length){ queueMicrotask(()=>this.hooks.signal?.({type:"path-blocked",agent:c.agent})); continue; }
        a.navigate(path,c.arrivalRadius,c.speed);
      }else if(c.kind==="face"){
        const t=this.namedTargets.get(c.target); if(t)a.faceWorldPoint(t.getWorldPosition(new THREE.Vector3())); else queueMicrotask(()=>this.hooks.signal?.({type:"facing-ready",agent:c.agent}));
      }else if(c.kind==="play") a.play(c.clip,!!c.loop,c.crossFade);
      else if(c.kind==="look") this.hooks.look?.(c.agent,c.target);
      else if(c.kind==="ik") this.hooks.ik?.(c.agent,c.hand,c.target);
      else if(c.kind==="hold") a.stop();
      else if(c.kind==="event") this.hooks.event?.(c.agent,c.name,c.payload);
    }
  }
  update(dt:number){ for(const a of this.avatars.values())a.update(dt); }
}
