# Audio Engine

**Source:** `src/audio/AudioEngine.ts`, `src/audio/synth.ts`

The `AudioEngine` class owns the single `AudioContext` for the session. All
audio in Polyphonia flows through it.

## The golden rule

> Every stem is scheduled off the **same** `AudioContext` clock and started at
> the **same** absolute time. Never restart a source to apply an edit.

Breaking this rule causes drift. Even a few milliseconds of scheduling skew
compounds over loops and makes stems audibly phase against each other.

## Audio graph structure

```
[AudioBufferSourceNode] → [GainNode: per-track volume]
                              ↓                    ↓
              [LiveTrackInstance per tile copy]     [AnalyserNode: metering]
                    ↓
              [PannerNode: HRTF spatialization]
                    ↓
              [GainNode: distance gain]
                    ↓
              [GainNode: occlusion gain] + [BiquadFilterNode: occlusion LPF]
                    ↓
              [GainNode: dry bus] ─────────────────────────────────┐
                    ↓                                               ↓
              [GainNode: reverb send] → [ConvolverNode] → [GainNode: wet]
                                                                    ↓
                                                         [GainNode: master]
                                                                    ↓
                                                         [AudioDestinationNode]
```

Each track has one `AudioBufferSourceNode` feeding a single gain + analyser,
then one or more `LiveTrackInstance` objects — one for the base position and
additional ones for tiled/looped virtual copies. Each instance has its own
panner, distance gain, occlusion gain, and occlusion filter.

## Loop preparation

When a composition has a `beats` value, stems are prepared into clean loop
buffers before playback starts:

1. **Leading silence detection** (`leadingSilence`): scans each decoded buffer
   to find where the actual audio begins. MP3 encoders prepend silence as padding
   (encoder delay); this offset is recorded as `loopOffset`.
2. **Musical length** (`loopLength`): computed as `beats * (60 / bpm)` seconds.
   For compositions without `beats`, it is inferred by BPM-aligning the longest
   loaded stem.
3. **`prepareLoopBuffer`**: copies the source audio from `loopOffset` into a
   new buffer of exactly `loopLength`. Clips shorter than `loopLength` are padded
   with silence. Clips longer are trimmed. A short crossfade (default 35 ms) is
   blended at the end→start seam to mask any boundary click.
4. **Per-stem sub-loop** (`loopStart`/`loopEnd`): if a track has its own loop
   in/out points, those are respected within `prepareLoopBuffer`. Short sub-loops
   can tile repeatedly to fill the composition length (`loopRepeat`).
5. **Loop tail** (`loopTail`): if a stem has a reverb tail that runs slightly
   past the musical length, that overrun is folded back onto the start of the
   loop rather than clipped, so the tail rings naturally across the seam. Capped
   at `LOOP_TAIL_MAX_BEATS` so a genuinely longer stem is not folded onto itself.

The prepared buffer is what the `AudioBufferSourceNode` loops. The source buffer
is retained separately so per-stem parameters (sub-loop points, offset beats)
can be re-prepared without re-fetching audio.

## Starting playback

`engine.start()` schedules all tracks at the same `ctx.currentTime + startDelay`.
Every `AudioBufferSourceNode.start()` call receives the same absolute time.

`engine.addLiveTrack(def, buffer)` phase-aligns a new stem to the already-running
loop. It computes where in the current loop iteration the clock is and starts the
new source at the equivalent position, so it snaps in without audible glitch.

## Listener updates

`engine.updateListener(position, forward, map)` is called every frame by
`<ListenerSync>`. It:

1. Moves the Web Audio `AudioListener` to the new camera position/orientation.
2. On a throttled interval (`listenerUpdateInterval`, 0 on desktop / 30 Hz on
   mobile), updates `PannerNode` positions and listener orientation params.
3. On a slower interval (`acousticsUpdateInterval`), recomputes occlusion for
   each stem:
   - **Room wall occlusion** (`roomWallObstructionCount`): counts how many room
     walls the listener→stem line crosses, weighted by wall thickness.
   - **Tunnel occlusion** (`tunnelObstructionCount`): counts tunnel side-wall
     crossings.
   - **Standalone wall occlusion** (`wallObstructionCount`): counts standalone
     `MapWall` crossings.
   - Each occlusion reduces gain and applies a low-pass filter to muffle the
     sound.
4. On an even slower interval (`roomUpdateInterval`), updates room reverb: when
   the listener enters a room, a convolver IR is loaded for that room's geometry
   and the reverb send is faded in.

## Tiled virtual instances

On tiled or path-looped maps, a stem exists at multiple positions simultaneously
(once per visible tile copy). The engine creates additional `LiveTrackInstance`
objects for nearby copies, up to `maxVirtualAudioInstancesPerTrack` (4 on
desktop, 2 on mobile). Each instance has its own panner positioned at the
transformed coordinates of that tile. All instances share the same
`AudioBufferSourceNode` — only the panners differ.

## Adaptive performance mode

At construction, the engine detects mobile vs. desktop (`preferredAudioPerformanceMode`):

| Setting | Desktop (full) | Mobile (reduced) |
|---|---|---|
| Panning model | HRTF | equalpower |
| Max virtual instances | 4 | 2 |
| Tile audio radius | 120 | 80 |
| Listener update interval | every frame | 30 Hz |
| Acoustics update interval | every frame | 20 Hz |
| Room update interval | every frame | 8 Hz |

Override with `?audioQuality=full` or `?audioQuality=reduced`.

## Live setters (never restart playback)

All edits to playing stems go through these setters, not by reloading:

- `engine.setVolume(id, volume)` — adjusts the per-track gain
- `engine.setMinVolume(id, minVolume)` — adjusts the per-instance distance floor
- `engine.setPosition(id, position)` — repositions all panners for a track
- `engine.setFalloff(id, {refDistance, maxDistance, rolloff})` — updates panner
  distance model params
- `engine.updateLoopSettings(comp)` — applies `loopStart`/`loopEndTrim`/etc.
  without reloading buffers

## Procedural fallback (`synth.ts`)

Stems with `source.kind === "synth"` use `createPlaceholderStems` to generate
in-memory `AudioBuffer` objects (bass, pad, arp, drums presets) so the app runs
with zero audio files. These are synthesized at composition load time using the
`AudioContext`'s offline rendering pipeline.
