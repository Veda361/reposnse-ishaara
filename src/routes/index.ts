import { Router } from "express";
import healthRoutes from "../modules/health/health.routes";
import surveyRoutes from "../modules/survey/survey.routes";
import adminRoutes from "../modules/survey/admin.routes";
import userRoutes from "../modules/users/user.routes";
import driverRoutes from "../modules/drivers/driver.routes";
import vehicleRoutes from "../modules/vehicles/vehicle.routes";
import locationRoutes from "../modules/locations/location.routes";
import tripRoutes from "../modules/trips/trip.routes";
import voiceRoutes from "../modules/voice/voice.routes";
import discoveryRoutes from "../modules/matching/discovery.routes";
import rideRequestRoutes from "../modules/ride-requests/ride-request.routes";
import rideRoutes from "../modules/rides/ride.routes";

const apiV1Router = Router();

// Active modules
apiV1Router.use("/health", healthRoutes);
apiV1Router.use("/users", userRoutes);
apiV1Router.use("/drivers", driverRoutes);
apiV1Router.use("/vehicles", vehicleRoutes);
apiV1Router.use("/locations", locationRoutes);
apiV1Router.use("/trips", tripRoutes);
apiV1Router.use("/voice", voiceRoutes);
apiV1Router.use("/discovery", discoveryRoutes);
apiV1Router.use("/ride-requests", rideRequestRoutes);
apiV1Router.use("/rides", rideRoutes);
apiV1Router.use("/survey", surveyRoutes);
apiV1Router.use("/admin", adminRoutes);

export default apiV1Router;
