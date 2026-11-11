import { Router } from "express";
import healthRoutes from "../modules/health/health.routes.js";
import surveyRoutes from "../modules/survey/survey.routes.js";
import adminRoutes from "../modules/survey/admin.routes.js";
import userRoutes from "../modules/users/user.routes.js";
import driverRoutes from "../modules/drivers/driver.routes.js";
import vehicleRoutes from "../modules/vehicles/vehicle.routes.js";
import locationRoutes from "../modules/locations/location.routes.js";
import tripRoutes from "../modules/trips/trip.routes.js";
import voiceRoutes from "../modules/voice/voice.routes.js";
import discoveryRoutes from "../modules/matching/discovery.routes.js";
import rideRequestRoutes from "../modules/ride-requests/ride-request.routes.js";
import rideRoutes from "../modules/rides/ride.routes.js";
import notificationRoutes from "../modules/notifications/notification.routes.js";
import deviceRoutes from "../modules/notifications/device.routes.js";
import paymentRoutes from "../modules/payments/payment.routes.js";
import safetyRoutes from "../modules/safety/safety.routes.js";
import operatorRoutes from "../modules/operators/operator.routes.js";
import agencyRoutes from "../modules/agencies/agency.routes.js";

const apiV1Router = Router();

// Active modules
apiV1Router.use("/health", healthRoutes);
apiV1Router.use("/users", userRoutes);
apiV1Router.use("/drivers", driverRoutes);
apiV1Router.use("/vehicles", vehicleRoutes);
apiV1Router.use("/operators", operatorRoutes);
apiV1Router.use("/agencies", agencyRoutes);
apiV1Router.use("/locations", locationRoutes);
apiV1Router.use("/trips", tripRoutes);
apiV1Router.use("/voice", voiceRoutes);
apiV1Router.use("/discovery", discoveryRoutes);
apiV1Router.use("/ride-requests", rideRequestRoutes);
apiV1Router.use("/rides", rideRoutes);
apiV1Router.use("/notifications", notificationRoutes);
apiV1Router.use("/devices", deviceRoutes);
apiV1Router.use("/payments", paymentRoutes);
apiV1Router.use("/survey", surveyRoutes);
apiV1Router.use("/admin", adminRoutes);
apiV1Router.use("/safety", safetyRoutes);

export default apiV1Router;
