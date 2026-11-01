# RTAFNC Agent Brain V6

## Purpose

V6 converts the medical AI characters from timed UI actors into event-driven game agents. Planning, navigation, locomotion, animation, interaction and rendering are separate layers. The mission advances only when a real movement or animation event confirms progress.

## Motion graph

`GOAL -> NAVIGATE -> ARRIVE -> FACE TARGET -> ANTICIPATE -> ACTION -> CONTACT -> FOLLOW-THROUGH -> RECOVER -> NEXT TASK`

A fixed mission timer must never be used to skip these stages.

## Runtime priorities

1. FAIL_SAFE
2. PATIENT_CRITICAL
3. TREATMENT
4. TRIAGE
5. HANDOFF
6. DOCUMENTATION
7. AUDIT
8. IDLE

`FAIL_SAFE` cancels motion and holds all actors at safe state. `PATIENT_CRITICAL` preempts lower-priority work and sends Triage + Medical to bedside using `RunShort`, then normal planning resumes after the interrupt clears.

## Navigation contract

Production navigation should use an A*/navmesh provider. The renderer asks for a route from current X/Z to a goal. A route is replanned when an obstacle blocks movement or when a target moves. The agent has an action-specific arrival radius and never teleports because a route cannot be found.

Movement characteristics:

- walk/run acceleration rather than instant velocity
- deceleration at arrival
- turn-to-target before action
- distance-driven walk-cycle phase to reduce foot skating
- stuck detection and path replan
- current position stays authoritative; corrections should be blended, not snapped, except large warps/reset events

## Animation contract

Every character is a humanoid GLB with a compatible skeleton. Recommended model rules:

- units: meters
- Y up
- character forward: +Z in runtime after import normalization
- PBR materials
- one skinned character root per agent
- named animation clips or an explicit alias map
- transform origin at feet
- no baked world translation in task clips; locomotion is controlled by runtime/root motion policy

Required locomotion clips:

`Idle`, `Turn`, `Walk`, `RunShort`

Role clips:

### Dispatch
`ReceiveCall`, `TypeConsole`, `PointRoute`, `Handoff`, `Talk`

### Triage
`Acknowledge`, `Assess`, `CheckVitals`, `ReadTablet`, `Handoff`, `Talk`

### Medical
`BedsideCheck`, `Examine`, `Treat`, `CheckMonitor`, `AdjustIV`, `Handoff`, `Talk`

### Documentation
`TypeRecord`, `ReviewChart`, `SendData`, `ConfirmNote`

### Auditor
`ReviewFile`, `InspectMetrics`, `Approve`, `Reject`, `CloseCase`

## Animation events

Task clips should expose four logical moments:

- `anticipate`: actor visibly prepares the task
- `contact`: hand/tool actually reaches the target; gameplay effect is emitted here
- `follow-through`: visible completion after contact
- `recover`: actor returns to a locomotion/idle-ready pose

The current Three.js adapter supplies normalized marker defaults when the GLB itself has no marker metadata. Future exported assets should use sidecar marker JSON for per-clip tuning.

## Layering

The intended animation stack is:

1. locomotion
2. upper-body task
3. look-at
4. hand IK
5. facial/attention layer

This lets a nurse look at a patient or reach toward a monitor while lower-body locomotion remains natural.

## Named scene targets

Register these scene objects with `AgentRuntimeV6.registerTarget()` when present:

- `patient`
- `monitor`
- `iv`
- `tablet`
- `dispatch`
- `triage`
- `medical`
- `documentation`
- `auditor`

## Integration

```ts
const runtime = new AgentRuntimeV6(navmeshPathProvider, {
  look: applyLookAtRig,
  ik: applyHandIK,
  event: applyGameplayContact,
  state: updateDebugHud,
});

runtime.registerAgent("triage", triageScene, triageAnimations);
runtime.registerTarget("patient", patientRoot);
runtime.start("NEW");

function frame(dt: number) {
  runtime.update(dt);
}
```

Movement/animation feedback is wired back to the brain automatically. The game should not call the next task manually unless it is an explicit operator override.

## Licensing / clean-room boundary

The motion architecture was derived from observed gameplay concepts in the upstream Rune Online project: goal planning, replanning, arrival ranges, smoothing, animation action phases and interruptible automation. V6 is an original implementation for RTAFNC and does not copy upstream source code. Keep upstream GPL-derived code separate unless the whole resulting distribution is intentionally handled under compatible GPL terms.

## Safety

`production_write=false` remains the default for the AI Agent simulation. Treatment animations are visual workflow simulations; any clinical decision support or real patient record write requires a separately approved backend/RBAC/audit path.
