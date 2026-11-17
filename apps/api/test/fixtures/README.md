# Synthetic S03 fixtures

These project-authored fixtures are dedicated to the public domain (CC0). They contain no personal or licensed document content. `synthetic-pdf.ts` generates text, multi-page, blank, image-only and deliberately unsupported encrypted-dictionary PDFs with physical page objects. `handbook.pdf` and `scanned.pdf` are generated from that helper for the curl demonstration. The image-only fixture represents the absence of an extractable text layer; it does not test OCR or realistic scanning quality. The encrypted-dictionary fixture exercises password/unsupported handling, not interoperability with every encryption scheme.

`notes.txt` and `policy.md` are UTF-8 fixture originals. Unit tests generate normalization, Unicode, fence, malformed, and budget edge cases in memory. Fake vectors prove lifecycle and source integrity, not semantic retrieval quality.

S05’s `chat-evidence.ts` supplies project-authored maintenance, recovery and adversarial instruction passages in memory. `fake-grounded-answer-client.ts` returns scripted structured outputs; `chat.spec.ts` adds ambiguity/conflict/invalid-reference cases. `chat.integration.ts` generates PDF/TXT/Markdown originals and traces citations through real ingestion/retrieval. These are deterministic contract fixtures, not the S07 gold corpus or a measured model-quality evaluation.
