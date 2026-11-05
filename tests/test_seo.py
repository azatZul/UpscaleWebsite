import json
from pathlib import Path
import re
import sys
import unittest
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'build'))
import build as site
from store_links import store_link

class SEOTests(unittest.TestCase):
    def test_errors_are_localized_self_contained_and_noindex(self):
        for lang in site.LOCALIZED_CODES:
            c=site.inject_facts(site.localization_catalog.load_locale(lang),lang)
            html=site.render_not_found(c,lang)
            self.assertIn('noindex,follow',html)
            self.assertIn(c['not_found']['headline'],html)
            self.assertIn('type="range"',html)
            self.assertNotIn('site.js?',html)
            self.assertNotIn('/assets/marketing/',html)
            for src in re.findall(r'(?:src|href)="([^"]+)"',html):
                if not src.startswith('https://'): self.assertTrue(src.startswith('/'),src)
                else: self.assertIn(urlparse(src.replace('&amp;','&')).hostname,['apps.apple.com','play.google.com'])
    def test_article_uses_real_metadata_and_shared_identity(self):
        for lang in site.LOCALIZED_CODES:
            c=site.inject_facts(site.localization_catalog.load_locale(lang),lang)
            slug=site.GUIDE_SLUGS[0]
            html=site.render_guide(c,lang,slug)
            items=[json.loads(t) for t in re.findall(r'<script type="application/ld\+json">(.*?)</script>',html,re.S)]
            article=next(t for t in items if t.get('@type')=='Article')
            self.assertEqual(article['author'],{'@id':site.SITE+'/#organization'})
            self.assertEqual(article['dateModified'],site.updated_for('guides/'+slug))
            self.assertNotIn('datePublished',article)
            crumbs=next(t for t in items if t.get('@type')=='BreadcrumbList')
            self.assertEqual(crumbs['itemListElement'][-1]['name'],c['guide_pages'][slug]['card_title'])
    def test_campaigns_are_fixed_and_provider_token_is_optional(self):
        base={'app_store_url':'https://apps.apple.com/app/id123','google_play_url':'https://play.google.com/store/apps/details?id=com.uscale'}
        self.assertEqual(store_link(base,'appstore','site_home'),base['app_store_url'])
        apple=parse_qs(urlparse(store_link({**base,'app_store_provider_token':'1234'},'appstore','site_guides')).query)
        self.assertEqual(apple,{'pt':['1234'],'ct':['site_guides']})
        google=parse_qs(urlparse(store_link(base,'googleplay','site_home')).query)
        self.assertEqual(parse_qs(google['referrer'][0]),{'utm_source':['upscales.app'],'utm_medium':['website'],'utm_campaign':['site_home']})
