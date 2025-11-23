function autoCleanKeywords(
  raw: string,
  autoRemoveDupKeywords: boolean,
  bulkKeywordExtra: string,
): string {
  // ইউজারের extra bulk keyword–ও add করা হচ্ছে
  const base = raw + (bulkKeywordExtra ? ',' + bulkKeywordExtra : '');

  let tokens = base
    .toLowerCase()
    .split(/[,;\n]/)             // কমা / সেমিকোলন / নিউলাইন দিয়ে ভাগ
    .map((t) => t.trim())
    .filter(Boolean)
    // এখানে প্রতিটা keyword থেকে শুধু **প্রথম শব্দ** রাখা হচ্ছে
    .map((t) => t.split(/\s+/)[0])
    .filter(Boolean);

  if (autoRemoveDupKeywords) {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        unique.push(t);
      }
    }
    tokens = unique;
  }

  // ফাইনাল আউটপুট: "word1, word2, word3" – সব এক শব্দের হবে
  return tokens.join(', ');
}
