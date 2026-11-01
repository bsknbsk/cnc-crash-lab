// lib/meta.ts
// Server-only Meta Model API client (OpenAI-compatible Responses API).
// NEVER import this module in a client component: it carries MODEL_API_KEY,
// which must never reach the browser.
import OpenAI from "openai";

export const meta = new OpenAI({
  baseURL: "https://api.meta.ai/v1",
  apiKey: process.env.MODEL_API_KEY,
});
