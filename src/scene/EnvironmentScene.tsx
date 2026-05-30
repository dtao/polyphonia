import { Grid, Sparkles } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { EnvironmentSettings } from "../environment";

type PropSet = Array<{ position: [number, number, number]; scale: [number, number, number]; rotation?: [number, number, number] }>;
type TorchSet = Array<{ position: [number, number, number]; rotation: [number, number, number]; color: string }>;

export function EnvironmentScene({ environment, editMode }: { environment: EnvironmentSettings; editMode: boolean }) {
  const tone = TONES[environment.type];

  return (
    <>
      <color attach="background" args={[tone.background]} />
      <fog attach="fog" args={[tone.background, tone.fogNear, tone.fogFar]} />
      <ambientLight intensity={tone.ambient} />
      <hemisphereLight args={[tone.sky, tone.ground, tone.hemi]} />
      <directionalLight position={[12, 18, 8]} intensity={tone.sun} color={tone.sunColor} />

      {editMode && (
        <Grid
          args={[80, 80]}
          cellSize={1}
          cellColor={tone.gridCell}
          sectionSize={5}
          sectionColor={tone.gridSection}
          fadeDistance={55}
          infiniteGrid
        />
      )}

      {environment.type === "cavern" && <Cavern ambience={environment.ambience} />}
      {environment.type === "forest" && <Forest ambience={environment.ambience} />}
      {environment.type === "crystal" && <CrystalHall ambience={environment.ambience} />}
      {environment.type === "studio" && <Studio accents={environment.ambience} />}
    </>
  );
}

function Studio({ accents }: { accents: number }) {
  const sculptures = useMemo(() => ringProps(10, 13, 1.7), []);
  const light = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    if (light.current) light.current.intensity = 2.7 + accents * 2 + Math.sin(clock.elapsedTime * 0.8) * 0.35;
  });

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <circleGeometry args={[46, 96]} />
        <FloorMaterial base="#070914" accent="#20345a" density={0.62} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -7]}>
        <ringGeometry args={[4.5, 16, 96]} />
        <meshBasicMaterial color="#5c86ff" transparent opacity={0.11} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, -7]}>
        <ringGeometry args={[9.4, 9.8, 96]} />
        <meshBasicMaterial color="#d9e5ff" transparent opacity={0.22} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 4.2, -18]} scale={[28, 7, 0.4]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#10192d" emissive="#162c62" emissiveIntensity={0.45 + accents * 0.35} roughness={0.72} />
      </mesh>
      <mesh position={[-12, 3.3, -13]} rotation={[0, 0.24, 0]} scale={[0.45, 6, 5]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#243c76" emissive="#284fa0" emissiveIntensity={0.28 + accents * 0.3} roughness={0.55} />
      </mesh>
      <mesh position={[12, 3.3, -13]} rotation={[0, -0.24, 0]} scale={[0.45, 6, 5]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#273456" emissive="#3b66b8" emissiveIntensity={0.22 + accents * 0.28} roughness={0.55} />
      </mesh>
      <group position={[0, 0, -7]}>
        <mesh position={[-4.8, 1.25, 0]} scale={[1.4, 2.5, 1.4]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#2f5f9e" roughness={0.45} metalness={0.12} />
        </mesh>
        <mesh position={[0, 1.15, -0.8]} rotation={[0, Math.PI / 4, 0]} scale={[1.7, 1.7, 1.7]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#f0dc68" emissive="#6b5815" emissiveIntensity={0.2 + accents * 0.25} roughness={0.34} />
        </mesh>
        <mesh position={[5.2, 1.9, 0.4]} scale={[1.35, 3.8, 1.35]}>
          <cylinderGeometry args={[0.55, 0.55, 1, 24]} />
          <meshStandardMaterial color="#79ad67" roughness={0.5} metalness={0.08} />
        </mesh>
      </group>
      {sculptures.map((p, i) => (
        <mesh key={`studio-sculpture-${i}`} position={[p.position[0], 1 + (i % 3) * 0.6, p.position[2]]} scale={[p.scale[0] * 0.22, p.scale[1] * 0.5, p.scale[2] * 0.22]} rotation={p.rotation}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={i % 2 ? "#20375f" : "#273a6e"} emissive="#14244c" emissiveIntensity={0.16 + accents * 0.12} roughness={0.62} />
        </mesh>
      ))}
      <pointLight ref={light} position={[0, 5, -7]} color="#8fb0ff" intensity={2.7 + accents * 2} distance={34} />
      <pointLight position={[-10, 4, -10]} color="#6fa0ff" intensity={1.3 + accents * 1.1} distance={24} />
      <pointLight position={[9, 3, 3]} color="#ffd975" intensity={0.9 + accents * 0.9} distance={18} />
      <Sparkles count={Math.round(44 + accents * 58)} scale={[42, 6, 42]} size={1.1} speed={0.08} color="#8fb0ff" opacity={0.24} />
    </>
  );
}

function Cavern({ ambience }: { ambience: number }) {
  const wallRocks = useMemo(() => cavernWallProps(30), []);
  const ceilingRibs = useMemo(() => cavernCeilingProps(18), []);
  const stalactites = useMemo(() => cavernSpikeProps(26, 10), []);
  const stalagmites = useMemo(() => cavernSpikeProps(22, 14), []);
  const rubble = useMemo(() => scatterProps(48, 9, 34), []);
  const torches = useMemo<TorchSet>(
    () => [
      { position: [-14, 1.2, -11], rotation: [0, 0.55, 0], color: "#ffbf75" },
      { position: [16, 1.2, -6], rotation: [0, -0.75, 0], color: "#ff9f52" },
      { position: [-10, 1.2, 16], rotation: [0, -0.15, 0], color: "#ffd38d" },
    ],
    [],
  );

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <circleGeometry args={[55, 96]} />
        <CavernFloorMaterial />
      </mesh>
      <mesh position={[0, 5.7, 0]} scale={[1, 0.55, 1]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[27, 7, 12, 96, Math.PI * 2]} />
        <meshStandardMaterial color="#2d2830" roughness={1} side={THREE.BackSide} />
      </mesh>
      {wallRocks.map((p, i) => (
        <mesh key={`wall-${i}`} position={p.position} scale={p.scale} rotation={p.rotation}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={i % 3 === 0 ? "#665b5f" : i % 3 === 1 ? "#4d454d" : "#3b343c"} roughness={0.98} />
        </mesh>
      ))}
      {ceilingRibs.map((p, i) => (
        <mesh key={`rib-${i}`} position={p.position} scale={p.scale} rotation={p.rotation}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={i % 2 ? "#2f2932" : "#3b3339"} roughness={1} />
        </mesh>
      ))}
      {stalactites.map((p, i) => (
        <mesh key={`stalactite-${i}`} position={[p.position[0], 7.2 + (i % 5) * 0.35, p.position[2]]} scale={[p.scale[0] * 0.42, p.scale[1] * 2.1, p.scale[2] * 0.42]} rotation={[Math.PI, p.rotation?.[1] ?? 0, 0]}>
          <coneGeometry args={[1, 4, 7]} />
          <meshStandardMaterial color={i % 2 ? "#6c6267" : "#524a52"} roughness={0.98} />
        </mesh>
      ))}
      {stalagmites.map((p, i) => (
        <mesh key={`stalagmite-${i}`} position={[p.position[0], 1.1 + (i % 4) * 0.18, p.position[2]]} scale={[p.scale[0] * 0.45, p.scale[1] * 1.2, p.scale[2] * 0.45]} rotation={[0, p.rotation?.[1] ?? 0, 0]}>
          <coneGeometry args={[1, 3.2, 7]} />
          <meshStandardMaterial color={i % 2 ? "#5e555c" : "#473f47"} roughness={0.98} />
        </mesh>
      ))}
      {rubble.map((p, i) => (
        <mesh key={`rubble-${i}`} position={[p.position[0], 0.12, p.position[2]]} scale={[p.scale[0] * 0.55, p.scale[1] * 0.22, p.scale[2] * 0.55]} rotation={p.rotation}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={i % 3 === 0 ? "#6d625b" : "#4c4548"} roughness={1} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, -0.2]} position={[1, 0.005, 3]}>
        <planeGeometry args={[7, 28, 1, 1]} />
        <meshStandardMaterial color="#1a2430" emissive="#173044" emissiveIntensity={0.72} roughness={0.2} metalness={0.25} transparent opacity={0.86} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -0.45]} position={[-6, 0.01, -8]}>
        <circleGeometry args={[3.2, 32]} />
        <meshStandardMaterial color="#152231" emissive="#18384c" emissiveIntensity={0.78} roughness={0.15} metalness={0.2} transparent opacity={0.78} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0.08]} position={[0, 0.018, -7.2]}>
        <planeGeometry args={[5.5, 15, 1, 1]} />
        <meshBasicMaterial color="#6f5946" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <group position={[0, 0, -13]}>
        <mesh position={[0, 3.05, -0.2]} scale={[7.8, 3.4, 1.35]} rotation={[0.04, 0, 0]}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color="#5e5354" roughness={1} />
        </mesh>
        <mesh position={[0, 3.2, 0.72]} scale={[4.2, 2.5, 0.44]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#21171a" />
        </mesh>
        <mesh position={[0, 2.7, 0.52]} scale={[2.9, 1.85, 0.28]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#ffb367" transparent opacity={0.1} />
        </mesh>
        <pointLight position={[0, 2.9, 1.4]} color="#ffc17d" intensity={7.5 + ambience * 2.8} distance={28} />
      </group>
      <group position={[-4.4, 0.1, -5.4]} rotation={[0, 0.22, 0]}>
        <mesh position={[0, 1.15, 0]} scale={[0.62, 1.25, 0.62]}>
          <coneGeometry args={[1, 3.1, 7]} />
          <meshStandardMaterial color="#726761" roughness={0.96} />
        </mesh>
        <mesh position={[-0.8, 0.55, 1.4]} scale={[0.7, 0.4, 0.9]} rotation={[0.2, 0.3, -0.1]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#5f554e" roughness={1} />
        </mesh>
      </group>
      <group position={[4.9, 0.08, -7.8]} rotation={[0, -0.35, 0]}>
        <mesh position={[0, 1, 0]} scale={[0.48, 1.1, 0.48]}>
          <coneGeometry args={[1, 2.8, 7]} />
          <meshStandardMaterial color="#645b5e" roughness={0.96} />
        </mesh>
        <mesh position={[0.85, 0.48, 1]} scale={[0.75, 0.36, 0.55]} rotation={[0.1, -0.2, 0.15]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#50494c" roughness={1} />
        </mesh>
      </group>
      <CavernMist />
      {torches.map((torch, i) => (
        <Torch key={`torch-${i}`} index={i} {...torch} ambience={ambience} />
      ))}
      <Brazier position={[0, 0, -8]} ambience={ambience} />
      <Brazier position={[6, 0, 8]} ambience={ambience} small />
      <pointLight position={[-12, 5, -8]} color="#aeb8ff" intensity={8.5 + ambience * 2.8} distance={52} />
      <pointLight position={[10, 3, 12]} color="#ffdca8" intensity={4.6 + ambience * 1.7} distance={36} />
      <pointLight position={[0, 6, 0]} color="#f0e8ff" intensity={7.6 + ambience * 2.2} distance={48} />
      <Sparkles count={34} scale={[38, 8, 38]} size={0.9} speed={0.08} color="#ffddaa" opacity={0.16} />
    </>
  );
}

function Brazier({ position, ambience, small = false }: { position: [number, number, number]; ambience: number; small?: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Group>(null);
  const scale = small ? 0.72 : 1;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 5.5 + position[0] * 0.2;
    const flicker = 0.86 + Math.sin(t) * 0.09 + Math.sin(t * 2.2) * 0.06;
    if (light.current) light.current.intensity = (7.5 + ambience * 2.8) * flicker;
    if (flame.current) flame.current.scale.setScalar(scale * (0.92 + flicker * 0.14));
  });

  return (
    <group position={position}>
      <mesh position={[0, 0.32 * scale, 0]} scale={[scale, scale, scale]}>
        <cylinderGeometry args={[0.72, 0.56, 0.34, 12]} />
        <meshStandardMaterial color="#211815" roughness={0.55} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.53 * scale, 0]} scale={[scale, scale, scale]}>
        <torusGeometry args={[0.64, 0.08, 8, 20]} />
        <meshStandardMaterial color="#3a2720" roughness={0.5} metalness={0.2} />
      </mesh>
      <group ref={flame} position={[0, 0.8 * scale, 0]}>
        <mesh position={[0, 0.16, 0]} scale={[0.85, 1.45, 0.85]}>
          <coneGeometry args={[0.48, 1.1, 12]} />
          <meshBasicMaterial color="#ff8a3d" toneMapped={false} transparent opacity={0.92} />
        </mesh>
        <mesh position={[0, 0.06, 0]} scale={[0.75, 0.8, 0.75]}>
          <sphereGeometry args={[0.35, 12, 8]} />
          <meshBasicMaterial color="#ffe0a0" toneMapped={false} transparent opacity={0.78} />
        </mesh>
      </group>
      <pointLight ref={light} position={[0, 1.1 * scale, 0]} color="#ffb36f" intensity={7.5 + ambience * 2.8} distance={small ? 18 : 26} />
    </group>
  );
}

function Torch({ position, rotation, color, ambience, index }: { position: [number, number, number]; rotation: [number, number, number]; color: string; ambience: number; index: number }) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 6 + index * 1.7;
    const flicker = 0.82 + Math.sin(t) * 0.11 + Math.sin(t * 1.83) * 0.07;
    if (light.current) light.current.intensity = (4.5 + ambience * 2.5) * flicker;
    if (flame.current) flame.current.scale.setScalar(0.9 + flicker * 0.12);
  });

  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.65, 0]} rotation={[0.35, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.11, 1.3, 8]} />
        <meshStandardMaterial color="#2b1710" roughness={0.7} />
      </mesh>
      <group ref={flame} position={[0, 1.34, 0]}>
        <mesh position={[0, 0.08, 0]} scale={[0.6, 1.25, 0.6]}>
          <coneGeometry args={[0.28, 0.74, 10]} />
          <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.95} />
        </mesh>
        <mesh position={[0, 0.02, 0]} scale={[0.75, 0.7, 0.75]}>
          <sphereGeometry args={[0.2, 10, 8]} />
          <meshBasicMaterial color="#fff0b8" toneMapped={false} transparent opacity={0.8} />
        </mesh>
      </group>
      <pointLight ref={light} position={[0, 1.35, 0]} color={color} intensity={4.5 + ambience * 2.5} distance={18} />
    </group>
  );
}

function CavernMist() {
  const mist = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (mist.current) mist.current.position.x = Math.sin(clock.elapsedTime * 0.12) * 0.8;
  });

  return (
    <group ref={mist}>
      {[-12, -5, 4, 12].map((z, i) => (
        <mesh key={`mist-${i}`} rotation={[-Math.PI / 2, 0, 0.2 + i * 0.35]} position={[i % 2 ? 4 : -4, 0.18, z]}>
          <planeGeometry args={[18, 5, 1, 1]} />
          <meshBasicMaterial color="#c8c0d8" transparent opacity={0.045} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function Forest({ ambience }: { ambience: number }) {
  const trees = useMemo(() => scatterProps(54, 13, 36), []);
  const rocks = useMemo(() => scatterProps(26, 5, 30), []);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]}>
        <circleGeometry args={[60, 96]} />
        <FloorMaterial base="#0b1912" accent="#35532b" density={1.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -0.1]} position={[0, 0.012, -7]}>
        <planeGeometry args={[4.8, 32, 1, 1]} />
        <meshStandardMaterial color="#102b35" emissive="#143b48" emissiveIntensity={0.52 + ambience * 0.32} roughness={0.25} metalness={0.12} transparent opacity={0.86} />
      </mesh>
      <mesh position={[0, 9.8, -29]}>
        <circleGeometry args={[3.5, 48]} />
        <meshBasicMaterial color="#dceaff" transparent opacity={0.92} />
      </mesh>
      <mesh position={[0, 9.8, -29.1]} scale={[1.45, 1.45, 1.45]}>
        <circleGeometry args={[3.5, 48]} />
        <meshBasicMaterial color="#8ab8ff" transparent opacity={0.13} />
      </mesh>
      {trees.map((p, i) => (
        <group key={`tree-${i}`} position={p.position} rotation={p.rotation}>
          <mesh position={[0, 2.1, 0]} scale={[0.44 + (i % 3) * 0.05, 2.5 + (i % 5) * 0.36, 0.44 + (i % 4) * 0.04]}>
            <cylinderGeometry args={[0.45, 0.65, 2.4, 8]} />
            <meshStandardMaterial color="#2b1c13" roughness={0.85} />
          </mesh>
          <mesh position={[0, 5.6 + (i % 4) * 0.3, 0]} scale={[p.scale[0] * 1.2, p.scale[1] * 1.25, p.scale[2] * 1.2]}>
            <icosahedronGeometry args={[1.9, 1]} />
            <meshStandardMaterial color={i % 2 ? "#255137" : "#173d2b"} emissive={i % 5 === 0 ? "#0e271a" : "#08160f"} emissiveIntensity={0.12 + ambience * 0.1} roughness={0.95} />
          </mesh>
        </group>
      ))}
      {rocks.map((p, i) => (
        <mesh key={`forest-rock-${i}`} position={[p.position[0], 0.18, p.position[2]]} scale={[p.scale[0] * 0.7, p.scale[1] * 0.28, p.scale[2] * 0.55]} rotation={p.rotation}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={i % 2 ? "#334336" : "#25342d"} roughness={1} />
        </mesh>
      ))}
      <group position={[-5.5, 0.1, -6.5]} rotation={[0, -0.4, -0.08]}>
        <mesh position={[0, 0.35, 0]} scale={[0.55, 0.55, 3.6]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.45, 0.55, 1, 10]} />
          <meshStandardMaterial color="#3a2418" roughness={0.92} />
        </mesh>
        <mesh position={[-1.2, 0.22, -1.2]} scale={[1.1, 0.35, 0.75]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#26392d" roughness={1} />
        </mesh>
      </group>
      <group position={[5.5, 0, -8]}>
        <mesh position={[0, 1.4, 0]} scale={[0.48, 2.4, 0.48]}>
          <cylinderGeometry args={[0.55, 0.75, 2.4, 8]} />
          <meshStandardMaterial color="#26170f" roughness={0.9} />
        </mesh>
        <mesh position={[0.2, 4.2, -0.1]} scale={[2.2, 2.5, 2]}>
          <icosahedronGeometry args={[1.7, 1]} />
          <meshStandardMaterial color="#1e4f32" emissive="#0b2416" emissiveIntensity={0.18 + ambience * 0.1} roughness={0.95} />
        </mesh>
      </group>
      <pointLight position={[0, 8.8, -24]} color="#b9d8ff" intensity={2.7 + ambience * 1.9} distance={55} />
      <pointLight position={[0, 1.1, -5.5]} color="#5fb7df" intensity={1.5 + ambience * 1.2} distance={18} />
      <hemisphereLight args={["#b8f0c8", "#102016", 0.55 + ambience * 0.35]} />
      <Sparkles count={42} scale={[45, 6, 45]} size={0.74} speed={0.15} color="#bdfeda" opacity={0.2} />
    </>
  );
}

function CrystalHall({ ambience }: { ambience: number }) {
  const crystalClusters = useMemo(() => scatterProps(24, 8, 36), []);
  const groundShards = useMemo(() => scatterProps(42, 4, 40), []);
  const mesas = useMemo(() => scatterProps(18, 12, 34), []);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
        <circleGeometry args={[58, 96]} />
        <FloorMaterial base="#080814" accent="#23344f" density={1.25} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0.18]} position={[0, 0.012, -6]}>
        <planeGeometry args={[6.5, 30, 1, 1]} />
        <meshBasicMaterial color="#46c9ff" transparent opacity={0.12} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -0.15]} position={[-3.5, 0.016, -9]}>
        <circleGeometry args={[6.5, 48]} />
        <meshBasicMaterial color="#8d38ff" transparent opacity={0.07} depthWrite={false} />
      </mesh>
      <mesh position={[0, 8.6, -30]} scale={[1.6, 1.6, 1.6]}>
        <sphereGeometry args={[3.2, 32, 16]} />
        <meshBasicMaterial color="#44308f" transparent opacity={0.86} />
      </mesh>
      <mesh position={[0.3, 8.7, -29.7]} scale={[2.2, 2.2, 2.2]}>
        <sphereGeometry args={[3.2, 32, 16]} />
        <meshBasicMaterial color="#7e4dff" transparent opacity={0.08} />
      </mesh>
      {mesas.map((p, i) => (
        <mesh key={`crystal-mesa-${i}`} position={[p.position[0], 0.22, p.position[2]]} scale={[p.scale[0] * 1.2, p.scale[1] * 0.26, p.scale[2] * 1]} rotation={p.rotation}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={i % 2 ? "#111728" : "#171329"} emissive={i % 3 === 0 ? "#25105a" : "#0b2330"} emissiveIntensity={0.1 + ambience * 0.08} roughness={0.92} />
        </mesh>
      ))}
      {crystalClusters.map((p, i) => (
        <CrystalFormation
          key={`crystal-formation-${i}`}
          position={[p.position[0], 0, p.position[2]]}
          rotation={p.rotation ?? [0, 0, 0]}
          scale={0.72 + (i % 5) * 0.14}
          color={i % 3 === 0 ? "#72ecff" : i % 3 === 1 ? "#bd54ff" : "#49f0b9"}
          emissive={i % 3 === 0 ? "#187f98" : i % 3 === 1 ? "#641c9e" : "#15845f"}
          ambience={ambience}
        />
      ))}
      {groundShards.map((p, i) => (
        <mesh key={`crystal-shard-${i}`} position={[p.position[0], 0.12, p.position[2]]} scale={[p.scale[0] * 0.3, p.scale[1] * 0.22, p.scale[2] * 0.3]} rotation={[0.35 + (i % 3) * 0.18, p.rotation?.[1] ?? 0, -0.28 + (i % 5) * 0.12]}>
          <tetrahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={i % 2 ? "#5de7ff" : "#ca55ff"} emissive={i % 2 ? "#1a7a88" : "#5a1988"} emissiveIntensity={0.32 + ambience * 0.28} roughness={0.32} metalness={0.08} />
        </mesh>
      ))}
      <group position={[0, 0, -8]}>
        <CrystalFormation position={[-3.2, 0, 0]} rotation={[0, 0.3, 0]} scale={1.8} color="#d045ff" emissive="#8b18c4" ambience={ambience} hero />
        <CrystalFormation position={[3.5, 0, -0.8]} rotation={[0, -0.25, 0]} scale={1.55} color="#60edff" emissive="#178aa0" ambience={ambience} hero />
        <CrystalFormation position={[0.5, 0, 1.6]} rotation={[0, 0.75, 0]} scale={1.15} color="#ff4b8f" emissive="#a91c52" ambience={ambience} />
      </group>
      <pointLight position={[0, 5.5, 0]} color="#8eefff" intensity={2.4 + ambience * 3.1} distance={48} />
      <pointLight position={[-4, 2.6, -8]} color="#e553ff" intensity={3.5 + ambience * 2.7} distance={28} />
      <pointLight position={[4, 2.6, -8]} color="#50eaff" intensity={3.1 + ambience * 2.5} distance={28} />
      <pointLight position={[0, 8, -27]} color="#8a5cff" intensity={2.2 + ambience * 1.7} distance={52} />
      <Sparkles count={38} scale={[42, 6, 42]} size={1.05} speed={0.08} color="#bff8ff" opacity={0.22} />
    </>
  );
}

function CrystalFormation({
  position,
  rotation,
  scale,
  color,
  emissive,
  ambience,
  hero = false,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  color: string;
  emissive: string;
  ambience: number;
  hero?: boolean;
}) {
  const height = hero ? 4.5 : 2.6;
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.18 * scale, 0]} scale={[1.05 * scale, 0.32 * scale, 0.9 * scale]} rotation={[0.05, 0.2, -0.05]}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#15162a" emissive={emissive} emissiveIntensity={0.12 + ambience * 0.08} roughness={0.9} />
      </mesh>
      <mesh position={[0, (height * scale) / 2, 0]} scale={[0.55 * scale, height * scale, 0.55 * scale]} rotation={[0.06, 0.1, -0.12]}>
        <coneGeometry args={[1, 1, 6]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={(hero ? 0.9 : 0.55) + ambience * 0.55} roughness={0.18} metalness={0.1} />
      </mesh>
      <mesh position={[-0.7 * scale, 1.05 * scale, 0.22 * scale]} scale={[0.32 * scale, 1.7 * scale, 0.32 * scale]} rotation={[0.18, -0.35, 0.28]}>
        <coneGeometry args={[1, 1, 6]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.46 + ambience * 0.35} roughness={0.2} metalness={0.08} />
      </mesh>
      <mesh position={[0.78 * scale, 0.75 * scale, -0.18 * scale]} scale={[0.26 * scale, 1.25 * scale, 0.26 * scale]} rotation={[-0.2, 0.45, -0.24]}>
        <coneGeometry args={[1, 1, 6]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.42 + ambience * 0.3} roughness={0.22} metalness={0.08} />
      </mesh>
    </group>
  );
}

function FloorMaterial({ base, accent, density }: { base: string; accent: string; density: number }) {
  return (
    <shaderMaterial
      uniforms={{
        baseColor: { value: new THREE.Color(base) },
        accentColor: { value: new THREE.Color(accent) },
        density: { value: density },
      }}
      vertexShader={floorVertexShader}
      fragmentShader={floorFragmentShader}
    />
  );
}

function CavernFloorMaterial() {
  return (
    <shaderMaterial
      uniforms={{
        baseColor: { value: new THREE.Color("#2a2527") },
        accentColor: { value: new THREE.Color("#75604d") },
        wetColor: { value: new THREE.Color("#141923") },
      }}
      vertexShader={floorVertexShader}
      fragmentShader={cavernFloorFragmentShader}
    />
  );
}

const floorVertexShader = `
  varying vec2 vWorld;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const floorFragmentShader = `
  uniform vec3 baseColor;
  uniform vec3 accentColor;
  uniform float density;
  varying vec2 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    float n = noise(vWorld * 0.18 * density);
    float fine = noise(vWorld * 0.85 * density) * 0.35;
    float bands = sin((vWorld.x + vWorld.y) * 0.16 * density) * 0.08;
    float mixAmount = clamp(n * 0.55 + fine + bands, 0.0, 1.0);
    vec3 color = mix(baseColor, accentColor, mixAmount);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const cavernFloorFragmentShader = `
  uniform vec3 baseColor;
  uniform vec3 accentColor;
  uniform vec3 wetColor;
  varying vec2 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    float broad = noise(vWorld * 0.16);
    float grain = noise(vWorld * 1.1) * 0.28;
    float path = smoothstep(4.8, 0.4, abs(vWorld.x * 0.65 + sin(vWorld.y * 0.18) * 1.6));
    float puddle = smoothstep(0.72, 1.0, noise(vWorld * 0.32 + vec2(4.0, 1.0))) * path;
    vec3 rock = mix(baseColor, accentColor, clamp(broad * 0.55 + grain, 0.0, 1.0));
    vec3 color = mix(rock, wetColor, puddle * 0.55);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function ringProps(count: number, minRadius: number, seed: number): PropSet {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const wobble = Math.sin(i * seed) * 3;
    const r = minRadius + wobble + (i % 5);
    return {
      position: [Math.cos(a) * r, 1.2 + (i % 4) * 0.35, Math.sin(a) * r],
      scale: [2.2 + (i % 3), 2.4 + (i % 5), 1.6 + ((i + 1) % 3)],
      rotation: [0.2 * i, a, 0.12 * i],
    };
  });
}

function cavernWallProps(count: number): PropSet {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const r = 25 + Math.sin(i * 1.9) * 2.4;
    return {
      position: [Math.cos(a) * r, 2.3 + (i % 4) * 0.45, Math.sin(a) * r],
      scale: [3.6 + (i % 5) * 0.6, 4.6 + (i % 6) * 0.8, 2.4 + (i % 4) * 0.5],
      rotation: [0.12 * i, a + Math.PI / 2, 0.08 * i],
    };
  });
}

function cavernCeilingProps(count: number): PropSet {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    const r = 14 + (i % 4) * 2.2;
    return {
      position: [Math.cos(a) * r, 8.4 + Math.sin(i * 2.1) * 0.8, Math.sin(a) * r],
      scale: [1.1, 0.75, 8 + (i % 5)],
      rotation: [0.4, a, 0.15],
    };
  });
}

function cavernSpikeProps(count: number, minRadius: number): PropSet {
  return Array.from({ length: count }, (_, i) => {
    const a = i * 2.399963;
    const r = minRadius + ((i * 5) % 24);
    return {
      position: [Math.cos(a) * r, 0, Math.sin(a) * r],
      scale: [0.7 + (i % 4) * 0.22, 0.8 + (i % 5) * 0.35, 0.7 + ((i + 2) % 4) * 0.2],
      rotation: [0, a, 0],
    };
  });
}

function scatterProps(count: number, clearRadius: number, spread: number): PropSet {
  return Array.from({ length: count }, (_, i) => {
    const a = i * 2.399963;
    const r = clearRadius + ((i * 7) % spread);
    return {
      position: [Math.cos(a) * r, 0, Math.sin(a) * r],
      scale: [0.8 + (i % 4) * 0.18, 0.9 + (i % 5) * 0.25, 0.8 + ((i + 2) % 4) * 0.18],
      rotation: [0, a, 0],
    };
  });
}

const TONES = {
  studio: {
    background: "#05060a",
    fogNear: 18,
    fogFar: 55,
    ambient: 0.25,
    sky: "#3a4a7a",
    ground: "#0a0a12",
    hemi: 0.4,
    sun: 0.7,
    sunColor: "#dce5ff",
    gridCell: "#1a2138",
    gridSection: "#2a3658",
  },
  cavern: {
    background: "#16131a",
    fogNear: 28,
    fogFar: 78,
    ambient: 0.55,
    sky: "#6c6480",
    ground: "#302832",
    hemi: 0.82,
    sun: 0.95,
    sunColor: "#f1e7d8",
    gridCell: "#4c4560",
    gridSection: "#746894",
  },
  forest: {
    background: "#06100b",
    fogNear: 16,
    fogFar: 58,
    ambient: 0.22,
    sky: "#264a36",
    ground: "#09150d",
    hemi: 0.5,
    sun: 0.75,
    sunColor: "#d6ffd8",
    gridCell: "#163123",
    gridSection: "#2c5a3c",
  },
  crystal: {
    background: "#050813",
    fogNear: 14,
    fogFar: 60,
    ambient: 0.2,
    sky: "#26356c",
    ground: "#07101a",
    hemi: 0.55,
    sun: 0.6,
    sunColor: "#c6f8ff",
    gridCell: "#10283c",
    gridSection: "#245979",
  },
} satisfies Record<EnvironmentSettings["type"], Record<string, string | number>>;
