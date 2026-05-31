import * as THREE from "three";
import { CompositionMap, WalkableSegment } from "../map";

export function MapScene({ map, editMode }: { map: CompositionMap; editMode: boolean }) {
  if (!map.segments.length) return null;
  return (
    <group>
      {map.segments.map((segment) => (
        <Segment key={segment.id} segment={segment} height={map.wallHeight} editMode={editMode} />
      ))}
    </group>
  );
}

function Segment({ segment, height, editMode }: { segment: WalkableSegment; height: number; editMode: boolean }) {
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
        <mesh key={i} position={[point[0], 0.035, point[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[halfWidth, 40]} />
          <meshBasicMaterial color="#5b8cff" transparent opacity={editMode ? 0.1 : 0.045} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
