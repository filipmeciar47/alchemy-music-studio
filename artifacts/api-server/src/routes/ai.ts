import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

router.post("/ai/chat", async (req, res) => {
  try {
    const { messages, systemPrompt, context, mode } = req.body as {
      messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
      systemPrompt: string;
      context?: string;
      mode?: string;
    };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "messages array required" });
      return;
    }

    const fullSystem = context ? `${systemPrompt}\n${context}` : systemPrompt;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const validMessages = messages.slice(-14).map((m) => ({
      role: (m.role === "system" ? "user" : m.role) as "user" | "assistant",
      content: String(m.content),
    }));

    let fullResponse = "";

    const stream = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 1200,
      messages: [
        { role: "system", content: fullSystem },
        ...validMessages,
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    let parsed: { message?: string; commands?: unknown[] } = {};
    try {
      const raw = fullResponse.trim();
      const jsonMatch = raw.match(/```json?\s*([\s\S]*?)\s*```/) ?? null;
      const jsonStr = jsonMatch ? jsonMatch[1] : raw;
      const fi = jsonStr.indexOf("{");
      const li = jsonStr.lastIndexOf("}");
      if (fi >= 0 && li > fi) {
        parsed = JSON.parse(jsonStr.slice(fi, li + 1)) as typeof parsed;
      }
    } catch {
      parsed = { message: fullResponse.slice(0, 300) };
    }

    res.write(`data: ${JSON.stringify({ done: true, parsed })}\n\n`);
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
});

export default router;
