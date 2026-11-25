"""The one way to Claude: one `claude -p` process per call, its answer parsed
into a pydantic schema, with the call's cost logged. The claims parser uses
it; tests replace `generate_json`.

The CLI takes its login from the process environment: ANTHROPIC_API_KEY, which
docker compose passes in from .env. Outside Docker, with no key exported, it
uses the Claude login of the machine."""

import json
import subprocess

from pydantic import ValidationError

from ..config import settings

# Under the 100 s that the Cloudflare tunnel gives a request.
TIMEOUT_S = 90


def generate_json(prompt: str, schema):
    """Claude's answer to `prompt` as an instance of `schema`. Raises
    RuntimeError when the CLI is missing, fails or times out. Synchronous and
    slow (seconds): call it in a worker thread."""
    try:
        out = subprocess.run(
            [
                "claude", "-p", "--output-format", "json",
                "--json-schema", json.dumps(schema.model_json_schema()),
                "--model", settings.claude_model,
                # A plain question and answer: no tools, no settings or
                # CLAUDE.md from the server, nothing saved to disk.
                "--tools", "", "--setting-sources", "", "--no-session-persistence",
                # Without these two, the MCP servers and skills of the login
                # ride along in every call: 115k tokens against 1.3k.
                "--strict-mcp-config", "--disable-slash-commands",
                # Replaces the CLI's own long coding-agent prompt.
                "--system-prompt", "Answer with the requested JSON only.",
            ],
            input=prompt, capture_output=True, text=True, timeout=TIMEOUT_S,
        )
    except FileNotFoundError:
        raise RuntimeError("The claude CLI is not installed on the server")
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"Claude did not answer in {TIMEOUT_S}s")
    try:
        answer = json.loads(out.stdout)
    except ValueError:
        answer = None
    if not isinstance(answer, dict):
        answer = {}
    if out.returncode != 0 or answer.get("is_error") or "structured_output" not in answer:
        detail = answer.get("result") or out.stderr or out.stdout
        raise RuntimeError(f"claude CLI failed: {str(detail).strip()[:300]}")
    print(f"[claude-usage] cost=${answer.get('total_cost_usd') or 0:.5f}", flush=True)
    try:
        return schema.model_validate(answer["structured_output"])
    except ValidationError:
        raise RuntimeError("Claude's answer did not fit the schema")
