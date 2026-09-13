import { createApp } from "./app";
import { connectDatabase } from "./config/database";
import { env } from "./config/env";

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDatabase();

    const app = createApp();

    const server = app.listen(env.PORT, () => {
      console.log(`
=====================================================
🚀 Isahara Backend Server running!
📍 Port:        ${env.PORT}
🌍 Environment: ${env.NODE_ENV}
📡 Health:      http://localhost:${env.PORT}/api/v1/health
📝 Survey API:  http://localhost:${env.PORT}/api/v1/survey
📊 Admin API:   http://localhost:${env.PORT}/api/v1/admin/surveys
📈 Analytics:   http://localhost:${env.PORT}/api/v1/admin/analytics/overview
⚠️  NOTICE:      Admin routes are unauthenticated (MVP mode)
=====================================================
      `);
    });

    return server;
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
