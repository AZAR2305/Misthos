import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Misthos",
    short_name: "Misthos",
    description: "Get paid days after approval, not weeks.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#82de91",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
