/**
 * Manual follow-up tasks (FR-SAL-66). A salesperson can set a reminder against a lead
 * with a due date and description; due tasks show up in "My Pending Actions" and the
 * daily automation nudges the owner when one falls due.
 */
import "server-only";
import { db } from "@/server/db";
import { requirePermission, requireRecordAccess, type Actor } from "@/server/auth/permissions";

export class FollowUpError extends Error {
  readonly code = "FOLLOW_UP_ERROR";
}

export async function createFollowUp(actor: Actor, input: { leadId: string; dueDate: string; description: string }): Promise<{ id: string }> {
  requirePermission(actor, "lead:update:own");
  const lead = await db.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) throw new FollowUpError("Lead not found.");
  requireRecordAccess(actor, lead);
  if (!input.description.trim()) throw new FollowUpError("A description is required.");
  const due = new Date(input.dueDate);
  if (Number.isNaN(due.getTime())) throw new FollowUpError("Enter a valid due date.");

  const task = await db.followUpTask.create({
    data: { leadId: input.leadId, assignedTo: actor.userId, dueDate: due, description: input.description.trim(), createdBy: actor.userId, status: "OPEN" },
  });
  return { id: task.id };
}

export async function completeFollowUp(actor: Actor, taskId: string): Promise<void> {
  const task = await db.followUpTask.findUnique({ where: { id: taskId } });
  if (!task) throw new FollowUpError("Task not found.");
  if (task.assignedTo !== actor.userId) throw new FollowUpError("This task is not assigned to you.");
  await db.followUpTask.update({ where: { id: taskId }, data: { status: "DONE", completedAt: new Date() } });
}

export interface PendingAction {
  id: string;
  leadId: string;
  learnerName: string;
  description: string;
  dueDate: string;
  overdue: boolean;
}

/** Open follow-up tasks assigned to the actor, soonest first (FR-SAL-66). */
export async function myPendingActions(actor: Actor, now: Date = new Date()): Promise<PendingAction[]> {
  const tasks = await db.followUpTask.findMany({
    where: { assignedTo: actor.userId, status: "OPEN" },
    include: { lead: { select: { fullName: true } } },
    orderBy: { dueDate: "asc" },
    take: 100,
  });
  return tasks.map((t) => ({
    id: t.id,
    leadId: t.leadId,
    learnerName: t.lead.fullName,
    description: t.description,
    dueDate: t.dueDate.toISOString(),
    overdue: t.dueDate.getTime() <= now.getTime(),
  }));
}

/** Follow-ups for one lead (for the lead detail page). */
export async function listFollowUpsForLead(actor: Actor, leadId: string): Promise<PendingAction[]> {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new FollowUpError("Lead not found.");
  requireRecordAccess(actor, lead);
  const tasks = await db.followUpTask.findMany({ where: { leadId }, include: { lead: { select: { fullName: true } } }, orderBy: { dueDate: "asc" } });
  const now = Date.now();
  return tasks.map((t) => ({ id: t.id, leadId: t.leadId, learnerName: t.lead.fullName, description: t.description, dueDate: t.dueDate.toISOString(), overdue: t.status === "OPEN" && t.dueDate.getTime() <= now }));
}
