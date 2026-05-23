import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { db, policiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreatePolicyBody,
  GetPolicyParams,
  UpdatePolicyParams,
  UpdatePolicyBody,
  DeletePolicyParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/policies", async (_req, res) => {
  try {
    const rows = await db.select().from(policiesTable).orderBy(policiesTable.createdAt);
    res.json({ policies: rows });
  } catch (err) {
    _req.log.error({ err }, "Failed to list policies");
    res.status(500).json({ error: "internal", message: "Failed to list policies" });
  }
});

router.post("/policies", async (req, res) => {
  const parsed = CreatePolicyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", message: "Invalid policy body" });
    return;
  }

  const now = new Date();
  const policy = {
    id: randomUUID(),
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    workflowPattern: parsed.data.workflowPattern,
    rules: parsed.data.rules,
    failMode: parsed.data.failMode,
    active: parsed.data.active ?? true,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(policiesTable).values(policy);
    res.status(201).json(policy);
  } catch (err) {
    req.log.error({ err }, "Failed to create policy");
    res.status(500).json({ error: "internal", message: "Failed to create policy" });
  }
});

router.get("/policies/:id", async (req, res) => {
  const parsed = GetPolicyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", message: "Invalid policy ID" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(policiesTable)
      .where(eq(policiesTable.id, parsed.data.id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "not_found", message: "Policy not found" });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to get policy");
    res.status(500).json({ error: "internal", message: "Failed to get policy" });
  }
});

router.put("/policies/:id", async (req, res) => {
  const paramsParsed = UpdatePolicyParams.safeParse(req.params);
  const bodyParsed = UpdatePolicyBody.safeParse(req.body);

  if (!paramsParsed.success || !bodyParsed.success) {
    res.status(400).json({ error: "validation", message: "Invalid request" });
    return;
  }

  const updates = {
    ...bodyParsed.data,
    updatedAt: new Date(),
  };

  try {
    const rows = await db
      .update(policiesTable)
      .set(updates)
      .where(eq(policiesTable.id, paramsParsed.data.id))
      .returning();

    if (rows.length === 0) {
      res.status(404).json({ error: "not_found", message: "Policy not found" });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to update policy");
    res.status(500).json({ error: "internal", message: "Failed to update policy" });
  }
});

router.delete("/policies/:id", async (req, res) => {
  const parsed = DeletePolicyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", message: "Invalid policy ID" });
    return;
  }

  try {
    await db.delete(policiesTable).where(eq(policiesTable.id, parsed.data.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete policy");
    res.status(500).json({ error: "internal", message: "Failed to delete policy" });
  }
});

export default router;
