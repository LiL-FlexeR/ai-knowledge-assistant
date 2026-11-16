# Product vision

## Problem

People keep useful information in PDFs, notes, and Markdown but lose time finding the passage that answers a question. A generic chatbot may sound confident while lacking access to those documents or verifiable evidence for its answer.

## Target users

The initial user is one person working locally with a modest collection of text-based documents: a developer searching project notes, a learner reviewing reference material, or a reviewer exploring a synthetic handbook. This is also a portfolio demonstration of backend engineering, REST contracts, RAG, relational/vector storage, security fundamentals, testing, and measured AI evaluation.

The user controls one shared local corpus; there are no accounts or user workspaces. It is not a commercial SaaS platform or a replacement for specialist advice.

## Main experience

The user opens Documents, uploads a supported file, and sees its processing state or a useful error. When ready, the user opens Ask AI, asks a question, and receives a concise response whose statements link to source cards. PDF cards identify physical pages; text/Markdown cards identify the document, section, and lines. When sources are insufficient or contradictory, the response explains that limitation instead of supplying an unsupported answer. The user can remove a document and its index or explicitly retry processing.

## Value proposition

Combine semantic document discovery with answers tied to inspectable evidence. Processing status and error feedback make ingestion visible. Explicit abstention and source excerpts help the user judge reliability. This differs from an unrestricted chatbot through a bounded corpus, retrieved context, verified reference identities, and a no-evidence response path.

Citations and prompts do not eliminate hallucinations or injection. Product trust rests on transparent evidence and published evaluation, not an unmeasured accuracy claim. Local runtime still sends selected text/questions to OpenAI; explain this clearly before use.

## Delivery principles

Build a complete small workflow before advanced retrieval. Keep Docker-based development reproducible, contracts predictable, and implementation stages independently verifiable. Prioritize source integrity and failure cleanup over dashboards, animations, or hypothetical enterprise infrastructure. See [scope](mvp-scope.md).
