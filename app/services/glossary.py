from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Term:
    source: str
    target: str
    source_lang: str = ""
    target_lang: str = ""
    domain: str = ""
    notes: str = ""


def load_terms(folder: Path, source_lang: str, target_lang: str) -> list[Term]:
    terms: list[Term] = []
    for path in sorted(folder.glob("*")):
        if path.name.startswith("."):
            continue
        try:
            if path.suffix.lower() in {".csv", ".tsv"}:
                terms.extend(_load_delimited(path))
            elif path.suffix.lower() == ".json":
                terms.extend(_load_json(path))
        except (OSError, UnicodeError, csv.Error, json.JSONDecodeError):
            # One malformed glossary should not make a document untranslatable.
            continue
    return [_orient(term, source_lang, target_lang) for term in terms if _supports(term, source_lang, target_lang)]


def relevant_terms(terms: list[Term], texts: list[str], limit: int = 120) -> list[Term]:
    haystack = "\n".join(texts).casefold()
    matched = [term for term in terms if term.source and term.source.casefold() in haystack]
    return matched[:limit]


def load_style_guide(folder: Path, max_chars: int = 12000) -> str:
    path = folder / "style_guide.md"
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")[:max_chars].strip()
    except (OSError, UnicodeError):
        return ""


def _load_delimited(path: Path) -> list[Term]:
    delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = csv.DictReader(handle, delimiter=delimiter)
        return [_term_from_mapping(row) for row in rows if row.get("source") and row.get("target")]


def _load_json(path: Path) -> list[Term]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("terms", [])
    return [_term_from_mapping(item) for item in data if isinstance(item, dict) and item.get("source") and item.get("target")]


def _term_from_mapping(item: dict) -> Term:
    return Term(
        source=str(item.get("source", "")).strip(),
        target=str(item.get("target", "")).strip(),
        source_lang=str(item.get("source_lang", "")).strip().lower(),
        target_lang=str(item.get("target_lang", "")).strip().lower(),
        domain=str(item.get("domain", "")).strip(),
        notes=str(item.get("notes", "")).strip(),
    )


def _supports(term: Term, source_lang: str, target_lang: str) -> bool:
    if not term.source_lang or not term.target_lang:
        return True
    return (term.source_lang == source_lang and term.target_lang == target_lang) or (
        term.source_lang == target_lang and term.target_lang == source_lang
    )


def _orient(term: Term, source_lang: str, target_lang: str) -> Term:
    if term.source_lang == target_lang and term.target_lang == source_lang:
        return Term(term.target, term.source, source_lang, target_lang, term.domain, term.notes)
    return term

