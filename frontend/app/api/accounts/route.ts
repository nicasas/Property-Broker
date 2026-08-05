import type { NextRequest } from "next/server";
import { forwardCreate } from "@/lib/forward";

export async function POST(request: NextRequest) {
  return forwardCreate(request, "/accounts");
}
