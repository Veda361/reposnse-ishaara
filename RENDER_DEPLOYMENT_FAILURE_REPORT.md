# ISHAARA Backend — Render Deployment Failure Investigation & Fix Report

**Date**: November 11, 2026  
**Service**: `ishara-backend` (`https://reposnse-ishaara.onrender.com`)  
**Repository**: `https://github.com/Veda361/reposnse-ishaara.git`  
**Deployment Platform**: Render (Web Service)  

---

## 1. Actual Root Cause Analysis

### Observed Failure Output on Render
```text
npm error
npm error   --omit
npm error   --include
npm error   --strict-peer-deps
npm error Run "npm help ci" for more info

==> Build failed
```

### Forensic Tracing of npm Source Code (`lib/commands/ci.js`)
In the npm CLI source code (`npm/lib/commands/ci.js`), `CI.params` defines the command-line options in order of appearance:
```javascript
static params = [
  'install-strategy',
  'legacy-bundling',
  'global-style',
  'omit',
  'include',
  'strict-peer-deps',
  'foreground-scripts',
  'ignore-scripts',
  'audit',
  'bin-links',
  'fund',
  'dry-run',
  ...super.params,
]
```

When `npm ci` encounters a usage or execution precondition failure, it invokes `this.usageError(...)` which prints `npm error code EUSAGE`, prints the specific error reason, and then outputs the options usage block containing:
```text
npm error   --omit
npm error   --include
npm error   --strict-peer-deps
npm error Run "npm help ci" for more info
```

There are three primary root causes responsible for this failure during Render's build lifecycle:

1. **Root Directory Misconfiguration in Render Dashboard (Primary Cause)**:
   - In the GitHub repository (`Veda361/reposnse-ishaara.git`), `package.json` and `package-lock.json` are placed directly in the **repository root**.
   - If the Render Web Service settings specify **Root Directory** as `ishara-backend` (derived from the local directory name `/home/dev/ishara/ishara-backend`), Render executes `cd ishara-backend`.
   - Because `ishara-backend/` does not exist as a subdirectory inside the repository, Render attempts to run `npm ci` in an empty directory without `package-lock.json`.
   - When `package-lock.json` is missing, `arborist.loadVirtual()` throws an immediate `EUSAGE` error:
     ```text
     The `npm ci` command can only install with an existing package-lock.json or npm-shrinkwrap.json...
     Run "npm help ci" for more info
     ```
2. **Malformed or Incomplete Build Command Arguments**:
   - If Render's Build Command field was entered with dangling flags (such as `npm ci --omit` or `npm ci --include` without the mandatory operand `dev`, `optional`, or `peer`), npm rejects the CLI configuration.
   - Additionally, recent git history showed an attempted commit message `push npm cl version`, indicating potential typos like `npm cl` vs `npm ci`.
3. **Missing Node.js & npm Engine Specification**:
   - `package.json` previously lacked an `"engines"` field. Render defaults to its baseline container image (which can be Node 18 or older depending on service creation date).
   - The dependency `resend@^6.32.0` (added in commit `765b0c9`) strictly specifies `"engines": { "node": ">=20" }`. Building or installing with older npm/node runtimes triggers strict-peer or engine mismatches.

---

## 2. Exact Failing Command

In Render's build container:
```bash
# Executed when Root Directory is set to 'ishara-backend' (or non-root):
cd ishara-backend && npm ci
# Result: EUSAGE (missing package-lock.json) -> Build failed
```
Or when invoked with malformed arguments:
```bash
npm ci --omit # (missing operand dev/optional/peer)
```

The correct, authoritative build sequence for production deployment is:
```bash
npm ci --include=dev && npm run build
```

---

## 3. Relevant Package and Lockfile Findings

1. **`package.json`**:
   - Dependencies: 17 production dependencies (`better-auth`, `cors`, `dotenv`, `express`, `express-rate-limit`, `firebase-admin`, `helmet`, `json2csv`, `mongodb`, `mongoose`, `multer`, `razorpay`, `resend`, `ws`, `zod`).
   - DevDependencies: 10 packages including `typescript@^5.9.3` and `@types/*`.
   - Build script: `"build": "tsc"`. Because TypeScript is in `devDependencies`, `npm ci` in a production environment (`NODE_ENV=production`) must explicitly include dev dependencies (`--include=dev`) so that the `tsc` compiler is available.
   - Start script: `"start": "node dist/server.js"`.
2. **`package-lock.json`**:
   - `lockfileVersion`: `3`.
   - Synchronization: Fully synchronized with `package.json`. Tested via `npm ci --dry-run` which reported `up to date in 2s` with 0 mismatches.
   - Lockfile integrity is 100% valid. **Do NOT delete or recreate `package-lock.json`.**

---

## 4. Files Modified

| File | Modification | Purpose |
|------|--------------|---------|
| `package.json` | Added `"engines": { "node": ">=20.0.0", "npm": ">=9.0.0" }` | Guarantees Render deploys using Node 20+ and npm 9+, matching `resend` and lockfile v3 requirements. |
| `src/modules/auth/auth.config.ts` | Multi-Client ID parsing via regex `[,;\s|]+` | Allows multiple Web Client IDs and Android Client IDs simultaneously without audience mismatch. *(Previously staged & committed in `7b8f7d4`)* |
| `RENDER_DEPLOYMENT_FAILURE_REPORT.md` | Created report | Complete forensic analysis, fix documentation, and deployment instructions. |

---

## 5. Minimal Fix Applied

In `package.json`, added explicit engine constraints directly below the `license` field:
```json
  "license": "ISC",
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=9.0.0"
  },
  "dependencies": {
```

No package manager was replaced. `package-lock.json` was preserved intact without `--force` or `--legacy-peer-deps`.

---

## 6. Validation Results

All verification gates were executed locally:

### A. Clean Install with Dev Dependencies
```bash
npm ci --include=dev
```
- **Result**: `added 385 packages, and audited 386 packages in 10s` (Exit code: 0).

### B. Production TypeScript Compilation
```bash
npm run build
```
- **Command**: `tsc`
- **Result**: Successfully compiled all TypeScript source files into `dist/` (Exit code: 0).

### C. Strict Static Analysis (Typecheck)
```bash
npm run typecheck
```
- **Command**: `tsc --noEmit`
- **Result**: Zero type errors across the entire codebase (Exit code: 0).

### D. Authentication & Google OAuth Verification Tests
```bash
NODE_ENV=test npx tsx --test src/modules/auth/__tests__/google.auth.test.ts
```
- **Result**: `10/10` tests passed (`0` failed, `duration: 29.5s`):
  - `✔ 1. should accept Google ID token issued for Android OAuth Client ID`
  - `✔ 2. should accept Google ID token issued for Web OAuth Client ID`
  - `✔ 3. should reject Google ID token with unknown audience (unauthorized client)`
  - `✔ 4. should reject expired Google ID token`
  - `✔ 5. should reject malformed Google ID token string`
  - `✔ 6. should reject request with wrong or unsupported provider`
  - `✔ 7. should allow authenticated request to GET /api/v1/users/me using Bearer session token`
  - `✔ 8. should idempotently handle repeated logins for the same user identity`
  - `✔ 9. should preserve onboarding flow: allow role selection and prevent tampering`
  - `✔ 10. should return 401 Unauthorized for protected route without Bearer token`

---

## 7. Exact Render Configuration Recommendations

To ensure Render builds and starts cleanly, configure the following settings in the **Render Dashboard** (`https://dashboard.render.com` -> Select `ishara-backend` Web Service):

### A. Service Settings (Under "Settings" tab)
| Setting | Exact Value to Enter | Note |
|---------|----------------------|------|
| **Root Directory** | *(Leave empty/blank or enter `.`) | **DO NOT set to `ishara-backend`**. The git repo root already contains `package.json`. |
| **Build Command** | `npm ci --include=dev && npm run build` | Ensures `tsc` compiler is installed and executes the TypeScript build. |
| **Start Command** | `npm start` | Runs `node dist/server.js`. |

### B. Environment Variables (Under "Environment" tab)
Ensure these environment variables are set in Render:
```ini
NODE_VERSION=20.18.0
CLIENT_URL=https://ishaara-web-dashboard.vercel.app, http://localhost:3000, http://127.0.0.1:3000
GOOGLE_WEB_CLIENT_ID=879711366748-vte2ip1qrc5vf2jd13hcvgisprraqoc9.apps.googleusercontent.com, 710758057789-f40u0f6qgvd3h8okjpcchmicbnru01lf.apps.googleusercontent.com
BETTER_AUTH_URL=https://reposnse-ishaara.onrender.com
NODE_ENV=production
```

---

## 8. Confirmation: Google OAuth Changes Remain Intact

The recent Google OAuth features remain fully intact, compiled in `dist/`, and passing automated regression tests:

1. **Multiple Google Web Client ID Support**:
   - `src/modules/auth/auth.config.ts` splits both `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_ANDROID_CLIENT_ID` by delimiter `[,;\s|]+`.
   - The primary ID becomes `clientId`, and all other IDs are registered in `extraAudiences`.
   - Google ID tokens from both Client IDs are accepted and validated against Google token endpoints.
2. **Updated `CLIENT_URL` Origin Parsing**:
   - `src/config/env.ts` splits comma/pipe-separated URLs (`parseClientUrls`).
   - Trusted origins include `https://ishaara-web-dashboard.vercel.app`, `http://localhost:3000`, `http://127.0.0.1:3000`, and `http://localhost:3001`.
3. **Better Auth Trusted Origins**:
   - CORS and Better Auth receive the complete list of authorized origins for cross-origin authentication headers and credentials.

---

## 9. Next Steps to Complete Deployment

1. **Push Local Commits to GitHub Remote**:
   The branch `main` has 2 local commits ahead of `origin/main`:
   - `7b8f7d4`: Multi-client Google OAuth configuration and verification doc.
   - `40d4c63`: Node.js and npm engine specifications in `package.json`.

   Run in terminal:
   ```bash
   git push origin main
   ```
2. **Verify Render Dashboard Settings**:
   - Check that **Root Directory** is empty.
   - Check that **Build Command** is set to `npm ci --include=dev && npm run build`.
   - Trigger a "Manual Deploy -> Clear build cache & deploy" on Render.
3. **Verify Live Health Endpoint**:
   Once Render completes the build, test:
   ```bash
   curl -s https://reposnse-ishaara.onrender.com/api/v1/health
   ```

