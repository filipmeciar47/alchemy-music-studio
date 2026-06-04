import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import decomposeRouter from "./decompose";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(decomposeRouter);

export default router;
