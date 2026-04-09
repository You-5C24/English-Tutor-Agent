import { classify, type Scenario } from '@/classifier';
import type { TutorStateType } from '@/graph/state';

export async function classifyNode(
  state: TutorStateType
): Promise<{ scenario: Scenario }> {
  const scenario = await classify(state.userMessage);
  console.log(`  [Router] Detected scenario: ${scenario}`);
  return { scenario };
}
