import { createApp } from "./app";
import { connectDatabase } from "./config/database";
import { env } from "./config/env";

const PORT = Number(process.env.PORT) || env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDatabase();

    const app = createApp();

    const server = app.listen(PORT, () => {
      console.log(`
=====================================================
🚀 Isahara Backend Server running!
📍 Port:        ${PORT}
🌍 Environment: ${env.NODE_ENV}
📡 Health:      http://localhost:${PORT}/api/v1/health
📝 Survey API:  http://localhost:${PORT}/api/v1/survey
📊 Admin API:   http://localhost:${PORT}/api/v1/admin/surveys
📈 Analytics:   http://localhost:${PORT}/api/v1/admin/analytics/overview
🔐 Security:    Admin endpoints guarded by ADMIN_SECRET_KEY
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
