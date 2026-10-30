import express from "express";
import {
  createBudget,
  listBudgets,
  getBudgetById,
  updateBudget,
  deleteBudget,
  evaluateBudget,
  listAlerts,
  acknowledgeAlert
} from "../controllers/budgetController.js";
import { authenticateToken, requireWorkspaceRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);

// Budget CRUD & evaluation
router.post("/", requireWorkspaceRole(["owner", "admin"]), createBudget);
router.get("/", listBudgets);
router.get("/alerts", listAlerts);
router.patch("/alerts/:alertId/ack", acknowledgeAlert);
router.get("/:id", getBudgetById);
router.put("/:id", requireWorkspaceRole(["owner", "admin"]), updateBudget);
router.delete("/:id", requireWorkspaceRole(["owner", "admin"]), deleteBudget);
router.post("/:id/evaluate", requireWorkspaceRole(["owner", "admin"]), evaluateBudget);

export default router;
