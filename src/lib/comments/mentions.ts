// Stored mention syntax: @[Display Name](uuid). The display name is never an
// identity claim; ids are recomputed from the body at the server boundary.
const MENTION_PATTERN =
  /@\[([^\]\n]{1,80})\]\((\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b)\)/g;

export function parseMentions(body: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const id = match[2]!.toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export type MentionToken =
  { type: "text"; value: string } | { type: "mention"; userId: string; label: string };

export function tokenizeMentions(body: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ type: "text", value: body.slice(lastIndex, index) });
    tokens.push({ type: "mention", userId: match[2]!.toLowerCase(), label: match[1]! });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < body.length) tokens.push({ type: "text", value: body.slice(lastIndex) });
  return tokens;
}
