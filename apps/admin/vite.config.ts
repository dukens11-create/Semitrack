import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({command,mode}) => {
  const value = process.env.VITE_API_URL ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL;
  if (command === 'build') {
    let url: URL;
    try { url = new URL(value ?? ''); }
    catch { throw new Error('VITE_API_URL is required for the production admin build.'); }
    if (url.origin !== 'https://semitrax-api.onrender.com' || url.pathname !== '/' ||
        url.username || url.password || url.search || url.hash) {
      throw new Error('Production admin requires the approved HTTPS SemiTraX API origin.');
    }
  }
  return {
  plugins: [react()],
  server: { port: 5173 },
  };
});
