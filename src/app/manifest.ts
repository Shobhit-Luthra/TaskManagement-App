import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kanbo",
    short_name: "Kanbo",
    description: "A real-time Kanban board for small teams.",
    start_url: "/projects",
    scope: "/",
    display: "standalone",
    background_color: "#fff8f6",
    theme_color: "#693612",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My tasks", url: "/my-tasks" },
      { name: "Projects", url: "/projects" },
    ],
  };
}
