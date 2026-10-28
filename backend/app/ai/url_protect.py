"""URL tokenization to protect opaque asset URLs across an LLM round-trip.

BUG-7 -- the refiner round-trips the ENTIRE current MJML through the model
(Haiku by default) and asks it to re-emit the updated MJML. Image ``src``
values are absolute URLs with opaque random filenames, e.g. (URL wrapped here
for line length; it is a single unbroken value in practice)::

    <mj-image src="http://localhost:8000/uploads/3/
        f24517f9bbc248b3b60980291b7c06d4_msedge_dSINmt9SY8.png" />

LLMs do not reliably reproduce long random strings verbatim, so the re-emitted
``src`` filename gets mangled -> 404 -> broken image. The deterministic
sanitizer does NOT touch ``src``, so the corruption is purely the model
round-trip.

The fix here is a tokenize -> call -> restore pass: before sending the MJML to
the model we replace each unique URL with a short, stable, model-safe
placeholder token (``@@URL0@@``, ``@@URL1@@``, ...) and keep a mapping; after
parsing the model's response we substitute the original URLs back in. This
guarantees byte-for-byte preservation regardless of model fidelity, and also
saves tokens.

Token scheme
------------
Tokens have the form ``@@URL{n}@@`` (e.g. ``@@URL0@@``). The reasons this is
collision-safe and model-safe:

* The literal ``@@`` digraph is not part of MJML/HTML/CSS syntax, so it cannot
  appear in well-formed source we tokenize. We additionally guard at runtime:
  :func:`tokenize_urls` raises if the chosen token already occurs in the source.
* It is short and opaque, so the model treats it as an atomic identifier and is
  far less likely to "helpfully" reformat it than a long URL with slashes,
  underscores, and a random filename.
* The numeric suffix is bounded by the number of unique URLs, so token strings
  are stable and deterministic for a given input.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# Matches our placeholder tokens. Used both to build them and to find any
# leftover/unknown tokens in the model output.
_TOKEN_RE = re.compile(r"@@URL(\d+)@@")

# URL extraction patterns. We protect three carriers of opaque asset URLs that
# share the same model-mangling failure mode:
#   * mj-image / mj-hero / any element with a src="..." attribute
#   * any href="..." (links / tracked landing pages)
#   * CSS url(...) inside background-url / style attributes
#
# We capture the URL payload (group "url") and preserve the surrounding
# delimiters so restoration is exact. ``src`` and ``href`` are matched as
# quoted attribute values; ``url(...)`` is matched as a CSS function.
_SRC_RE = re.compile(r'\bsrc\s*=\s*(?P<q>["\'])(?P<url>.*?)(?P=q)', re.IGNORECASE)
_HREF_RE = re.compile(r'\bhref\s*=\s*(?P<q>["\'])(?P<url>.*?)(?P=q)', re.IGNORECASE)
_CSS_URL_RE = re.compile(
    r"url\(\s*(?P<q>[\"\']?)(?P<url>.*?)(?P=q)\s*\)", re.IGNORECASE
)

_EXTRACT_PATTERNS = (_SRC_RE, _HREF_RE, _CSS_URL_RE)


def _make_token(index: int) -> str:
    return f"@@URL{index}@@"


def tokenize_urls(mjml: str) -> tuple[str, dict[str, str]]:
    """Replace opaque URLs in ``mjml`` with stable placeholder tokens.

    Extracts URLs carried by ``src="..."``, ``href="..."``, and CSS
    ``url(...)`` and replaces each *unique* URL with a deterministic token of
    the form ``@@URL{n}@@``. The first time a URL is seen it is assigned the
    next index; repeat occurrences reuse the same token, so identical URLs map
    to one token.

    Parameters
    ----------
    mjml:
        The source MJML to tokenize.

    Returns
    -------
    tuple[str, dict[str, str]]
        ``(tokenized_mjml, token_to_url)`` where ``token_to_url`` maps each
        token (e.g. ``"@@URL0@@"``) back to its original URL. The mapping is
        insertion-ordered by first appearance.

    Raises
    ------
    ValueError
        If the source already contains a string matching the token pattern
        ``@@URL{n}@@`` (collision risk -- restoration would be ambiguous).
    """
    if _TOKEN_RE.search(mjml):
        raise ValueError(
            "Source MJML already contains a token matching @@URL<n>@@; "
            "cannot safely tokenize URLs."
        )

    url_to_token: dict[str, str] = {}
    token_to_url: dict[str, str] = {}

    def _replace(match: re.Match[str]) -> str:
        url = match.group("url")
        # Skip empty values; nothing to protect and a token would be wasteful.
        if not url:
            return match.group(0)
        token = url_to_token.get(url)
        if token is None:
            token = _make_token(len(url_to_token))
            url_to_token[url] = token
            token_to_url[token] = url
        # Rebuild the match with the URL payload swapped for the token,
        # preserving the surrounding delimiters exactly.
        full = match.group(0)
        start, end = match.span("url")
        offset = match.start()
        return full[: start - offset] + token + full[end - offset :]

    tokenized = mjml
    for pattern in _EXTRACT_PATTERNS:
        tokenized = pattern.sub(_replace, tokenized)

    return tokenized, token_to_url


def restore_urls(text: str, token_to_url: dict[str, str]) -> str:
    """Restore original URLs in ``text`` from a token mapping.

    Every token present in ``token_to_url`` is replaced by its original URL.
    Tokens that were dropped by the model (e.g. the user removed the image)
    are simply absent from ``text`` -- their restoration is a no-op.

    Any leftover token that is **not** in the mapping (the model hallucinated a
    token) is stripped so it can never reach the user, and a warning is logged.

    Parameters
    ----------
    text:
        Model output (typically the parsed MJML) that may contain tokens.
    token_to_url:
        Mapping from token to original URL, as returned by
        :func:`tokenize_urls`.

    Returns
    -------
    str
        ``text`` with known tokens restored and unknown tokens stripped.
    """
    restored = text
    for token, url in token_to_url.items():
        restored = restored.replace(token, url)

    # Strip any leftover/unknown tokens the model may have invented.
    leftovers = _TOKEN_RE.findall(restored)
    if leftovers:
        logger.warning(
            "Stripping %d unknown URL placeholder token(s) from refiner "
            "output (model hallucinated tokens not in the map): %s",
            len(leftovers),
            sorted({f"@@URL{n}@@" for n in leftovers}),
        )
        restored = _TOKEN_RE.sub("", restored)

    return restored
