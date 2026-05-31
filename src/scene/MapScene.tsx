import { ThreeEvent, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TrackDef } from "../composition";
import { CompositionMap, WalkableSegment } from "../map";
import { useStore } from "../store";

const MAX_TRACK_LIGHTS = 12;

export function MapScene({ map, tracks, editMode }: { map: CompositionMap; tracks: TrackDef[]; editMode: boolean }) {
  const endpointCounts = new Map<string, number>();
  for (const segment of map.segments) {
    for (const point of [segment.start, segment.end]) {
      const key = pointKey(point);
      endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
    }
  }
  return (
    <group>
      <StartMarker map={map} editMode={editMode} />
      {map.segments.map((segment) => (
        <Segment key={segment.id} segment={segment} tracks={tracks} editMode={editMode} endpointCounts={endpointCounts} />
      ))}
      {editMode && <EndpointEditor map={map} endpointCounts={endpointCounts} />}
    </group>
  );
}

function StartMarker({ map, editMode }: { map: CompositionMap; editMode: boolean }) {
  const [x, z] = map.start.position;
  const [fx, fz] = map.start.direction;
  const angle = -Math.atan2(fz, fx);
  const opacity = editMode ? 0.9 : 0.45;

  return (
    <group position={[x, 0.08, z]} rotation={[0, angle, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.65, 1.15, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={opacity} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[1.45, 0.02, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.38, 0.9, 3]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={opacity} toneMapped={false} depthWrite={false} />
      </mesh>
      <pointLight position={[0, 0.8, 0]} color="#ffffff" intensity={editMode ? 1.2 : 0.5} distance={5} />
    </group>
  );
}

function Segment({
  segment,
  tracks,
  editMode,
  endpointCounts,
}: {
  segment: WalkableSegment;
  tracks: TrackDef[];
  editMode: boolean;
  endpointCounts: Map<string, number>;
}) {
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const length = Math.hypot(dx, dz);
  const angle = -Math.atan2(dz, dx);
  const mid: [number, number, number] = [(segment.start[0] + segment.end[0]) / 2, 0, (segment.start[1] + segment.end[1]) / 2];
  const halfWidth = segment.width / 2;
  const normal: [number, number] = length === 0 ? [0, 1] : [-dz / length, dx / length];

  return (
    <group>
      <mesh position={[mid[0], 0.026, mid[2]]} rotation={[-Math.PI / 2, 0, angle]}>
        <planeGeometry args={[length, segment.width]} />
        <PathMaterial tracks={tracks} editMode={editMode} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[mid[0] + normal[0] * halfWidth * side, 0.045, mid[2] + normal[1] * halfWidth * side]} rotation={[-Math.PI / 2, 0, angle]}>
          <planeGeometry args={[length, 0.16]} />
          <meshBasicMaterial
            color={editMode ? "#dce7ff" : "#c8d2df"}
            transparent
            opacity={editMode ? 0.42 : 0.24}
            toneMapped={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
      {[segment.start, segment.end].map((point, i) => (
        <group key={i}>
          <mesh position={[point[0], 0.028, point[1]]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[halfWidth, 40]} />
            <PathMaterial tracks={tracks} editMode={editMode} />
          </mesh>
          {(endpointCounts.get(pointKey(point)) ?? 0) === 1 && (
            <mesh position={[point[0], 0.047, point[1]]} rotation={[-Math.PI / 2, 0, angle]}>
              <planeGeometry args={[0.16, segment.width]} />
              <meshBasicMaterial
                color={editMode ? "#dce7ff" : "#c8d2df"}
                transparent
                opacity={editMode ? 0.46 : 0.28}
                toneMapped={false}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

function PathMaterial({ tracks, editMode }: { tracks: TrackDef[]; editMode: boolean }) {
  const uniforms = useMemo(() => {
    const positions = Array.from({ length: MAX_TRACK_LIGHTS }, () => new THREE.Vector3(0, 0, 0));
    const colors = Array.from({ length: MAX_TRACK_LIGHTS }, () => new THREE.Color("#000000"));
    tracks.slice(0, MAX_TRACK_LIGHTS).forEach((track, i) => {
      const volume = track.volume ?? 1;
      const refDistance = track.refDistance ?? 4;
      const maxDistance = track.maxDistance ?? 40;
      positions[i].set(track.position[0], track.position[2], Math.max(7, Math.min(24, refDistance + maxDistance * 0.22 + volume * 4)));
      colors[i].set(track.color);
    });
    return {
      baseColor: { value: new THREE.Color("#c8d2df") },
      trackPositions: { value: positions },
      trackColors: { value: colors },
      trackCount: { value: Math.min(tracks.length, MAX_TRACK_LIGHTS) },
      opacity: { value: editMode ? 0.72 : 0.56 },
      edgeBoost: { value: editMode ? 0.36 : 0.22 },
    };
  }, [tracks, editMode]);

  return (
    <shaderMaterial
      transparent
      depthWrite={false}
      toneMapped={false}
      blending={THREE.AdditiveBlending}
      side={THREE.DoubleSide}
      uniforms={uniforms}
      vertexShader={pathVertexShader}
      fragmentShader={pathFragmentShader}
    />
  );
}

function EndpointEditor({ map, endpointCounts }: { map: CompositionMap; endpointCounts: Map<string, number> }) {
  const controls = useThree((s) => s.controls as { enabled?: boolean } | undefined);
  const selectedMapPointKey = useStore((s) => s.selectedMapPointKey);
  const setMap = useStore((s) => s.setMap);
  const selectMapPoint = useStore((s) => s.selectMapPoint);
  const drag = useRef<{ pointKey: string } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const endpoints = useMemo(() => {
    const points = new Map<string, [number, number]>();
    for (const segment of map.segments) {
      points.set(pointKey(segment.start), segment.start);
      points.set(pointKey(segment.end), segment.end);
    }
    return Array.from(points.entries()).map(([key, point]) => ({
      id: key,
      key,
      point,
      shared: (endpointCounts.get(key) ?? 0) > 1,
    }));
  }, [endpointCounts, map.segments]);

  function moveEndpoint(e: ThreeEvent<PointerEvent>) {
    if (!drag.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(ground, hit)) return;
    const next: [number, number] = [hit.x, hit.z];
    const activeKey = drag.current.pointKey;
    const nextKey = pointKey(next);
    drag.current.pointKey = nextKey;
    setActiveId(nextKey);
    setMap({
      preset: "custom",
      segments: useStore.getState().composition.map.segments.map((segment) => ({
        ...segment,
        start: pointKey(segment.start) === activeKey ? next : segment.start,
        end: pointKey(segment.end) === activeKey ? next : segment.end,
      })),
    });
    selectMapPoint(nextKey);
  }

  function endDrag(e?: ThreeEvent<PointerEvent>) {
    e?.stopPropagation();
    drag.current = null;
    setActiveId(null);
    if (controls) controls.enabled = true;
    const target = e?.nativeEvent.target as Element | null | undefined;
    target?.releasePointerCapture?.(e?.pointerId ?? -1);
    document.body.style.cursor = "grab";
  }

  return (
    <group onPointerMove={moveEndpoint} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerLeave={endDrag}>
      {endpoints.map(({ id, key, point, shared }) => {
        const active = activeId === id;
        const selected = selectedMapPointKey === key;
        return (
        <mesh
          key={id}
          position={[point[0], 0.35, point[1]]}
          onPointerDown={(e) => {
            e.stopPropagation();
            drag.current = { pointKey: key };
            setActiveId(id);
            selectMapPoint(key);
            if (controls) controls.enabled = false;
            const target = e.nativeEvent.target as Element | null;
            target?.setPointerCapture?.(e.pointerId);
            document.body.style.cursor = "grabbing";
          }}
          onPointerMove={moveEndpoint}
          onPointerUp={endDrag}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "grab";
          }}
          onPointerOut={() => {
            if (!drag.current) document.body.style.cursor = "auto";
          }}
        >
          <sphereGeometry args={[active ? 0.95 : selected ? 0.82 : shared ? 0.72 : 0.58, 24, 16]} />
          <meshBasicMaterial color={active ? "#8fffe8" : selected ? "#9fb4ff" : shared ? "#ffd166" : "#ffffff"} transparent opacity={1} toneMapped={false} />
          {(active || selected) && (
            <mesh>
              <sphereGeometry args={[active ? 1.35 : 1.12, 24, 16]} />
              <meshBasicMaterial color={active ? "#8fffe8" : "#9fb4ff"} transparent opacity={active ? 0.22 : 0.16} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
          )}
        </mesh>
        );
      })}
    </group>
  );
}

function pointKey(point: [number, number]): string {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`;
}

const pathVertexShader = `
  varying vec2 vUv;
  varying vec2 vWorld;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorld = worldPosition.xz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const pathFragmentShader = `
  #define MAX_TRACK_LIGHTS ${MAX_TRACK_LIGHTS}

  uniform vec3 baseColor;
  uniform vec3 trackColors[MAX_TRACK_LIGHTS];
  uniform vec3 trackPositions[MAX_TRACK_LIGHTS];
  uniform int trackCount;
  uniform float opacity;
  uniform float edgeBoost;
  varying vec2 vUv;
  varying vec2 vWorld;

  void main() {
    float edge = smoothstep(0.5, 0.18, abs(vUv.y - 0.5));
    float center = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
    vec3 color = baseColor * (0.48 + center * 0.42);
    float lightTotal = 0.0;

    for (int i = 0; i < MAX_TRACK_LIGHTS; i++) {
      if (i >= trackCount) break;
      float radius = trackPositions[i].z;
      float d = distance(vWorld, trackPositions[i].xy);
      float light = pow(smoothstep(radius, 0.0, d), 1.55);
      lightTotal += light;
      color = mix(color, trackColors[i] * 1.08, light * 0.58);
      color += trackColors[i] * light * 0.34;
    }

    color += baseColor * edge * edgeBoost;
    color += baseColor * min(lightTotal, 1.0) * 0.08;
    float alpha = opacity * (0.34 + center * 0.62 + edge * 0.2 + min(lightTotal, 1.0) * 0.2);
    gl_FragColor = vec4(color, alpha);
  }
`;
