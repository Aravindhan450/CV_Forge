import re
from collections.abc import Iterable


SECTION_HEADERS = {
    "skills": ["skills", "technical skills", "core competencies"],
    "experience": ["experience", "work experience", "professional experience"],
    "education": ["education", "academic background"],
    "projects": ["projects", "key projects"],
}


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\u00a0", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    chunks = re.split(r"(?<=[.!?])\s+", text)
    return [chunk.strip() for chunk in chunks if len(chunk.strip()) > 0]


def normalize_token(token: str) -> str:
    return re.sub(r"[^a-z0-9+#.-]", "", token.lower()).strip()


def unique_preserve_order(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        normalized = item.strip()
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        ordered.append(normalized)
    return ordered


def find_all_occurrences(text: str, phrase: str) -> list[tuple[int, int]]:
    if not phrase:
        return []

    matches: list[tuple[int, int]] = []
    start = 0
    haystack = text.lower()
    needle = phrase.lower()

    while True:
        idx = haystack.find(needle, start)
        if idx == -1:
            break
        matches.append((idx, idx + len(needle)))
        start = idx + len(needle)

    return matches
