import { Grid, Sparkles } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { EnvironmentSettings } from "../environment";

type PropSet = Array<{ position: [number, number, number]; scale: [number, number, number]; rotation?: [number, number, number] }>;

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
  const rocks = useMemo(() => ringProps(18, 22, 7), []);
  const stalactites = useMemo(() => ringProps(14, 17, 11), []);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <circleGeometry args={[55, 96]} />
        <FloorMaterial base="#2a252b" accent="#5a4a40" density={1.35} />
      </mesh>
      {rocks.map((p, i) => (
        <mesh key={`rock-${i}`} position={p.position} scale={p.scale} rotation={p.rotation}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={i % 2 ? "#5a5258" : "#463f47"} roughness={0.95} />
        </mesh>
      ))}
      {stalactites.map((p, i) => (
        <mesh key={`stalactite-${i}`} position={[p.position[0], 7.5 + (i % 3), p.position[2]]} scale={[p.scale[0] * 0.5, p.scale[1] * 1.8, p.scale[2] * 0.5]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[1, 4, 7]} />
          <meshStandardMaterial color="#504750" roughness={0.95} />
        </mesh>
      ))}
      <pointLight position={[-12, 5, -8]} color="#aeb8ff" intensity={7.2 + ambience * 2.6} distance={48} />
      <pointLight position={[10, 3, 12]} color="#ffdca8" intensity={3.6 + ambience * 1.4} distance={34} />
      <pointLight position={[0, 6, 0]} color="#f0e8ff" intensity={5.2 + ambience * 1.8} distance={42} />
    </>
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
