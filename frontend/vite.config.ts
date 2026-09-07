import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server runs on :3000 to match the backend's default APP_BASE_URL /
// CORS allow-list (see backend/src/config/env.ts). If you change this,
// update CORS_ORIGIN in backend/.env to match.
export default defineConfig({
  plugins: [react()],
  server: {
  host: "0.0.0.0",
  port: 3000,
},
});
