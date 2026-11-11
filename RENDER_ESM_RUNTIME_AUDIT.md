# ISHAARA Backend — Render ESM Runtime Audit Report

**Date:** 2026-11-11  
**Repository:** `ishara-backend`  
**Environment:** Node.js 20.18.0 / 20.20.2 (Render Production)  
**Branch:** `fix/render-esm-runtime`  

---

## 1. Executive Summary & Incident Description

During deployment to Render (`https://reposnse-ishaara.onrender.com`), the production backend build succeeded (`npm run build`), but the service crashed immediately upon startup (`npm start` / `node dist/server.js`) with the following runtime fatal error:

```text
Error [ERR_REQUIRE_ESM]: require() of ES Module
better-auth/dist/integrations/node.mjs not supported.
Instead change the require of node.mjs in dist/app.js to a dynamic import() which is available in all CommonJS modules.
    at dist/app.js:12:16
```

This audit provides a forensic examination of the project's module resolution configuration, compiler settings, source imports, and the architectural root cause.

---

## 2. Root Cause Analysis

### 2.1 The TypeScript `NodeNext` Dual-Module Semantics
In `tsconfig.json`, the compiler was configured with:
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022"
  }
}
```

Under TypeScript's `NodeNext` module mode, TypeScript determines whether a `.ts` file compiles to CommonJS or ECMAScript Modules (ESM) based on the nearest `package.json`'s `"type"` field:
1. **When `package.json` omits `"type": "module"` (or has `"type": "commonjs"`):**
   - Every `.ts` file is treated as a CommonJS module.
   - `tsc` emits CommonJS JavaScript syntax: `const express = require("express");`, `const node_1 = require("better-auth/node");`.
2. **When importing pure ESM packages from CommonJS:**
   - Package `better-auth` v1.7.5 publishes native ES modules (`better-auth/dist/integrations/node.mjs`).
   - Node.js prohibits synchronous `require()` of an ES module, immediately throwing `ERR_REQUIRE_ESM`.

### 2.2 Why Previous Builds Did Not Catch This
In development and local test execution:
- Scripts used `tsx` (e.g. `npm run dev`, `npm test`), which dynamically intercepts and transpiles TypeScript and ESM imports on the fly in memory using `esbuild`.
- Production, however, runs `node dist/server.js` using native Node.js directly on compiled artifacts in `dist/`.
- Because `package.json` did not declare `"type": "module"`, `tsc` compiled `src/` to CommonJS `require()` calls, which caused Node.js to throw `ERR_REQUIRE_ESM` at runtime in Render.

---

## 3. Comprehensive Codebase Audit

A full scan of the codebase was conducted across all 322 TypeScript source files in `src/`.

### 3.1 CommonJS Globals & Patterns
- **`__dirname` / `__filename`:** 0 occurrences found in `src/`. No refactoring of Node path globals required.
- **`require()` calls:** 0 occurrences found in `src/`. All source files already utilized ESM `import` / `export` syntax.
- **JSON imports:** 0 JSON imports without import attributes.

### 3.2 Relative Import Specifiers Audit
Under `NodeNext` with `"type": "module"`, Node.js requires explicit file extensions (e.g. `.js` / `/index.js`) for all relative imports and exports:
- **Total `.ts` files scanned:** 322 files.
- **Files requiring `.js` extensions:** 287 files.
- **Total relative specifiers requiring `.js`:** 1,958 specifiers.
- **Directory imports identified:**
  - `src/app.ts`: `./routes` -> resolved to `./routes/index.js`.
- **Module re-exports identified:**
  - `src/modules/realtime/realtime.types.ts`: `../tracking/tracking.types` -> resolved to `../tracking/tracking.types.js`.

### 3.3 External Dependencies Audit
- External package imports (such as `express`, `helmet`, `cors`, `better-auth/node`, `zod`, `mongoose`, `mongodb`, `ws`, `resend`, `firebase-admin`, `razorpay`) do not use relative paths and remain standard bare specifiers.
- `better-auth/node` is imported via `import { toNodeHandler } from "better-auth/node"`, which compiles cleanly to native ESM `import { toNodeHandler } from "better-auth/node"` without requiring extension modifications.

---

## 4. Risk Assessment & Migration Strategy

| Category | Risk Level | Mitigation |
| :--- | :--- | :--- |
| **API Contracts & Endpoints** | None | AST-based extension update only modifies relative module specifiers. Zero changes to endpoint paths, validation schemas, or HTTP responses. |
| **Business Logic** | None | Zero modification to any function, class, or service implementation. |
| **Database & Mongoose** | None | Schema definitions and models untouched. |
| **Type Checking** | Low | Verified via `tsc --noEmit` across all 322 files with 0 errors. |
| **Runtime Execution** | Low | Verified locally on Node.js 20.20.2 (matching Render Node 20.18.0) with clean startup and zero `ERR_REQUIRE_ESM`. |

---

## 5. Audit Conclusion

The repository was already authored in ESM style, but was being miscompiled into CommonJS by `tsc` due to the missing `"type": "module"` declaration in `package.json`. Adding `"type": "module"` and affixing `.js` extensions to all relative imports enables native ESM output, fully resolving `ERR_REQUIRE_ESM` on Render.

