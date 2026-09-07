import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Runs on :3001 to match the backend's STAFF_BASE_URL / CORS allow-list
// default (see backend/src/config/env.ts). If you change this, update
// CORS_ORIGIN / STAFF_BASE_URL in backend/.env to match.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
  },
});
