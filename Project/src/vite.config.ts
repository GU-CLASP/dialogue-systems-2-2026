import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/furhat": {
        target: "http://127.0.0.1:54321",
        changeOrigin: true,
      },
    },
  },
});
