import { invokeEdgeFunction } from "./edge-functions";

export type HearingNudgeInput = {
  address: string;
  daysLeft: number;
};

export async function getHearingNudge(input: HearingNudgeInput): Promise<{ message: string }> {
  return invokeEdgeFunction<{ message: string }>("deadline-nudge?action=hearing-nudge", input);
}
