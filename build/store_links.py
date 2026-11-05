"""Fixed website campaign links; visitor query parameters are never forwarded."""
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl


def store_link(facts, store, campaign):
    base = facts["google_play_url" if store == "googleplay" else "app_store_url"]
    parts = urlsplit(base)
    query = dict(parse_qsl(parts.query))
    if store == "googleplay":
        query["referrer"] = urlencode({"utm_source": "upscales.app", "utm_medium": "website", "utm_campaign": campaign})
    elif facts.get("app_store_provider_token"):
        query.update(pt=str(facts["app_store_provider_token"]), ct=campaign)
    return urlunsplit(parts._replace(query=urlencode(query)))
