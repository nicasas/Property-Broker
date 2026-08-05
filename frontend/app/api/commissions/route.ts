import type { NextRequest } from "next/server";
import { forwardMutation } from "@/lib/forward";

export async function POST(request: NextRequest) {
  return forwardMutation(request, "/commissions");
}
