"""Helpers for parsing LLM responses.

Extracted from pipeline.py to allow reuse across generation and
chat/refinement flows.
"""

from __future__ import annotations

import re


def parse_response(text: str) -> tuple[str, str, str]:
    """Extract subject line, preheader, and MJML from the LLM response text.

    Expected format::

        SUBJECT: <subject line>
        PREHEADER: <preheader text>

        <mjml>...</mjml>

    Subject and preheader are optional -- if missing, an empty string is
    returned for that field.  The MJML block is required.

    Returns
    -------
    tuple[str, str, str]
        (subject_line, preheader, mjml_source)

    Raises
    ------
    ValueError
        If the MJML block cannot be found in the response.
    """
    # Extract subject line (optional -- return "" if missing)
    subject_match = re.search(r"SUBJECT:\s*(.+)", text)
    subject = subject_match.group(1).strip() if subject_match else ""

    # Extract preheader (optional -- return "" if missing)
    preheader_match = re.search(r"PREHEADER:\s*(.+)", text)
    preheader = preheader_match.group(1).strip() if preheader_match else ""

    # Extract MJML block (required)
    mjml_match = re.search(r"(<mjml[\s\S]*?</mjml>)", text)
    if not mjml_match:
        raise ValueError("Response does not contain a valid <mjml> block")
    mjml = mjml_match.group(1).strip()

    return subject, preheader, mjml
