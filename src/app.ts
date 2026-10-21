import express from "express";
import cors from "cors";
import { config } from "./config/env";
import { requestLogger } from "./common/middleware/requestLogger";
import { errorHandler } from "./common/errors/errorHandler";
import authRoutes from "./modules/auth/auth.routes";
import userRoutes from "./modules/user/user.routes";
import companyRoutes from "./modules/company/company.routes";
import settingsRoutes from "./modules/settings/settings.routes";
import customerRoutes from "./modules/customer/customer.routes";
import mediaRoutes from "./modules/media/media.routes";
import templateRoutes from "./modules/template/template.routes";
import adminRoutes from "./modules/admin/admin.routes";
import invoiceRoutes from "./modules/invoice/invoice.routes";
import productRoutes from "./modules/product/product.routes";
import legalRoutes from "./modules/legal/legal.routes";
import remoteConfigRoutes from "./modules/remoteConfig/remoteConfig.routes";
import formsRoutes from "./modules/forms/forms.routes";

const app = express();

// --- Global middleware ------------------------------------------------------------
app.use(requestLogger); // registered first so it times everything below it
app.use(cors());
app.use(express.json({ limit: "2mb" })); // template sources and sync batches are chunky

// --- Health check -----------------------------------------------------------------
// Plain text, no envelope, no auth. Used by nginx / uptime checks.
app.get("/", (_req, res) => {
  res.send("Billanta Backend Running");
});

// --- Public legal pages -----------------------------------------------------------
// privacy / terms / delete-account (+ aliases). No auth — Google Play's crawler and the app's
// own links must reach them. Mounted before the authenticated feature routes.
app.use(legalRoutes);

// --- Remote config ----------------------------------------------------------------
// GET /config — the app's behaviour switches (feature kill switches, update policy, limits,
// legal links), read on every cold start. Deliberately mounted up here with the other public
// routes: nothing about the caller is required, so a first launch that has never signed in
// still gets a document. Its router applies optionalAuth, so a token is USED when present —
// it is a targeting input for future rules. Never touches the database.
// See docs/REMOTE_CONFIG.md and HOA protocol 10.
app.use("/config", remoteConfigRoutes);

// --- Forms ------------------------------------------------------------------------
// GET /forms — the global business profile / customer / product / settings forms the app builds
// its screens from (docs/FIELDS.md §5). Public and static, like /config.
app.use("/forms", formsRoutes);

// --- Feature routes ---------------------------------------------------------------
app.use("/auth", authRoutes); // public: sign in, rotate, log out
app.use("/users", userRoutes); // requires an access token
app.use("/company", companyRoutes); // seller profile (auth)
app.use("/settings", settingsRoutes); // invoice defaults (auth)
app.use("/customers", customerRoutes); // customer CRUD + search (auth)
app.use("/media", mediaRoutes); // image uploads -> S3 (auth)
app.use("/invoices", invoiceRoutes); // invoice CRUD + sync (auth)
app.use("/products", productRoutes); // reusable line-item catalogue (auth)
app.use("/templates", templateRoutes); // public template browse + compiled download (optionalAuth)
// Admin authoring API + panel. Authenticates with ADMIN_API_KEY (not a user JWT); GET /admin
// and POST /admin/login are public and registered before the key check inside the router.
app.use("/admin", adminRoutes);
// (Phase 6 mounts the public legal pages here.)

// --- Unknown route -> the standard 404 envelope, so responses stay consistent -------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// --- Centralized error handling — MUST be registered after all routes --------------
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Billanta Backend listening on port ${config.port}`);
});
