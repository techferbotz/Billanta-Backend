import { Router } from "express";
import { optionalAuth } from "../../common/middleware/auth.middleware";
import { asyncHandler } from "../../common/utils/asyncHandler";
import { getConfig } from "./controller/remoteConfig.controller";

// EVERYTHING about the caller is optional here — the config must be fetchable by any build in
// any state: a first launch that has never signed in (login is optional in Billanta), a build
// whose access token expired weeks ago, an old build that sends no headers at all.
//  - optionalAuth sets req.userId when a valid token is supplied, and continues anonymously
//    otherwise (it never rejects, so a stale token can't lock a device out of its switches).
//  - X-Device-Id and the X-App-* headers are read straight off the request in
//    remoteConfig.context.ts; Billanta has no device middleware because it has no device
//    concept — that header is an experiment-bucketing key and nothing more.
// All of them are still worth sending: they are the targeting inputs for future rules. A
// caller that sends none simply gets the default config.
const router = Router();

router.use(optionalAuth);

router.get("/", asyncHandler(getConfig));

export default router;
