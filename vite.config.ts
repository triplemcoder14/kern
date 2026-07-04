import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/k8s-api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/k8s-api/, ""),
      },
      "/ebpf-api": {
        target: "http://127.0.0.1:9474",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ebpf-api/, ""),
      },
    },
  },
});
