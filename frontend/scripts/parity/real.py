"""real.py <backend dir> <scenario.json> <out.json>: run the scenario against
the real FastAPI app in-process and write every answer to out.json (the app
prints its own log lines to stdout).

It sets up the app the way backend/tests/conftest.py does: a throwaway data
folder, a fresh signed-in user, a stub scanner, Scryfall answering with one
card and the CK price list stubbed, so nothing goes over the network while
the app's own code builds every answer."""

import json
import os
import re
import sys

backend, scenario_path, out_path = (os.path.abspath(a) for a in sys.argv[1:4])
sys.path.insert(0, backend)
os.chdir(backend)

import tests.conftest as c  # noqa: E402  (sets the test environment, then imports the app)
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

main, catalogue, scans = c.main, c.catalogue, c.scans
command.upgrade(Config(str(main.BASE_DIR.parent / "alembic.ini")), "head")
main.settings.make_data_dirs()


SOL_RING = {
    "id": "0d3f4b1c-1111-4222-8333-444455556666", "name": "Sol Ring", "set": "cmm", "set_name": "Commander Masters",
    "collector_number": "1", "rarity": "uncommon", "prices": {"usd": "1.50", "usd_foil": None},
    "image_uris": {"normal": "https://cards.scryfall.io/normal/sol-ring.jpg"}, "scryfall_uri": "https://scryfall.com/card/cmm/1",
}


async def fake_scryfall(session, url, params=None):
    return {"data": [SOL_RING], "has_more": False} if url.endswith("/cards/search") else SOL_RING


async def fake_ck():
    return c._FakeCK()


scans.scanner = c.FakeScanner()
# As the local scanner: it says how it picked the printing.
scans.scanner.cards = [c.sol_ring(version_source="ocr")]
catalogue._get_json = fake_scryfall
catalogue.ck_index = fake_ck
main.limiter.enabled = False
_, headers = c.sign_in()
saved: dict = {}


def fill(v):
    if isinstance(v, str):
        whole = re.fullmatch(r"\{(\w+)\}", v)
        if whole:
            return saved[whole.group(1)]
        return re.sub(r"\{(\w+)\}", lambda m: str(saved[m.group(1)]), v)
    if isinstance(v, list):
        return [fill(x) for x in v]
    if isinstance(v, dict):
        return {k: fill(x) for k, x in v.items()}
    return v


def pick(body, path):
    for part in path.split("."):
        body = body[int(part)] if isinstance(body, list) else body[part]
    return body


out = []
with TestClient(main.app) as client:
    for step in json.load(open(scenario_path)):
        kw = {"headers": headers}
        if "json" in step:
            kw["json"] = fill(step["json"])
        if "form" in step:
            kw["data"] = fill(step["form"])
        if step.get("image"):
            kw["files"] = {"image": ("a.jpg", c._photo(), "image/jpeg")}
        r = client.request(step["method"], fill(step["path"]), **kw)
        body = r.json() if r.content and "json" in r.headers.get("content-type", "") else None
        for name, path in step.get("save", {}).items():
            saved[name] = pick(body, path)
        out.append({"name": step["name"], "status": r.status_code, "body": body})

with open(out_path, "w") as f:
    json.dump(out, f)
