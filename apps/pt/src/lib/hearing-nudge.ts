import { invokeEdgeFunction } from "./edge-functions";

export type HearingNudgeInput = {
  address: string;
  daysLeft: number;
};

export async function getHearingNudge(input: HearingNudgeInput): Promise<{ message: string }> {
  return invokeEdgeFunction<{ message: string }>("hearing-nudge", input);
}
