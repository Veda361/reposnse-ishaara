# ISHAARA BACKEND — PHASE 08: VEHICLE DOMAIN & DRIVER–VEHICLE ASSIGNMENT
## Comprehensive Architecture & Domain Specification

---

## 1. Objective

Phase 08 establishes the authoritative backend infrastructure for:

1. **Vehicle Management** — Registration, ownership, lifecycle, and fleet management for individual, agency-owned, and operator-owned vehicles.
2. **Driver–Vehicle Assignment** — The authoritative assignment model that pairs a `DriverProfile` with a `Vehicle` for an operational shift, enforcing strict concurrency, multi-tenant, and eligibility constraints.

Phase 08 extends the operational readiness chain established by Phase 07 by providing vehicle assignment telemetry that Phase 09 (trip dispatch) will consume as a dispatch precondition.

---

## 2. Vehicle Architecture

The vehicle domain is implemented in `src/modules/vehicles/` as a self-contained module:

```
src/modules/vehicles/
├── vehicle.model.ts                    # Mongoose schema + toCleanVehicleResponse DTO
├── vehicle.types.ts                    # TypeScript interfaces, DTOs, enums
├── vehicle.service.ts                  # Individual + agency-scoped CRUD
├── vehicle.schema.ts                   # Zod strict validation schemas
├── vehicle.controller.ts               # Express request handlers
├── vehicle.routes.ts                   # Individual vehicle route definitions
├── vehicle-assignment.service.ts       # Assignment + unassignment logic
├── assignment.model.ts                 # DriverVehicleAssignment schema + DTO
├── assignment.types.ts                 # Assignment type interfaces
└── __tests__/
    ├── vehicle.api.test.ts
    ├── vehicle.service.test.ts
    └── vehicle-assignment-phase08.test.ts
```

---

## 3. Vehicle Ownership

Every vehicle has an `ownershipType` field:

| Ownership Type | Owner Field | Manager |
|:---|:---|:---|
| `INDIVIDUAL` | `driverId` (DriverProfile) | The driver themselves |
| `AGENCY` | `agencyId` (Agency) | Agency Owner or Platform Admin |
| `OPERATOR` | `operatorId` (BusOperator) | Bus Operator — field present, not yet operationally activated |

> **Domain Separation**: `BusOperator` is a separate settlement entity managed for financial routing (Razorpay Route beneficiaries). Vehicle ownership by an operator is structurally supported but not operationally enforced in Phase 08.

---

## 4. Individual Vehicles

- Created via `POST /api/v1/vehicles` by an authenticated `DRIVER_CONDUCTOR` user.
- `ownershipType = "INDIVIDUAL"`, `driverId` set to the driver's profile ID at creation.
- No agency membership required.
- Driver assigns themselves via `POST /api/v1/vehicles/:vehicleId/assignments`.
- Platform Admin can override assignment using `x-admin-key`.

---

## 5. Agency Vehicles

- Created via `POST /api/v1/agencies/:agencyId/vehicles` by the agency owner.
- `ownershipType = "AGENCY"`, `agencyId` set to the agency ID.
- Multi-tenant isolation enforced: agency owner identity resolved from `AgencyModel.ownerUserId` (never from `req.body`).
- Assignment: `POST /api/v1/agencies/:agencyId/vehicles/:vehicleId/assignments` — requires `APPROVED` agency membership for the assigning driver in that specific agency.

---

## 6. Operator Relationship

`Vehicle.operatorId` references a `BusOperator` document. This field is structurally present but Phase 08 does not activate operator-vehicle assignment workflows. `BusOperator` remains the settlement beneficiary domain and is kept strictly independent.

---

## 7. Vehicle Lifecycle

```
CREATED (isActive=true, isVerified=false)
   ↓
DEACTIVATED (isActive=false)  ←→  ACTIVATED (isActive=true)
```

- `POST /api/v1/agencies/:id/vehicles/:vehicleId/activate`
- `POST /api/v1/agencies/:id/vehicles/:vehicleId/deactivate`

---

## 8. Vehicle Verification

- `isVerified: Boolean` defaults `false` on creation.
- Vehicles are not automatically verified.
- `isVerified` is reserved for a future platform-administered compliance process.
- Phase 08 does not enforce `isVerified = true` as a prerequisite for assignment.

---

## 9. DriverVehicleAssignment Model

The `DriverVehicleAssignment` collection is the **authoritative source of truth** for driver-vehicle pairing.

### Schema Fields

| Field | Type | Purpose |
|:---|:---|:---|
| `driverId` | ObjectId → DriverProfile | The assigned driver |
| `vehicleId` | ObjectId → Vehicle | The assigned vehicle |
| `agencyId` | ObjectId → Agency \| null | The managing agency (if agency vehicle) |
| `status` | `"ACTIVE"` \| `"ENDED"` | Current assignment state |
| `assignedAt` | Date | When the assignment was created |
| `unassignedAt` | Date \| null | When the assignment was terminated |
| `assignedBy` | ObjectId → User | Actor who created the assignment |
| `assignedByRole` | `AssignmentActorRole` | `AGENCY_OWNER \| ADMIN \| DRIVER` |
| `unassignedBy` | ObjectId → User \| null | Actor who terminated the assignment |
| `unassignedByRole` | `AssignmentActorRole \| null` | Role of the unassigning actor |
| `reason` | string \| null | Free-text reason for unassignment |

---

## 10. Assignment Lifecycle

```
POST .../assignments
   ↓
10-step validation pipeline
   ↓
ACTIVE assignment created
   ↓
POST .../unassign
   ↓
status = "ENDED", timestamps/actors recorded
   ↓
Historical record preserved (never deleted)
```

Assignment documents are **never deleted**. `status = "ENDED"` terminates the assignment while preserving the audit record.

---

## 11. Assignment Cardinality

- **One active driver per vehicle** — enforced by business logic AND partial unique index on `{ vehicleId: 1 }` with `partialFilterExpression: { status: "ACTIVE" }`.
- **One active vehicle per driver** — enforced by business logic AND partial unique index on `{ driverId: 1 }` with `partialFilterExpression: { status: "ACTIVE" }`.
- Conductor multi-staff scenarios (Phase N) are out of scope.

---

## 12. Assignment Source of Truth

> **`DriverVehicleAssignment` is the authoritative source of truth for driver-vehicle relationships.**

`Vehicle.driverId` is a **denormalized convenience field** maintained to enable efficient vehicle-scoped queries without a join. It is synchronized during:
- `assignVehicle()` → `vehicle.driverId = profile._id`
- `unassignVehicle()` → `vehicle.driverId = null`

These two writes are **not wrapped in a MongoDB transaction**. On a crash between assignment creation and `vehicle.driverId` sync, `DriverVehicleAssignment` remains authoritative. `getActiveAssignmentForDriver()` resolves via the assignment collection first.

---

## 13. Cross-Agency Security

Multi-tenant isolation is enforced at two layers:

1. **Scope Validation**: Agency ID from the URL parameter is validated against `Agency.ownerUserId` fetched from the database.
2. **Assignment Membership Check**: The target driver must have an `APPROVED` `AgencyMembership` in **that specific agency**. A driver from Agency B cannot be assigned to an Agency A vehicle → `CROSS_AGENCY_ASSIGNMENT_FORBIDDEN (409)`.

---

## 14. Driver Eligibility for Vehicle Assignment

The 10-step assignment validation pipeline enforces:

1. Vehicle must exist
2. Vehicle must belong to the specified agency (if agency context)
3. `vehicle.isActive === true`
4. Driver must have a `DriverProfile`
5. Must be `DRIVER_CONDUCTOR` (errors: `INVALID_ROLE`)
6. `isSuspended === false` (errors: `DRIVER_OPERATIONAL_SUSPENDED`)
7. `verificationStatus === VERIFIED` (errors: `DRIVER_NOT_VERIFIED`)
8. If agency vehicle, driver must have `APPROVED` membership (errors: `CROSS_AGENCY_ASSIGNMENT_FORBIDDEN`)
9. Driver must not have an active trip on a different vehicle (errors: `DRIVER_HAS_ACTIVE_TRIP`)
10. No existing ACTIVE assignment for driver or vehicle (errors: `DRIVER_ALREADY_ASSIGNED`, `VEHICLE_ALREADY_ASSIGNED`)

> **Critical**: Assignment eligibility does **NOT** require `readiness === READY`. See §17.

---

## 15. Concurrency Strategy

### Database Layer (Atomic)
Two partial unique indexes prevent duplicate ACTIVE assignments:

```typescript
// One active assignment per driver
driverVehicleAssignmentSchema.index(
  { driverId: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" } }
);
// One active assignment per vehicle
driverVehicleAssignmentSchema.index(
  { vehicleId: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" } }
);
```

MongoDB 11000 duplicate key errors on concurrent `create()` are caught and re-thrown as `ConflictError`. Business-layer pre-checks reduce the probability of reaching this path.

### Transaction Note
Assignment creation and `Vehicle.driverId` sync are **not wrapped in a MongoDB transaction** by design. Recovery path: `getActiveAssignmentForDriver()` is the authoritative resolver.

---

## 16. Database Indexes

### VehicleModel
| Index | Options |
|:---|:---|
| `registrationNumber` | `unique: true` |
| `driverId, isActive` | compound |
| `agencyId, isActive` | compound, sparse |
| `operatorId, isActive` | compound, sparse |
| `ownershipType` | single |
| `isActive` | single |

### DriverVehicleAssignmentModel
| Index | Options |
|:---|:---|
| `{ driverId: 1 }` | unique + partialFilter: {status: ACTIVE} |
| `{ vehicleId: 1 }` | unique + partialFilter: {status: ACTIVE} |
| `agencyId, status` | compound, sparse |
| `driverId, createdAt: -1` | compound |
| `vehicleId, createdAt: -1` | compound |

---

## 17. Phase 07 Readiness Integration

### Phase 08 Architectural Decision: Vehicle Assignment is Informational

Vehicle assignment is exposed as **telemetry** in the readiness response but **does not gate** `status = READY`.

**Rationale — Circular Dependency Prevention:**

If `READY` required `vehicleAssigned: true`, and assignment required `READY`, then:
- Assignment requires READY → READY requires assignment → **circular deadlock**

The correct sequence enforced by Phase 08:
```
VERIFIED + APPROVED_MEMBERSHIP
        ↓
eligible for vehicle assignment (prerequisites exist before READY)
        ↓
vehicle assignment created
        ↓
readiness telemetry reflects vehicleAssigned: true
        ↓
Phase 09 uses vehicleAssigned as a dispatch precondition
```

### Response Example (READY without vehicle)
```json
{
  "requirements": {
    "platformVerification": true,
    "agencyMembership": true,
    "profileComplete": true,
    "notSuspended": true,
    "vehicleAssigned": false
  },
  "activeVehicle": null,
  "status": "READY",
  "authorized": true
}
```

---

## 18. Online/Offline Relationship

| Event | Vehicle Effect | Driver Status Effect |
|:---|:---|:---|
| Assignment created | `vehicle.driverId` set | No change |
| Driver goes ONLINE | No change | `status = ONLINE` (requires READY) |
| Assignment unassigned | `vehicle.driverId = null` | Forced to `OFFLINE` if currently ONLINE |
| Driver suspended | No assignment change | Forced to `OFFLINE` |

---

## 19. API Contracts

### Individual Vehicle Routes
| Method | Endpoint | Auth |
|:---|:---|:---|
| `POST` | `/api/v1/vehicles` | DRIVER_CONDUCTOR |
| `GET` | `/api/v1/vehicles` | DRIVER_CONDUCTOR |
| `GET` | `/api/v1/vehicles/:vehicleId` | DRIVER_CONDUCTOR |
| `PATCH` | `/api/v1/vehicles/:vehicleId` | DRIVER_CONDUCTOR |
| `POST` | `/api/v1/vehicles/:vehicleId/activate` | DRIVER_CONDUCTOR |
| `POST` | `/api/v1/vehicles/:vehicleId/deactivate` | DRIVER_CONDUCTOR |
| `POST` | `/api/v1/vehicles/:vehicleId/assignments` | DRIVER_CONDUCTOR / Admin |
| `POST` | `/api/v1/vehicles/:vehicleId/unassign` | DRIVER_CONDUCTOR / Admin |
| `GET` | `/api/v1/vehicles/:vehicleId/assignments` | DRIVER_CONDUCTOR |
| `GET` | `/api/v1/drivers/me/vehicle` | DRIVER_CONDUCTOR |

### Agency Fleet Routes
| Method | Endpoint | Auth |
|:---|:---|:---|
| `POST` | `/api/v1/agencies/:id/vehicles` | Agency Owner / Admin |
| `GET` | `/api/v1/agencies/:id/vehicles` | Agency Owner / Admin |
| `GET` | `/api/v1/agencies/:id/vehicles/:vehicleId` | Agency Owner / Admin |
| `PATCH` | `/api/v1/agencies/:id/vehicles/:vehicleId` | Agency Owner / Admin |
| `POST` | `/api/v1/agencies/:id/vehicles/:vehicleId/activate` | Agency Owner / Admin |
| `POST` | `/api/v1/agencies/:id/vehicles/:vehicleId/deactivate` | Agency Owner / Admin |
| `POST` | `/api/v1/agencies/:id/vehicles/:vehicleId/assignments` | Agency Owner / Admin |
| `POST` | `/api/v1/agencies/:id/vehicles/:vehicleId/unassign` | Agency Owner / Admin |
| `GET` | `/api/v1/agencies/:id/vehicles/:vehicleId/assignments` | Agency Owner / Admin |

---

## 20. Error Codes

| Code | HTTP | Scenario |
|:---|:---|:---|
| `VEHICLE_NOT_FOUND` | 404 | Vehicle ID does not exist |
| `VEHICLE_REGISTRATION_ALREADY_EXISTS` | 409 | Registration number already in use |
| `VEHICLE_INACTIVE` | 400 | Assigning to an inactive vehicle |
| `VEHICLE_ALREADY_ASSIGNED` | 409 | Vehicle already has an active driver |
| `VEHICLE_HAS_ACTIVE_TRIP` | 400 | Cannot unassign during active trip/ride |
| `DRIVER_ALREADY_ASSIGNED` | 409 | Driver already has an active vehicle |
| `DRIVER_NOT_VERIFIED` | 400 | Assignment requires VERIFIED status |
| `DRIVER_OPERATIONAL_SUSPENDED` | 403 | Driver is suspended |
| `CROSS_AGENCY_ASSIGNMENT_FORBIDDEN` | 409 | Vehicle/driver agency mismatch |
| `INVALID_ROLE` | 400 | Non-DRIVER_CONDUCTOR cannot be assigned |
| `VEHICLE_NOT_ASSIGNED` | — | Reserved for future readiness gate use |
| `DRIVER_ONLINE_ASSIGNMENT_CONFLICT` | — | Reserved for future ONLINE state conflict |

---

## 21. Security Model

| Control | Mechanism |
|:---|:---|
| Authentication | `requireAuth` middleware (BetterAuth Bearer token) |
| Driver role | `requireDriverConductor` middleware |
| Agency ownership | DB lookup: `Agency.ownerUserId === req.auth.applicationUserId` |
| Admin bypass | `x-admin-key` header verification |
| Driver identity | Always from `req.auth` → never `req.body` |
| IDOR prevention | URL params cross-checked against DB ownership |
| Cross-agency prevention | Agency membership verified against vehicle's `agencyId` |
| Mass assignment protection | Explicit field-by-field updates |
| Server-owned fields | `.strict()` Zod schemas |
| Registration uniqueness | DB unique index |
| Concurrency safety | Partial unique indexes + 11000 error catch |

---

## 22. Document Storage Limitation

Phase 08 does not implement binary document storage (vehicle insurance certificates, fitness certificates, RC copies). The `Vehicle` model has no binary attachment fields. A future compliance document phase may extend the schema with object-storage references.

---

## 23. Phase 09 Boundary

Phase 08 explicitly does NOT implement:
- Trip scheduling or dispatch
- Route assignment
- Ride lifecycle or live tracking
- Passenger matching
- Payments or settlements

**What Phase 09 can build on:**

1. Verify `vehicleAssigned === true` from `getActiveAssignmentForDriver()` as a dispatch precondition.
2. Read `activeVehicle.id` from the assignment for `TripModel.vehicleId`.
3. The existing `TripStatus` and `RideStatus` active-trip guards in `assignVehicle()`/`unassignVehicle()` are forward-compatible.
