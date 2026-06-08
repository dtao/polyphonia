import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import App from "./App";
import { Viewer } from "./ui/Viewer";
import { Gallery } from "./ui/Gallery";
import { ArtistPage } from "./ui/ArtistPage";
import { PublicLanding } from "./ui/PublicLanding";
import { useStore } from "./store";

function AuthenticatedRoute({ children }: { children: React.ReactNode }) {
  const authReady = useStore((state) => state.authReady);
  const user = useStore((state) => state.user);

  if (!authReady) return <div style={loading}>Loading...</div>;
  return user ? children : <Navigate to="/" replace />;
}

function HomeRoute() {
  const authReady = useStore((state) => state.authReady);
  const user = useStore((state) => state.user);

  if (!authReady) return <div style={loading}>Loading...</div>;
  return user ? <App /> : <PublicLanding />;
}

function Root() {
  useEffect(() => {
    useStore.getState().initAuth();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/c/:id" element={<Viewer />} />
        <Route
          path="/gallery"
          element={
            <AuthenticatedRoute>
              <Gallery />
            </AuthenticatedRoute>
          }
        />
        <Route
          path="/artist/:slug"
          element={
            <AuthenticatedRoute>
              <ArtistPage />
            </AuthenticatedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

// No StrictMode: its dev-only double-mount duplicates pointer-lock listeners
// and rebuilds the scene/AudioContext twice, which hurts a realtime 3D+audio app.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <Root />,
);

const loading: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "#05060a",
  color: "rgba(255,255,255,0.6)",
  fontFamily: "system-ui, sans-serif",
};
