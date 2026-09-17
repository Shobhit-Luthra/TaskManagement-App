import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { tokenizeMentions } from "./mentions";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: ["p", "strong", "em", "ul", "ol", "li", "code", "pre", "a", "br", "blockquote"],
  attributes: { ...defaultSchema.attributes, a: ["href", "title"] },
  protocols: { ...defaultSchema.protocols, href: ["http", "https", "mailto"] },
};

export function CommentBody({
  body,
  allowedMentionIds,
  resolveDisplayName,
}: {
  body: string;
  allowedMentionIds: ReadonlySet<string>;
  resolveDisplayName: (userId: string) => string | null;
}) {
  return (
    <div className="max-w-none text-sm leading-6 [&_p]:m-0 [&_p]:inline">
      {tokenizeMentions(body).map((token, index) => {
        if (token.type === "text") {
          if (token.value.trim().length === 0) return token.value;
          return (
            <ReactMarkdown key={index} rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}>
              {token.value}
            </ReactMarkdown>
          );
        }
        const resolved = allowedMentionIds.has(token.userId)
          ? resolveDisplayName(token.userId)
          : null;
        return resolved ? (
          <span
            key={index}
            className="bg-primary/10 text-primary rounded px-1 font-medium"
            data-mention-user-id={token.userId}
          >
            @{resolved}
          </span>
        ) : (
          <span key={index}>@{token.label}</span>
        );
      })}
    </div>
  );
}
