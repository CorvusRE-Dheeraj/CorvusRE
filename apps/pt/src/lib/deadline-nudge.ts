import { invokeEdgeFunction } from "./edge-functions";

export type DeadlineNudgeInput = {
  address: string;
  daysLeft: number;
  totalValue?: number;
};

export async function getDeadlineNudge(input: DeadlineNudgeInput): Promise<{ message: string }> {
  return invokeEdgeFunction<{ message: string }>("deadline-nudge", input);
}
