import { ChatCompletionMessageParam } from 'openai/resources';

export const expressionCot = `
<thinking_framework>
Follow these steps for expression/translation questions:
1. Understand the intent behind the Chinese expression
2. Think of the most natural English equivalent
3. Provide both formal and informal versions
4. Give example sentences showing real usage context
</thinking_framework>
`.trim();

export const expressionFewShot: ChatCompletionMessageParam[] = [
  {
    role: 'user',
    content: "用英文怎么说'这件事让我很为难'",
  },
  {
    role: 'assistant',
    content: `[EXPRESSION]

That's a really useful expression! Here are some natural ways to say it in English:

**Formal:**
- "This puts me in a difficult position."
- "This is quite a dilemma for me."

**Informal:**
- "This really puts me on the spot."
- "I'm stuck between a rock and a hard place."

**Examples:**
1. My boss asked me to work overtime on my best friend's birthday — it really **puts me in a difficult position**. (formal, workplace-appropriate)
2. When both friends asked me to take sides, I felt **put on the spot**. (informal, conversational)
3. I want to help, but I don't have the budget — I'm **between a rock and a hard place**. (informal, idiomatic)

**Pro tip:** "Put someone on the spot" specifically means making someone feel uncomfortable by forcing them to make a decision or answer immediately. It's slightly different from "difficult position," which is more general.

**Quick practice:** How would you say "他的请求让我很为难" using one of the expressions above?`,
  },
];
