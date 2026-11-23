import express from "express";
import {
  listWorkspaces,
  createWorkspace,
  switchWorkspace,
  renameWorkspace,
  getWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
  modifyWorkspaceMemberRole,
  modifyWorkspaceMemberStatus,
  leaveWorkspace,
  archiveWorkspace,
  transferOwnership
} from "../controllers/workspaceController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);

router.get("/", listWorkspaces);
router.post("/", createWorkspace);
router.post("/switch", switchWorkspace);
router.patch("/:id", renameWorkspace);
router.patch("/:id/archive", archiveWorkspace);
router.post("/:id/leave", leaveWorkspace);
router.post("/:id/transfer-ownership", transferOwnership);
router.get("/:id/members", getWorkspaceMembers);
router.post("/:id/members", addWorkspaceMember);
router.patch("/:id/members/:memberUserId/role", modifyWorkspaceMemberRole);
router.patch("/:id/members/:memberUserId/status", modifyWorkspaceMemberStatus);
router.delete("/:id/members/:memberUserId", removeWorkspaceMember);

export default router;
