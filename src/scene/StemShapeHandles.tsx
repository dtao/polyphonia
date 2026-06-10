// Edit-mode drag handles for shaped stems (pillar / wall / river).
// Rendered in Scene.tsx next to TrackGizmo when a shaped stem is selected.

import { ThreeEvent, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { StemShape } from "../composition";
import { useStore } from "../store";

const HANDLE_COLOR = "#8fffe8";
const HANDLE_RADIUS = 0.5;

export function StemShapeHandles() {
  const selectedId = useStore((s) => s.selectedId);
  const track = useStore((s) => s.composition.tracks.find((t) => t.id === s.selectedId));
  if (!selectedId || !track || !track.stemShape) return null;
  if (track.stemShape.kind === "orb" || track.stemShape.kind === "pillar") return null;

  if (track.stemShape.kind === "wall") {
    return <WallShapeHandles trackId={selectedId} position={track.position} shape={track.stemShape} />;
  }
  if (track.stemShape.kind === "river") {
    return <RiverEndHandle trackId={selectedId} position={track.position} shape={track.stemShape} />;
  }
  return null;
}

// ---------------------------------------------------------------------------
// River: single draggable sphere at the end point.
// ---------------------------------------------------------------------------

function RiverEndHandle({
  trackId,
  position,
  shape,
}: {
  trackId: string;
  position: [number, number, number];
  shape: Extract<StemShape, { kind: "river" }>;
}) {
  const setTrackShapeRiverEnd = useStore((s) => s.setTrackShapeRiverEnd);
  const controls = useThree((s) => s.controls as { enabled?: boolean } | undefined);
  const dragging = useRef(false);
  const [, stemY] = position;
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -stemY), [stemY]);
  const hit = useMemo(() => new THREE.Vector3(), []);

  function onDown(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    dragging.current = true;
    if (controls) controls.enabled = false;
    (e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "grabbing";
  }

  function onMove(e: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(ground, hit)) return;
    setTrackShapeRiverEnd(trackId, [hit.x, stemY, hit.z]);
  }

  function onUp(e?: ThreeEvent<PointerEvent>) {
    dragging.current = false;
    if (controls) controls.enabled = true;
    (e?.nativeEvent.target as Element | null | undefined)?.releasePointerCapture?.(e?.pointerId ?? -1);
    document.body.style.cursor = "auto";
  }

  return (
    <group onPointerUp={onUp} onPointerCancel={onUp}>
      {dragging.current && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, stemY, 0]} onPointerMove={onMove} onPointerUp={onUp}>
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh
        position={shape.end}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "grab"; }}
        onPointerOut={() => { if (!dragging.current) document.body.style.cursor = "auto"; }}
      >
        <sphereGeometry args={[HANDLE_RADIUS, 20, 14]} />
        <meshBasicMaterial color={HANDLE_COLOR} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Wall: facing arrow handle + two width endpoint handles.
// ---------------------------------------------------------------------------

function WallShapeHandles({
  trackId,
  position,
  shape,
}: {
  trackId: string;
  position: [number, number, number];
  shape: Extract<StemShape, { kind: "wall" }>;
}) {
  return (
    <group>
      <WallFacingHandle trackId={trackId} position={position} shape={shape} />
      <WallWidthHandles trackId={trackId} position={position} shape={shape} />
    </group>
  );
}

// Arrow in the facing direction — drag to rotate the wall.
function WallFacingHandle({
  trackId,
  position,
  shape,
}: {
  trackId: string;
  position: [number, number, number];
  shape: Extract<StemShape, { kind: "wall" }>;
}) {
  const setTrackShapeWallFacing = useStore((s) => s.setTrackShapeWallFacing);
  const controls = useThree((s) => s.controls as { enabled?: boolean } | undefined);
  const dragging = useRef(false);
  const [cx, stemY, cz] = position;
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -stemY), [stemY]);
  const hit = useMemo(() => new THREE.Vector3(), []);

  const [fx, fz] = shape.facing;
  const arrowOffset = shape.width / 2 + 2;
  const arrowPos: [number, number, number] = [cx + fx * arrowOffset, stemY, cz + fz * arrowOffset];

  function onDown(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    dragging.current = true;
    if (controls) controls.enabled = false;
    (e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "grabbing";
  }

  function onMove(e: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(ground, hit)) return;
    const dx = hit.x - cx, dz = hit.z - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return;
    setTrackShapeWallFacing(trackId, [dx / len, dz / len]);
  }

  function onUp(e?: ThreeEvent<PointerEvent>) {
    dragging.current = false;
    if (controls) controls.enabled = true;
    (e?.nativeEvent.target as Element | null | undefined)?.releasePointerCapture?.(e?.pointerId ?? -1);
    document.body.style.cursor = "auto";
  }

  return (
    <group onPointerUp={onUp} onPointerCancel={onUp}>
      {dragging.current && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, stemY, 0]} onPointerMove={onMove} onPointerUp={onUp}>
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh
        position={arrowPos}
        rotation={[Math.PI / 2, Math.atan2(fx, fz), 0]}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "grab"; }}
        onPointerOut={() => { if (!dragging.current) document.body.style.cursor = "auto"; }}
      >
        <coneGeometry args={[0.45, 1.2, 12]} />
        <meshBasicMaterial color="#ffcc44" toneMapped={false} />
      </mesh>
    </group>
  );
}

// Two spheres at the wall's tangent endpoints — drag to resize width.
function WallWidthHandles({
  trackId,
  position,
  shape,
}: {
  trackId: string;
  position: [number, number, number];
  shape: Extract<StemShape, { kind: "wall" }>;
}) {
  const setTrackShapeWallWidth = useStore((s) => s.setTrackShapeWallWidth);
  const controls = useThree((s) => s.controls as { enabled?: boolean } | undefined);
  const dragging = useRef<"left" | "right" | null>(null);
  const [cx, stemY, cz] = position;
  const ground = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -stemY), [stemY]);
  const hit = useMemo(() => new THREE.Vector3(), []);

  const [fx, fz] = shape.facing;
  // Tangent = perpendicular to facing in XZ (90° CCW).
  const tx = -fz, tz = fx;

  function onDown(e: ThreeEvent<PointerEvent>, which: "left" | "right") {
    e.stopPropagation();
    dragging.current = which;
    if (controls) controls.enabled = false;
    (e.nativeEvent.target as Element | null)?.setPointerCapture?.(e.pointerId);
    document.body.style.cursor = "grabbing";
  }

  function onMove(e: ThreeEvent<PointerEvent>) {
    if (!dragging.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(ground, hit)) return;
    const sign = dragging.current === "right" ? 1 : -1;
    const dx = hit.x - cx, dz = hit.z - cz;
    const along = dx * tx + dz * tz;
    const newHalfWidth = Math.max(0.5, along * sign);
    setTrackShapeWallWidth(trackId, newHalfWidth * 2);
  }

  function onUp(e?: ThreeEvent<PointerEvent>) {
    dragging.current = null;
    if (controls) controls.enabled = true;
    (e?.nativeEvent.target as Element | null | undefined)?.releasePointerCapture?.(e?.pointerId ?? -1);
    document.body.style.cursor = "auto";
  }

  return (
    <group onPointerUp={onUp} onPointerCancel={onUp}>
      {dragging.current && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, stemY, 0]} onPointerMove={onMove} onPointerUp={onUp}>
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {([-1, 1] as const).map((sign) => {
        const half = shape.width / 2;
        const hx = cx + tx * half * sign;
        const hz = cz + tz * half * sign;
        const which = sign === 1 ? "right" : "left";
        return (
          <mesh
            key={sign}
            position={[hx, stemY, hz]}
            onPointerDown={(e) => onDown(e, which)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "grab"; }}
            onPointerOut={() => { if (!dragging.current) document.body.style.cursor = "auto"; }}
          >
            <sphereGeometry args={[HANDLE_RADIUS, 20, 14]} />
            <meshBasicMaterial color={HANDLE_COLOR} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}
