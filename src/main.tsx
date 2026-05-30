import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import { Viewer } from "./ui/Viewer";
import { Gallery } from "./ui/Gallery";
import { ArtistPage } from "./ui/ArtistPage";

// No StrictMode: its dev-only double-mount duplicates pointer-lock listeners
// and rebuilds the scene/AudioContext twice, which hurts a realtime 3D+audio app.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/c/:id" element={<Viewer />} />
      <Route path="/gallery" element={<Gallery />} />
      <Route path="/artist/:slug" element={<ArtistPage />} />
    </Routes>
  </BrowserRouter>,
);
