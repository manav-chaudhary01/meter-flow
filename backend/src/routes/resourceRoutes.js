import express from "express";
import {
  createResource,
  getResources
} from "../controllers/resourceController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);

router.post("/", createResource);
router.get("/", getResources);

export default router;