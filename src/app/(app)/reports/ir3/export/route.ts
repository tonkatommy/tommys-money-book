// GET /reports/ir3/export?fy=2027 — the IR3 pack as a downloadable .xlsx.
//
// A read, but a read of the same financial data every Server Action in this
// app guards, so it re-checks `hasSession()` itself rather than relying
// solely on `src/proxy.ts`'s matcher — the same reasoning invariant 6 states
// for actions: a route is reachable directly, not only through a link
// someone clicked.

import { hasSession } from "@/lib/auth/guard";
import { buildIr3Workbook } from "@/lib/reports/export";
import { parseFY } from "@/lib/reports/fy";
import { getIr3Pack } from "@/lib/reports/query";

export async function GET(request: Request) {
  if (!(await hasSession())) {
    return new Response("Unauthorised", { status: 401 });
  }

  const url = new URL(request.url);
  const now = new Date();
  const fy = parseFY(url.searchParams.get("fy") ?? undefined, now);

  const pack = await getIr3Pack(fy, now);
  const workbook = buildIr3Workbook(pack);
  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ir3-pack-${fy.label}.xlsx"`,
    },
  });
}
