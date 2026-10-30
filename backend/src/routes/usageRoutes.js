import express from "express";
import {
  ingestUsage,
  getUsageHistory,
  getUsageSummary,
  getUsageById
} from "../controllers/usageController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);

router.post("/", ingestUsage);
router.get("/summary", getUsageSummary);
router.get("/", getUsageHistory);
router.get("/:id", getUsageById);

export default router;
