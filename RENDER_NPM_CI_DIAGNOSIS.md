# ISHAARA — Render npm ci Failure Diagnosis & Verification Report

**Date**: November 11, 2026  
**Status**: Diagnosed, Resolved, and Verified on Live Production Render  
**Service**: `ishara-backend` (`https://reposnse-ishaara.onrender.com`)  
**Repository**: `https://github.com/Veda361/reposnse-ishaara.git`  

---

## 1. Executive Summary

Render builds were failing during the npm installation stage with the following output:
```text
npm error Run "npm help ci" for more info
==> Build failed
```

A forensic investigation of the dependency graph, Git commit history, and runtime environments uncovered the exact reason why `npm ci` succeeded on local development machines but consistently failed on Render's build infrastructure.

The issue has been completely resolved. The fix was pushed in commits `3f99ce4` and `cf47341`, and Render successfully completed the build and deployment. The production service is live and returning `HTTP/2 200` healthy status.

---

## 2. Forensic Investigation & Root Cause

### A. Lockfile Discrepancy Forensic
In commit `765b0c9621391fd87384702f273e4c2b1d125e86` (*"add origin 3001"*), 73 lines were pruned from `package-lock.json`. Among the removed entries:
- `node_modules/@opentelemetry/api`
- `node_modules/mongoose/node_modules/gcp-metadata`

These packages are mandatory sub-dependencies:
- `firebase-admin@14.4.0` -> `@google-cloud/firestore` -> `@opentelemetry/api: "^1.9.0"`
- `firebase-admin@14.4.0` -> `google-gax` -> `@opentelemetry/api: "^1.9.0"`
- `mongoose@8.10.1` -> `mongodb` -> `gcp-metadata: "5.3.0"`

### B. The npm 11 vs npm 10 Discrepancy
- **Local Host**: Ran Node `v24.13.0` with **npm 11.6.2**. npm 11 includes updated Arborist heuristics that did not enforce strict presence for certain optional/peer sub-dependency entries in `package-lock.json`.
- **Render Native Container**: Defaults to Node 20 LTS with **npm 10** (`npm 10.8.2`). In npm 10, `npm ci`'s `validateLockfile()` performs an invariant check comparing the virtual dependency tree from `package-lock.json` against the ideal tree calculated from `package.json`.

When `@opentelemetry/api` and `gcp-metadata` were missing from `package-lock.json`, npm 10 halted with `code EUSAGE`:
```text
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: @opentelemetry/api@1.10.0 from lock file
npm error Missing: gcp-metadata@5.3.0 from lock file
npm error Run "npm help ci" for more info
==> Build failed
```

Render’s web build log interface collapsed the stack and displayed the final error lines:
```text
npm error Run "npm help ci" for more info
==> Build failed
```

---

## 3. Local Reproduction Evidence

We reproduced the failure under isolated clean conditions using Render's exact runtime (`node v20.20.2`, `npm 10.8.2`):

```bash
cd /tmp/clean-test
/home/dev/.nvm/versions/node/v20.20.2/bin/npm ci --include=dev
```
- **Result on unpatched lockfile**:
  ```text
  npm error code EUSAGE
  npm error Missing: @opentelemetry/api@1.10.0 from lock file
  npm error Missing: gcp-metadata@5.3.0 from lock file
  npm error Run "npm help ci" for more info
  ```
  *(Confirmed 100% reproduction of the Render failure).*

---

## 4. Corrective Changes Applied

1. **Lockfile Synchronization (`package-lock.json`)**:
   - Executed `npm install --package-lock-only` under npm 10.
   - Restored `node_modules/@opentelemetry/api` (`1.10.0`) and `node_modules/mongoose/node_modules/gcp-metadata` (`5.3.0`).
   - Retained strict `lockfileVersion: 3`. No packages were upgraded or removed.
2. **Deterministic Runtime Pinning**:
   - Added `.node-version` containing `20.18.0`.
   - Added `.nvmrc` containing `20.18.0`.
   - In `package.json`, configured `"engines": { "node": ">=20.0.0", "npm": ">=9.0.0" }`.

---

## 5. Live Production Verification on Render

Following the push of commit `cf47341` to `origin/main`, Render automatically triggered a build and deployment:

```bash
curl -is https://reposnse-ishaara.onrender.com/api/v1/health
```

**Live Response**:
```http
HTTP/2 200 
date: Wed, 11 Nov 2026 05:30:11 GMT
content-type: application/json; charset=utf-8
server: cloudflare
x-render-origin-server: Render

{"success":true,"data":{"status":"healthy","database":"connected","environment":"production","timestamp":"2026-11-11T05:30:11.348Z","uptime":54}}
```

- **Render Build Status**: Passed (Clean install and TypeScript compilation succeeded).
- **Service Status**: Healthy. Database connected.
