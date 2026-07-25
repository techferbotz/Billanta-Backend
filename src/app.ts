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
import legalRoutes from "./modules/legal/legal.routes";

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

// --- Feature routes ---------------------------------------------------------------
app.use("/auth", authRoutes); // public: sign in, rotate, log out
app.use("/users", userRoutes); // requires an access token
app.use("/company", companyRoutes); // seller profile (auth)
app.use("/settings", settingsRoutes); // invoice defaults (auth)
app.use("/customers", customerRoutes); // customer CRUD + search (auth)
app.use("/media", mediaRoutes); // image uploads -> S3 (auth)
app.use("/invoices", invoiceRoutes); // invoice CRUD + sync (auth)
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
