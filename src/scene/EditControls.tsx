import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

// Edit-mode camera: orbit around the plaza with a free cursor, so you can see
// the whole layout and click tracks to select/move them.
export function EditControls() {
  const { camera } = useThree();

  // Pull back to an overview vantage when entering edit mode.
  useEffect(() => {
    camera.position.set(0, 14, 22);
  }, [camera]);

  return (
    <OrbitControls
      makeDefault
      target={[0, 1.5, 0]}
      enableDamping
      maxPolarAngle={Math.PI / 2.05} // don't dip below the floor
      minDistance={3}
      maxDistance={60}
    />
  );
}
