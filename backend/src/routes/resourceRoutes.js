import express from "express";
import {
  createResource,
  getResources,
  getResourceById
} from "../controllers/resourceController.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authenticateToken);

router.post("/", createResource);
router.get("/", getResources);
router.get("/:id", getResourceById);

export default router;