import { Router } from "express";
import { busOperatorController } from "./operator.controller";
import { requireAuth, requireAdminKey } from "../../middleware/authorization";

const router = Router();

// Bus Operator admin endpoints
router.post("/", requireAdminKey, (req, res, next) =>
  busOperatorController.createOperator(req, res, next)
);

router.get("/:id", requireAuth, (req, res, next) =>
  busOperatorController.getOperator(req, res, next)
);

router.patch("/:id/verify-payout", requireAdminKey, (req, res, next) =>
  busOperatorController.verifyPayoutAccount(req, res, next)
);

router.post(
  "/:id/vehicles/:vehicleId",
  requireAdminKey,
  (req, res, next) => busOperatorController.assignVehicle(req, res, next)
);

export default router;
