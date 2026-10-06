"""
One-off scraper: builds data/item-lookup.json from Costco.com's public
product pages. Run manually (python scripts/scrape_costco_items.py), not
at app runtime - see CLAUDE.md.

Costco's warehouse item numbers often differ from online-only SKUs, and a
lot of what's on a receipt (produce, meat, deli, rotisserie chicken) is
warehouse-exclusive and never listed on costco.com at all, so this is a
best-effort seed, not a complete catalog - the app's "Look it up" linkout
and manual edit are the real fallback for everything this misses.

Scope, deliberately narrow:
- Only touches static sitemap XML and plain product detail pages
  (*.product.<id>.html). Costco's category/search browsing is a client-
  rendered app behind Kasada bot-mitigation (confirmed by inspecting
  network requests in a real browser) - this script never touches that.
- Checks robots.txt before fetching each URL.
- Filters the full product sitemap down to grocery/household-sounding
  slugs via a keyword list (crude, but avoids crawling tens of thousands
  of furniture/electronics/jewelry products that never show up on a
  warehouse receipt).
- Rate-limited, capped at --limit product pages for a single run.
"""
import argparse
import html
import json
import re
import time
import urllib.robotparser
from pathlib import Path

import requests

BASE = "https://www.costco.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
HEADERS = {"User-Agent": USER_AGENT}

SITEMAPS = [
    "/sitemap_lw_p_001.xml",
    "/sitemap_lw_p_mod_001.xml",
]

GROCERY_KEYWORDS = [
    "kirkland", "organic", "snack", "cookie", "cracker", "chip", "soda",
    "water", "juice", "coffee", "tea", "cereal", "pasta", "sauce", "oil",
    "sugar", "flour", "rice", "bean", "nut", "fruit", "vegetable",
    "chicken", "beef", "pork", "salmon", "shrimp", "cheese", "milk",
    "yogurt", "egg", "bread", "bagel", "muffin", "paper-towel", "tissue",
    "detergent", "soap", "shampoo", "toothpaste", "vitamin", "supplement",
    "diaper", "wipes", "candy", "chocolate", "granola", "pretzel",
    "popcorn", "ketchup", "mustard", "mayo", "syrup", "honey", "jam",
    "peanut-butter", "spice", "seasoning", "tide", "charmin", "bounty",
    "kleenex", "clorox", "lysol", "dawn", "soup", "broth", "spring-water",
    "almond", "walnut", "cashew", "trail-mix", "protein-bar", "oatmeal",
]

ITEM_NUMBER_RE = re.compile(r'data-testid="Text_item-number">Item\s+(\d{4,8})')
OG_TITLE_RE = re.compile(r'<meta property="og:title" content="([^"]+)"')


def fetch_sitemap_urls(session, rp):
    urls = []
    for path in SITEMAPS:
        url = BASE + path
        if not rp.can_fetch(USER_AGENT, url):
            print(f"skip (robots.txt): {url}")
            continue
        resp = session.get(url, timeout=20)
        if resp.status_code != 200:
            print(f"sitemap fetch failed ({resp.status_code}): {url}")
            continue
        urls.extend(re.findall(r"<loc>(.*?)</loc>", resp.text))
        time.sleep(1)
    return urls


def filter_grocery_urls(urls):
    matched = []
    for u in urls:
        lower = u.lower()
        if ".product." not in lower:
            continue
        if any(kw in lower for kw in GROCERY_KEYWORDS):
            matched.append(u)
    return matched


def scrape_product(session, rp, url):
    if not rp.can_fetch(USER_AGENT, url):
        return None
    try:
        resp = session.get(url, timeout=20)
    except requests.RequestException as e:
        print(f"  error fetching {url}: {e}")
        return None
    if resp.status_code != 200:
        return None
    text = resp.text
    item_match = ITEM_NUMBER_RE.search(text)
    title_match = OG_TITLE_RE.search(text)
    if not item_match or not title_match:
        return None
    return item_match.group(1), html.unescape(title_match.group(1))


def tokenize(name):
    cleaned = re.sub(r"[^a-z0-9\s]", " ", name.lower())
    return [t for t in cleaned.split() if len(t) > 1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=250, help="max product pages to fetch")
    parser.add_argument("--delay", type=float, default=1.5, help="seconds between requests")
    args = parser.parse_args()

    out_path = Path(__file__).resolve().parent.parent / "data" / "item-lookup.json"

    session = requests.Session()
    session.headers.update(HEADERS)

    # RobotFileParser.read() uses urllib directly, which doesn't have a
    # working cert bundle in this environment - fetch via requests (which
    # bundles certifi) and feed it the text instead.
    rp = urllib.robotparser.RobotFileParser()
    robots_resp = session.get(BASE + "/robots.txt", timeout=20)
    rp.parse(robots_resp.text.splitlines())

    print("Fetching product sitemaps...")
    all_urls = fetch_sitemap_urls(session, rp)
    print(f"  {len(all_urls)} total product URLs in sitemap(s)")

    candidates = filter_grocery_urls(all_urls)
    print(f"  {len(candidates)} look grocery/household-relevant by slug keyword")

    candidates = candidates[: args.limit]
    print(f"Scraping {len(candidates)} product pages (limit={args.limit})...")

    items = {}
    text_index = []
    ok = 0
    for i, url in enumerate(candidates, 1):
        result = scrape_product(session, rp, url)
        if result:
            code, name = result
            items[code] = {"name": name}
            text_index.append({"code": code, "tokens": tokenize(name)})
            ok += 1
        if i % 20 == 0:
            print(f"  {i}/{len(candidates)} fetched, {ok} matched so far")
        time.sleep(args.delay)

    print(f"Done: {ok}/{len(candidates)} product pages yielded an item number + name")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(
            {
                "generatedAt": time.strftime("%Y-%m-%d"),
                "items": items,
                "textIndex": text_index,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {out_path} ({len(items)} items)")


if __name__ == "__main__":
    main()
