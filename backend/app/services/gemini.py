"""The one way to Gemini: a JSON answer parsed into a pydantic schema, with each
call's token use and cost logged. The scanner and the claims parser use it;
tests replace `generate_json`."""

from google import genai
from google.genai import types

from ..config import settings


def client() -> genai.Client:
    api_key = settings.gemini_api_key
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com/apikey "
            "and put it in backend/.env or export it as an environment variable."
        )
    return genai.Client(api_key=api_key)


def _log_usage(response) -> None:
    """Per-call token use, to see the cost shape and prove the thinking-budget
    cap works. At $0.50/M input + $3.00/M output (thinking is billed at the
    output rate), the dominant lever is the thinking token count."""
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return
    prompt_t = getattr(usage, "prompt_token_count", 0) or 0
    output_t = getattr(usage, "candidates_token_count", 0) or 0
    thinking_t = getattr(usage, "thoughts_token_count", 0) or 0
    total_t = getattr(usage, "total_token_count", 0) or 0
    # Rough USD cost estimate at advertised Gemini 3 Flash rates.
    cost_usd = (prompt_t * 0.5 + (output_t + thinking_t) * 3.0) / 1_000_000
    print(
        f"[gemini-usage] prompt={prompt_t} thinking={thinking_t} "
        f"output={output_t} total={total_t} cost=${cost_usd:.5f}",
        flush=True,
    )


def generate_json(contents: list, schema, temperature: float):
    """Gemini's answer to `contents` as an instance of `schema`, or None when
    the answer did not fit the schema. Synchronous and slow (seconds): call it
    in a worker thread."""
    # Keep the client in a variable: a temporary is closed as soon as it is
    # garbage-collected, which can be mid-request.
    gemini = client()
    response = gemini.models.generate_content(
        model=settings.gemini_model,
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
            thinking_config=types.ThinkingConfig(thinking_budget=settings.gemini_thinking_budget),
        ),
    )
    _log_usage(response)
    if response.parsed is None:
        print(f"[gemini] answer did not fit the schema: {(response.text or '')[:500]!r}", flush=True)
    return response.parsed
