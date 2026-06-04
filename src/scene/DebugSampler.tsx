import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { debugEnabled, mapDebugSnapshot, memorySnapshot, recordDebugSample, roomDebugSnapshot, timingSnapshot } from "../debug";
import { useStore } from "../store";
import * as THREE from "three";
import { markerDebugSnapshot } from "./markerDebug";

export function DebugSampler() {
  const { camera, gl, scene } = useThree();
  const lastFrame = useRef(performance.now());
  const lastSample = useRef(0);
  const fps = useRef(0);

  useFrame(() => {
    if (!debugEnabled()) return;
    const now = performance.now();
    const frameMs = now - lastFrame.current;
    lastFrame.current = now;
    const instantFps = frameMs > 0 ? 1000 / frameMs : 0;
    fps.current = fps.current ? fps.current * 0.9 + instantFps * 0.1 : instantFps;
    if (now - lastSample.current < 250) return;
    lastSample.current = now;

    const state = useStore.getState();
    const position: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
    const room = roomDebugSnapshot(state.composition.map, [position[0], position[2]], state.composition.tracks);
    recordDebugSample({
      t: now,
      fps: fps.current,
      frameMs,
      memory: memorySnapshot(),
      mode: state.mode,
      entered: state.entered,
      position,
      ...room,
      map: mapDebugSnapshot(state.composition.map),
      render: renderDebugSnapshot(gl, scene),
      visual: markerDebugSnapshot(now),
      audio: state.engine?.debugSnapshot() ?? null,
      timings: timingSnapshot(),
    });
  });

  return null;
}

function renderDebugSnapshot(gl: THREE.WebGLRenderer, scene: THREE.Scene) {
  let pointLights = 0;
  let visiblePointLights = 0;
  let meshes = 0;
  scene.traverse((object) => {
    if ((object as THREE.Light).isLight && object.type === "PointLight") {
      pointLights++;
      if (object.visible) visiblePointLights++;
    }
    if ((object as THREE.Mesh).isMesh) meshes++;
  });
  return {
    calls: gl.info.render.calls,
    triangles: gl.info.render.triangles,
    points: gl.info.render.points,
    lines: gl.info.render.lines,
    pointLights,
    visiblePointLights,
    meshes,
  };
}
