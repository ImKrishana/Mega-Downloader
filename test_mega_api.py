#!/usr/bin/env python3
"""End-to-end test for the Mega Downloader API.

Usage:
    python3 test_mega_api.py

The script creates one job for the folder link and one for the file link,
prints each job_id, polls the status endpoint, and prints a final summary.
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_BASE = "https://thezakemegaapi.vercel.app".rstrip("/")
POLL_SECONDS = 3
MAX_POLLS = 40
REQUEST_TIMEOUT = 60
TERMINAL_STATES = {"completed", "partial", "failed", "expired"}

LINKS = {
    "folder": "https://mega.nz/folder/XSRzmRJY#oxazK3KhK0RPge4_xt7Fhg",
    "file": "https://mega.nz/file/sSEVyBzI#Ms1LeokrYqv5u9GXfBVm8d9igqe8TXwJKeqlHe0YZ6o",
}


@dataclass
class ApiResponse:
    http_status: int | None
    body: dict[str, Any]
    error: str | None = None


def call_api(path: str, params: dict[str, str]) -> ApiResponse:
    url = f"{API_BASE}{path}?{urlencode(params)}"
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "mega-api-test/1.0",
        },
    )

    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            raw = response.read().decode("utf-8", errors="replace")
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                body = {"raw_response": raw}
            return ApiResponse(response.status, body)
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"raw_response": raw}
        return ApiResponse(exc.code, body, f"HTTP {exc.code}")
    except (URLError, TimeoutError, OSError) as exc:
        return ApiResponse(None, {}, f"{type(exc).__name__}: {exc}")


def compact_result(response: ApiResponse) -> dict[str, Any]:
    body = response.body
    files = body.get("files") or []
    return {
        "http_status": response.http_status,
        "error": response.error,
        "job_id": body.get("job_id"),
        "state": body.get("state"),
        "name": body.get("name"),
        "total_files": body.get("total_files"),
        "completed_files": body.get("completed_files"),
        "failed_files": body.get("failed_files"),
        "total_size": body.get("total_size"),
        "has_zip_url": bool(body.get("zip_url")),
        "returned_files": len(files) if isinstance(files, list) else 0,
        "download_urls": (
            sum(bool(item.get("download_url")) for item in files if isinstance(item, dict))
            if isinstance(files, list)
            else 0
        ),
    }


def print_json(label: str, value: Any) -> None:
    print(f"{label}: {json.dumps(value, ensure_ascii=False, indent=2)}")


def test_link(label: str, mega_url: str) -> dict[str, Any]:
    print(f"\n{'=' * 72}\nTEST: {label.upper()}\nMEGA URL: {mega_url}\n{'=' * 72}")

    created = call_api("/api/mega", {"url": mega_url})
    print_json("CREATE", compact_result(created))

    job_id = created.body.get("job_id")
    if not job_id:
        print_json("CREATE_BODY", created.body)
        return {"label": label, "create": created.body, "final": None}

    last = created
    for poll_number in range(1, MAX_POLLS + 1):
        state = last.body.get("state")
        if state in TERMINAL_STATES:
            break

        time.sleep(POLL_SECONDS)
        last = call_api("/api/mega/status", {"id": str(job_id)})
        summary = compact_result(last)
        summary["poll"] = poll_number
        print_json("POLL", summary)

        if last.body.get("state") in TERMINAL_STATES:
            break
    else:
        print(f"Polling stopped after {MAX_POLLS} attempts.")

    print_json("FINAL", compact_result(last))
    print_json("FINAL_BODY", last.body)
    return {"label": label, "job_id": job_id, "final": last.body}


def main() -> int:
    print(f"API_BASE: {API_BASE}")
    print(f"POLL_SECONDS: {POLL_SECONDS}, MAX_POLLS: {MAX_POLLS}")

    results = [test_link(label, url) for label, url in LINKS.items()]

    print(f"\n{'=' * 72}\nCOPY THIS RESPONSE\n{'=' * 72}")
    print_json(
        "RESULT_SUMMARY",
        [
            {
                "label": result["label"],
                "job_id": result.get("job_id"),
                "state": (result.get("final") or {}).get("state"),
                "total_files": (result.get("final") or {}).get("total_files"),
                "completed_files": (result.get("final") or {}).get("completed_files"),
                "failed_files": (result.get("final") or {}).get("failed_files"),
            }
            for result in results
        ],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
