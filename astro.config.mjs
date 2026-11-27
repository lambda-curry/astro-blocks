import node from "@astrojs/node";
import { defineConfig } from "astro/config";

// The workbench renders on demand, like a Site Boulder draft, so the gallery's
// ?theme= and ?category= links work without client JavaScript in both places.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  devToolbar: { enabled: false },
});
