import { openai, createOpenAI } from "@ai-sdk/openai";

const openAIProvider = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const $ai = {
    models: {
        thinking: openAIProvider("gpt-5"),
        base: openAIProvider("gpt-5-mini"),
        quick: openAIProvider("gpt-5-nano"),
    },
};
