import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('taste', Path(__file__).resolve().parents[1] / 'ui-taste-count.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class UITasteReviewTests(unittest.TestCase):
    def test_new_capsule_is_not_covered_by_an_existing_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reviewed = root / 'Voice.swift'
            reviewed.write_text('Capsule()')
            review = {'entries': [{'kind': 'Capsule', 'file': 'Voice.swift', 'count': 1,
                'sha256': hashlib.sha256(reviewed.read_bytes()).hexdigest()}]}
            (root / 'NewCard.swift').write_text('Capsule()')
            self.assertEqual(module.count(root, 'Capsule', r'Capsule\(\)', review), (2, 1))
            reviewed.write_text('Capsule()\nCapsule()')
            with self.assertRaisesRegex(ValueError, 'review expired'):
                module.count(root, 'Capsule', r'Capsule\(\)', review)

    def test_interpolation_source_length_is_not_displayed_prose(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'View.swift').write_text('Text("\\(veryLongIdentifierThatIsNotDisplayedOnScreen.count)")\nText("' + '文' * 40 + '")')
            self.assertEqual(module.count(root, '40字超の文言', r'Text\("[^"\n]{40,}"', {}), (1, 0))

if __name__ == '__main__':
    unittest.main()
