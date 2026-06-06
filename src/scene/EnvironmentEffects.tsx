import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { EnvironmentSettings } from "../environment";
import { environmentPackById, resolvedEnvironmentQuality } from "../environmentPacks";
import { arWalk } from "../store";

export function EnvironmentEffects({ environment, editMode }: { environment: EnvironmentSettings; editMode: boolean }) {
  const { camera, gl, scene, size } = useThree();
  const pack = environmentPackById(environment.pack?.id);
  const quality = resolvedEnvironmentQuality(environment.pack?.quality ?? "auto");
  const enabled = !!pack?.effects && quality === "high" && !editMode;

  const composer = useMemo(() => {
    if (!enabled || !pack?.effects) return null;
    const effects = pack.effects;
    const next = new EffectComposer(gl);
    next.addPass(new RenderPass(scene, camera));
    if (effects.ambientOcclusion) {
      const ssao = new SSAOPass(scene, camera, size.width, size.height);
      ssao.kernelRadius = 7;
      ssao.minDistance = 0.002;
      ssao.maxDistance = 0.08;
      next.addPass(ssao);
    }
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      effects.bloomStrength,
      effects.bloomRadius,
      effects.bloomThreshold,
    );
    next.addPass(bloom);
    const vignette = new ShaderPass(VIGNETTE_SHADER);
    vignette.uniforms.amount.value = effects.vignette;
    next.addPass(vignette);
    next.addPass(new OutputPass());
    return next;
  }, [camera, enabled, gl, pack, scene]);

  useEffect(() => {
    composer?.setSize(size.width, size.height);
  }, [composer, size]);

  useEffect(() => {
    const previousToneMapping = gl.toneMapping;
    const previousExposure = gl.toneMappingExposure;
    if (pack?.effects) {
      gl.toneMapping = THREE.ACESFilmicToneMapping;
      gl.toneMappingExposure = pack.effects.exposure;
    }
    return () => {
      gl.toneMapping = previousToneMapping;
      gl.toneMappingExposure = previousExposure;
    };
  }, [gl, pack]);

  useEffect(() => () => composer?.dispose(), [composer]);

  useFrame(() => {
    if (!composer) return;
    if (arWalk.active || gl.xr.isPresenting) gl.render(scene, camera);
    else composer.render();
  }, enabled ? 1 : 0);

  return null;
}

const VIGNETTE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0.25 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float edge = smoothstep(0.82, 0.25, distance(vUv, vec2(0.5)));
      color.rgb *= mix(1.0 - amount, 1.0, edge);
      gl_FragColor = color;
    }
  `,
};
