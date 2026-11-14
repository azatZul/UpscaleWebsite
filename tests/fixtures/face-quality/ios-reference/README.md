# Frozen iOS reference

`manifest.json` pins the iOS quality-gate snapshot this port was checked against:
repository revisions, model hashes, private sample/Float32 hashes, and the SHA-256
of the then-uncommitted iOS sources (`iosSources`, keyed by path in the iOS
repository; check with `shasum -a 256 <path>` there). The Swift sources stay in
the iOS repository and are not copied here. `policy.json` and `expected.json`
(26 reference assessments) are the only files the tests read; their hashes are in
`files`. Photos and large arrays are deliberately excluded.

Run `node scripts/check_face_quality_parity.mjs /path/to/face-quality-lab-v2/swift-verification`
to verify the private arrays against the frozen Swift results. Ordinary Node tests
check reference hashes, decisions, synthetic texture and threshold behavior without
access to those photos.

The product policy `face-guard-v1-web-pixel` uses the same pixel metrics and thresholds,
but does not require or inspect landmark displacement. Its `pass` does not establish
identity preservation or verified improvement. Existing web pose/size admission and
eye centers are separate from this policy.
