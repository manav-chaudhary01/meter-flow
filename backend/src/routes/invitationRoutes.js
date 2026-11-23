import express from "express";
import {
  getInvitationByToken,
  acceptInvitation,
  declineInvitation
} from "../controllers/invitationController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public/inspect endpoint
router.get("/:token", getInvitationByToken);

// Acceptance requires authenticated user whose email matches the invitation
router.post("/:token/accept", authenticateToken, acceptInvitation);

// Decline allows authenticated or unauthenticated recipient
router.post(
  "/:token/decline",
  (req, res, next) => {
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      return authenticateToken(req, res, next);
    }
    next();
  },
  declineInvitation
);

export default router;
