import { readFile } from "node:fs/promises";
import path from "node:path";
import { BRIEF_FILE } from "./config.ts";

/** The brief is read, never written, by the orchestrator: it is the agent's document. */
const BRIEF_LIMIT = 6_000;

/**
 * The project's app brief, when the agent has written one. Trimmed to a size
 * that fits every prompt; the agent is told to keep it short and current.
 */
export async function readBrief(dir: string): Promise<string | null> {
  try {
    const text = (await readFile(path.join(dir, BRIEF_FILE), "utf8")).trim();
    if (!text) return null;
    return text.length > BRIEF_LIMIT ? `${text.slice(0, BRIEF_LIMIT)}\n…(brief truncated)` : text;
  } catch {
    return null;
  }
}
