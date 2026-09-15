import { invokeEdgeFunction } from "./edge-functions";

export type RouteIntentResult = { destination: string; message: string };

export async function askRouter(query: string): Promise<RouteIntentResult> {
  return invokeEdgeFunction<RouteIntentResult>("route-intent", { query });
}
