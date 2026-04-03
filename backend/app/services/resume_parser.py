from __future__ import annotations

from io import BytesIO
import re

import pdfplumber
from docx import Document

from app.models.schemas import ParseSections
from app.utils.text import SECTION_HEADERS, normalize_text, unique_preserve_order


class ResumeParserService:
    SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt"}

    def parse_upload(self, filename: str, file_bytes: bytes) -> tuple[str, ParseSections]:
        extension = self._get_extension(filename)
        text = self._extract_text(extension, file_bytes)
        normalized = normalize_text(text)
        sections = self.extract_sections(normalized)
        return normalized, sections

    def parse_text(self, resume_text: str) -> tuple[str, ParseSections]:
        normalized = normalize_text(resume_text)
        sections = self.extract_sections(normalized)
        return normalized, sections

    def _get_extension(self, filename: str) -> str:
        match = re.search(r"(\.[a-zA-Z0-9]+)$", filename or "")
        extension = match.group(1).lower() if match else ""
        if extension not in self.SUPPORTED_EXTENSIONS:
            raise ValueError("Unsupported file type. Supported types are PDF, DOCX, TXT")
        return extension

    def _extract_text(self, extension: str, file_bytes: bytes) -> str:
        if extension == ".pdf":
            return self._extract_pdf_text(file_bytes)
        if extension == ".docx":
            return self._extract_docx_text(file_bytes)
        return file_bytes.decode("utf-8", errors="ignore")

    @staticmethod
    def _extract_pdf_text(file_bytes: bytes) -> str:
        lines: list[str] = []
        with pdfplumber.open(BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                if page_text:
                    lines.append(page_text)
        return "\n".join(lines)

    @staticmethod
    def _extract_docx_text(file_bytes: bytes) -> str:
        doc = Document(BytesIO(file_bytes))
        return "\n".join(paragraph.text for paragraph in doc.paragraphs if paragraph.text.strip())

    def extract_sections(self, resume_text: str) -> ParseSections:
        lines = [line.strip() for line in resume_text.split("\n") if line.strip()]
        buckets: dict[str, list[str]] = {"skills": [], "experience": [], "education": [], "projects": []}

        current_section: str | None = None

        for line in lines:
            normalized = line.lower().strip(":")
            detected = self._match_section_header(normalized)
            if detected:
                current_section = detected
                continue

            if current_section in buckets:
                buckets[current_section].append(line)
            else:
                # capture loose content when explicit headers are missing
                if any(token in normalized for token in ["bachelor", "master", "university", "college"]):
                    buckets["education"].append(line)
                elif any(token in normalized for token in ["engineer", "developer", "intern", "lead"]):
                    buckets["experience"].append(line)

        skills = self._normalize_skill_lines(buckets["skills"])

        return ParseSections(
            skills=skills,
            experience=unique_preserve_order(buckets["experience"]),
            education=unique_preserve_order(buckets["education"]),
            projects=unique_preserve_order(buckets["projects"]),
        )

    def _match_section_header(self, normalized_line: str) -> str | None:
        cleaned = re.sub(r"[^a-z ]", "", normalized_line)
        for section_name, aliases in SECTION_HEADERS.items():
            if cleaned in aliases:
                return section_name
        return None

    def _normalize_skill_lines(self, skill_lines: list[str]) -> list[str]:
        skills: list[str] = []
        for line in skill_lines:
            chunks = re.split(r"[,|/•·]", line)
            for chunk in chunks:
                stripped = re.sub(r"^[\-•*]\s*", "", chunk).strip()
                if len(stripped) >= 2:
                    skills.append(stripped)
        return unique_preserve_order(skills)
