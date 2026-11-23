import express from "express";
import {
  generateBill,
  listBillingRecords,
  getBillingRecordById,
  getBillingUsage,
  finalizeInvoice,
  voidInvoice
} from "../controllers/billingController.js";
import { authenticateToken, requireWorkspaceRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);

router.post("/generate", requireWorkspaceRole(["owner", "admin"]), generateBill);
router.patch("/:id/finalize", requireWorkspaceRole(["owner", "admin"]), finalizeInvoice);
router.patch("/:id/void", requireWorkspaceRole(["owner", "admin"]), voidInvoice);
router.get("/", listBillingRecords);
router.get("/:id", getBillingRecordById);
router.get("/:id/usage", getBillingUsage);

export default router;
