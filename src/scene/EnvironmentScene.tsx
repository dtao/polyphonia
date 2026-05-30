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
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <circleGeometry args={[46, 96]} />
        <FloorMaterial base="#080a13" accent="#151f35" density={0.4} />
      </mesh>
      <Sparkles count={Math.round(30 + accents * 40)} scale={[42, 5, 42]} size={1.2} speed={0.08} color="#5b8cff" opacity={0.22} />
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
  const trees = useMemo(() => scatterProps(34, 13, 36), []);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.07, 0]}>
        <circleGeometry args={[60, 96]} />
        <FloorMaterial base="#0d1d16" accent="#2c4a24" density={1.1} />
      </mesh>
      {trees.map((p, i) => (
        <group key={`tree-${i}`} position={p.position} rotation={p.rotation}>
          <mesh position={[0, 1.5, 0]} scale={[0.35, 1.8 + (i % 4) * 0.25, 0.35]}>
            <cylinderGeometry args={[0.45, 0.65, 2.4, 8]} />
            <meshStandardMaterial color="#2b1c13" roughness={0.85} />
          </mesh>
          <mesh position={[0, 4.1, 0]} scale={p.scale}>
            <icosahedronGeometry args={[1.8, 1]} />
            <meshStandardMaterial color={i % 2 ? "#244b32" : "#173b2a"} roughness={0.95} />
          </mesh>
        </group>
      ))}
      <hemisphereLight args={["#b8f0c8", "#102016", 0.45 + ambience * 0.25]} />
      <Sparkles count={26} scale={[45, 5, 45]} size={0.7} speed={0.15} color="#c8ffd8" opacity={0.16} />
    </>
  );
}

function CrystalHall({ ambience }: { ambience: number }) {
  const crystals = useMemo(() => scatterProps(30, 10, 34), []);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
        <circleGeometry args={[58, 96]} />
        <FloorMaterial base="#07101a" accent="#14536b" density={0.85} />
      </mesh>
      {crystals.map((p, i) => (
        <mesh key={`crystal-${i}`} position={[p.position[0], 1.6 + p.scale[1] * 0.5, p.position[2]]} scale={p.scale} rotation={p.rotation}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? "#79f0ff" : i % 3 === 1 ? "#b96bff" : "#56e0c0"}
            emissive={i % 3 === 0 ? "#1f7a88" : i % 3 === 1 ? "#4d1f88" : "#167a62"}
            emissiveIntensity={0.45 + ambience * 0.45}
            roughness={0.25}
            metalness={0.15}
          />
        </mesh>
      ))}
      <pointLight position={[0, 6, 0]} color="#8eefff" intensity={1.6 + ambience * 2.8} distance={42} />
      <Sparkles count={45} scale={[42, 10, 42]} size={1.4} speed={0.12} color="#bff8ff" opacity={0.3} />
    </>
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
