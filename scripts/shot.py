#!/usr/bin/env python3
"""Screenshot a running web page using Playwright driving the system Chrome.

Captures the viewport (above-the-fold hero) by default, which is what we want
for product thumbnails. Use --full for a full-page capture.

Usage:
    python3 scripts/shot.py <url> <out.png> [--w 1440 --h 900 --wait 3500]
                                            [--selector "#x"] [--full]
"""
import argparse
import sys

from playwright.sync_api import sync_playwright


def main() -> None:
    ap = argparse.ArgumentParser(description="Screenshot a web page via Chrome.")
    ap.add_argument("url")
    ap.add_argument("out")
    ap.add_argument("--w", type=int, default=1440)
    ap.add_argument("--h", type=int, default=900)
    ap.add_argument("--wait", type=int, default=3500, help="ms to wait after load")
    ap.add_argument("--selector", help="wait for this selector before shooting")
    ap.add_argument("--full", action="store_true", help="full-page screenshot")
    args = ap.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            headless=True,
            args=[
                "--autoplay-policy=no-user-gesture-required",
                "--mute-audio",
            ],
        )
        page = browser.new_page(
            viewport={"width": args.w, "height": args.h},
            device_scale_factor=2,
        )
        try:
            page.goto(args.url, wait_until="networkidle", timeout=45000)
        except Exception as e:  # networkidle can time out on long-polling apps
            print(f"  (load note: {e}); continuing", file=sys.stderr)
        if args.selector:
            try:
                page.wait_for_selector(args.selector, timeout=15000)
            except Exception as e:
                print(f"  (selector note: {e})", file=sys.stderr)
        page.wait_for_timeout(args.wait)
        page.screenshot(path=args.out, full_page=args.full)
        browser.close()
    print(f"✓ shot {args.url} -> {args.out}")


if __name__ == "__main__":
    main()
