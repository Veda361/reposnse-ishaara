# ISHAARA — Second-Level Render npm ci Failure Investigation & Resolution Report

**Date**: November 11, 2026  
**Status**: Root Cause Identified, Locally Reproduced, and Resolved  
**Service**: `ishara-backend` (`https://reposnse-ishaara.onrender.com`)  
**Deployment Target**: Render Web Service  

---

## 1. Exact Root Cause

The exact failure on Render during `npm ci --include=dev` was:
```text
npm error code EUSAGE
npm error
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error
npm error Missing: @opentelemetry/api@1.10.0 from lock file
npm error Missing: gcp-metadata@5.3.0 from lock file
...
npm error Run "npm help ci" for more info
==> Build failed
```

### Why this occurred on Render but passed locally on developer machine:
1. **Accidental Lockfile Deletion in Commit `765b0c9`**:
   In commit `765b0c9621391fd87384702f273e4c2b1d125e86` (*"add origin 3001"*), 73 lines were pruned from `package-lock.json`. Among them:
   - `node_modules/@opentelemetry/api` (required by `@google-cloud/firestore` and `google-gax`, dependencies of `firebase-admin`).
   - `node_modules/mongoose/node_modules/gcp-metadata` (required by `mongoose`/`mongodb`).
2. **npm Version Behavioral Discrepancy (npm 11 vs npm 10)**:
   - **Local Developer Environment**: Runs Node `v24.13.0` with **npm 11.6.2**. npm 11's Arborist engine has updated virtual-inventory resolution rules for optional/peer sub-dependencies and did not throw a validation error.
   - **Render Build Container**: Runs Node 20 LTS with **npm 10** (`npm 10.8.2`). npm 10's `validateLockfile()` strictly compares the virtual tree against the ideal tree. When `@opentelemetry/api` and `gcp-metadata` are absent from `package-lock.json`, npm 10 immediately halts with `code: EUSAGE` and outputs:
     ```text
     npm error Run "npm help ci" for more info
     ==> Build failed
     ```

---

## 2. Evidence Supporting the Root Cause

1. **Exact Reproduction in Clean Node 20 / npm 10 Environment**:
   Using `node v20.20.2` and `npm 10.8.2` (Render's exact runtime), running `npm ci --include=dev` on `origin/main` produced the identical failure:
   ```text
   npm error code EUSAGE
   npm error Missing: @opentelemetry/api@1.10.0 from lock file
   npm error Missing: gcp-metadata@5.3.0 from lock file
   npm error Run "npm help ci" for more info
   ```
2. **Git Commit Forensic Evidence**:
   Inspecting `git show 765b0c9 package-lock.json`:
   ```diff
   --- a/package-lock.json
   +++ b/package-lock.json
   @@ -1123,16 +1123,6 @@
   -    "node_modules/@opentelemetry/api": {
   -      "version": "1.9.1",
   ...
   @@ -3932,21 +3906,6 @@
   -    "node_modules/mongoose/node_modules/gcp-metadata": {
   -      "version": "5.3.0",
   ```
3. **Arborist Dependency Graph Verification**:
   - `firebase-admin@14.4.0` -> `@google-cloud/firestore@9.1.0` -> `@opentelemetry/api: "^1.9.0"`
   - `firebase-admin@14.4.0` -> `google-gax@6.4.0` -> `@opentelemetry/api: "^1.9.0"`
   - `mongoose@8.10.1` -> `mongodb` -> `gcp-metadata: "5.3.0"`
   Because these packages were stripped from the lockfile, npm 10 declared the lockfile out of sync.

---

## 3. Exact Failing Command

On Render:
```bash
npm ci --include=dev
```
- **Exit Code**: `1`
- **Error Code**: `EUSAGE`
- **Output**: `npm error Run "npm help ci" for more info` followed by `==> Build failed`.

---

## 4. Node and npm Version Comparison

| Environment | Node Version | npm Version | `npm ci` Status on `origin/main` | `npm ci` Status with Fix |
|-------------|--------------|-------------|----------------------------------|--------------------------|
| **Local Host** | `v24.13.0` | `11.6.2` | Pass (npm 11 permissive) | **Pass** (Exit 0) |
| **Render Container (Node 20)** | `v20.20.2` | `10.8.2` | **FAIL: Missing `@opentelemetry/api`** | **Pass** (Exit 0, 387 packages) |
| **Node 22 Container** | `v22.23.4` | `10.9.9` | **FAIL: Missing `@opentelemetry/api`** | **Pass** (Exit 0, 387 packages) |

---

## 5. Lockfile Consistency Results

- **Before Fix**:
  - `npm ci --dry-run` under npm 10: Failed with `code: EUSAGE` (2 missing lockfile dependencies).
- **After Fix**:
  - Executed `/home/dev/.nvm/versions/node/v20.20.2/bin/npm install --package-lock-only`.
  - Restored `node_modules/@opentelemetry/api` (`1.10.0`) and `node_modules/mongoose/node_modules/gcp-metadata` (`5.3.0`).
  - `npm ci --include=dev` under npm 10: `added 387 packages, and audited 388 packages in 6s` (Exit code: 0).
  - `package-lock.json` remains strictly `lockfileVersion: 3`.

---

## 6. Minimal Corrective Changes

1. **`package-lock.json`**:
   - Restored and synchronized missing `@opentelemetry/api` and `gcp-metadata` entries using npm 10.
   - Preserved all existing 17 dependencies and 10 devDependencies without breaking changes or `--force`.
2. **`package.json`**:
   - Preserved `"engines": { "node": ">=20.0.0", "npm": ">=9.0.0" }`.
3. **`.node-version` & `.nvmrc`**:
   - Created `.node-version` with `20.18.0`.
   - Created `.nvmrc` with `20.18.0`.
   - Explicitly instructs Render's runtime selector to boot Node 20 LTS.

---

## 7. Local Verification Results

All commands were executed using the **Render-matching Node 20 environment** (`node v20.20.2`, `npm 10.8.2`):

```bash
node --version
# v20.20.2

npm --version
# 10.8.2

npm ci --include=dev
# added 387 packages, and audited 388 packages in 8s (Exit code: 0)

npm run build
# > tsc (Exit code: 0)

npm run typecheck
# > tsc --noEmit (Exit code: 0)

NODE_ENV=test npx tsx --test src/modules/auth/__tests__/google.auth.test.ts
# ✔ Google Social Sign-In & ID-Token Audience Verification Tests (10/10 passed, 0 failed, Exit code: 0)
```

---

## 8. Exact Render Configuration Required

In the Render Dashboard (`https://dashboard.render.com` -> `ishara-backend`):

### Service Settings
- **Root Directory**: *(Leave empty / blank)*
- **Build Command**: `npm ci --include=dev && npm run build`
- **Start Command**: `npm start`
- **Branch**: `main`

### Environment Variables
- `NODE_VERSION`: `20.18.0`
- `CLIENT_URL`: `https://ishaara-web-dashboard.vercel.app, http://localhost:3000, http://127.0.0.1:3000`
- `GOOGLE_WEB_CLIENT_ID`: `879711366748-vte2ip1qrc5vf2jd13hcvgisprraqoc9.apps.googleusercontent.com, 710758057789-f40u0f6qgvd3h8okjpcchmicbnru01lf.apps.googleusercontent.com`
- `BETTER_AUTH_URL`: `https://reposnse-ishaara.onrender.com`
- `NODE_ENV`: `production`

---

## 9. Preservation of Google OAuth Features

The Google OAuth multi-client authentication logic remains 100% intact:
- Multi-web client ID splitting on `[,;\s|]+` in `src/modules/auth/auth.config.ts`.
- Multi-origin URL parsing for `CLIENT_URL` in `src/config/env.ts`.
- Verified passing in test suite: 10/10 tests passed against mock token endpoints and Bearer session verification.
