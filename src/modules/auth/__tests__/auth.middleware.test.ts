import { describe, it } from "node:test";
import assert from "node:assert";
import { requireAuth } from "../../../middleware/auth";
import { requireRole, requireUser, requireDriverConductor } from "../../../middleware/authorization";
import { UserRole } from "../../../shared/constants/roles.constants";
import { ERROR_CODES } from "../../../shared/errors/error-codes";
import { AuthenticatedRequest } from "../../../shared/types/common.types";
import { AppError } from "../../../shared/errors/app-error";

describe("Authentication & Authorization Middleware Tests", () => {
  describe("requireAuth()", () => {
    it("should reject request when no authenticated user is attached and no session exists", async () => {
      const mockReq = {
        headers: {},
        auth: undefined,
        user: undefined,
      } as unknown as AuthenticatedRequest;

      const mockRes = {} as any;
      let caughtError: any = null;

      await requireAuth(mockReq, mockRes, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError instanceof AppError);
      assert.strictEqual(caughtError.statusCode, 401);
      assert.strictEqual(caughtError.code, ERROR_CODES.UNAUTHORIZED);
    });

    it("should reject request with 403 if user account is deactivated (isActive === false)", async () => {
      const mockReq = {
        headers: {},
        auth: {
          authUserId: "auth_inactive_123",
          applicationUserId: "app_inactive_123",
          user: {
            _id: "app_inactive_123",
            email: "inactive@isahara.app",
            isActive: false,
          },
        },
      } as unknown as AuthenticatedRequest;

      const mockRes = {} as any;
      let caughtError: any = null;

      await requireAuth(mockReq, mockRes, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError instanceof AppError);
      assert.strictEqual(caughtError.statusCode, 403);
      assert.strictEqual(caughtError.code, ERROR_CODES.USER_INACTIVE);
    });

    it("should allow request to proceed when user is active and authenticated", async () => {
      const mockReq = {
        headers: {},
        auth: {
          authUserId: "auth_active_123",
          applicationUserId: "app_active_123",
          user: {
            _id: "app_active_123",
            email: "active@isahara.app",
            isActive: true,
          },
        },
      } as unknown as AuthenticatedRequest;

      const mockRes = {} as any;
      let calledNext = false;
      let caughtError: any = null;

      await requireAuth(mockReq, mockRes, (err?: any) => {
        calledNext = true;
        caughtError = err;
      });

      assert.strictEqual(calledNext, true);
      assert.strictEqual(caughtError, undefined);
    });
  });

  describe("requireRole()", () => {
    it("should reject request when user has no role (onboarding not completed)", () => {
      const mockReq = {
        auth: {
          user: {
            role: null,
          },
        },
      } as unknown as AuthenticatedRequest;

      const guard = requireRole(UserRole.USER);
      let caughtError: any = null;

      guard(mockReq, {} as any, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError instanceof AppError);
      assert.strictEqual(caughtError.statusCode, 403);
      assert.strictEqual(caughtError.code, ERROR_CODES.FORBIDDEN);
    });

    it("should reject USER from accessing DRIVER_CONDUCTOR route", () => {
      const mockReq = {
        auth: {
          user: {
            role: UserRole.USER,
          },
        },
      } as unknown as AuthenticatedRequest;

      const guard = requireDriverConductor;
      let caughtError: any = null;

      guard(mockReq, {} as any, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError instanceof AppError);
      assert.strictEqual(caughtError.statusCode, 403);
      assert.strictEqual(caughtError.code, ERROR_CODES.FORBIDDEN);
    });

    it("should reject DRIVER_CONDUCTOR from accessing strictly USER route", () => {
      const mockReq = {
        auth: {
          user: {
            role: UserRole.DRIVER_CONDUCTOR,
          },
        },
      } as unknown as AuthenticatedRequest;

      const guard = requireUser;
      let caughtError: any = null;

      guard(mockReq, {} as any, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError instanceof AppError);
      assert.strictEqual(caughtError.statusCode, 403);
      assert.strictEqual(caughtError.code, ERROR_CODES.FORBIDDEN);
    });

    it("should allow DRIVER_CONDUCTOR to access DRIVER_CONDUCTOR route", () => {
      const mockReq = {
        auth: {
          user: {
            role: UserRole.DRIVER_CONDUCTOR,
          },
        },
      } as unknown as AuthenticatedRequest;

      const guard = requireDriverConductor;
      let calledNext = false;
      let caughtError: any = null;

      guard(mockReq, {} as any, (err?: any) => {
        calledNext = true;
        caughtError = err;
      });

      assert.strictEqual(calledNext, true);
      assert.strictEqual(caughtError, undefined);
    });

    it("should allow both roles if route permits multiple roles", () => {
      const guard = requireRole(UserRole.USER, UserRole.DRIVER_CONDUCTOR);

      const reqUser = {
        auth: { user: { role: UserRole.USER } },
      } as unknown as AuthenticatedRequest;
      let userPassed = false;
      guard(reqUser, {} as any, () => { userPassed = true; });
      assert.strictEqual(userPassed, true);

      const reqDriver = {
        auth: { user: { role: UserRole.DRIVER_CONDUCTOR } },
      } as unknown as AuthenticatedRequest;
      let driverPassed = false;
      guard(reqDriver, {} as any, () => { driverPassed = true; });
      assert.strictEqual(driverPassed, true);
    });
  });
});
