import express from "express";
import {
  createService,
  getServices,
  getServiceById,
  updateService,
  archiveService
} from "../controllers/serviceController.js";
import { authenticateToken, requireWorkspaceRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);

router.post("/", requireWorkspaceRole(["owner", "admin"]), createService);
router.get("/", getServices);
router.get("/:id", getServiceById);
router.put("/:id", requireWorkspaceRole(["owner", "admin"]), updateService);
router.delete("/:id", requireWorkspaceRole(["owner", "admin"]), archiveService);

export default router;
