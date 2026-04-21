export type WcagDoc = {
  id: string;
  criterion: string;
  title: string;
  sourceUrl: string;
  techniques: string[];
  content: string;
};

export const WCAG_CORPUS: WcagDoc[] = [
  {
    id: "1.1.1",
    criterion: "1.1.1",
    title: "Non-text Content",
    sourceUrl: "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html",
    techniques: ["H37", "G94"],
    content: "All meaningful images need text alternatives so assistive technologies can convey equivalent meaning.",
  },
  {
    id: "1.3.1",
    criterion: "1.3.1",
    title: "Info and Relationships",
    sourceUrl: "https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html",
    techniques: ["H44", "ARIA1"],
    content: "Information and relationships implied visually must be programmatically determinable, including form labels.",
  },
  {
    id: "2.4.1",
    criterion: "2.4.1",
    title: "Bypass Blocks",
    sourceUrl: "https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html",
    techniques: ["G1", "G123"],
    content: "Users need a way to bypass repeated blocks like navigation through skip links or landmarks.",
  },
  {
    id: "2.4.4",
    criterion: "2.4.4",
    title: "Link Purpose (In Context)",
    sourceUrl: "https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html",
    techniques: ["H30", "G91"],
    content: "Link text should identify purpose from context to reduce ambiguity for screen reader users.",
  },
  {
    id: "4.1.2",
    criterion: "4.1.2",
    title: "Name, Role, Value",
    sourceUrl: "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html",
    techniques: ["ARIA4", "ARIA14"],
    content: "Interactive components require accessible names and proper semantic roles that can be read by assistive technologies.",
  },
];

export function retrieveWcagEvidence(query: string) {
  const qTokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  const scored = WCAG_CORPUS.map((doc) => {
    const docText = `${doc.title} ${doc.content} ${doc.criterion}`.toLowerCase();
    const score = qTokens.reduce((acc, token) => (docText.includes(token) ? acc + 1 : acc), 0);
    return { doc, score };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .filter((item) => item.score > 0)
    .map((item) => ({
      criterion: `${item.doc.criterion} ${item.doc.title}`,
      title: item.doc.title,
      sourceUrl: item.doc.sourceUrl,
      snippet: item.doc.content,
      techniques: item.doc.techniques,
    }));

  return scored;
}
