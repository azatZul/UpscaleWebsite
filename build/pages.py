"""
Standalone English pages that keep their historical URLs:

    /support_page.html   /terms.html   /privacy_policy.html   /sale.html

Only the markup lives here — head/nav/footer and the design system come from build.py,
so these pages look and behave exactly like the rest of upscales.app.
"""

EMAIL_LEGAL = "alexandr.graschenkov91@gmail.com"
EMAIL_HELP = EMAIL_LEGAL
X_HANDLE = "https://x.com/sharrikk"

# Support
SUPPORT = dict(
    file="support_page.html",
    eyebrow="Support",
    h1="UScale help & support",
    lead="Answers to the questions we get most, plus a direct line to the developer. "
         "We usually reply within one business day.",
    title="UScale Support — Help with the AI Photo Enhancer app",
    description="Get help with UScale, the on-device AI photo and video enhancer for iPhone and iPad. "
                "FAQ, troubleshooting and direct contact with the developer.",
    body=f"""
<div class="contact-card">
  <img class="me" src="/resources/alex_avatar.jpg" width="78" height="78" alt="Alex, the developer of UScale">
  <div class="contact-who">
    <b>Alex</b>
    <span>Developer of UScale — every message lands with me, not a helpdesk.</span>
    <span class="mailrow">
      <a href="mailto:{EMAIL_HELP}">{EMAIL_HELP}</a>
      <button class="copy" type="button" data-copy="{EMAIL_HELP}" aria-label="Copy email address" title="Copy email address">
        <svg class="i-copy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2.4"/><path d="M5.5 15H4.4A1.4 1.4 0 0 1 3 13.6V4.4A1.4 1.4 0 0 1 4.4 3h9.2A1.4 1.4 0 0 1 15 4.4v1.1"/>
        </svg>
        <svg class="i-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>
        <span class="copy-t"></span>
      </button>
    </span>
  </div>
  <div class="contact-row">
    <a class="btn btn-p" href="mailto:{EMAIL_HELP}">Email support</a>
    <a class="btn btn-g" href="{X_HANDLE}" target="_blank" rel="noopener">Message on X</a>
  </div>
</div>
<p style="font-size:14.5px;color:var(--tx-3)">Writing about a specific result? Attach the original file and the
enhanced one — it makes the fix much faster.</p>

<h2>Frequently asked</h2>
<div class="faq" style="margin-top:18px">
  <details open><summary>What does UScale actually do?</summary><div class="a">
    <p>UScale runs AI enhancement models on your iPhone or iPad. It unblurs and sharpens photos, upscales them
    2x or 4x, restores faces in old scans, colorises black-and-white pictures, improves video quality and
    generates smooth slow motion. The core processing happens on the device — your files are not uploaded
    to a server.</p></div></details>

  <details><summary>How do I enhance a photo?</summary><div class="a">
    <p>Open the app, tap the photo you want to fix, pick a tool (Enhance, Upscale, Face restore or Colorize),
    wait for the preview and save. There are no layers, masks or sliders to learn.</p>
    <p style="margin-top:12px"><a href="/guides/unblur-photo-iphone.html">Step-by-step guide →</a></p></div></details>

  <details><summary>Are my photos uploaded anywhere?</summary><div class="a">
    <p>No. Photo and video enhancement runs locally on your device, so your library never leaves your phone
    for processing. The app does use third-party services for analytics, ads and subscription management —
    those are listed in the <a href="/privacy_policy.html">Privacy Policy</a>.</p></div></details>

  <details><summary>Which devices and iOS versions are supported?</summary><div class="a">
    <p>iPhone, iPad and iPod touch running iOS {{minimum_ios}} or later. Newer chips finish a 4x upscale noticeably faster,
    but the same tools are available on every supported device.</p></div></details>

  <details><summary>Processing is slow or the app heats up. Is that normal?</summary><div class="a">
    <p>Enhancement is a heavy computation and it runs on the Neural Engine, so some warmth is expected.
    If a job is unusually slow: close other apps, keep the app in the foreground, disable Low Power Mode,
    and try 2x before 4x on very large source files.</p></div></details>

  <details><summary>The result looks over-smoothed or a face looks wrong.</summary><div class="a">
    <p>Face restoration is trained on photographic faces. On a heavily compressed source, a drawing or a
    non-human subject it can push details too far. Re-run the same file with plain Enhance or with 2x
    instead of 4x, and always start from the largest original you have rather than a screenshot.</p></div></details>

  <details><summary>How much does Premium cost?</summary><div class="a">
    <p>The app is free for {{free_photos_per_day}} photo enhancements a day. Premium is {{annual_price}} a year and starts with a {{trial_days}}-day free
    trial with everything unlocked. Prices vary slightly by region — the App Store shows the exact amount in
    your currency before you confirm.</p></div></details>

  <details><summary>I paid but Premium is not active.</summary><div class="a">
    <p>Open the app and use <strong>Restore purchases</strong> in Settings while signed in with the Apple ID
    that made the purchase. If it still does not unlock, email <a href="mailto:{EMAIL_HELP}">{EMAIL_HELP}</a>
    with your App Store receipt and we will sort it out.</p></div></details>

  <details><summary>How do I manage or cancel a subscription?</summary><div class="a">
    <p>Subscriptions are handled by Apple. On your device open <strong>Settings → your name → Subscriptions</strong>,
    select UScale and change or cancel it there, or manage everything on
    <a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener">apple.com</a>.
    Refunds are requested through
    <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener">reportaproblem.apple.com</a>.</p></div></details>

  <details><summary>Can I use enhanced photos commercially?</summary><div class="a">
    <p>You keep the rights to your own files and to the results you create from them. The
    <a href="/terms.html">Terms of Use</a> cover how the app itself may be used.</p></div></details>
</div>

<h2>Reporting a bug</h2>
<p>Send us an email with these four things and the fix usually lands in the next release:</p>
<ul>
  <li>Device model and iOS version (Settings → General → About)</li>
  <li>App version (shown at the bottom of the app's Settings screen)</li>
  <li>What you tapped, and what happened instead</li>
  <li>The original file, if the problem is about a specific result</li>
</ul>

<div class="inline-cta">
  <img src="/resources/appstore/icon_512.png" width="66" height="66" loading="lazy" alt="UScale app icon">
  <div>
    <h3>Still stuck?</h3>
    <p>Write to <a href="mailto:{EMAIL_HELP}">{EMAIL_HELP}</a> — the developer answers personally.</p>
  </div>
  <a class="btn btn-p" href="/guides/">Browse the guides</a>
</div>
""",
)

# Terms
TERMS = dict(
    file="terms.html",
    eyebrow="Legal",
    h1="Terms of Use",
    lead="The rules that apply when you download and use the UScale iOS app.",
    title="Terms of Use — UScale",
    description="Terms of Use for the UScale iOS app: licence, in-app purchases, third-party services, "
                "user content, disclaimers and contact details.",
    sections=True,
    body=f"""
<h2>Introduction</h2>
<p>Welcome to UScale (referred to as “UScale”, “we”, or “us”). These Terms of Use govern your use of our iOS
application (the “App”). By downloading, accessing, or using the App, you agree to comply with these Terms.
If you do not agree to these Terms, please do not use the App.</p>

<h2>Eligibility</h2>
<p>By using the App, you confirm that you are at least 16 years old or have parental or guardian consent to use
the App. You are responsible for ensuring that your use of the App complies with all applicable laws and
regulations.</p>

<h2>Licence to use the App</h2>
<p>UScale grants you a limited, non-exclusive, non-transferable, and revocable licence to use the App for
personal, non-commercial purposes. You agree not to:</p>
<ul>
  <li>Modify, copy, distribute, or create derivative works of the App.</li>
  <li>Reverse-engineer or decompile the App, except as permitted by applicable law.</li>
  <li>Use the App in any manner that could interfere with its operation or disrupt other users.</li>
</ul>

<h2>In-app purchases</h2>
<p>The App may include in-app purchases managed through RevenueCat. By making a purchase, you agree to the
pricing, payment, and subscription terms provided at the point of sale. All purchases are final and
non-refundable, except as required by applicable law.</p>

<h2>Third-party services and advertising</h2>
<p>The App is provided as an ad-supported service and uses various third-party services for functionality and
advertising. Your use of these services is subject to their respective terms and policies:</p>
<ul>
  <li><a href="https://amplitude.com/terms" target="_blank" rel="noopener">Amplitude Terms of Service</a></li>
  <li><a href="https://www.revenuecat.com/terms" target="_blank" rel="noopener">RevenueCat Terms of Use</a></li>
  <li><a href="https://firebase.google.com/terms" target="_blank" rel="noopener">Firebase Terms of Service</a></li>
  <li><a href="https://developers.google.com/admob/terms" target="_blank" rel="noopener">AdMob Terms of Service</a></li>
  <li><a href="https://www.appodeal.com/home/terms-of-service/" target="_blank" rel="noopener">Appodeal Terms of Service</a></li>
  <li><a href="https://unity3d.com/legal/terms-of-service" target="_blank" rel="noopener">Unity Terms of Service</a></li>
</ul>
<p>Please be aware that the Service Provider does not assume responsibility for certain aspects. Some functions
of the Application require an active internet connection, which can be Wi-Fi or provided by your mobile network
provider. The Service Provider cannot be held responsible if the Application does not function at full capacity
due to lack of access to Wi-Fi or if you have exhausted your data allowance.</p>

<h2>App updates and availability</h2>
<p>We may update the App from time to time to improve functionality, fix bugs, or comply with operating system
changes. You agree to install these updates to continue using the App. While we strive to maintain
compatibility, we cannot guarantee the App will always be compatible with all operating system versions.</p>

<h2>User content</h2>
<p>You retain ownership of any content you upload, create, or process using the App. However, you agree that you
will not upload, share, or process any content that:</p>
<ul>
  <li>Violates any laws or regulations.</li>
  <li>Contains offensive, harmful, or inappropriate material.</li>
  <li>Infringes on the rights of others, including intellectual property rights.</li>
</ul>

<h2>Disclaimers</h2>
<p>The App is provided “as is” without warranties of any kind, either express or implied. UScale disclaims all
warranties, including but not limited to merchantability, fitness for a particular purpose, and
non-infringement. We do not guarantee that the App will be error-free, uninterrupted, or free from security
vulnerabilities.</p>

<h2>Limitation of liability</h2>
<p>To the maximum extent permitted by law, UScale shall not be liable for any damages arising from your use of
the App, including but not limited to indirect, incidental, consequential, or punitive damages, even if advised
of the possibility of such damages.</p>

<h2>Changes to these Terms</h2>
<p>UScale reserves the right to modify these Terms at any time. Any changes will be effective upon posting the
updated Terms in the App. Your continued use of the App after such changes constitutes your acceptance of the
new Terms.</p>

<h2>Governing law</h2>
<p>These Terms are governed by and construed in accordance with the laws of your jurisdiction. Any disputes
arising from or relating to these Terms shall be resolved exclusively in the courts of your jurisdiction.</p>

<h2>Contact us</h2>
<p>If you have any questions or concerns about these Terms, please contact us at
<a href="mailto:{EMAIL_LEGAL}">{EMAIL_LEGAL}</a>.</p>
""",
)

# Privacy
PRIVACY = dict(
    file="privacy_policy.html",
    eyebrow="Legal",
    h1="Privacy Policy",
    lead="What the UScale app collects, what it never collects, and who we share data with.",
    title="Privacy Policy — UScale",
    description="How UScale handles your data: photos and videos are processed on your device, plus the "
                "analytics, advertising and subscription services the app uses.",
    sections=True,
    body=f"""
<h2>Introduction</h2>
<p>UScale (hereinafter referred to as “UScale”, “we”, or “us”) values your privacy and is committed to
protecting it. This Privacy Policy outlines how we handle your information when you use our app. Please read
this policy carefully to understand our practices.</p>

<h2>Scope</h2>
<p>This Privacy Policy applies to the UScale iOS application. By using the app, you agree to the terms outlined
here. We may update this policy from time to time, so we encourage you to review it periodically for any
changes.</p>

<h2>Your photos and videos</h2>
<div class="answer"><p>Photo and video enhancement runs on your device. Your media is not uploaded to our
servers for processing, and we never collect, store or share the content of your library.</p></div>
<p>The app asks for access to your photo library only so that you can pick a file to enhance and save the
result back. You can review or revoke that access at any time in <strong>Settings → Privacy &amp; Security →
Photos</strong> on your device.</p>

<h2>Personal data we collect</h2>
<p>We collect certain data to provide and improve the app's functionality, including:</p>
<ul>
  <li>Usage data, such as app interactions, crash reports, and device information.</li>
  <li>In-app purchase data via RevenueCat to manage subscriptions and transactions.</li>
</ul>
<p>This data helps us enhance app performance, track usage trends, and resolve technical issues.</p>

<h2>Third-party services</h2>
<p>We integrate with third-party services to provide app functionality, analytics, and advertising. These
services may collect data as outlined below:</p>
<ul>
  <li><strong>Amplitude:</strong> for app usage analytics, tracking interactions to improve features and user
    experience. See <a href="https://amplitude.com/privacy" target="_blank" rel="noopener">Amplitude's Privacy Policy</a>.</li>
  <li><strong>RevenueCat:</strong> to manage subscriptions and in-app purchases. See
    <a href="https://www.revenuecat.com/privacy" target="_blank" rel="noopener">RevenueCat's Privacy Policy</a>.</li>
  <li><strong>Google Firebase:</strong> for app performance monitoring, analytics, and crash reporting. See
    <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noopener">Firebase's Privacy Policy</a>.</li>
  <li><strong>AdMob:</strong> for serving advertisements. See
    <a href="https://support.google.com/admob/answer/6128543?hl=en" target="_blank" rel="noopener">AdMob's Privacy Policy</a>.</li>
  <li><strong>Appodeal:</strong> for advertisement management. See
    <a href="https://www.appodeal.com/home/privacy-policy/" target="_blank" rel="noopener">Appodeal's Privacy Policy</a>.</li>
  <li><strong>Unity:</strong> for advertisement services. See
    <a href="https://unity3d.com/legal/privacy-policy" target="_blank" rel="noopener">Unity's Privacy Policy</a>.</li>
  <li><strong>Vungle:</strong> for advertisement services. See
    <a href="https://vungle.com/privacy/" target="_blank" rel="noopener">Vungle's Privacy Policy</a>.</li>
</ul>
<p>These services may collect information such as:</p>
<ul>
  <li>Device type, operating system, and app version</li>
  <li>Your device's Internet Protocol address (IP address)</li>
  <li>The screens of the Application that you visit, the time and date of your visit, and time spent on them</li>
  <li>Advertising ID</li>
  <li>Other non-identifiable data</li>
</ul>
<p>We may disclose user-provided and automatically collected information:</p>
<ul>
  <li>As required by law, such as to comply with a subpoena or similar legal process</li>
  <li>When we believe in good faith that disclosure is necessary to protect our rights, protect your safety or
    the safety of others, investigate fraud, or respond to a government request</li>
  <li>With our trusted service providers who work on our behalf, do not have an independent use of the
    information we disclose to them, and have agreed to adhere to the rules set forth in this privacy statement</li>
</ul>

<h2>Children's privacy</h2>
<p>UScale is not intended for children under the age of 16. We do not knowingly collect any personal information
from children. If you believe a child has provided us with personal information, please contact us at
<a href="mailto:{EMAIL_LEGAL}">{EMAIL_LEGAL}</a> so we can take appropriate action.</p>

<h2>Security</h2>
<p>We take reasonable steps to protect your data from unauthorised access or disclosure. However, no method of
transmission over the internet or electronic storage is completely secure. We recommend you use the app in a
secure environment.</p>

<h2>Your rights</h2>
<p>Depending on your jurisdiction, you may have rights to access, modify, or delete your data. To exercise these
rights, please contact us at <a href="mailto:{EMAIL_LEGAL}">{EMAIL_LEGAL}</a>.</p>

<h2>Opt-out rights</h2>
<p>You can stop all collection of information by the Application by uninstalling it. You may use the standard
uninstall processes available as part of your mobile device or via the mobile application marketplace or
network.</p>

<h2>Changes to this policy</h2>
<p>We may update this Privacy Policy periodically. Any updates will be reflected in this document, and we
recommend reviewing it regularly to stay informed of changes.</p>

<h2>Contact us</h2>
<p>If you have any questions about this Privacy Policy or the app, please contact us at
<a href="mailto:{EMAIL_LEGAL}">{EMAIL_LEGAL}</a>.</p>
""",
)

DOCS = [SUPPORT, TERMS, PRIVACY]
