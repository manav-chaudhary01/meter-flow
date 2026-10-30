import express from "express";
import {
  listWorkspaces,
  createWorkspace,
  switchWorkspace,
  getWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember
} from "../controllers/workspaceController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);

router.get("/", listWorkspaces);
router.post("/", createWorkspace);
router.post("/switch", switchWorkspace);
router.get("/:id/members", getWorkspaceMembers);
router.post("/:id/members", addWorkspaceMember);
router.delete("/:id/members/:memberUserId", removeWorkspaceMember);

export default router;
