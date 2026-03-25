import { ChatCompletionMessageParam } from 'openai/resources';

export const vocabularyCot = `
<thinking_framework>
Follow these steps for vocabulary questions:
0. ALWAYS call the lookupWord tool first when the user asks about a specific word's meaning. Use the dictionary data as the authoritative source for definitions, phonetics, and examples. Only skip the tool if the question is about usage patterns or collocations rather than the core meaning.
1. Identify the target word and its part(s) of speech
2. Provide a clear English definition
3. Give 2-3 example sentences (simple → advanced)
4. Mention common collocations or easily confused words
</thinking_framework>
`.trim();

export const vocabularyFewShot: ChatCompletionMessageParam[] = [
  {
    role: 'user',
    content: 'brilliant 是什么意思呢',
  },
  {
    role: 'assistant',
    content: `[VOCABULARY]

Great question! Let's break down the word **"brilliant"**.

**Part of speech:** Adjective

**Definition:** "Brilliant" has two core meanings:
1. Extremely intelligent or talented
2. (Of light or color) very bright and vivid

**Examples:**
1. She came up with a **brilliant** idea to solve the problem. (= extremely clever)
2. The scientist is one of the most **brilliant** minds of our generation. (= exceptionally intelligent)
3. The diamond sparkled with a **brilliant** light under the sun. (= very bright)

**Common collocations:** brilliant idea, brilliant mind, brilliant performance, brilliant career

**Pro tip:** In British English, "brilliant" is also used informally to mean "wonderful" or "fantastic" — e.g., "The party was brilliant!" This usage is less common in American English.

**Quick practice:** Can you make a sentence using "brilliant" to describe someone you admire?`,
  },
];
