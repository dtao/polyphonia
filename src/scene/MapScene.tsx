import { ThreeEvent, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CompositionMap, WalkableSegment } from "../map";
import { useStore } from "../store";

export function MapScene({ map, editMode }: { map: CompositionMap; editMode: boolean }) {
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
        <Segment key={segment.id} segment={segment} height={map.wallHeight} editMode={editMode} endpointCounts={endpointCounts} />
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
  height,
  editMode,
  endpointCounts,
}: {
  segment: WalkableSegment;
  height: number;
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
  const wallColor = editMode ? "#9fb4ff" : "#d9e4ff";

  return (
    <group>
      <mesh position={[mid[0], 0.025, mid[2]]} rotation={[-Math.PI / 2, 0, angle]}>
        <planeGeometry args={[length, segment.width]} />
        <meshBasicMaterial color="#5b8cff" transparent opacity={editMode ? 0.12 : 0.055} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[mid[0] + normal[0] * halfWidth * side, height / 2, mid[2] + normal[1] * halfWidth * side]}
          rotation={[0, angle, 0]}
        >
          <boxGeometry args={[length, height, 0.18]} />
          <meshStandardMaterial
            color={wallColor}
            emissive="#2f4b9b"
            emissiveIntensity={editMode ? 0.34 : 0.18}
            transparent
            opacity={editMode ? 0.34 : 0.22}
            roughness={0.45}
          />
        </mesh>
      ))}
      {[segment.start, segment.end].map((point, i) => (
        <group key={i}>
          <mesh position={[point[0], 0.035, point[1]]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[halfWidth, 40]} />
            <meshBasicMaterial color="#5b8cff" transparent opacity={editMode ? 0.1 : 0.045} depthWrite={false} />
          </mesh>
          {(endpointCounts.get(pointKey(point)) ?? 0) === 1 && (
            <mesh position={[point[0], height / 2, point[1]]} rotation={[0, angle, 0]}>
              <boxGeometry args={[0.18, height, segment.width]} />
              <meshStandardMaterial
                color={wallColor}
                emissive="#2f4b9b"
                emissiveIntensity={editMode ? 0.34 : 0.18}
                transparent
                opacity={editMode ? 0.34 : 0.22}
                roughness={0.45}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

function EndpointEditor({ map, endpointCounts }: { map: CompositionMap; endpointCounts: Map<string, number> }) {
  const controls = useThree((s) => s.controls as { enabled?: boolean } | undefined);
  const setMap = useStore((s) => s.setMap);
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
      segments: useStore.getState().composition.map.segments.map((segment) => ({
        ...segment,
        start: pointKey(segment.start) === activeKey ? next : segment.start,
        end: pointKey(segment.end) === activeKey ? next : segment.end,
      })),
    });
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
        return (
        <mesh
          key={id}
          position={[point[0], 0.35, point[1]]}
          onPointerDown={(e) => {
            e.stopPropagation();
            drag.current = { pointKey: key };
            setActiveId(id);
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
          <sphereGeometry args={[active ? 0.95 : shared ? 0.72 : 0.58, 24, 16]} />
          <meshBasicMaterial color={active ? "#8fffe8" : shared ? "#ffd166" : "#ffffff"} transparent opacity={1} toneMapped={false} />
          {active && (
            <mesh>
              <sphereGeometry args={[1.35, 24, 16]} />
              <meshBasicMaterial color="#8fffe8" transparent opacity={0.22} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
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
