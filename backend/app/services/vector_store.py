from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class InMemoryFaissStore:
    """Optional vector index abstraction for startup-stage semantic search.

    Replace with Pinecone or managed vector DB in production cloud deployments.
    """

    vectors: list[np.ndarray] = field(default_factory=list)
    metadata: list[dict] = field(default_factory=list)

    def upsert(self, vector: np.ndarray, payload: dict) -> None:
        self.vectors.append(vector.astype(np.float32))
        self.metadata.append(payload)

    def search(self, query: np.ndarray, top_k: int = 5) -> list[dict]:
        if not self.vectors:
            return []

        matrix = np.vstack(self.vectors)
        scores = matrix @ query.astype(np.float32)
        indices = np.argsort(scores)[::-1][:top_k]

        return [
            {
                "score": float(scores[idx]),
                "metadata": self.metadata[idx],
            }
            for idx in indices
        ]
