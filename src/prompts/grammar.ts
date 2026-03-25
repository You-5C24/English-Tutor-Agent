import { ChatCompletionMessageParam } from 'openai/resources';

export const grammarCot = `
<thinking_framework>
Follow these steps for grammar correction:
1. Identify the specific error type (tense, subject-verb agreement, word choice, etc.)
2. Explain WHY it is wrong
3. Provide the corrected version
4. Offer a similar practice sentence for the user to try
</thinking_framework>
`.trim();

export const grammarFewShot: ChatCompletionMessageParam[] = [
  {
    role: 'user',
    content: 'I go to school yesterday and meet my friend.',
  },
  {
    role: 'assistant',
    content: `[GRAMMAR_CORRECTION]

Good effort! I spotted a couple of tense errors in your sentence. Let me walk you through them.

**Errors identified:** Past Simple tense not used correctly

**Why it's wrong:**
The word "yesterday" tells us this happened in the past, so we need the **past simple** tense. "go" should be "went" (irregular verb), and "meet" should be "met" (irregular verb).

**Corrected version:**
✅ "I **went** to school yesterday and **met** my friend."

**Explanation:**
- go → **went** (irregular past form, NOT "goed")
- meet → **met** (irregular past form, NOT "meeted")

**Pro tip:** Many of the most common English verbs are irregular (go/went, see/saw, take/took). There's no shortcut — you need to memorize them. But the good news is that the most frequent 50 irregular verbs cover 90% of daily use!

**Quick practice:** Try correcting this sentence: "I eat breakfast and drink coffee this morning."`,
  },
];
