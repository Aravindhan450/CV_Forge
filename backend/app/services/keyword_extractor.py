from __future__ import annotations

import re

from keybert import KeyBERT

from app.core.config import get_settings
from app.models.schemas import KeywordResult
from app.utils.text import normalize_token, unique_preserve_order


class KeywordExtractorService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._model: KeyBERT | None = None

    @property
    def model(self) -> KeyBERT:
        if self._model is None:
            self._model = KeyBERT(model=self.settings.keybert_model_name)
        return self._model

    def extract(self, resume_text: str, job_description: str, top_n: int = 25) -> KeywordResult:
        resume_keywords = self._extract_keywords(resume_text, top_n=top_n)
        jd_keywords = self._extract_keywords(job_description, top_n=top_n)

        resume_set = {normalize_token(value) for value in resume_keywords}

        found = unique_preserve_order([word for word in jd_keywords if normalize_token(word) in resume_set])
        missing = unique_preserve_order([word for word in jd_keywords if normalize_token(word) not in resume_set])

        return KeywordResult(
            resume_keywords=resume_keywords,
            jd_keywords=jd_keywords,
            found_keywords=found,
            missing_keywords=missing,
        )

    def _extract_keywords(self, text: str, top_n: int = 25) -> list[str]:
        if not text.strip():
            return []

        try:
            keywords = self.model.extract_keywords(
                text,
                keyphrase_ngram_range=(1, 2),
                stop_words="english",
                top_n=top_n,
                use_maxsum=True,
                nr_candidates=max(top_n * 2, 40),
            )
            extracted = [phrase for phrase, score in keywords if score > 0.1]
            if extracted:
                return unique_preserve_order(extracted)
        except Exception:
            pass

        # fallback when ML model is unavailable
        tokens = re.findall(r"[A-Za-z][A-Za-z+#.-]{2,}", text)
        filtered = [token for token in tokens if token.lower() not in _STOPWORDS]
        return unique_preserve_order(filtered[:top_n])


_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "you",
    "your",
    "from",
    "into",
    "have",
    "will",
    "are",
    "our",
    "all",
}
