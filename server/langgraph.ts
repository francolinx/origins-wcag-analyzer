let cached: boolean | null = null;

export async function isLangGraphAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const moduleName = "@langchain/langgraph";
    await import(moduleName);
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}
