// Edit-mode drag handles for shaped stems (pillar / wall / river).
// Rendered in Scene.tsx next to TrackGizmo when a shaped stem is selected.

import { ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { StemShape } from "../composition";
import { nearestBoundaryPointInMap } from "../map";
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
    const map = useStore.getState().composition.map;
    const snapped = nearestBoundaryPointInMap(map, [hit.x, hit.z]) ?? [hit.x, hit.z];
    setTrackShapeRiverEnd(trackId, [snapped[0], stemY, snapped[1]]);
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

// Y-axis rotation ring — drag left/right to rotate the wall's facing direction.
// Angle is accumulated from the drag-start position so direction never reverses.
// Dragging right (positive screen X) rotates clockwise when viewed from above.
// Window-level pointermove/up listeners ensure the grip is never lost when the
// pointer strays far from the ring mesh.
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
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const dragRef = useRef<{ startX: number; startAngle: number } | null>(null);
  // Refs to window listeners so the cleanup effect can remove them on unmount.
  const listenersRef = useRef<{ move: (e: PointerEvent) => void; up: () => void } | null>(null);
  const [cx, stemY, cz] = position;
  const [fx, fz] = shape.facing;

  useEffect(() => () => {
    if (listenersRef.current) {
      window.removeEventListener("pointermove", listenersRef.current.move);
      window.removeEventListener("pointerup", listenersRef.current.up);
    }
  }, []);

  function onDown(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    const startX = e.nativeEvent.clientX;
    const startAngle = Math.atan2(fx, fz);
    dragRef.current = { startX, startAngle };
    setIsDragging(true);
    if (controls) controls.enabled = false;
    document.body.style.cursor = "grabbing";

    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      // 200 px per radian; right drag = clockwise = decreasing angle.
      const newAngle = dragRef.current.startAngle - (ev.clientX - dragRef.current.startX) / 200;
      setTrackShapeWallFacing(trackId, [Math.sin(newAngle), Math.cos(newAngle)]);
    };
    const up = () => {
      dragRef.current = null;
      setIsDragging(false);
      if (controls) controls.enabled = true;
      document.body.style.cursor = "auto";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      listenersRef.current = null;
    };
    listenersRef.current = { move, up };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const color = isDragging ? "#ffffff" : isHovered ? "#c8fff4" : HANDLE_COLOR;

  // Two small cones tangent to the ring at 3-o'clock and 9-o'clock, pointing
  // clockwise, so the rotation direction is visually obvious.
  return (
    <group position={[cx, stemY, cz]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={onDown}
        onPointerOver={(e) => { e.stopPropagation(); setIsHovered(true); document.body.style.cursor = "grab"; }}
        onPointerOut={() => { setIsHovered(false); if (!isDragging) document.body.style.cursor = "auto"; }}
      >
        <torusGeometry args={[1.5, 0.09, 8, 64]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* CW arrow at 3-o'clock: tangent points in -Z */}
      <mesh position={[1.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.12, 0.28, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* CW arrow at 9-o'clock: tangent points in +Z */}
      <mesh position={[-1.5, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.12, 0.28, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
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
