// Edit-mode drag handles for shaped stems (pillar / wall / river).
// Rendered in Scene.tsx next to TrackGizmo when a shaped stem is selected.

import { ThreeEvent, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { TransformControls } from "@react-three/drei";
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

// Y-axis rotation ring — drag the arc to set the wall's facing direction.
// Uses TransformControls (same mechanism as the start-marker rotate mode) so
// the handle stays fixed while you arc around it, avoiding the grip-loss that
// a moving arrow cone causes.
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
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const [cx, stemY, cz] = position;

  // Keep the gizmo object's rotation in sync with shape.facing for external
  // changes (undo/redo). During a drag, TransformControls sets obj.rotation.y
  // to a continuously growing angle that may exceed ±π. If we naively reset it
  // to atan2(fx, fz) every time, the angle gets normalised back into (-π, π]
  // mid-drag, which makes the wall snap and reverse direction. Guard the sync
  // by comparing the *facing direction* as a unit vector: sin/cos of the current
  // angle equal sin/cos of atan2(fx, fz) within floating-point epsilon, so
  // drag-induced store updates read as a no-op while genuine undo/redo changes
  // (where the stored direction differs from the live rotation) still snap through.
  useLayoutEffect(() => {
    if (!obj) return;
    const [fx, fz] = shape.facing;
    const cur = obj.rotation.y;
    if (Math.abs(Math.sin(cur) - fx) > 0.001 || Math.abs(Math.cos(cur) - fz) > 0.001) {
      obj.rotation.y = Math.atan2(fx, fz);
    }
  }, [obj, shape.facing]);

  function handleObjectChange() {
    if (!obj) return;
    const a = obj.rotation.y;
    setTrackShapeWallFacing(trackId, [Math.sin(a), Math.cos(a)]);
  }

  return (
    <>
      <group ref={setObj} position={[cx, stemY, cz]} />
      {obj && (
        <TransformControls
          object={obj}
          mode="rotate"
          showX={false}
          showY={true}
          showZ={false}
          size={1.2}
          onObjectChange={handleObjectChange}
        />
      )}
    </>
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
