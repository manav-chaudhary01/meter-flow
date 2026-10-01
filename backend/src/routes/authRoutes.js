import express from "express";
import { register, login } from "../controllers/authController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);

router.get("/me", authenticateToken, (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      userId: req.user.userId,
      tenantId: req.user.tenantId
    }
  });
});

export default router;