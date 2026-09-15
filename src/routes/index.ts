import { Router } from "express";
import healthRoutes from "../modules/health/health.routes";
import surveyRoutes from "../modules/survey/survey.routes";
import adminRoutes from "../modules/survey/admin.routes";
import userRoutes from "../modules/users/user.routes";

const apiV1Router = Router();

// Active modules
apiV1Router.use("/health", healthRoutes);
apiV1Router.use("/users", userRoutes);
apiV1Router.use("/survey", surveyRoutes);
apiV1Router.use("/admin", adminRoutes);

export default apiV1Router;
