import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'build'))
from responsive_images import MANIFEST,responsive_markup

class ResponsiveImagesTests(unittest.TestCase):
    def test_candidates_exist_never_enlarge_or_increase_transfer(self):
        for original,entry in MANIFEST.items():
            for candidate in entry['variants']:
                with self.subTest(source=original,candidate=candidate['src']):
                    self.assertLessEqual(candidate['width'],entry['width'])
                    self.assertLessEqual(candidate['bytes'],entry['original_bytes'])
                    self.assertEqual((ROOT/candidate['src'].lstrip('/')).stat().st_size,candidate['bytes'])
            self.assertTrue((ROOT/original.lstrip('/')).exists())
    def test_both_tab_sides_and_small_card_sizes_are_preserved(self):
        before='/resources/before_after/hero_spiderman_before.jpg'
        after='/resources/before_after/hero_spiderman_after.jpg'
        html=responsive_markup(f'<button class="cmp-tab dot" data-before="{before}" data-after="{after}"></button><img src="{after}" width="78" height="98" alt="">')
        self.assertIn('data-before-srcset=',html)
        self.assertIn('data-after-srcset=',html)
        self.assertIn('sizes="78px"',html)
        self.assertIn('104vw',html)
