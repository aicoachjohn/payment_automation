import { Role } from "@prisma/client";
import { requireRoles } from "@/server/auth/guard";
import { IntakeClient } from "./intake-client";

export default async function EnrollmentIntakePage() {
  await requireRoles([Role.SALESPERSON, Role.SALES_MANAGER]); // defense-in-depth (middleware also gates /leads)
  return <IntakeClient />;
}
