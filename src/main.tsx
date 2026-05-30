import ReactDOM from "react-dom/client";
import App from "./App";

// No StrictMode: its dev-only double-mount duplicates pointer-lock listeners
// and rebuilds the scene/AudioContext twice, which hurts a realtime 3D+audio app.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
