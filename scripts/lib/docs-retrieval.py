"""LightRAG worker for `scripts/docs-retrieval.mjs` (DR-041) — naive mode, local embeddings, no LLM.

This file is PYTHON because LightRAG is a Python library installed into a venv outside this
repository; a Node script cannot call it in-process, and the alternative — a Python program
embedded in a JavaScript string — hides the part a reviewer most needs to read. The split is:
`docs-retrieval.mjs` owns the repository (the tracked file set, every containment refusal, the
CLI) and this file owns the LightRAG calls. It is never registered as an npm script and is never
run directly by a human; it reads one JSON job on stdin and writes one JSON result on stdout.

Two properties are re-checked HERE rather than trusted from the caller, because this process is
the one that actually writes: the working directory must resolve outside the repository, and no
generative model is configured — `_refuse_llm` raises if LightRAG ever reaches for one, so a
future mode change fails loudly instead of silently needing a key.

WHY INDEXING GOES THROUGH THE PIPELINE AND NOT `ainsert`. `ainsert` always runs entity/relation
extraction, which is the LLM half; with no model configured every document ends FAILED after its
chunks have already been embedded — an index that answers queries while its own status says it
did not build. LightRAG has a first-class opt-out for exactly this: process option `"!"`
(`PROCESS_OPTION_SKIP_KG`), whose own pipeline comment reads "skipping entity/relation
extraction ... chunks remain in the vector store so naive / mix retrieval still works". Only
`apipeline_enqueue_documents` takes it, so indexing is enqueue + process, and this file FAILS if
any document ends in a state other than `processed`.

WHY `file_path` IS SENT TILDE-JOINED. LightRAG canonicalizes a document's `file_path` to its
BASENAME (`utils_pipeline.normalize_document_file_path`) and rejects a second document whose
basename it already holds. `docs/` has several same-named files (three `README.md` among them),
so sending real relative paths silently drops all but the first of each name. The relative path
is sent with `/` replaced by `~` (no tracked docs path contains one) to keep basenames unique;
the authoritative path is recovered by the caller from the chunk id, which carries the doc id
this file assigned.
"""

import asyncio
import json
import os
import sys


def fail(code, message):
    sys.stdout.write(json.dumps({"ok": False, "error": message}) + "\n")
    sys.exit(code)


async def _refuse_llm(*args, **kwargs):
    raise RuntimeError(
        "docs-retrieval configures NO generative model (DR-041). A code path asked for one; "
        "that is a defect, not a missing key. Nothing was answered."
    )


def resolve_outside(path, repo_root):
    real = os.path.realpath(path)
    root = os.path.realpath(repo_root)
    if real == root or real.startswith(root + os.sep):
        fail(
            3,
            "working dir %s resolves inside the repository (%s); the index must live outside it. "
            "Nothing was written." % (real, root),
        )
    return real


async def run(job):
    repo_root = job["repoRoot"]
    working_dir = resolve_outside(job["workingDir"], repo_root)
    os.makedirs(working_dir, exist_ok=True)
    resolve_outside(working_dir, repo_root)  # re-check after creation, in case of a symlinked parent

    import logging

    import numpy as np
    from fastembed import TextEmbedding
    from lightrag import LightRAG
    from lightrag.kg.shared_storage import initialize_pipeline_status
    from lightrag.utils import EmbeddingFunc

    for name in ("lightrag", "nano-vectordb"):
        logging.getLogger(name).setLevel(logging.ERROR)

    model = TextEmbedding(model_name=job["embeddingModel"], cache_dir=job["modelsDir"])
    counted = {"texts": 0}

    async def embed(texts, **_kwargs):
        counted["texts"] += len(texts)
        return np.array(list(model.embed(list(texts))), dtype=np.float32)

    rag = LightRAG(
        working_dir=working_dir,
        llm_model_func=_refuse_llm,
        llm_model_name="none",
        embedding_func=EmbeddingFunc(embedding_dim=job["embeddingDim"], func=embed),
    )
    await rag.initialize_storages()
    await initialize_pipeline_status()
    try:
        if job["op"] == "index":
            out = await do_index(rag, job, counted)
        elif job["op"] == "query":
            out = await do_query(rag, job, counted)
        else:
            fail(2, "unknown op %r" % job["op"])
    finally:
        await rag.finalize_storages()
    sys.stdout.write(json.dumps(out) + "\n")


async def do_index(rag, job, counted):
    """Delete-then-reindex. LightRAG REJECTS a changed file re-inserted under a basename it
    already holds ("File name already exists"), so a refresh is a delete followed by an insert —
    measured 2026-09-12, and the reason this is not an incremental update."""
    deleted = []
    for doc_id in job["deleteIds"]:
        result = await rag.adelete_by_doc_id(doc_id)
        deleted.append({"docId": doc_id, "status": getattr(result, "status", str(result))})

    inserted = []
    if job["insert"]:
        texts, ids, paths = [], [], []
        for doc in job["insert"]:
            with open(doc["abs"], encoding="utf-8") as handle:
                texts.append(handle.read())
            ids.append(doc["docId"])
            paths.append(doc["relPath"].replace("/", "~"))
            inserted.append(doc["relPath"])
        # "!" == PROCESS_OPTION_SKIP_KG: chunk and embed, build no graph, call no model.
        await rag.apipeline_enqueue_documents(texts, ids=ids, file_paths=paths, process_options="!")
        await rag.apipeline_process_enqueue_documents()

    # An index whose documents ended anywhere but PROCESSED is not an index; say so rather than
    # answering queries out of a half-built store.
    counts = await rag.doc_status.get_status_counts()
    statuses = {str(k): int(v) for k, v in counts.items() if int(v) > 0}
    bad = {k: v for k, v in statuses.items() if k != "processed"}
    if bad:
        fail(4, "the index did not build cleanly — document status counts %r. Nothing is trustworthy here; "
                "re-run --reindex after reading the working dir's kv_store_doc_status.json." % statuses)

    return {
        "ok": True,
        "op": "index",
        "deleted": deleted,
        "inserted": inserted,
        "embeddedTexts": counted["texts"],
        "docStatus": statuses,
    }


async def do_query(rag, job, counted):
    from lightrag import QueryParam

    # naive ONLY: the graph modes cost 2 LLM calls per chunk to build and this install has no LLM.
    param = QueryParam(
        mode="naive", only_need_context=True, chunk_top_k=job["topK"], top_k=job["topK"]
    )
    data = await rag.aquery_data(job["query"], param=param)
    payload = data.get("data", {}) or {}
    chunks = []
    for chunk in payload.get("chunks", []) or []:
        chunks.append(
            {
                "chunkId": chunk.get("chunk_id", ""),
                "storedPath": chunk.get("file_path", "unknown_source"),
                "content": chunk.get("content", ""),
            }
        )
    return {
        "ok": True,
        "op": "query",
        "status": data.get("status", "unknown"),
        "chunks": chunks,
        "embeddedTexts": counted["texts"],
        "mode": (data.get("metadata", {}) or {}).get("query_mode", "unknown"),
    }


def main():
    job = json.loads(sys.stdin.read())
    asyncio.run(run(job))


if __name__ == "__main__":
    main()
