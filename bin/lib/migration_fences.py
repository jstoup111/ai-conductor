"""Recognize candidate ``bash migration`` fences in Markdown changelogs.

This module deliberately owns only Markdown fence recognition.  Callers retain
release parsing, version filtering, and output ordering policy.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Iterator


@dataclass(frozen=True)
class MigrationFence:
    """One syntactically candidate migration fence and its source context.

    ``source_start`` and ``source_end`` are zero-based offsets into the input;
    the end offset is exclusive.  ``script`` preserves the text between the
    opening and closing fences, without the runner's output trimming.
    """

    source_start: int
    source_end: int
    script: str
    in_migration_section: bool
    closed: bool


_MIGRATION_HEADING = re.compile(r"^#{2,3}\s+Migration\s*$")
_SECTION_END_HEADING = re.compile(r"^#{1,3}\s")
_FENCE_OPENING = re.compile(r"^([`~])\1{2,}")


def scan_migration_fences(text: str) -> Iterator[MigrationFence]:
    """Yield candidate triple-backtick ``bash migration`` fences in source order.

    The state machine intentionally mirrors the original runner behavior:
    headings inside a surrounding Markdown fence are ignored, a closer may be
    wider than its opener, and an unterminated candidate is reported as closed
    ``False`` rather than emitted as runnable.
    """

    in_migration_section = False
    fence: tuple[str, int] | None = None
    candidate_start: int | None = None
    candidate_section = False
    candidate_script: list[str] | None = None
    offset = 0

    for line in text.splitlines(keepends=True):
        if fence is not None:
            marker, width = fence
            if re.match(rf"^{re.escape(marker)}{{{width},}}\s*$", line):
                if candidate_start is not None:
                    yield MigrationFence(
                        source_start=candidate_start,
                        source_end=offset + len(line),
                        script="".join(candidate_script or []),
                        in_migration_section=candidate_section,
                        closed=True,
                    )
                    candidate_start = None
                    candidate_script = None
                fence = None
            elif candidate_script is not None:
                candidate_script.append(line)
            offset += len(line)
            continue

        if _MIGRATION_HEADING.match(line):
            in_migration_section = True
            offset += len(line)
            continue
        if in_migration_section and _SECTION_END_HEADING.match(line):
            in_migration_section = False
            offset += len(line)
            continue

        opening = _FENCE_OPENING.match(line)
        if opening:
            marker = opening.group(1)
            width = len(opening.group(0))
            fence = (marker, width)
            if marker == "`" and width == 3 and line[width:].strip() == "bash migration":
                candidate_start = offset
                candidate_section = in_migration_section
                candidate_script = []
        offset += len(line)

    if candidate_start is not None:
        yield MigrationFence(
            source_start=candidate_start,
            source_end=len(text),
            script="".join(candidate_script or []),
            in_migration_section=candidate_section,
            closed=False,
        )


def runnable_migration_fences(text: str) -> Iterator[MigrationFence]:
    """Yield the closed candidates eligible for the migration runner."""

    return (
        candidate
        for candidate in scan_migration_fences(text)
        if candidate.in_migration_section and candidate.closed
    )
