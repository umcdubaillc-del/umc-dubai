#!/usr/bin/env python3
import json, pathlib
HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE / "site"

# ---------- responsive-image pipeline ----------
# STANDING RULE: every interior image emits a srcset with small variants so the
# browser does a gentle downscale instead of a brutal 5x reduction into a small
# cell. The build generates the 360w + 720w variants on demand (LANCZOS, high-
# quality JPEG/WebP). Future cars' interior images get this automatically, no
# per-page wiring needed. (Diagnosed live: 1280->249 single-step crush is what
# was causing the blocky mottling in dark/shadow areas on the V Class details.)
_INT_VARIANT_WIDTHS = (360, 720, 1080)
_RESP_CACHE = {}

def _compute_fleet_v():
    """Per-deploy content hash of every file under site/assets/fleet/. Used as
    a ?v= query suffix on every fleet image URL so swapped images defeat
    browser + Cloudflare edge caches even when the filename is unchanged."""
    import hashlib, pathlib
    h = hashlib.md5()
    base = pathlib.Path(__file__).resolve().parent / "site" / "assets" / "fleet"
    if not base.exists(): return "0"
    for p in sorted(base.rglob("*")):
        if not p.is_file(): continue
        h.update(str(p.relative_to(base)).encode())
        h.update(b"\0")
        h.update(p.read_bytes())
    return h.hexdigest()[:10]
FV = _compute_fleet_v()
def ensure_image_variants(src_path):
    """Generate 360w + 720w variants if missing. Return [(w, name), ...].

    v50: alpha-aware. Previously called .convert('RGB') unconditionally and
    then wrote a JPEG into the source's file extension (so PNG sources became
    JPEG bytes with a .png suffix, and the alpha-zero areas of a transparent
    source baked out to whatever RGB happened to be at those pixels, often
    (0,0,0) -> visible BLACK BACKGROUND on the rendered card). Now:
      - PNG source  -> PNG variant, alpha preserved
      - WebP source -> WebP variant, alpha preserved
      - JPEG source -> JPEG variant, alpha flattened onto WHITE (not black);
                       white multiplies down to the card's bone tone via the
                       existing .vcard .vimg img mix-blend-mode:multiply rule,
                       so JPEG cards visually match the transparent ones.
    """
    src = pathlib.Path(src_path)
    if not src.exists(): return []
    key = str(src)
    if key in _RESP_CACHE: return _RESP_CACHE[key]
    try:
        from PIL import Image
    except ImportError:
        _RESP_CACHE[key] = []
        return []
    src_img = None
    out = []
    nat_w = None
    ext = src.suffix.lower()
    for tw in _INT_VARIANT_WIDTHS:
        var = src.with_name(f'{src.stem}-{tw}{src.suffix}')
        if not var.exists():
            if src_img is None:
                src_img = Image.open(src)
                nat_w = src_img.size[0]
            if tw >= src_img.size[0]: continue
            th = round(src_img.size[1] * tw / src_img.size[0])
            small = src_img.resize((tw, th), Image.LANCZOS)
            if ext == '.webp':
                small.save(var, 'webp', quality=88)
            elif ext == '.png':
                small.save(var, 'png', optimize=True)
            else:
                if small.mode in ('RGBA', 'LA'):
                    bg = Image.new('RGB', small.size, (255, 255, 255))
                    mask = small.split()[-1] if small.mode == 'RGBA' else None
                    bg.paste(small, mask=mask)
                    small = bg
                elif small.mode != 'RGB':
                    small = small.convert('RGB')
                small.save(var, 'jpeg', quality=86, optimize=True, progressive=True)
        out.append((tw, var.name))
    if nat_w is None:
        nat_w = Image.open(src).size[0]
    _RESP_CACHE[key] = (out, nat_w)
    return _RESP_CACHE[key]

def responsive_img(rel_path, css_class, alt, sizes_attr, loading="lazy", extra_attrs=""):
    """Emit an <img> with srcset for an interior image. rel_path is relative to
    site/assets/fleet/. Falls back to a plain <img> if PIL is unavailable or the
    file is missing. Every fleet image URL carries ?v={FV} so a swapped image
    file under the same filename defeats browser + Cloudflare edge caches."""
    abs_src = SITE / 'assets' / 'fleet' / rel_path
    result = ensure_image_variants(abs_src)
    # Root-absolute so srcset works from any page depth (e.g. /airport-transfers/dubai).
    plain_src = f'/assets/fleet/{rel_path}?v={FV}'
    if not result:
        return f'<img class="{css_class}" src="{plain_src}" alt="{alt}" loading="{loading}"{extra_attrs}>'
    variants, nat_w = result
    parent = pathlib.Path(rel_path).parent
    stem = pathlib.Path(rel_path).stem
    ext = pathlib.Path(rel_path).suffix
    parts = [f'/assets/fleet/{parent}/{stem}-{w}{ext}?v={FV} {w}w' for w, _ in variants]
    parts.append(f'{plain_src} {nat_w}w')
    return (f'<img class="{css_class}" '
            f'srcset="{", ".join(parts)}" '
            f'sizes="{sizes_attr}" '
            f'src="{plain_src}" alt="{alt}" loading="{loading}"{extra_attrs}>')
WA = "https://api.whatsapp.com/send?phone=971586497861&text=Hello%2C%20I%20would%20like%20to%20reserve%20a%20car%20with%20UMC%20Dubai."
MAPS_KEY = "AIzaSyBx8uKzaCk5fFG8a0D8zqW82HLwOsb7px0"
def _compute_v():
    """Cache-bust string derived from the actual content of the asset files
    HTML pages reference. Changes only when one of those files changes, so
    git diffs stay clean across asset-free commits but every CSS/JS edit
    forces the browser off any cached copy. Previously V was a hard-coded
    string, which meant style.css edits never reached visitors who had the
    file cached under the same ?v= URL (root cause of v50's "rule looks
    empty in DevTools",the browser was serving stale CSS)."""
    import hashlib, pathlib
    h = hashlib.md5()
    for rel in ("assets/style.css","assets/s-class.css","assets/main.js",
                "assets/booking.js","assets/fleet-data.js",
                "assets/vendor/flatpickr.min.css","assets/vendor/flatpickr.min.js"):
        p = SITE / rel
        if p.exists(): h.update(p.read_bytes())
    return h.hexdigest()[:10]
V = _compute_v()
OG_BASE = "https://umc-dubai.umcdubaillc.workers.dev"  # flip to https://umcdubai.ae at production cutover (the dead pages.dev was 404ing previews)
GTM_ID = "GTM-PNM6MRS7"
GTM_HEAD = ("<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});"
 "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;"
 "j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" + GTM_ID + "');</script>\n<!-- End Google Tag Manager -->")
PAY = json.load(open(HERE / "payicons.json"))
def paysvg(k):
    i = PAY[k]
    return '<svg role="img" aria-label="' + i["title"] + '" viewBox="0 0 24 24" fill="' + i["hex"] + '"><path d="' + i["path"] + '"/></svg>'
PAYLINE = ('<div class="payline">' + paysvg("visa") + paysvg("mastercard") + paysvg("amex") + paysvg("applepay") + paysvg("googlepay")
 + '<span class="paywrap">'
   '<button type="button" class="payplus" aria-expanded="false" aria-controls="paypop" aria-describedby="paypop" aria-label="Other accepted payment methods">+</button>'
   '<span class="paypop" id="paypop" role="tooltip">'
   'Beyond cards, we also accept bank transfer and secure payment links, in AED and major currencies. A payment link or invoice can be issued on request.'
   '</span>'
 '</span>'
 '</div>')
GTM_BODY = ('<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=' + GTM_ID + '" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>')

def head(title, desc, canon, extra=""):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="https://umcdubai.ae/{canon}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="UMC Dubai">
<meta property="og:locale" content="en_GB">
<meta property="og:url" content="https://umcdubai.ae/{canon}">
<meta property="og:image" content="{OG_BASE}/assets/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{OG_BASE}/assets/og-image.png">
<meta name="msvalidate.01" content="1848923491E08E0A57EBF89D946D8B19">
<meta name="facebook-domain-verification" content="sx2v5hd4o6p3f8ve51c385hcojspbn">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#F6F1E7">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://maps.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Marcellus&family=Outfit:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css?v={V}">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
{extra}
{GTM_HEAD}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{GTM_BODY}
"""

def to_abs(h):
    """Convert a relative-page key like 'index.html', 'fleet.html', or
    'airport-transfers/dubai' to its root-absolute href. Critical: every
    page emits root-absolute URLs so a page at subdirectory depth (e.g.
    /airport-transfers/dubai) does NOT resolve assets against its own dir.
    Earlier bug: relative 'assets/style.css' from /airport-transfers/dubai
    resolved to /airport-transfers/assets/style.css → 404 → unstyled page."""
    if h is None or h == "" or h.startswith(("http", "tel:", "mailto:", "#", "/")):
        return h
    if h == "index.html":
        return "/"
    if h.endswith(".html"):
        return "/" + h[:-5]
    return "/" + h

def header(active):
    # Each item: (href, label) for simple links, or (href, label, submenu) where
    # submenu is a list of (subhref, sublabel, disabled) triples. Disabled items
    # render as a non-clickable "soon" badge but still appear in the dropdown.
    items = [
      ("index.html", "Home"),
      ("fleet.html", "Fleet"),
      ("airport-transfers.html", "Airport Transfers", [
        ("airport-transfers/dubai", "Dubai", False),
        ("airport-transfers/abu-dhabi", "Abu Dhabi", False),
        ("airport-transfers/sharjah", "Sharjah", False),
        ("airport-transfers/rak", "Ras Al Khaimah", False),
        ("airport-transfers/al-ain", "Al Ain", False),
      ]),
      # v65,Chauffeur Service hub + per-emirate by-the-hour pages.
      ("rent-a-car-with-driver/", "Chauffeur Service", [
        ("rent-a-car-with-driver/dubai", "Dubai", False),
        ("rent-a-car-with-driver/abu-dhabi", "Abu Dhabi", False),
        ("rent-a-car-with-driver/sharjah", "Sharjah", False),
        ("rent-a-car-with-driver/rak", "Ras Al Khaimah", False),
        ("rent-a-car-with-driver/al-ain", "Al Ain", False),
        ("rent-a-car-with-driver/umm-al-quwain", "Umm Al Quwain", False),
      ]),
      ("corporate.html", "Corporate"),
      ("events.html", "Events"),
      ("about.html", "About"),
      ("contact.html", "Contact"),
    ]
    parts = []
    for item in items:
        h, t = item[0], item[1]
        sub = item[2] if len(item) > 2 else None
        parent_on = (h == active) or (sub and any(s[0] and s[0] == active for s in sub))
        a_cls = ' class="on"' if h == active else ''
        if sub:
            sub_li = []
            for sh, st, dis in sub:
                if dis:
                    sub_li.append('<li><span class="off">' + st + ' <em>soon</em></span></li>')
                else:
                    cls = ' class="on"' if sh == active else ''
                    sub_li.append('<li><a href="' + to_abs(sh) + '"' + cls + '>' + st + '</a></li>')
            sub_html = '<ul class="submenu">' + "".join(sub_li) + '</ul>'
            wrap_cls = ' class="has-sub' + (' on' if parent_on else '') + '"'
            # Mobile collapse: the parent <a> remains a real link (tap navigates).
            # The sub-toggle button is hidden on desktop (hover opens .submenu)
            # and visible on mobile, where it toggles .has-sub.open to expand.
            caret_svg = '<span class="caret" aria-hidden="true"><svg viewBox="0 0 12 8"><path d="M1.5 1.5l4.5 4.5 4.5-4.5"/></svg></span>'
            parts.append('<li' + wrap_cls + '><a href="' + to_abs(h) + '"' + a_cls + '>' + t +
                         ' ' + caret_svg + '</a>' +
                         '<button class="sub-toggle" type="button" aria-expanded="false" aria-label="Toggle ' + t + ' submenu">' +
                         caret_svg + '</button>' +
                         sub_html + '</li>')
        else:
            parts.append('<li><a href="' + to_abs(h) + '"' + a_cls + '>' + t + '</a></li>')
    nav = "".join(parts)
    return f"""<header class="site">
  <div class="topbar">
    <div class="left"><button class="burger" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button></div>
    <a class="masthead" href="/" aria-label="UMC Dubai, home"><span class="mark">UMC</span><span class="rule"></span><span class="sub">Dubai</span></a>
    <div class="right">
      <a class="pill" href="/booking">Reserve</a>
      <a class="top-phone" href="tel:+971586497861" aria-label="Call UMC Dubai"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>
    </div>
  </div>
  <nav class="mainnav" aria-label="Main"><ul>{nav}</ul></nav>
</header>
<main id="main">
"""

FOOTER = f"""</main>
<footer class="site">
  <div class="wrap">
    <div class="fgrid">
      <div>
        <a class="masthead" href="/"><span class="mark">UMC</span><span class="rule"></span><span class="sub">Dubai</span></a>
        <p style="max-width:34ch;margin-top:1.2rem;font-size:.92rem">Luxury chauffeur service in Dubai and across the UAE. Airport transfers, corporate programmes, half-day and full-day hire, 24 hours a day.</p>
        <h4 style="margin-top:1.4rem">Payments</h4>
        {PAYLINE}
      </div>
      <div>
        <h4>Services</h4>
        <ul>
          <li><a href="/airport-transfers">Airport transfer Dubai</a></li>
          <li><a href="/corporate">Corporate chauffeur</a></li>
          <li><a href="/inter-emirate">Inter-emirate transfers</a></li>
          <li><a href="/events">Wedding &amp; event service</a></li>
          <li><a href="/rent-a-car-with-driver/">Half-day &amp; full-day hire</a></li>
          <li><a href="/booking">Reserve a car</a></li>
        </ul>
      </div>
      <div>
        <h4>Company</h4>
        <ul>
          <li><a href="/about">About UMC</a></li>
          <li><a href="/fleet">Our fleet</a></li>
          <li><a href="/contact">Contact</a></li>
          <li><a href="/terms">Terms &amp; conditions</a></li>
          <li><a href="/privacy">Privacy</a></li>
        </ul>
      </div>
      <div>
        <h4>Concierge &middot; 24/7</h4>
        <ul>
          <li><a href="tel:+971586497861">+971 58 649 7861</a></li>
          <li><a href="mailto:contact@umcdubai.ae">contact@umcdubai.ae</a></li>
          <li><a target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=971586497861">WhatsApp</a></li>
          <li>Dubai, United Arab Emirates</li>
        </ul>
        <div class="socials">
          <a href="https://www.facebook.com/umcdubai" target="_blank" rel="noopener" aria-label="UMC Dubai on Facebook"><svg viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg></a>
          <a href="https://www.instagram.com/umcdubai" target="_blank" rel="noopener" aria-label="UMC Dubai on Instagram"><svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="5"/><circle cx="12" cy="12" r="4.3"/><circle cx="17.4" cy="6.6" r=".9" fill="currentColor" stroke="none"/></svg></a>
        </div>
      </div>
    </div>
    <div class="fbase">
      <span>&copy; 2026 UMC Dubai. All rights reserved.</span>
      <span><span class="stars">&#9733;&#9733;&#9733;&#9733;&#9733;</span>5.0 on Google</span>
    </div>
  </div>
</footer>
<a class="wa-float" aria-label="WhatsApp UMC Dubai" target="_blank" rel="noopener" href="{WA}">
  <svg viewBox="0 0 32 32"><path d="M16 .8C7.6.8.8 7.6.8 16c0 2.7.7 5.3 2 7.6L.7 31.3l7.9-2.1c2.2 1.2 4.7 1.9 7.4 1.9 8.4 0 15.2-6.8 15.2-15.1S24.4.8 16 .8zm0 27.7c-2.4 0-4.7-.7-6.7-1.9l-.5-.3-4.7 1.2 1.3-4.6-.3-.5a12.4 12.4 0 0 1-1.9-6.6C3.2 9 8.9 3.3 16 3.3S28.8 9 28.8 16 23.1 28.5 16 28.5zm7-9.4c-.4-.2-2.3-1.1-2.6-1.2-.4-.1-.6-.2-.9.2-.3.4-1 1.2-1.2 1.5-.2.3-.4.3-.8.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.2-2.1-2.6-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.6.1-.3 0-.5 0-.7l-1.2-2.8c-.3-.7-.6-.6-.9-.6h-.7c-.3 0-.7.1-1 .5-.4.4-1.3 1.3-1.3 3.2s1.4 3.7 1.6 4c.2.3 2.7 4.1 6.6 5.8.9.4 1.6.6 2.2.8.9.3 1.8.3 2.4.2.7-.1 2.3-.9 2.6-1.8.3-.9.3-1.7.2-1.8-.1-.2-.3-.3-.7-.5z"/></svg>
</a>
<script>window.UMC_FLEET_V="{FV}";</script>
<script src="/assets/fleet-data.js?v={V}"></script>
<script src="/assets/main.js?v={V}"></script>
"""

JL = '<div class="jline" aria-hidden="true"><span class="n1"></span><span class="stem"></span><span class="n2"></span></div>'

def faq_details(faqs):
    return "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q,a in faqs)

def faq_schema(faqs):
    import re
    items = [{"@type":"Question","name":re.sub('<[^>]+>','',q),
              "acceptedAnswer":{"@type":"Answer","text":re.sub('<[^>]+>','',a)}} for q,a in faqs]
    return '<script type="application/ld+json">'+json.dumps({"@context":"https://schema.org","@type":"FAQPage","mainEntity":items})+'</script>'

# ---------- FAQs (verbatim-faithful from umcdubai.ae) ----------
HOME_FAQS = [
 ("What does the rate include?",
  "Every rate includes your professional chauffeur, fuel, Salik and parking. There are no hidden costs and your quote sets out the full amount before you confirm."),
 ("How do I reserve, and can I request a specific vehicle?",
  "Reserve online in minutes, or call or WhatsApp our concierge desk on +971 58 649 7861 at any hour. If the vehicle you have in mind is not listed, tell us and we will do our best to arrange it."),
 ("What if I need additional stops, or the day runs long?",
  "Additional stops are charged by vehicle type for each 30-minute interval, up to one hour. If your plans extend, the booking extends with them by the hour. Our desk is available around the clock."),
 ("Which payment methods do you accept?",
  "All major cards, bank transfers and cash. For card payments we share a secure payment link once your reservation is confirmed. Invoices are available on request."),
 ("Are there any additional fees I should know about?",
  "Journeys outside Dubai carry an additional fee by vehicle type. Your quote states the full amount before you confirm, and nothing changes after it."),
 ("Can I cancel and receive a refund?",
  "Yes. Cancel at least 48 hours before your pick-up time and the booking is refunded in full."),
 ("Can I rebook?",
  "Yes. Reservations can be rebooked for up to 15 days from the time of booking."),
]
AIRPORT_FAQS = [
 ("How does the meet &amp; greet work?",
  "Your chauffeur waits in the arrivals hall with a name board, assists with your luggage and walks you to the car."),
 ("What if my flight is delayed?",
  "We track the flight from departure. If it is delayed, the booking moves with it and your chauffeur is there when you land."),
 ("What does the transfer rate include?",
  "Your chauffeur, fuel, Salik and parking. Transfers ending outside Dubai carry an additional fee by vehicle type, stated in your quote."),
 ("Can I add a stop on the way?",
  "Yes. Additional stops are charged at AED 75 for each 30-minute interval."),
 ("Which airports do you cover?",
  "All UAE airports: Dubai International, Al Maktoum, Abu Dhabi, Sharjah, Ras Al Khaimah and Al Ain, at any hour of the day or night."),
]
FLEET_FAQS = [
 ("Do the rates differ by vehicle?",
  "Yes. Each vehicle carries its own rate for airport transfers and for five and ten hour engagements. The rate shown is the rate you pay, with the chauffeur, fuel, Salik and parking included."),
 ("What if the vehicle I want is not listed?",
  "Tell our concierge what you have in mind and we will do our best to arrange it."),
 ("Are the photographs of the actual cars?",
  "Yes. Every photograph of the fleet is of a UMC vehicle, not stock imagery."),
]
CORP_FAQS = [
 ("How does corporate invoicing work?",
  "Corporate accounts receive consolidated monthly invoicing with a detailed breakdown per journey, cost-centre references on request, and payment by bank transfer or card."),
 ("Can our assistants book on behalf of executives and guests?",
  "Yes. Executive assistants and travel managers reserve directly with our 24/7 concierge desk by phone, WhatsApp or email, and can book for any guest with a name board at arrival."),
 ("Do you handle roadshows and multi-car movements?",
  "Yes, coordinated multi-vehicle movements, investor roadshows and delegation logistics are planned to the minute with a single point of contact."),
 ("How quickly can an account be operational?",
  "Typically within 48 hours of receiving your company details."),
]

COUNTRIES_PREF = [("AE","971"),("SA","966"),("QA","974"),("KW","965"),("BH","973"),("OM","968"),
 ("GB","44"),("US","1"),("IN","91"),("PK","92"),("RU","7"),("CN","86")]
COUNTRIES_REST = sorted([("Afghanistan","AF","93"),("Argentina","AR","54"),("Armenia","AM","374"),("Australia","AU","61"),("Austria","AT","43"),
 ("Azerbaijan","AZ","994"),("Bangladesh","BD","880"),("Belgium","BE","32"),("Brazil","BR","55"),("Bulgaria","BG","359"),
 ("Canada","CA","1"),("Czechia","CZ","420"),("Denmark","DK","45"),("Egypt","EG","20"),("Ethiopia","ET","251"),
 ("France","FR","33"),("Georgia","GE","995"),("Germany","DE","49"),("Ghana","GH","233"),("Greece","GR","30"),
 ("Hong Kong","HK","852"),("Hungary","HU","36"),("Indonesia","ID","62"),("Iran","IR","98"),("Iraq","IQ","964"),
 ("Ireland","IE","353"),("Italy","IT","39"),("Japan","JP","81"),("Jordan","JO","962"),("Kazakhstan","KZ","7"),
 ("Kenya","KE","254"),("Lebanon","LB","961"),("Malaysia","MY","60"),("Mexico","MX","52"),("Morocco","MA","212"),
 ("Nepal","NP","977"),("Netherlands","NL","31"),("New Zealand","NZ","64"),("Nigeria","NG","234"),("Norway","NO","47"),
 ("Philippines","PH","63"),("Poland","PL","48"),("Portugal","PT","351"),("Romania","RO","40"),("Singapore","SG","65"),
 ("South Africa","ZA","27"),("South Korea","KR","82"),("Spain","ES","34"),("Sri Lanka","LK","94"),("Sweden","SE","46"),
 ("Switzerland","CH","41"),("Thailand","TH","66"),("Tunisia","TN","216"),("Turkiye","TR","90"),("Ukraine","UA","380"),
 ("Uzbekistan","UZ","998"),("Vietnam","VN","84")])
def _flag(cc): return "".join(chr(0x1F1E6 + ord(ch) - 65) for ch in cc)
CC_NAMES = {"AE":"United Arab Emirates","SA":"Saudi Arabia","QA":"Qatar","KW":"Kuwait","BH":"Bahrain","OM":"Oman",
 "GB":"United Kingdom","US":"United States","IN":"India","PK":"Pakistan","RU":"Russia","CN":"China"}
# Per-country national mobile-number length [min,max] after stripping the trunk-prefix 0.
# Defaults to (7,12) for any unlisted country.
LEN = {
 "AE":(9,9),"SA":(9,9),"QA":(8,8),"KW":(8,8),"BH":(8,8),"OM":(8,8),
 "GB":(10,10),"US":(10,10),"CA":(10,10),
 "IN":(10,10),"PK":(10,10),"BD":(10,10),"CN":(11,11),
 "FR":(9,9),"DE":(10,11),"IT":(9,10),"ES":(9,9),"NL":(9,9),
 "CH":(9,9),"RU":(10,10),"TR":(10,10),"EG":(10,10),"NG":(10,10),"KE":(9,9),"ZA":(9,9),
 "AU":(9,9),"SG":(8,8),"HK":(8,8),"JP":(10,10),"KR":(9,10),
 "BR":(10,11),"MX":(10,10),
}
DEFAULT_LEN = (7,12)
def _len_attrs(cc):
    mn, mx = LEN.get(cc, DEFAULT_LEN)
    return ' data-cc="' + cc + '" data-len-min="' + str(mn) + '" data-len-max="' + str(mx) + '"'
CC_OPTIONS = "".join('<option value="' + d + '"' + (' selected' if cc=="AE" else '') + _len_attrs(cc) + ' title="' + CC_NAMES[cc] + '">' + _flag(cc) + ' +' + d + '</option>' for cc,d in COUNTRIES_PREF)
CC_OPTIONS += '<option disabled>&#8213;&#8213;&#8213;</option>'
CC_OPTIONS += "".join('<option value="' + d + '"' + _len_attrs(cc) + ' title="' + n + '">' + _flag(cc) + ' +' + d + '</option>' for n,cc,d in COUNTRIES_REST)

TERMS_ITEMS = [
 ("Unforeseen circumstances","We shall not be held responsible for delays or disruptions caused by traffic, weather conditions, road closures or any other unforeseen events beyond our control."),
 ("Vehicle representation","The assigned vehicle will match the category and model booked; however, specifications such as colour, interior features or exact configuration may vary. If you require specific features, please inform us in advance to confirm availability."),
 ("Client responsibility","Clients must provide accurate booking information including pickup details and contact information. Any damages to the vehicle caused by the client or passengers will be the client&rsquo;s responsibility. A cleaning fee will apply if the vehicle is excessively dirty."),
 ("Conduct in vehicle","Smoking and the consumption of alcohol are strictly prohibited in all vehicles. The company reserves the right to terminate service immediately without refund if these rules are violated or if passengers behave in a manner deemed unsafe or inappropriate."),
 ("Booking confirmation and payments","Bookings are confirmed only upon receipt of payment or advance deposit as agreed. Any remaining balance must be settled prior to or at the time of service. Prices are subject to change without prior notice until payment is received."),
 ("Cancellation policy","Cancellations made within 24 hours of the scheduled service time will incur charges. Any confirmed booking that is not honoured (no show) or cancelled at the last minute will be fully chargeable; no refunds or credits will be issued under these circumstances. If payment was made via a payment link, a 3% transaction fee applies to all cancellations."),
 ("Personal belongings","The company is not liable for any personal belongings left in the vehicle. Please ensure all items are removed at the end of the trip."),
 ("Third-party services","We are not liable for issues, errors or delays caused by third-party vendors or services arranged through us."),
 ("Liability","The company&rsquo;s liability is limited to the provision of transportation as confirmed in the booking. We shall not be held liable for indirect losses, missed flights or appointments arising from uncontrollable circumstances."),
 ("Intellectual property","All design, copy and code on this website are the property of UMC Dubai LLC. Unauthorised reproduction, modification, distribution or scraping of this material is prohibited and monitored. &copy; UMC Dubai LLC. All rights reserved."),
 ("Governing law","These terms are governed by the laws of the United Arab Emirates. Any disputes shall be handled under the jurisdiction of the courts in Dubai, UAE. By proceeding with a booking through our website form, WhatsApp, or phone call, you acknowledge and agree to abide by all terms and conditions outlined on our website."),
]
TERMS_OL = "".join("<li><b>" + t + ".</b> " + b + "</li>" for t,b in TERMS_ITEMS)
TERMS_DLG = ('<dialog id="termsDlg" class="terms">'
 '<div class="thead"><h2>Terms of Service</h2><button class="x" type="button" aria-label="Close">&times;</button></div>'
 '<div class="tbody"><ol>' + TERMS_OL + '</ol></div></dialog>')

# ---------- favicon ----------
(SITE/"favicon.svg").write_text(
"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#F6F1E7"/><text x="32" y="40" font-family="Georgia,serif" font-size="30" text-anchor="middle" fill="#221B14">U</text><rect x="22" y="47" width="20" height="2.5" fill="#C75B12"/></svg>""")

# ---------- index ----------
ld_home = '<script type="application/ld+json">'+json.dumps({
 "@context":"https://schema.org","@type":"LocalBusiness","name":"UMC Dubai",
 "description":"Luxury chauffeur service in Dubai and across the UAE: airport transfers, corporate chauffeur programmes, hourly and full-day private drivers.",
 "url":"https://umcdubai.ae/","telephone":"+971586497861","email":"contact@umcdubai.ae",
 "sameAs":["https://www.facebook.com/umcdubai","https://www.instagram.com/umcdubai"],
 "image":"https://umcdubai.ae/assets/home/s-class-interior-meta.jpg",
 "areaServed":["Dubai","Abu Dhabi","Sharjah","Ras Al Khaimah","Al Ain","Umm Al Quwain"],
 "priceRange":"AED 350 - AED 2400","openingHours":"Mo-Su 00:00-24:00",
 "aggregateRating":{"@type":"AggregateRating","ratingValue":"5.0","reviewCount":"25"}})+'</script>'

index_body = header("index.html") + f"""
<section class="hero2" id="book">
  <!-- TEMPORARY hero image, replace with real UMC photography ASAP. -->
  <div class="h2bg" role="img" aria-label="Luxury chauffeur sedan at the kerbside"></div>
  <div class="h2scrim"></div>
  <div class="wrap h2grid">
    <div class="h2copy">
      <span class="kicker"><i class="kdot kdot-open"></i><i class="krule"></i><em>Serving all seven emirates</em><i class="krule"></i><i class="kdot kdot-fill"></i></span>
      <h1>Chauffeur driven, without compromise.</h1>
      <p class="lede">Immaculate cars, vetted chauffeurs and a concierge that answers at any hour.</p>
    </div>
    <div class="h2form">
      <form class="book" id="bookForm" aria-label="Reserve a car">
        <div class="seg" role="tablist">
          <button type="button" class="on" data-mode="transfer">Transfer</button>
          <button type="button" data-mode="hourly">By the hour</button>
        </div>
        <div class="f"><label for="bFrom">Pick-up</label><input id="bFrom" autocomplete="off" placeholder="DXB Terminal 3, hotel, residence" required></div>
        <div class="swap">
          <div class="f" id="fTo"><label for="bTo">Destination</label><input id="bTo" autocomplete="off" placeholder="Where to?" required></div>
          <div class="f" id="fHours" style="display:none"><label for="bHours">At your disposal</label>
            <select id="bHours"><option>5 hours</option><option>10 hours</option><option>Multiple days</option></select>
          </div>
        </div>
        <div class="two">
          <div class="f"><label for="bDate">Date</label><input id="bDate" type="text" placeholder="Select date" required></div>
          <div class="f"><label for="bTime">Time</label><input id="bTime" type="text" placeholder="Select time" required></div>
        </div>
        <button class="btn btn-ink" type="submit">See options</button>
      </form>
    </div>
  </div>
</section>

<div class="authority rv">
  <div class="wrap">
    <span class="lbl">Guests and delegations served for</span>
    <p class="names">Emirates <i>&middot;</i> Jetex <i>&middot;</i> IIFA Awards <i>&middot;</i> Gulfood <i>&middot;</i> Loro Piana <i>&middot;</i> Dolce &amp; Gabbana</p>
  </div>
</div>

{JL}

<section class="sec" id="fleet">
  <div class="wrap wide">
    <div class="shead rv">
      <span class="lbl">The fleet</span>
      <h2>Every car. One standard.</h2>
      <p class="lede">Detailed before every journey and driven by the same vetted chauffeurs, whichever car you choose. The standard never changes, only the car does.</p>
    </div>
    <div class="fleet-grid" id="homeFleet"></div>
    <div class="center rv" style="margin-top:2.6rem"><a class="btn btn-ghost" href="/fleet">View the complete fleet</a></div>
  </div>
</section>

{JL}

<section class="sec" id="services">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Services</span><h2>One company. Every journey.</h2></div>
    <div class="svp rv" id="svpCar">
      <a class="svp-row" href="/airport-transfers">
        <span class="svp-num">01</span>
        <span class="svp-rule" aria-hidden="true"></span>
        <span class="svp-mid">
          <span class="svp-meta">Transfer service</span>
          <h3>Airport transfers</h3>
          <p>Met at arrivals with a name board, your flight tracked from departure, driven door to door across every UAE airport.</p>
        </span>
        <span class="svp-cta">Reserve</span>
      </a>
      <a class="svp-row" href="/rent-a-car-with-driver/">
        <span class="svp-num">02</span>
        <span class="svp-rule" aria-hidden="true"></span>
        <span class="svp-mid">
          <span class="svp-meta">Hourly service</span>
          <h3>By the hour</h3>
          <p>A car and chauffeur entirely at your disposal, five or ten hours at a time, for the day that does not run in a straight line.</p>
        </span>
        <span class="svp-cta">Reserve</span>
      </a>
      <a class="svp-row" href="/corporate">
        <span class="svp-num">03</span>
        <span class="svp-rule" aria-hidden="true"></span>
        <span class="svp-mid">
          <span class="svp-meta">Account programme</span>
          <h3>Corporate</h3>
          <p>Executive travel managed under one account, one monthly invoice and one point of contact who already knows your preferences.</p>
        </span>
        <span class="svp-cta">Accounts</span>
      </a>
      <a class="svp-row" href="/inter-emirate">
        <span class="svp-num">04</span>
        <span class="svp-rule" aria-hidden="true"></span>
        <span class="svp-mid">
          <span class="svp-meta">All seven emirates</span>
          <h3>Inter-emirate</h3>
          <p>Fixed-quote journeys between all seven emirates, planned to the minute, from Dubai to Abu Dhabi, Ras Al Khaimah and beyond.</p>
        </span>
        <span class="svp-cta">Routes</span>
      </a>
      <a class="svp-row" href="/events">
        <span class="svp-num">05</span>
        <span class="svp-rule" aria-hidden="true"></span>
        <span class="svp-mid">
          <span class="svp-meta">Occasions</span>
          <h3>Events</h3>
          <p>Weddings, galas and private celebrations, a coordinated fleet for the days that matter most, planned to the minute by one point of contact.</p>
        </span>
        <span class="svp-cta">Plan</span>
      </a>
    </div>
    <div class="svnav" aria-hidden="true">
      <button id="svprev" type="button" aria-label="Previous service">&larr;</button>
      <button id="svnext" type="button" aria-label="Next service">&rarr;</button>
    </div>
  </div>
</section>

{JL}

<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">The UMC standard</span><h2>The measures that matter.</h2></div>
    <div class="std four rv">
      <div><span class="lbl">Assurance</span><h3>Settled in advance</h3><p>Your car and chauffeur are assigned at booking and held for you. Nothing is left to the moment.</p></div>
      <div><span class="lbl">Punctuality</span><h3>Ready before you are</h3><p>Flights are tracked, routes are planned and traffic is watched. Your chauffeur waits for you. Never the reverse.</p></div>
      <div><span class="lbl">Discretion</span><h3>Privacy as policy</h3><p>Vetted chauffeurs trained in discretion. Take the call or hold the meeting. What is said in the car stays in the car.</p></div>
      <div><span class="lbl">Consistency</span><h3>One standard, always</h3><p>The same immaculate vehicle and the same conduct on the hundredth journey as on the first.</p></div>
    </div>
  </div>
</section>

<section class="sec band-soft">
  <div class="wrap" style="text-align:center">
    <span class="lbl">Corporate</span>
    <h2 style="margin:.7rem 0">Executive travel, managed.</h2>
    <p class="lede" style="margin:0 auto 1.4rem">Consolidated invoicing, bookings on behalf of guests and one number that answers at any hour. Accounts are operational within 48 hours.</p>
    <a class="btn-line" href="/corporate">Open a corporate account</a>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Testimonials</span><h2>Judged by the people we drive.</h2></div>
    <div class="tcar rv" id="tcar">
      <article class="tc"><div class="tstars">★★★★★</div><p>UMC Dubai's chauffeur service surpassed all expectations. From seamless booking to a prompt, professional, and friendly chauffeur, every aspect was top-notch. The immaculate vehicle and skilled driving made for a comfortable and stress-free ride. Highly recommend for anyone seeking luxury transportation in Dubai.</p><footer><b>M Inam</b><span class="gsrc"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>Google review</span></footer></article>
      <article class="tc"><div class="tstars">★★★★★</div><p>I recently hired UMC Dubai for a five-day trip from the UK to Dubai, and it was an outstanding experience. The driver was incredibly helpful throughout the journey, providing excellent service and local insights. The luxurious vehicle ensured a comfortable ride at all times. Highly recommended for anyone visiting Dubai!</p><footer><b>Ehsan Lone</b><span class="gsrc"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>Google review</span></footer></article>
      <article class="tc"><div class="tstars">★★★★★</div><p>I booked my ride with UMC and I was not disappointed. They were very punctual and the whole process was extremely smooth. The chauffeur was very professional and knew his way around the emirates. From pick up to drop off the experience was top notch and of ultimate luxury. Will definitely book again.</p><footer><b>Abe</b><span class="gsrc"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>Google review</span></footer></article>
      <article class="tc"><div class="tstars">★★★★★</div><p>Excellent service. Very fast and reliable. Amazing cars with very friendly drivers. I will use again next time I am in UAE.</p><footer><b>Abbas Ahmed</b><span class="gsrc"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>Google review</span></footer></article>
    </div>
    <div class="tnav"><button id="tprev" aria-label="Previous">&larr;</button><button id="tnext" aria-label="Next">&rarr;</button></div>
  </div>
</section>

{JL}

<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Good to know</span><h2>Questions, answered.</h2></div>
    <div class="faq rv">{faq_details(HOME_FAQS)}</div>
  </div>
</section>

<section class="closing band-dark">
  <div class="wrap">
    <span class="lbl">Reservations</span>
    <h2 class="rv">Arrive as intended.</h2>
    <div class="btns rv">
      <a class="btn btn-ink" href="/booking">Reserve your car</a>
      <a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a>
    </div>
  </div>
</section>
""" + FOOTER + """
<script src="/assets/vendor/flatpickr.min.js?v={V}"></script>
<script async src="https://maps.googleapis.com/maps/api/js?key=""" + MAPS_KEY + """&libraries=places&callback=umcHomeMaps"></script>
<script>
document.addEventListener("DOMContentLoaded", function(){
  renderFleet(document.getElementById("homeFleet"),
    { featured: ["mb-s-class","cadillac-escalade","bmw-7","mb-v-class","mb-e-class","gmc-yukon-xl"] });
});
</script>
</body>
</html>"""

(SITE/"index.html").write_text(
 head("Luxury Chauffeur Service in Dubai & the UAE | UMC Dubai",
      "UMC Dubai is the luxury chauffeur service trusted across the UAE. Airport transfers, corporate and private drivers, one all-inclusive rate, 24/7.",
      "", ld_home + faq_schema(HOME_FAQS) + '<link rel="stylesheet" href="/assets/vendor/flatpickr.min.css?v={V}">') + index_body)

# ---------- booking ----------
booking_body = header("booking.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">Reservations</span>
    <h1>Reserve your car</h1>
    <p class="lede">Confirmed personally by our concierge, usually within the hour and always the same day. Free cancellation up to 48 hours before pickup.</p>
  </div>
</section>

<section class="sec" style="padding-top:2rem">
  <div class="wrap">
    <form id="bkForm">
    <div class="bk-layout">
      <div>
        <div class="bk-card">
          <h2>Your journey</h2>
          <div class="seg" role="tablist" id="bkSeg">
            <button type="button" class="on" data-mode="transfer">Transfer</button>
            <button type="button" data-mode="hourly">By the hour</button>
          </div>
          <div class="f hide" id="rowDur"><label for="kDur">At your disposal</label>
            <select id="kDur">
              <option value="hourly5">5 hours</option>
              <option value="hourly10">10 hours</option>
              <option value="fullday">Multiple days</option>
            </select>
          </div>
          <div class="f hide" id="rowDays"><label for="kDays">Number of days</label>
            <input id="kDays" type="number" min="2" max="60" value="2" inputmode="numeric">
          </div>
          <div class="f"><label for="kFrom">Pick-up</label><input id="kFrom" autocomplete="off" placeholder="Airport, hotel, residence" required></div>
          <div class="f" id="rowTo"><label for="kTo">Destination</label><input id="kTo" autocomplete="off" placeholder="Where to?"></div>
          <div class="two">
            <div class="f"><label for="kDate">Date</label><input id="kDate" type="text" placeholder="Select date" required></div>
            <div class="f"><label for="kTime">Time</label><input id="kTime" type="text" placeholder="Select time" required></div>
          </div>
          <p class="bk-note hide" id="timeNote" role="status" aria-live="polite"></p>
          <div class="two">
            <div class="f hide" id="rowFlight"><label for="kFlight">Flight number</label><input id="kFlight" placeholder="EK 202"></div>
            <div class="f hide" id="rowSign"><label for="kSign">Welcome sign name</label><input id="kSign" placeholder="Name on the board"></div>
          </div>
          <div class="f"><label for="kNotes">Notes for your chauffeur</label><textarea id="kNotes" rows="2" placeholder="Child seat, extra stop, preferences&hellip;"></textarea></div>
          <div class="bk-inc-title">Included in every journey</div>
          <div class="bk-inc" aria-label="Included in every journey">
            <span><svg viewBox="0 0 24 24"><circle cx="12" cy="9.4" r="3"/><path d="M5.4 21c.6-3.6 3-5.5 6.6-5.5s6 1.9 6.6 5.5"/><path d="M9.5 5.5h5l-.6-1.6a.9.9 0 0 0-.8-.6h-2.2a.9.9 0 0 0-.8.6z"/><path d="M7.5 5.5h9"/></svg><i id="incMeetTxt" style="font-style:normal">Professional chauffeur</i></span>
            <span id="incFlight" class="hide"><svg viewBox="0 0 24 24"><path d="M21.5 4.6c.8-.8.6-2-.5-2.1-.9-.1-1.9.2-2.6.9l-3.5 3.4-9.3-2.4a1 1 0 0 0-1 .3l-.8.9 7.4 4.5-3.3 3.4-2.7-.4-.9.9 3 1.9 1.9 3 .9-.9-.4-2.7 3.4-3.3 4.5 7.4.9-.8a1 1 0 0 0 .3-1l-2.4-9.3z"/></svg>Live flight tracking</span>
            <span><svg viewBox="0 0 24 24"><path d="M10.2 2.5h3.6M12 2.5v3.4M9.6 9.2c-.7.8-1.1 1.7-1.1 2.8V19a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2v-7c0-1.1-.4-2-1.1-2.8l-.9-1V5.9h-3v2.3z"/><path d="M8.5 13.5h7"/></svg>Bottled water</span>
            <span><svg viewBox="0 0 24 24"><path d="M13 2.5L5.5 13H11l-1 8.5L17.5 11H12z"/></svg>Device chargers</span>
            <span><svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="11" rx="2"/><path d="M8 9c0-4 8-4 8 0M10 13c.8 1 3.2 1 4 0"/></svg>Tissues</span>
            <span><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4M9 15l2.2 2.2L15.5 13"/></svg>Free cancellation up to 48 hours</span>
          </div>
        </div>

        <div class="bk-card" style="margin-top:1.4rem" id="secCars">
          <h2>Select your car</h2>
          <div class="bk-cars" id="carList"></div>
        </div>

        <div class="bk-card" style="margin-top:1.4rem" id="secDetails">
          <h2>Your details</h2>
          <div class="two">
            <div class="f"><label class="req" for="kName">Full name</label><input id="kName" autocomplete="name" required></div>
            <div class="f"><label class="req" for="kPhone">Phone / WhatsApp</label>
              <div class="phonewrap">
                <span class="cc"><select id="kCC" aria-label="Country code">{CC_OPTIONS}</select></span>
                <span class="num"><input id="kPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="5x xxx xxxx" required></span>
              </div><span class="fhint phone-err"></span></div>
          </div>
          <div class="f"><label class="req" for="kEmail">Email</label><input id="kEmail" type="email" autocomplete="email" required><span class="fhint">Enter a valid email address, e.g. name@domain.com</span></div>
                    <p class="bk-note" style="margin-top:1rem">By sending this request you agree to the <a href="/terms" id="openTerms" style="border-bottom:1px solid var(--amber);color:var(--ink)">Terms of Service</a>.</p>
          <div data-sitekey="0x4AAAAAADpUlIS_5IkgJa-H" id="bkTs" style="margin:.2rem 0 .4rem"></div>
          <button class="btn btn-ink" type="submit" id="btnConfirm" style="width:100%;margin-top:.7rem" disabled>Confirm reservation request</button>
          <p class="bk-note">Sending opens WhatsApp with your request pre-filled, and our concierge confirms availability and shares a secure payment link. By submitting this form you agree to receive booking and marketing emails from UMC Dubai, and you may unsubscribe at any time.</p>
        </div>
      </div>

      <div class="bk-side">
        <div id="map" role="img" aria-label="Route preview map"></div>
        
        <div class="bpass">
          <div class="bp-head"><span class="bp-brand">UMC</span><span class="lbl">Reservation</span></div>
          <div class="bp-rows" id="bkSummary"></div>
          <div class="bp-perf"></div>
          <div class="bp-total hide" id="bpTotal"></div>
        </div>
      </div>
    </div>
    </form>
    <div class="hide" id="bkDone">
      <div class="bk-card" style="max-width:560px;margin:0 auto;text-align:center">
        <h2>Request received</h2>
        <p class="lede" style="margin-bottom:1rem">Thank you! Our team will confirm the details with you shortly. We&rsquo;re opening WhatsApp so you can reach us directly, if it doesn&rsquo;t open, or you&rsquo;d prefer, call us on <a href="tel:+971586497861" style="border-bottom:1px solid var(--amber);color:var(--ink)">+971 58 649 7861</a> or email <a href="mailto:contact@umcdubai.ae" style="border-bottom:1px solid var(--amber);color:var(--ink)">contact@umcdubai.ae</a>.</p>
      </div>
    </div>
  </div>
</section>
""" + TERMS_DLG + FOOTER + f"""
<script src="/assets/vendor/flatpickr.min.js?v={V}"></script>
<script src="/assets/booking.js?v={V}"></script>
<script async src="https://maps.googleapis.com/maps/api/js?key={MAPS_KEY}&libraries=places&callback=umcMapsInit"></script>
</body>
</html>"""

(SITE/"booking.html").write_text(
 head("Reserve Your Car, Online Booking | UMC Dubai",
      "Reserve a chauffeur driven car in Dubai. Route preview, flight tracking on airport transfers and a personal concierge confirmation, usually the same day, 24/7.",
      "booking",
      '<link rel="stylesheet" href="/assets/vendor/flatpickr.min.css?v={V}">') + booking_body)

# ---------- fleet ----------
fleet_body = header("fleet.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">The fleet</span>
    <h1>Chauffeur driven cars in Dubai &amp; the UAE</h1>
    <p class="lede">Every car held to one standard. Each rate is final and includes the chauffeur, fuel, Salik and parking. What we quote is what you pay.</p>
  </div>
</section>
<section class="sec" style="padding-top:2.4rem">
  <div class="wrap wide">
    <div class="chips" id="fleetChips" role="tablist" aria-label="Filter fleet">
      <button class="on" data-cat="all">All</button>
      <button data-cat="sedan">Sedans</button>
      <button data-cat="suv">SUVs</button>
      <button data-cat="van">Vans</button>
      <button data-cat="coach">Coaches</button>
    </div>
    <div class="fleet-grid" id="fleetAll"></div>
    <p class="muted center" style="font-size:.85rem;margin-top:2.2rem">Rates may vary in peak season. Your quote is confirmed before you book.</p>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Guidance</span><h2>The right car for the moment.</h2></div>
    <div class="scen rv">
      <div class="sc"><svg viewBox="0 0 24 24"><path d="M21 15.5l-8-3V5.2a1.7 1.7 0 0 0-3.4 0v7.3l-6.6 2.5v2l6.6-1.4v3.6L7.5 21v1.4l4.8-1 4.8 1V21l-2.1-1.8v-3.6l6 1.3z"/></svg>
        <h3>The arrival</h3><p>Touching down at DXB after a long flight. Quiet, space and a chauffeur already waiting.</p>
        <div class="pick"><a href="/booking?vehicle=s-class">S Class</a><a href="/booking?vehicle=escalade">Escalade</a><a href="/booking?vehicle=v-class">V Class</a></div></div>
      <div class="sc"><svg viewBox="0 0 24 24"><path d="M9 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM17 11a2.5 2.5 0 1 0-2.5-2.5A2.5 2.5 0 0 0 17 11z"/><path d="M2.5 20c.5-3.2 2.8-4.8 6.5-4.8s6 1.6 6.5 4.8M14.8 15.6c2.8.2 4.5 1.7 4.9 4.4"/></svg>
        <h3>The family season</h3><p>School pick-ups, the mall, the beach club. Seven seats, cases and a pushchair, one calm cabin.</p>
        <div class="pick"><a href="/booking?vehicle=v-class">V Class</a><a href="/booking?vehicle=yukon">Yukon XL</a></div></div>
      <div class="sc"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="2"/><path d="M3 9.5h18M8 18v2.5M16 18v2.5"/></svg>
        <h3>The roadshow</h3><p>Investor days and delegations. Multi-car movements coordinated to the minute under one contact.</p>
        <div class="pick"><a href="/booking?vehicle=sprinter">Sprinter</a><a href="/contact?vehicle=Roadshow">Convoy desk</a></div></div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Good to know</span><h2>Fleet questions</h2></div>
    <div class="faq rv">{faq_details(FLEET_FAQS)}</div>
  </div>
</section>
<section class="closing band-dark">
  <div class="wrap"><span class="lbl">Reservations</span><h2 class="rv">The right car is the one that is ready.</h2>
  <div class="btns rv"><a class="btn btn-ink" href="/booking">Reserve your car</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + """
<script>document.addEventListener("DOMContentLoaded",function(){renderFleet(document.getElementById("fleetAll"),{});
  var chips=document.querySelectorAll("#fleetChips button");
  chips.forEach(function(b){b.addEventListener("click",function(){
    chips.forEach(function(x){x.classList.remove("on")});this.classList.add("on");
    var cat=this.dataset.cat;
    document.querySelectorAll("#fleetAll .vcard").forEach(function(card){
      var cc=(card.dataset.cat||"").toLowerCase();
      var show=cat==="all"||cc.indexOf(cat)>-1;
      card.style.display=show?"":"none";
    });
  });});});</script>
</body>
</html>"""
(SITE/"fleet.html").write_text(
 head("Luxury Fleet, Chauffeur-Driven Cars in Dubai | UMC Dubai",
      "The UMC Dubai fleet: Mercedes S-Class, BMW 7 Series, Cadillac Escalade, V-Class, Sprinter and coaches, all-inclusive chauffeur rates across the UAE.",
      "fleet", faq_schema(FLEET_FAQS)) + fleet_body)

# ---------- airport ----------
airport_body = header("airport-transfers.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">DXB &middot; DWC &middot; AUH &middot; SHJ &middot; RKT &middot; AAN</span>
    <h1>Airport transfers in Dubai &amp; the UAE</h1>
    <p class="lede">Met at arrivals. Driven without delay.</p>
    <div class="btns rv" style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="/booking">Reserve your transfer</a>
    </div>
  </div>
  </section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">The arrival protocol</span><h2>From the arrivals hall to your door.</h2></div>
    <div class="timeline rv">
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M21 15.5l-8-3V5.2a1.7 1.7 0 0 0-3.4 0v7.3l-6.6 2.5v2l6.6-1.4v3.6L7.5 21v1.4l4.8-1 4.8 1V21l-2.1-1.8v-3.6l6 1.3z"/></svg></div>
        <div><h3>Tracked<span class="lbl">From departure</span></h3><p>We follow your flight from the moment it leaves the ground. A delay moves the booking, not your plans.</p></div></div>
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><circle cx="12" cy="6.6" r="3.1"/><path d="M4.8 21c.8-4 3.6-6 7.2-6s6.4 2 7.2 6"/><path d="M10.7 12.4h2.6l-.5 1.5h-1.6z"/><path d="M11.3 13.9l-.8 3.6 1.5 2 1.5-2-.8-3.6"/></svg></div>
        <div><h3>Met<span class="lbl">Arrivals hall</span></h3><p>Your chauffeur waits with a name board, greets you and assists with your luggage.</p></div></div>
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M5 16l1.4-4.2A2 2 0 0 1 8.3 10h7.4a2 2 0 0 1 1.9 1.8L19 16M5 16h14M5 16v3h2v-2h10v2h2v-3"/><circle cx="8" cy="17.5" r=".4"/><circle cx="16" cy="17.5" r=".4"/></svg></div>
        <div><h3>Seated<span class="lbl">At the kerb</span></h3><p>An immaculate car waits with the route already set, bottled water and chargers within reach.</p></div></div>
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5"/><path d="M10.5 20v-5h3v5"/></svg></div>
        <div><h3>Arrived<span class="lbl">Door to door</span></h3><p>The journey ends at your door.</p></div></div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Included</span><h2>Attached to every journey.</h2></div>
    <div class="tagwrap rv">
      <div class="lugtag" role="list" aria-label="Included with every airport transfer">
        <div class="tg-head"><span class="lbl">Airport service manifest</span><b>UMC</b></div>
        <ul>
          <li role="listitem"><b class="t">Arrival monitoring</b><span>Your flight is tracked from departure; the pick-up adjusts to the actual landing time.</span></li>
          <li role="listitem"><b class="t">Reception</b><span>Your chauffeur waits in the arrivals hall with a name board and assists with luggage.</span></li>
          <li role="listitem"><b class="t">Cabin provisions</b><span>Bottled water, device chargers and tissues, prepared before every pick-up.</span></li>
          <li role="listitem"><b class="t">Cancellation</b><span>Released without charge up to 48 hours before the scheduled pick-up.</span></li>
        </ul>
        <div class="tg-foot"><span>No meter &middot; No surge</span><i>Priority handling</i></div>
      </div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap wide">
    <div class="shead rv"><span class="lbl">The fleet</span><h2>Choose your car.</h2><p class="lede">A seamless transfer between the terminal and your hotel, residence or boardroom, in the car that suits the moment.</p></div>
    <div class="fleet-grid" id="airportFleet"></div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Good to know</span><h2>Airport transfer questions</h2></div>
    <div class="faq rv">{faq_details(AIRPORT_FAQS)}</div>
  </div>
</section>
<section class="closing band-dark">
  <div class="wrap"><span class="lbl">Reservations</span><h2 class="rv">Have the car waiting when you land.</h2>
  <div class="btns rv"><a class="btn btn-ink" href="/booking">Reserve your transfer</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + """
<script>document.addEventListener("DOMContentLoaded",function(){renderFleet(document.getElementById("airportFleet"),{})});</script>
</body></html>"""
(SITE/"airport-transfers.html").write_text(
 head("Airport Transfers in Dubai & the UAE | UMC Dubai",
      "Fixed-price airport transfers across the UAE. Live flight tracking, meet & greet at baggage claim. From AED 350, all-inclusive.",
      "airport-transfers", faq_schema(AIRPORT_FAQS)) + airport_body)

# ---------- airport-transfers / per-emirate pages (v45 Dubai, v46 the other four) ----------
# Same template as the master (header, hero, arrival protocol, included, fleet,
# FAQ, closing band),ONLY copy + airport codes change per emirate. Per Usman's
# lock: NO layout/section/design changes. Each page references only its own
# emirate's airports + destinations (cross-emirate mentions are explicit, e.g.
# Sharjah/RAK/Al Ain note routing to/from Dubai where relevant). Distinct
# institutional hero sub + closing-band heading per emirate.
COMMON_AIRPORT_FAQS = [
 ("How does the meet &amp; greet work?",
  "Your chauffeur waits in the arrivals hall with a name board, assists with your luggage and walks you to the car."),
 ("What if my flight is delayed?",
  "We track the flight from departure. If it is delayed, the booking moves with it and your chauffeur is there when you land."),
 ("What does the transfer rate include?",
  "Your chauffeur, fuel, Salik and parking. Transfers ending outside Dubai carry an additional fee by vehicle type, stated in your quote."),
 ("Can I add a stop on the way?",
  "Yes. Additional stops are charged at AED 75 for each 30-minute interval."),
]

EMIRATES = [
  {
    "slug": "dubai", "name": "Dubai", "codes": "DXB &middot; DWC",
    "h1": "Airport transfers in Dubai.",
    "hero_sub": "From DXB or DWC, the city begins the moment you land.",
    "lead": "Whether you land at Dubai International or Al Maktoum, the protocol is the same. Your chauffeur tracks the flight, waits in the arrivals hall, and is standing ready the moment you clear.",
    "closing_heading": "The car is there before you are.",
    "seo_title": "Dubai Airport Transfer (DXB & DWC) | UMC Dubai",
    "seo_meta": "Chauffeur driven Dubai airport transfers from DXB and Al Maktoum (DWC). Meet & greet at arrivals, live flight tracking.",
    "faqs_extra": [
      ("Which Dubai airports do you cover?",
       "Both of Dubai's airports: Dubai International (DXB) and Al Maktoum International (DWC), at any hour of the day or night."),
      ("Where in Dubai will you take me?",
       "Across the city: DIFC, Downtown, Dubai Marina, Palm Jumeirah, Business Bay and any other Dubai address you provide."),
    ],
  },
  {
    "slug": "abu-dhabi", "name": "Abu Dhabi", "codes": "AUH",
    "h1": "Airport transfers in Abu Dhabi.",
    "hero_sub": "From Zayed International to the capital, at the pace the capital keeps.",
    "lead": "Your chauffeur tracks the flight into Zayed International, waits in the arrivals hall, and is ready the moment you clear. Whether the journey ends at a ministry, a corporate office, or a hotel on the Corniche, the standard does not change.",
    "closing_heading": "The capital, met properly.",
    "seo_title": "Abu Dhabi Airport Transfer (AUH) | UMC Dubai",
    "seo_meta": "Chauffeur driven Abu Dhabi airport transfers from Zayed International (AUH). Meet & greet at arrivals, live flight tracking.",
    "faqs_extra": [
      ("Which Abu Dhabi airports do you cover?",
       "We cover Zayed International Airport (AUH), the capital's principal airport."),
      ("Where in Abu Dhabi will you take me?",
       "Across the capital: the Corniche, Al Maryah and Al Reem islands, Yas Island, Saadiyat, the central business district, and any other Abu Dhabi address you provide."),
    ],
  },
  {
    "slug": "sharjah", "name": "Sharjah", "codes": "SHJ",
    "h1": "Airport transfers in Sharjah.",
    "hero_sub": "Met at Sharjah International. Driven on, wherever the day leads.",
    "lead": "Your chauffeur tracks the flight into Sharjah International, meets you at arrivals, and takes the luggage. Many journeys from here run on into Dubai or across the northern emirates, and we plan the route accordingly.",
    "closing_heading": "Arrival, without the wait.",
    "seo_title": "Sharjah Airport Transfer (SHJ) | UMC Dubai",
    "seo_meta": "Chauffeur driven Sharjah airport transfers from SHJ. Meet & greet at arrivals, onward into Dubai and the northern emirates, flight tracking included.",
    "faqs_extra": [
      ("Which Sharjah airports do you cover?",
       "We cover Sharjah International Airport (SHJ), and routinely carry on into Dubai and the northern emirates from there."),
      ("Where in Sharjah will you take me?",
       "Across the emirate: the Heritage and Arts areas, Al Majaz, Al Qasba, and onward to Dubai and the northern emirates when the journey continues."),
    ],
  },
  {
    "slug": "rak", "name": "Ras Al Khaimah", "codes": "RKT",
    "h1": "Airport transfers in Ras Al Khaimah.",
    "hero_sub": "From RKT to the mountains and the shore, unhurried.",
    "lead": "Your chauffeur tracks the flight into Ras Al Khaimah International, meets you at arrivals, and sees you to the car. From here the road runs to the resorts, the coast, and Jebel Jais, and we keep the journey calm and exact.",
    "closing_heading": "The journey north, made easy.",
    "seo_title": "Ras Al Khaimah Airport Transfer (RKT) | UMC Dubai",
    "seo_meta": "Chauffeur driven Ras Al Khaimah airport transfers from RKT. Meet & greet at arrivals, on to the resorts, the coast and Jebel Jais. Flight tracking included.",
    "faqs_extra": [
      ("Which Ras Al Khaimah airports do you cover?",
       "We cover Ras Al Khaimah International Airport (RKT). We also carry guests up from Dubai's airports to Ras Al Khaimah when the flight lands there instead."),
      ("Where in Ras Al Khaimah will you take me?",
       "Across the emirate: the beachfront resorts, Al Marjan Island, and Jebel Jais, alongside any other Ras Al Khaimah address you provide."),
    ],
  },
  {
    "slug": "al-ain", "name": "Al Ain", "codes": "AAN",
    "h1": "Airport transfers in Al Ain.",
    "hero_sub": "Into the garden city, quietly and on time.",
    "lead": "Your chauffeur tracks the flight into Al Ain International, meets you at arrivals, and takes the luggage. Al Ain rewards an unhurried arrival, and that is exactly how we drive it.",
    "closing_heading": "The garden city, met with care.",
    "seo_title": "Al Ain Airport Transfer (AAN) | UMC Dubai",
    "seo_meta": "Chauffeur driven Al Ain airport transfers from AAN. Meet & greet at arrivals, on into the garden city, oases and Jebel Hafeet. Flight tracking included.",
    "faqs_extra": [
      ("Which Al Ain airports do you cover?",
       "We cover Al Ain International Airport (AAN). Many guests also travel to Al Ain by car from Dubai or Abu Dhabi, and we cover that route too."),
      ("Where in Al Ain will you take me?",
       "Across the garden city: the oases, Jebel Hafeet, the heritage sites, and the green inland streets, alongside any other Al Ain address you provide."),
    ],
  },
]

def render_emirate_airport_page(em):
    faqs = COMMON_AIRPORT_FAQS + em["faqs_extra"]
    body = header(f"airport-transfers/{em['slug']}") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">{em['codes']}</span>
    <h1>{em['h1']}</h1>
    <p class="lede">{em['hero_sub']}</p>
    <div class="btns rv" style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="/booking">Reserve your transfer</a>
    </div>
  </div>
  </section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">The arrival protocol</span><h2>From the arrivals hall to your door.</h2></div>
    <p class="lede rv" style="text-align:center;max-width:60ch;margin:0 auto 2rem">{em['lead']}</p>
    <div class="timeline rv">
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M21 15.5l-8-3V5.2a1.7 1.7 0 0 0-3.4 0v7.3l-6.6 2.5v2l6.6-1.4v3.6L7.5 21v1.4l4.8-1 4.8 1V21l-2.1-1.8v-3.6l6 1.3z"/></svg></div>
        <div><h3>Tracked<span class="lbl">From departure</span></h3><p>We follow your flight from the moment it leaves the ground. A delay moves the booking, not your plans.</p></div></div>
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><circle cx="12" cy="6.6" r="3.1"/><path d="M4.8 21c.8-4 3.6-6 7.2-6s6.4 2 7.2 6"/><path d="M10.7 12.4h2.6l-.5 1.5h-1.6z"/><path d="M11.3 13.9l-.8 3.6 1.5 2 1.5-2-.8-3.6"/></svg></div>
        <div><h3>Met<span class="lbl">Arrivals hall</span></h3><p>Your chauffeur waits with a name board, greets you and assists with your luggage.</p></div></div>
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M5 16l1.4-4.2A2 2 0 0 1 8.3 10h7.4a2 2 0 0 1 1.9 1.8L19 16M5 16h14M5 16v3h2v-2h10v2h2v-3"/><circle cx="8" cy="17.5" r=".4"/><circle cx="16" cy="17.5" r=".4"/></svg></div>
        <div><h3>Seated<span class="lbl">At the kerb</span></h3><p>An immaculate car waits with the route already set, bottled water and chargers within reach.</p></div></div>
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5"/><path d="M10.5 20v-5h3v5"/></svg></div>
        <div><h3>Arrived<span class="lbl">Door to door</span></h3><p>The journey ends at your address in {em['name']}.</p></div></div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Included</span><h2>Attached to every journey.</h2></div>
    <div class="tagwrap rv">
      <div class="lugtag" role="list" aria-label="Included with every airport transfer">
        <div class="tg-head"><span class="lbl">Airport service manifest</span><b>UMC</b></div>
        <ul>
          <li role="listitem"><b class="t">Arrival monitoring</b><span>Your flight is tracked from departure; the pick-up adjusts to the actual landing time.</span></li>
          <li role="listitem"><b class="t">Reception</b><span>Your chauffeur waits in the arrivals hall with a name board and assists with luggage.</span></li>
          <li role="listitem"><b class="t">Cabin provisions</b><span>Bottled water, device chargers and tissues, prepared before every pick-up.</span></li>
          <li role="listitem"><b class="t">Cancellation</b><span>Released without charge up to 48 hours before the scheduled pick-up.</span></li>
        </ul>
        <div class="tg-foot"><span>No meter &middot; No surge</span><i>Priority handling</i></div>
      </div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap wide">
    <div class="shead rv"><span class="lbl">The fleet</span><h2>Choose your car.</h2><p class="lede">A seamless transfer between the terminal and your hotel, residence or boardroom, in the car that suits the moment.</p></div>
    <div class="fleet-grid" id="airportFleet"></div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Good to know</span><h2>Airport transfer questions</h2></div>
    <div class="faq rv">{faq_details(faqs)}</div>
  </div>
</section>
<section class="closing band-dark">
  <div class="wrap"><span class="lbl">Reservations</span><h2 class="rv">{em['closing_heading']}</h2>
  <div class="btns rv"><a class="btn btn-ink" href="/booking">Reserve your transfer</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + f"""
<script>document.addEventListener("DOMContentLoaded",function(){{renderFleet(document.getElementById("airportFleet"),{{emirate:"{em['slug']}"}})}});</script>
</body></html>"""
    (SITE/"airport-transfers").mkdir(parents=True, exist_ok=True)
    (SITE/"airport-transfers"/f"{em['slug']}.html").write_text(
        head(em["seo_title"], em["seo_meta"],
             f"airport-transfers/{em['slug']}", faq_schema(faqs)) + body)

for em in EMIRATES:
    render_emirate_airport_page(em)

# ---------- rent-a-car-with-driver (Phase B, by-the-hour service, per emirate) ----------
# These are legacy SEO URLs. The pages present the chauffeur-at-disposal /
# by-the-hour service per emirate. Rates are PULLED from UMC_RATES via
# renderFleet({emirate:"<slug>"}),single source of truth, so adding or
# changing prices in fleet-data.js propagates here automatically. Slugs match
# UMC_RATES keys: dubai, abu-dhabi, sharjah, rak, al-ain, umm-al-quwain.

RENT_EMIRATES = [
  {
    "slug": "dubai", "name": "Dubai",
    "airport_slug": "dubai",  # cross-link to /airport-transfers/dubai
    "h1": "Car Rental in Dubai with Driver",
    "hero_sub": "A professional chauffeur and a luxury car, for a half day, a full day, or an airport transfer.",
    "intro": "A dedicated chauffeur and a maintained luxury vehicle, for a 5-hour block, a 10-hour day, or a single airport run. UMC's chauffeur-at-disposal service operates 24 hours a day across Dubai. The rate you accept includes the chauffeur, fuel, Salik, parking and unlimited city mileage. Water and chargers are in the car.",
    "use_cases": "Corporate days, intercity meetings, family travel, sightseeing at your own pace, evenings out, anything that needs a clean schedule and a quiet cabin.",
    "seo_title": "Rent a Car with Driver in Dubai | UMC Dubai",
    "seo_meta": "Rent a luxury car with a professional chauffeur in Dubai, by the half day, full day or airport transfer. All-inclusive: fuel, Salik, parking.",
    "closing": "Dubai, on your schedule.",
  },
  {
    "slug": "abu-dhabi", "name": "Abu Dhabi",
    "airport_slug": "abu-dhabi",
    "h1": "Rent a Car with Driver in Abu Dhabi",
    "hero_sub": "A chauffeur for the day in the capital, on your timing and your route.",
    "intro": "From the Corniche to Yas Island, Saadiyat to Al Maryah, a chauffeur at your disposal turns the capital into a quiet day out. Reserve a 5-hour block, a 10-hour day, or a single transfer from Abu Dhabi International. Rates are all-inclusive: chauffeur, fuel, Salik, parking, with water and chargers in the car.",
    "use_cases": "Business meetings, government and embassy programmes, family days, the Grand Mosque circuit, Yas Island for the day, sightseeing at your own pace, late-night returns to Dubai.",
    "seo_title": "Rent a Car with Driver in Abu Dhabi | UMC Dubai",
    "seo_meta": "A private chauffeur in Abu Dhabi by the half day, full day or airport transfer. Late-model luxury vehicles, all-inclusive rates, 24/7.",
    "closing": "Abu Dhabi, on your timing.",
  },
  {
    "slug": "sharjah", "name": "Sharjah",
    "airport_slug": "sharjah",
    "h1": "Rent a Car with Driver in Sharjah",
    "hero_sub": "A private chauffeur for Sharjah and onward across the northern emirates.",
    "intro": "Sharjah's pace asks for an unhurried car. UMC's chauffeur-at-disposal service runs the emirate's avenues, the heritage neighbourhoods and the corporate addresses, with comfortable onward connections to Dubai and the northern emirates when the day requires it. Rates are all-inclusive: chauffeur, fuel, Salik and parking.",
    "use_cases": "Corporate days, university and embassy visits, family programmes, intercity transfers, evenings out, sightseeing at your own pace.",
    "seo_title": "Rent a Car with Driver in Sharjah | UMC Dubai",
    "seo_meta": "A private chauffeur in Sharjah by the half day or full day. Late-model luxury vehicles, all-inclusive rates, onward connections to Dubai.",
    "closing": "Sharjah, calmly driven.",
  },
  {
    "slug": "rak", "name": "Ras Al Khaimah",
    "airport_slug": "rak",
    "h1": "Rent a Car with Driver in Ras Al Khaimah",
    "hero_sub": "A chauffeur for the beachfront, Jebel Jais and any address in the emirate.",
    "intro": "Ras Al Khaimah rewards a relaxed pace. A chauffeur at your disposal makes the day work without the parking, the navigation or the return drive. UMC operates for a half day (5 hours), a full day (10 hours) or a single airport transfer across the emirate, with all-inclusive rates and a maintained luxury fleet. Water and chargers are in the car.",
    "use_cases": "Resort transfers, Al Marjan Island programmes, the drive up Jebel Jais, weddings and event movements, sightseeing at your own pace, family days.",
    "seo_title": "Rent a Car with Driver in Ras Al Khaimah | UMC Dubai",
    "seo_meta": "A private chauffeur in Ras Al Khaimah by the half day or full day. Resort transfers to Jebel Jais and Al Marjan, all-inclusive rates.",
    "closing": "Ras Al Khaimah, on your terms.",
  },
  {
    "slug": "al-ain", "name": "Al Ain",
    "airport_slug": "al-ain",
    "h1": "Rent a Car with Driver in Al Ain",
    "hero_sub": "The garden city met calmly, with a chauffeur for the day.",
    "intro": "Al Ain rewards an unhurried visit. A chauffeur at your disposal turns the oases, the heritage sites and Jebel Hafeet into a single composed day. UMC's half-day and full-day service operates throughout the city, with all-inclusive rates: chauffeur, fuel, Salik and parking.",
    "use_cases": "Heritage circuits, the Jebel Hafeet road, university and embassy programmes, family days, intercity transfers back to Dubai or Abu Dhabi.",
    "seo_title": "Rent a Car with Driver in Al Ain | UMC Dubai",
    "seo_meta": "A private chauffeur in Al Ain, for a half day or a full day. Oases, Jebel Hafeet and heritage circuits, with all-inclusive rates and a maintained luxury fleet.",
    "closing": "Al Ain, taken slowly.",
  },
  {
    "slug": "umm-al-quwain", "name": "Umm Al Quwain",
    "airport_slug": None,
    "h1": "Rent a Car with Driver in Umm Al Quwain",
    "hero_sub": "A private chauffeur for the quietest of the emirates, on your timing.",
    "intro": "Umm Al Quwain runs at its own pace. A chauffeur at your disposal makes the day work without the logistics. UMC's half-day and full-day service covers the corniche, the lagoons and any address in the emirate, with all-inclusive rates and a maintained luxury fleet. Onward routes to Dubai, Sharjah and Ras Al Khaimah are handled in the same booking.",
    "use_cases": "Resort and lagoon transfers, family days, intercity connections, sightseeing at your own pace.",
    "seo_title": "Rent a Car with Driver in Umm Al Quwain | UMC Dubai",
    "seo_meta": "A private chauffeur in Umm Al Quwain, for a half day or a full day. Lagoons and resort transfers, with all-inclusive rates and a maintained luxury fleet.",
    "closing": "Umm Al Quwain, quietly handled.",
  },
]

def rentacar_schema(em):
    canon = f"https://umcdubai.ae/rent-a-car-with-driver/{em['slug']}/"
    data = {
        "@context": "https://schema.org",
        "@type": "Service",
        "name": f"Chauffeur driven car rental in {em['name']}",
        "serviceType": "Chauffeur service",
        "areaServed": {"@type": "AdministrativeArea", "name": em["name"]},
        "provider": {
            "@type": "Organization", "name": "UMC Dubai",
            "url": "https://umcdubai.ae/",
            "logo": {"@type": "ImageObject", "url": f"{OG_BASE}/assets/og-image.png"}
        },
        "url": canon,
        "description": em["seo_meta"],
    }
    return '<script type="application/ld+json">' + json.dumps(data, separators=(",", ":")) + '</script>'

def render_rentacar_page(em):
    others = [o for o in RENT_EMIRATES if o["slug"] != em["slug"]]
    other_links = "".join(
        f'<li><a href="/rent-a-car-with-driver/{o["slug"]}/">{o["name"]}</a></li>'
        for o in others
    )
    # v66: the "Airport transfers in {Emirate}" bordered button was removed
    # from this section. It was category-mismatched (this block is about other
    # emirates' chauffeur pages, not airport transfers) and visually left-
    # aligned under the centered pills. Airport Transfers lives in the global
    # header nav.
    body = header(f"rent-a-car-with-driver/{em['slug']}") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">Chauffeur at your disposal</span>
    <h1>{em['h1']}</h1>
    <p class="lede">{em['hero_sub']}</p>
    <div class="btns rv" style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="/booking">Reserve your car</a>
      <a class="btn btn-ghost" href="/contact">Request a quote</a>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">The service</span><h2>The half day, the full day, the airport run.</h2></div>
    <p class="lede rv" style="text-align:center;max-width:62ch;margin:0 auto 1.4rem">{em['intro']}</p>
    <p class="lede rv" style="text-align:center;max-width:62ch;margin:0 auto 0;color:var(--muted)">{em['use_cases']}</p>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">How it works</span><h2>From request to kerbside, in a few clean steps.</h2></div>
    <div class="timeline rv">
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg></div>
        <div><h3>Choose your vehicle<span class="lbl">From the fleet</span></h3><p>Mercedes E Class, S Class, BMW 7 Series, Cadillac Escalade, GMC Yukon XL, Mercedes V Class, Lexus ES, or a Sprinter or coach for a group.</p></div></div>
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
        <div><h3>Pick the duration<span class="lbl">5hr, 10hr, transfer</span></h3><p>A 5-hour block for an afternoon, a 10-hour day for a full programme, or a single airport transfer. All quoted up-front.</p></div></div>
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M3 12h13l-4-4M16 12l-4 4"/></svg></div>
        <div><h3>Get an all-inclusive rate<span class="lbl">No meter</span></h3><p>Chauffeur, fuel, Salik, parking and unlimited city mileage are already in the quoted rate.</p></div></div>
      <div class="tstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg></div>
        <div><h3>Reserve<span class="lbl">Personally confirmed</span></h3><p>Confirmation is handled by a person, with the chauffeur's details before the pick-up.</p></div></div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Included</span><h2>Attached to every booking.</h2></div>
    <div class="tagwrap rv">
      <div class="lugtag" role="list" aria-label="What is included with every chauffeur-at-disposal booking">
        <div class="tg-head"><span class="lbl">Service manifest</span><b>UMC</b></div>
        <ul>
          <li role="listitem"><b class="t">Professional chauffeur</b><span>Vetted, trained, presentable, discreet. The same standard, every booking.</span></li>
          <li role="listitem"><b class="t">All-inclusive rate</b><span>Fuel, Salik and parking are already in the quoted rate. No meter.</span></li>
          <li role="listitem"><b class="t">Unlimited city mileage</b><span>Move around the city without watching the odometer.</span></li>
          <li role="listitem"><b class="t">Cabin provisions</b><span>Bottled water, device chargers and tissues, prepared before every pick-up.</span></li>
          <li role="listitem"><b class="t">24 hours a day</b><span>Early starts, late finishes, overnight transfers. We staff for the hours you need.</span></li>
        </ul>
        <div class="tg-foot"><span>No surge &middot; No metered fares</span><i>Confirmed by a person</i></div>
      </div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap wide">
    <div class="shead rv"><span class="lbl">The fleet</span><h2>Choose your car.</h2><p class="lede">Rates below are for {em['name']}. The in-card selector swaps any vehicle's rates to another emirate.</p></div>
    <div class="fleet-grid" id="rentFleet"></div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Also available in</span><h2>Across the UAE.</h2></div>
    <ul class="emirate-xlinks rv">
      {other_links}
    </ul>
  </div>
</section>
<section class="closing band-dark">
  <div class="wrap"><span class="lbl">Reservations</span><h2 class="rv">{em['closing']}</h2>
  <div class="btns rv"><a class="btn btn-ink" href="/booking">Reserve your car</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + f"""
<script>document.addEventListener("DOMContentLoaded",function(){{renderFleet(document.getElementById("rentFleet"),{{emirate:"{em['slug']}"}})}});</script>
</body></html>"""
    out_dir = SITE / "rent-a-car-with-driver" / em["slug"]
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.html").write_text(
        head(em["seo_title"], em["seo_meta"],
             f"rent-a-car-with-driver/{em['slug']}/",
             rentacar_schema(em)) + body
    )

for _em in RENT_EMIRATES:
    render_rentacar_page(_em)

# ---------- chauffeur-service HUB at /rent-a-car-with-driver/ (v65) ----------
# Net-new page (the legacy site had no parent hub for this cluster). Mirrors
# /airport-transfers in rhythm: hero, service intro, 6-emirate directory grid,
# what's included manifest, FAQ, closing dark band. Single source of truth on
# rates lives in fleet-data.js; this hub does not duplicate prices.

RENTHUB_FAQS = [
  ("What is a chauffeur-at-disposal booking?",
   "A dedicated chauffeur and a maintained luxury vehicle, reserved for a block of time. The car stays with you for the duration. You set the itinerary, the chauffeur handles the route, the parking and the timing."),
  ("What is included in the rate?",
   "Everything: the chauffeur, fuel, Salik, parking and unlimited city mileage. Bottled water and device chargers are in the car. The quote you accept is the quote you pay."),
  ("Which emirates do you cover?",
   "All six emirates that we serve as standard with this service: Dubai, Abu Dhabi, Sharjah, Ras Al Khaimah, Al Ain and Umm Al Quwain. Cross-emirate journeys are routine and handled in the same booking."),
  ("Half day or full day?",
   "Both. A five-hour block suits an afternoon, a meeting circuit or an evening out. A ten-hour day covers a full programme. A single transfer is a separate option on the airport-transfer pages."),
  ("How does booking work?",
   "Reserve via the booking page or WhatsApp. Confirmation is handled personally, and the chauffeur's details reach you before the pick-up."),
  ("How is this different from an airport transfer?",
   "An airport transfer is a single point-to-point ride priced per leg. Chauffeur-at-disposal reserves the car and the chauffeur for a block of hours, so the same car stays with you across multiple stops or the full day."),
]

def renthub_schema():
    canon = "https://umcdubai.ae/rent-a-car-with-driver/"
    service = {
        "@context": "https://schema.org",
        "@type": "Service",
        "name": "Chauffeur service across the UAE",
        "serviceType": "Chauffeur driven car hire",
        "areaServed": {"@type": "Country", "name": "United Arab Emirates"},
        "provider": {
            "@type": "Organization", "name": "UMC Dubai",
            "url": "https://umcdubai.ae/",
            "logo": {"@type": "ImageObject", "url": f"{OG_BASE}/assets/og-image.png"}
        },
        "url": canon,
        "description": "Chauffeur service for a half day or a full day, across all six emirates we serve. All-inclusive rates with fuel, Salik and parking included.",
    }
    item_list = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Chauffeur service by emirate",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1,
             "url": f"https://umcdubai.ae/rent-a-car-with-driver/{em['slug']}/",
             "name": f"Chauffeur service in {em['name']}"}
            for i, em in enumerate(RENT_EMIRATES)
        ],
    }
    return ('<script type="application/ld+json">' + json.dumps(service, separators=(",", ":")) + '</script>'
          + '<script type="application/ld+json">' + json.dumps(item_list, separators=(",", ":")) + '</script>')

def render_rentacar_hub():
    cards = []
    for em in RENT_EMIRATES:
        # One-line essence per emirate (pulled from each page's existing intro).
        descriptor = {
          "dubai": "Business days, events and evenings across the city.",
          "abu-dhabi": "The capital: Corniche, Yas Island, Saadiyat, on your timing.",
          "sharjah": "Unhurried, cultural, with quiet onward routes to the north.",
          "rak": "A relaxed pace, the beachfront and the Jebel Jais road.",
          "al-ain": "Oases, heritage and Jebel Hafeet, taken slowly.",
          "umm-al-quwain": "Lagoons, the quiet corniche, handled without logistics.",
        }.get(em["slug"], "")
        cards.append(f"""
      <a class="ch-card rv" href="/rent-a-car-with-driver/{em['slug']}/">
        <span class="lbl">Chauffeur</span>
        <h3>{em['name']}</h3>
        <p>{descriptor}</p>
        <span class="ch-go">View service<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg></span>
      </a>""")
    body = header("rent-a-car-with-driver/") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">Half day &middot; Full day &middot; Across the UAE</span>
    <h1>Chauffeur service, across the Emirates.</h1>
    <p class="lede">A dedicated chauffeur and a luxury vehicle, for a half day or a full day, in any emirate.</p>
    <div class="btns rv" style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="/booking">Reserve your car</a>
      <a class="btn btn-ghost" href="/contact">Request a quote</a>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">The service</span><h2>One chauffeur, one car, for the time you need.</h2></div>
    <p class="lede rv" style="text-align:center;max-width:62ch;margin:0 auto">A five-hour block for an afternoon, a ten-hour day for a full programme, or a single transfer when that is all the day requires. The rate is all-inclusive: the chauffeur, fuel, Salik, parking and unlimited city mileage. The car stays with you. The standard does not change between bookings.</p>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap wide">
    <div class="shead rv"><span class="lbl">By emirate</span><h2>Choose where you need the car.</h2><p class="lede">Six emirates, one standard. Tap an emirate for its rates and the full fleet.</p></div>
    <div class="ch-grid">
      {''.join(cards)}
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Included</span><h2>Attached to every booking.</h2></div>
    <div class="tagwrap rv">
      <div class="lugtag" role="list" aria-label="What is included with every chauffeur-at-disposal booking">
        <div class="tg-head"><span class="lbl">Service manifest</span><b>UMC</b></div>
        <ul>
          <li role="listitem"><b class="t">Professional chauffeur</b><span>Vetted, trained, presentable, discreet. The same standard, every booking.</span></li>
          <li role="listitem"><b class="t">All-inclusive rate</b><span>Fuel, Salik and parking are already in the quoted rate. No meter, no surge.</span></li>
          <li role="listitem"><b class="t">Unlimited city mileage</b><span>Move around the city without watching the odometer.</span></li>
          <li role="listitem"><b class="t">Cabin provisions</b><span>Bottled water, device chargers and tissues, prepared before every pick-up.</span></li>
          <li role="listitem"><b class="t">24 hours a day</b><span>Early starts, late finishes, overnight transfers. We staff for the hours you need.</span></li>
        </ul>
        <div class="tg-foot"><span>No meter &middot; No surge</span><i>Confirmed by a person</i></div>
      </div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Good to know</span><h2>Chauffeur service questions</h2></div>
    <div class="faq rv">{faq_details(RENTHUB_FAQS)}</div>
  </div>
</section>
<section class="closing band-dark">
  <div class="wrap"><span class="lbl">Reservations</span><h2 class="rv">A chauffeur for the half day, the full day, or the airport run.</h2>
  <div class="btns rv"><a class="btn btn-ink" href="/booking">Reserve your car</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + "</body></html>"
    (SITE / "rent-a-car-with-driver").mkdir(parents=True, exist_ok=True)
    (SITE / "rent-a-car-with-driver" / "index.html").write_text(
        head("Rent a Car with Driver Across the UAE | UMC Dubai",
             "Chauffeur service across the UAE: a private driver and luxury car by the half day or full day. All-inclusive rates, fuel, Salik and parking.",
             "rent-a-car-with-driver/", renthub_schema()) + body)

render_rentacar_hub()

# ---------- corporate ----------
# v27 T2,replaced the v25 T3 "What your programme receives" 6-up grid and
# "Operational in 48 hours" 3-step onboarding with the single Account File dossier.
# To revert: restore the two <section class="sec"> blocks below in place of the .dossier markup.
# --- v25 corporate blocks (preserved for revert) ---
# <section class="sec">
#   <div class="wrap">
#     <div class="shead rv"><span class="lbl">Corporate accounts</span><h2>What your programme receives.</h2></div>
#     <div class="std rv">
#       <div><span class="lbl">Account</span><h3>One account, one invoice</h3><p>A dedicated account contact, consolidated monthly invoicing with per-journey breakdowns, and cost-centre references on request.</p></div>
#       <div><span class="lbl">Booking</span><h3>Book for anyone</h3><p>Assistants and travel managers reserve for executives and guests in minutes by phone, WhatsApp or email. A name board waits at every arrival.</p></div>
#       <div><span class="lbl">Duty of care</span><h3>Vetted and accountable</h3><p>Employed and background-checked chauffeurs in maintained late-model vehicles, with live flight tracking and a human escalation path at any hour.</p></div>
#       <div><span class="lbl">Roadshows</span><h3>Movements, to the minute</h3><p>Investor roadshows, delegations and multi-car convoys coordinated under a single point of contact.</p></div>
#       <div><span class="lbl">Discretion</span><h3>Confidential by default</h3><p>Our chauffeurs serve senior executives daily. Conversations, documents and itineraries stay in the car.</p></div>
#       <div><span class="lbl">Certainty</span><h3>Fixed corporate rates</h3><p>Agreed rates that include the chauffeur, fuel, Salik and parking, so finance sees no surprises.</p></div>
#     </div>
#   </div>
# </section>
# {JL}
# <section class="sec">
#   <div class="wrap">
#     <div class="shead rv"><span class="lbl">Onboarding</span><h2>Operational in 48 hours.</h2></div>
#     <div class="hsteps rv">
#       <div class="hstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 7l8 6 8-6"/></svg></div><span class="when">Hour zero</span><h3>The enquiry</h3><p>Tell us how your company moves. Travel patterns, monthly volume, the departments involved and the standards you hold. We design the account to fit.</p></div>
#       <div class="hstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg></div><span class="when">Within a day</span><h3>Your rate card</h3><p>Fixed corporate rates for the classes you use, with everything included and nothing metered.</p></div>
#       <div class="hstep"><div class="node"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/></svg></div><span class="when">Within 48 hours</span><h3>Account live</h3><p>Your team books any service on the account: airport transfers, hourly hire, inter-emirate journeys and events. Every booking runs to one standard. One consolidated invoice arrives at month-end.</p></div>
#     </div>
#   </div>
# </section>
# --- end revert block ---
corp_body = header("corporate.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">DIFC &middot; Business Bay &middot; Downtown</span>
    <h1>Corporate chauffeur in Dubai &amp; the UAE</h1>
    <p class="lede">Ground transport your company can rely on. Confirmed cars, vetted chauffeurs, consolidated invoicing and a human on the line at any hour.</p>
    <div style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="/contact?vehicle=Corporate%20Account">Open a corporate account</a>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="dossier acctfile rv">
      <div class="ca-bar" aria-hidden="true">
        <span class="ca-bar-l"><span class="ca-punch"></span>Corporate account · File UMC-CA-2026-041</span>
        <span class="ca-bar-r">Private &amp; confidential</span>
      </div>

      <header class="ds-head">
        <div class="ds-headL">
          <span class="ds-kicker">UMC Dubai, Corporate Account</span>
          <h2 class="ds-title">Your account, on file.</h2>
          <p class="ds-intro">One agreement covers how your company moves. Everything in this file is held on your account and applied to every journey, for every traveller you send.</p>
        </div>
        <div class="ca-seal" aria-hidden="true">
          <svg viewBox="0 0 88 88">
            <defs><path id="caCirc" d="M44,44 m-31,0 a31,31 0 1,1 62,0 a31,31 0 1,1 -62,0"/></defs>
            <text class="ca-seal-ring"><textPath href="#caCirc">UMC DUBAI · CORPORATE DESK · 24/7 ·</textPath></text>
          </svg>
          <span class="ca-seal-mark">UMC</span>
        </div>
      </header>

      <div class="ca-registry">
        <div class="ca-field"><span class="ca-k">Account holder</span><span class="ca-v">Your company</span></div>
        <div class="ca-field"><span class="ca-k">Account contact</span><span class="ca-v">Dedicated, named</span></div>
        <div class="ca-field"><span class="ca-k">Invoicing</span><span class="ca-v">Monthly, consolidated</span></div>
        <div class="ca-field"><span class="ca-k">Status</span><span class="ca-v ca-open"><span class="ca-dot"></span>Open in 48 hours</span></div>
      </div>

      <div class="ca-sched-head"><span class="ca-sched-t">Schedule of services</span><span class="ca-sched-n">Applies to every journey on the account</span></div>

      <div class="ca-clauses">
        <div class="ca-clause"><span class="ca-no">01</span><div><h3 class="ca-ct">One account, one invoice</h3><p class="ca-cd">A dedicated account contact, consolidated monthly invoicing with per-journey breakdowns, and cost-centre references on request.</p></div></div>
        <div class="ca-clause"><span class="ca-no">02</span><div><h3 class="ca-ct">Booking authority</h3><p class="ca-cd">Assistants and travel managers reserve for executives and guests in minutes by phone, WhatsApp or email. A name board waits at every arrival.</p></div></div>
        <div class="ca-clause"><span class="ca-no">03</span><div><h3 class="ca-ct">Duty of care</h3><p class="ca-cd">Employed and background-checked chauffeurs in maintained late-model vehicles, with live flight tracking and a human escalation path at any hour.</p></div></div>
        <div class="ca-clause"><span class="ca-no">04</span><div><h3 class="ca-ct">Roadshows &amp; movements</h3><p class="ca-cd">Investor roadshows, delegations and multi-car convoys coordinated to the minute under a single point of contact.</p></div></div>
        <div class="ca-clause"><span class="ca-no">05</span><div><h3 class="ca-ct">Discretion</h3><p class="ca-cd">Our chauffeurs serve senior executives daily. Conversations, documents and itineraries stay in the car.</p></div></div>
        <div class="ca-clause"><span class="ca-no">06</span><div><h3 class="ca-ct">Fixed corporate rates</h3><p class="ca-cd">Agreed rates that include the chauffeur, fuel, Salik and parking, so finance sees no surprises.</p></div></div>
      </div>

      <div class="ca-approval">
        <div class="ca-sig">
          <div class="ca-sigline"><span class="ca-signame">Awaiting your signature</span></div>
          <span class="ca-sigcap">Authorised signatory · Your company</span>
        </div>
        <div class="ca-stamp" aria-hidden="true">Account opens<b>Within 48 hrs</b>of company details</div>
      </div>

      <footer class="ds-foot">
        <span class="ds-foot-line">Held in confidence · One account · One standard</span>
        <a class="ds-foot-cta" href="/contact?vehicle=Corporate%20Account">Open an account →</a>
      </footer>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Good to know</span><h2>Corporate account questions</h2></div>
    <div class="faq rv">{faq_details(CORP_FAQS)}</div>
  </div>
</section>
<section class="closing band-dark">
  <div class="wrap"><span class="lbl">Corporate accounts</span><h2 class="rv">Your executives, moved without friction.</h2>
  <div class="btns rv"><a class="btn btn-ink" href="/contact?vehicle=Corporate%20Account">Open a corporate account</a><a class="btn btn-ghost" href="tel:+971586497861">Call the desk</a></div></div>
</section>
""" + FOOTER + "</body></html>"
(SITE/"corporate.html").write_text(
 head("Corporate Chauffeur Service in Dubai | UMC Dubai",
      "Corporate chauffeur programmes in Dubai: consolidated invoicing, book-for-a-guest, vetted chauffeurs and 24/7 support. Live in 48 hours.",
      "corporate", faq_schema(CORP_FAQS)) + corp_body)

# ---------- about ----------
about_body = header("about.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">The company</span>
    <h1>A chauffeur company built on a single, stubborn standard.</h1>
    <p class="lede">UMC Dubai exists because &ldquo;good enough&rdquo; ground transport is not good enough for the people we serve. Every car immaculate. Every chauffeur vetted. Every detail attended to. Every hour of every day.</p>
  </div>
</section>
<section class="closing band-dark numband-sec" style="padding:3.6rem 0">
  <div class="wrap">
    <div class="numband rv">
      <div><div class="n" data-count="5" data-decimals="1"><span class="num">5.0</span><sup>&#9733;</sup></div><div class="d">Google rating</div></div>
      <div><div class="n" data-count="2500" data-commas="1"><span class="num">2,500</span><sup>+</sup></div><div class="d">Clients served</div></div>
      <div><div class="n" data-count="7"><span class="num">7</span></div><div class="d">Emirates covered</div></div>
      <div><div class="n" data-count="24"><span class="num">24</span><sup>/7</sup></div><div class="d">Concierge desk</div></div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Who we serve</span><h2>Trusted by the people Dubai trusts.</h2>
    <p class="lede">Executives between DIFC meetings. Families arriving for the season. High-profile guests whose schedules forgive nothing, and the assistants and travel managers who orchestrate it all. Guests and delegations served for Emirates, Jetex, IIFA Awards and Gulfood.</p></div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">The standard</span><h2>What &ldquo;chauffeur-grade&rdquo; means at UMC.</h2></div>
    <div class="std rv">
      <div><span class="lbl">The chauffeur</span><h3>Selected, then trained</h3><p>Vetted backgrounds, hospitality training, fluent English, and an expert command of every route between the seven emirates.</p></div>
      <div><span class="lbl">The vehicle</span><h3>Immaculate, every time</h3><p>Late-model cars detailed between journeys, stocked with bottled water and chargers and inspected before every pick-up.</p></div>
      <div><span class="lbl">The operation</span><h3>A human, at 3 a.m.</h3><p>A concierge desk that answers around the clock, flight tracking on every airport journey and routes planned before the engine starts.</p></div>
    </div>
  </div>
</section>
<section class="closing band-dark">
  <div class="wrap"><span class="lbl">Reservations</span><h2 class="rv">Judge us by a single journey.</h2>
  <div class="btns rv"><a class="btn btn-ink" href="/booking">Reserve your car</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + "</body></html>"
(SITE/"about.html").write_text(
 head("About UMC Dubai, A Chauffeur Company Built on Standards",
      "UMC Dubai is the luxury chauffeur company serving executives, families and high-profile guests across the UAE, one standard, 24 hours a day.",
      "about") + about_body)

# ---------- events / occasions ----------
EVENTS_WA = "https://api.whatsapp.com/send?phone=971586497861&text=Hello%20UMC%20Dubai%2C%20I%20would%20like%20to%20discuss%20chauffeur%20service%20for%20an%20event."
events_body = header("events.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">Weddings &middot; Galas &middot; Private celebrations</span>
    <h1>Arrivals worth remembering.</h1>
    <p class="lede">For the occasions that deserve more than a car: a coordinated fleet, one point of contact and a standard that holds from the first arrival to the last.</p>
    <div class="btns rv" style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="/contact">Plan your occasion</a>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="dossier flmove rv">
      <header class="ds-head">
        <div class="ds-headL">
          <span class="ds-kicker">UMC Dubai, Fleet Movement Order</span>
          <h2 class="ds-title">A fleet in formation, however large.</h2>
          <p class="ds-intro">From a single car to a convoy of more than a hundred, across one day or many. Every vehicle planned, staged and timed as one movement, your coordinator working alongside ours.</p>
        </div>
        <div class="mo-no" aria-hidden="true">Order No. <b>MO-2026-117</b><span>Issued by the concierge desk</span></div>
      </header>

      <div class="mo-strength">
        <div class="mo-cell"><span class="mo-k">Fleet assigned</span><span class="mo-v">1–100+ vehicles</span></div>
        <div class="mo-cell"><span class="mo-k">Duration</span><span class="mo-v">Single or multi-day</span></div>
        <div class="mo-cell"><span class="mo-k">Status</span><span class="mo-v mo-ready"><span class="mo-dot"></span>Ready to plan</span></div>
      </div>

      <div class="mo-timeline">
        <div class="mo-move">
          <div class="mo-t">14 days before<small>Enquiry</small></div>
          <div class="mo-node" aria-hidden="true"></div>
          <div class="mo-card"><div class="mo-row"><h3>You tell us the occasion</h3><span class="mo-stamp">Quoted</span></div><p>The occasion, the guests, the venues. We quote the fleet, and add cars as the plan grows.</p></div>
        </div>
        <div class="mo-move">
          <div class="mo-t">7 days before<small>Planning</small></div>
          <div class="mo-node" aria-hidden="true"></div>
          <div class="mo-card"><div class="mo-row"><h3>Every movement agreed</h3><span class="mo-stamp">Scheduled</span></div><p>Your coordinator and ours settle each movement: airport arrivals, shuttles, every car assigned to its party, hour by hour.</p></div>
        </div>
        <div class="mo-move">
          <div class="mo-t">90 min before<small>Staging</small></div>
          <div class="mo-node" aria-hidden="true"></div>
          <div class="mo-card"><div class="mo-row"><h3>Cars staged on site</h3><span class="mo-stamp">Staged</span></div><p>Every vehicle positioned, inspected and dressed before the first guest is anywhere near a kerb.</p></div>
        </div>
        <div class="mo-move mo-hhour">
          <div class="mo-t">On the hour<small>First arrival</small></div>
          <div class="mo-node" aria-hidden="true"></div>
          <div class="mo-card"><div class="mo-row"><h3>The fleet moves as one</h3><span class="mo-stamp mo-hot">Underway</span></div><p>Arrivals to the minute, convoys in formation, one point of contact through to the last departure.</p></div>
        </div>
      </div>

      <div class="mo-reserve">
        <span class="mo-rk">Held in reserve</span>
        <p>Spare cars stand by throughout for the unplanned, so a change of guest or schedule is never a problem you see. Rolls-Royce, limousines, S&nbsp;Class — a matched fleet of any marque.</p>
      </div>

      <footer class="ds-foot">
        <span class="ds-foot-line">One movement · One point of contact · Nothing your guests see go wrong</span>
        <a class="ds-foot-cta" href="/contact">Plan your event →</a>
      </footer>
    </div>
  </div>
</section>
{JL}
<section class="occ">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Occasions</span><h2>For the days that matter most.</h2></div>
    <div class="occ-list rv">
      <div class="occ-row">
        <div class="occ-txt"><div class="on">01</div><h3>Weddings</h3><p>A matched fleet for the couple and their guests, coordinated to the ceremony&rsquo;s timing. Ribboned cars on request, and a single chauffeur lead who answers to your planner, not to a dispatch line.</p></div>
        <div class="occ-side"><div class="li">Bridal car, dressed to your palette</div><div class="li">Guest shuttles between venues</div><div class="li">One coordinator across every vehicle</div></div>
      </div>
      <div class="occ-row">
        <div class="occ-txt"><div class="on">02</div><h3>Corporate &amp; galas</h3><p>Arrivals timed to the minute for conferences, award nights and delegations. Multiple cars moved as one convoy, with a manifest your office approves in advance.</p></div>
        <div class="occ-side"><div class="li">Convoy movements, single contact</div><div class="li">Branded welcome signage</div><div class="li">Monthly invoice, no per-trip admin</div></div>
      </div>
      <div class="occ-row">
        <div class="occ-txt"><div class="on">03</div><h3>Private celebrations</h3><p>Birthdays, anniversaries and family milestones, given the same discretion as a head-of-state movement. The cabin prepared to your preferences before you step in.</p></div>
        <div class="occ-side"><div class="li">Cabin prepared to your taste</div><div class="li">Child seats on request</div><div class="li">Discreet, vetted chauffeurs</div></div>
      </div>
    </div>
  </div>
</section>
<section class="closing band-dark">
  <div class="wrap"><span class="lbl">Occasions</span><h2 class="rv">Begin with the standard.</h2>
  <div class="btns rv"><a class="btn btn-ink" href="/contact">Plan your occasion</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{EVENTS_WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + "</body></html>"
(SITE/"events.html").write_text(
 head("Wedding & Event Chauffeur Service Dubai | UMC Dubai",
      "Chauffeur service for weddings, galas and private events across the UAE. A coordinated fleet, one point of contact and a standard that never changes.",
      "events") + events_body)

# ---------- contact (with verbatim terms) ----------
contact_body = header("contact.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">Concierge,24/7</span>
    <h1>A human answers. At any hour.</h1>
    <p class="lede">Call, WhatsApp or write, for reservations, changes, corporate accounts or special requests.</p>
  </div>
</section>
<section class="sec" style="padding-top:2.4rem">
  <div class="wrap">
    <div class="bk-layout">
      <div class="bk-card" id="ctFormCard">
        <h2>Reservation request</h2>
        <div class="two">
          <div class="f"><label class="req" for="cName">Full name</label><input id="cName" required></div>
          <div class="f"><label class="req" for="cPhone">Phone / WhatsApp</label>
            <div class="phonewrap">
              <span class="cc"><select id="cCC" aria-label="Country code">{CC_OPTIONS}</select></span>
              <span class="num"><input id="cPhone" type="tel" inputmode="tel" required placeholder="5x xxx xxxx"></span>
            </div><span class="fhint phone-err"></span></div>
        </div>
        <div class="f"><label class="req" for="cEmail">Email</label><input id="cEmail" type="email" autocomplete="email" required><span class="fhint">Enter a valid email address, e.g. name@domain.com</span></div>
        <div class="f"><label for="cVehicle">Vehicle or service</label><input id="cVehicle" name="vehicle" placeholder="S Class, airport transfer, corporate account&hellip;"></div>
        <div class="f"><label for="cMsg">Your request</label><textarea id="cMsg" rows="4" placeholder="Route, date and time, number of guests&hellip;"></textarea></div>
        <div class="cf-turnstile" data-sitekey="0x4AAAAAADpUlIS_5IkgJa-H" id="ctTs" style="margin:.2rem 0 1rem"></div>
        <button class="btn btn-ink" style="width:100%" id="cSend" type="button">Send request</button>
        <p class="bk-note">Prefer email? <a href="mailto:contact@umcdubai.ae" style="border-bottom:1px solid var(--amber)">contact@umcdubai.ae</a></p>
      </div>
      <div class="bk-card hide" id="ctDone" style="text-align:center">
        <h2>Request received</h2>
        <p class="lede" style="margin-bottom:1rem">Thank you! Our team will confirm the details with you shortly. We&rsquo;re opening WhatsApp so you can reach us directly, if it doesn&rsquo;t open, or you&rsquo;d prefer, call us on <a href="tel:+971586497861" style="border-bottom:1px solid var(--amber);color:var(--ink)">+971 58 649 7861</a> or email <a href="mailto:contact@umcdubai.ae" style="border-bottom:1px solid var(--amber);color:var(--ink)">contact@umcdubai.ae</a>.</p>
      </div>
      <div class="bk-card">
        <div class="chatcard rv" aria-hidden="true">
          <div class="ch-top"><span class="ch-dot">U</span><span><b>UMC Concierge</b><em>Online now</em></span></div>
          <div class="bub in">Landing at DXB T3 at 23:40 tonight, EK 004,book an S&#8209;Class for my transfer.</div>
          <div class="bub out">Your chauffeur will be waiting at arrivals with a name board at 23:40. EK 004 is being tracked, written confirmation follows here.</div>
          <div class="stamp">Typical reply, under five minutes</div>
        </div>
        <h2>Direct lines</h2>
        <div class="dl">
          <div class="row"><span class="k">Phone &amp; WhatsApp</span><span class="v"><a href="tel:+971586497861">+971 58 649 7861</a></span></div>
          <div class="row"><span class="k">Email</span><span class="v"><a href="mailto:contact@umcdubai.ae">contact@umcdubai.ae</a></span></div>
          <div class="row"><span class="k">Hours</span><span class="v">24 hours, 7 days</span></div>
          <div class="row"><span class="k">Base</span><span class="v">Dubai, United Arab Emirates</span></div>
          <div class="row"><span class="k">Coverage</span><span class="v">All seven emirates</span></div>
        </div>
      </div>
    </div>
  </div>
</section>

""" + FOOTER + """
<script>
function trackLead(formId, service){
  try{
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'lead_submit', form_id: formId, service: service || '' });
  }catch(e){}
}
var cEmailEl = document.getElementById("cEmail");
var C_EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
cEmailEl.addEventListener("input", function(){
  this.closest(".f").classList.toggle("bad", this.value.length>0 && !C_EMAIL_RX.test(this.value));
});
document.getElementById("cSend").addEventListener("click", function(){
  const g = id => (document.getElementById(id)||{}).value || "";
  const need = [["cName","your name"],["cPhone","your phone number"],["cEmail","your email"]];
  for(const [id,label] of need){
    const el = document.getElementById(id);
    if(!g(id)){ el.setCustomValidity("Please add " + label + "."); el.reportValidity(); el.setCustomValidity(""); return; }
  }
  if(!C_EMAIL_RX.test(g("cEmail"))){ cEmailEl.setCustomValidity("Please enter a valid email address."); cEmailEl.reportValidity(); cEmailEl.setCustomValidity(""); return; }
  const cPhoneEl = document.getElementById("cPhone");
  const cCCEl = document.getElementById("cCC");
  if(window.umcPhone && !window.umcPhone.valid(cPhoneEl, cCCEl)){
    const msg = window.umcPhone.errMsg(cCCEl);
    const w = cPhoneEl.closest(".f");
    if(w){ w.classList.add("bad"); const ee = w.querySelector(".phone-err"); if(ee) ee.textContent = msg; }
    cPhoneEl.setCustomValidity(msg); cPhoneEl.reportValidity(); cPhoneEl.setCustomValidity(""); return;
  }
  // strip leading zero for the outgoing message so the international number is clean
  const cPhoneOut = window.umcPhone ? window.umcPhone.significantDigits(g("cPhone")) : g("cPhone");
  // Same payload shape as the booking form; source distinguishes the two streams in the
  // Sheet/Mailchimp. Empty fields (service, pickup, destination, date, time, days, flight,
  // sign) are stripped by the Worker's emailRows() helper so the internal + client emails
  // don't show blank rows.
  const ctTok = (document.querySelector('#ctTs [name="cf-turnstile-response"]') || {}).value || "";
  const cPayload = {
    source: "contact-form",
    turnstileToken: ctTok,
    name: g("cName"), phone: "+" + cCCEl.value + " " + cPhoneOut, email: g("cEmail"),
    service: "", pickup: "", destination: "",
    date: "", time: "", vehicle: g("cVehicle"), days: "",
    flight: "", sign: "", notes: g("cMsg"),
    page: location.pathname, ts: new Date().toISOString()
  };
  try { fetch("/api/lead", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(cPayload)}).then(function(res){ if(res.ok) trackLead('contact', g("cVehicle")); }).catch(function(){}); } catch(_){}

  // Swap the form card for the done panel, then open WhatsApp ~600ms later.
  const formCard = document.getElementById("ctFormCard");
  const doneCard = document.getElementById("ctDone");
  if (formCard) formCard.classList.add("hide");
  if (doneCard) {
    doneCard.classList.remove("hide");
    doneCard.scrollIntoView({behavior:"smooth", block:"start"});
  }
  // Polished WhatsApp pre-fill (v22),same template as the booking form for consistency.
  // Compose as plain text + encodeURIComponent once; skip any empty field.
  const cLines = ["Hello UMC Dubai, I'd like to request a reservation.", ""];
  cLines.push("Name: " + g("cName"));
  const cContactBits = ["+" + cCCEl.value + " " + cPhoneOut];
  if (g("cEmail")) cContactBits.push(g("cEmail"));
  cLines.push("Contact: " + cContactBits.join(" · "));
  if (g("cVehicle")) cLines.push("Service: " + g("cVehicle"));
  if (g("cMsg")) cLines.push("Notes: " + g("cMsg"));
  cLines.push("", "Please confirm availability. Thank you.");
  const cWaText = encodeURIComponent(cLines.join("\n"));
  setTimeout(()=>{ window.open("https://api.whatsapp.com/send?phone=971586497861&text=" + cWaText, "_blank", "noopener"); }, 600);
});
</script>
</body>
</html>"""
(SITE/"contact.html").write_text(
 head("Contact UMC Dubai, Reserve Your Car, 24/7",
      "Reach the UMC Dubai concierge desk 24/7 by phone, WhatsApp or email for reservations, corporate accounts and special requests.",
      "contact") + contact_body)

# ---------- privacy ----------
privacy_body = header("contact.html").replace('class="on"','') + f"""
<section class="phero"><div class="wrap"><span class="lbl">Privacy</span><h1>Privacy notice</h1>
<p class="lede">What we collect, why, and how to reach us about it.</p></div></section>
<section class="sec" style="padding-top:2rem"><div class="wrap narrow">
<p>UMC Dubai collects the details you provide when reserving, including name, contact details, pick-up and drop-off information, and flight details where relevant, solely to operate your journey and to confirm and invoice your booking. We do not sell personal data. Booking communications take place over WhatsApp, phone or email at your choice; payment is handled through secure third-party payment links and we do not store card numbers. The reservation map and address suggestions on this site are provided by Google Maps, which processes the addresses you type under Google&rsquo;s own privacy policy. For any privacy request, including deletion of your booking history, write to <a href="mailto:contact@umcdubai.ae" style="border-bottom:1px solid var(--amber)">contact@umcdubai.ae</a>.</p>
</div></section>
""" + FOOTER + "</body></html>"
(SITE/"privacy.html").write_text(
 head("Privacy Notice | UMC Dubai","How UMC Dubai handles personal information from your bookings, contact and payment, and the choices you have over how your data is used.","privacy") + privacy_body)

# ---------- terms ----------
terms_body = header("contact.html").replace('class="on"','') + f"""
<section class="phero"><div class="wrap"><span class="lbl">Terms &amp; conditions</span><h1>Terms of Service</h1>
<p class="lede">The conditions that apply to every reservation with UMC Dubai.</p></div></section>
<section class="sec" style="padding-top:2rem"><div class="wrap narrow">
<ol style="padding-left:1.2rem;display:grid;gap:1rem;color:var(--ink-soft);font-size:.95rem">{TERMS_OL}</ol>
</div></section>
""" + FOOTER + "</body></html>"
(SITE/"terms.html").write_text(
 head("Terms of Service | UMC Dubai","Terms and conditions for UMC Dubai chauffeur reservations, cancellation, conduct, liability and the laws of the UAE that govern every booking.","terms") + terms_body)

# ---------- inter-emirate ----------
IE_FAQS = [
 ("Is there an additional fee for inter-emirate journeys?",
  "Yes. For services rendered outside Dubai an additional fee applies depending on type of vehicle. Your quote states the full amount before you confirm."),
 ("Can the chauffeur wait and bring me back the same day?",
  "Yes. Many clients book a return or keep the car at their disposal for the day. Tell our concierge your plans and we will hold the car for you."),
]
ie_body = header("airport-transfers.html").replace('class="on"','') + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl" style="white-space:normal;line-height:1.6">Dubai &middot; Abu Dhabi &middot; Sharjah &middot; Ajman &middot; Umm Al Quwain &middot; Ras Al Khaimah &middot; Fujairah</span>
    <h1>Inter-emirate transfers</h1>
    <p class="lede">Dubai to Abu Dhabi and every emirate beyond. One car and one chauffeur, door to door.</p>
    <div style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="/booking">Reserve your transfer</a>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Routes</span><h2>Where the day takes you.</h2>
    <p class="lede">One car and one chauffeur for the whole journey, with the quote agreed before departure.</p></div>
    <div class="depboard rv" role="table" aria-label="Inter-emirate routes">
      <div class="bd-head"><span>Route</span><span>Distance</span><span>Drive</span><span style="text-align:center">Rate</span></div>
      <div class="bd-row"><span class="rt">Dubai <span class="ar">&#8596;</span> Abu Dhabi</span><span class="cell km">≈ 140 km</span><span class="cell">90 min</span><a class="tag" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=971586497861&text=Hello%20UMC%20Dubai%2C%20I%20would%20like%20a%20quote%20for%20the%20Dubai%20-%20Abu%20Dhabi%20transfer.">Get quote</a></div>
      <div class="bd-row"><span class="rt">Dubai <span class="ar">&#8596;</span> Sharjah</span><span class="cell km">≈ 30 km</span><span class="cell">30 min</span><a class="tag" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=971586497861&text=Hello%20UMC%20Dubai%2C%20I%20would%20like%20a%20quote%20for%20the%20Dubai%20-%20Sharjah%20transfer.">Get quote</a></div>
      <div class="bd-row"><span class="rt">Dubai <span class="ar">&#8596;</span> Ajman</span><span class="cell km">≈ 38 km</span><span class="cell">40 min</span><a class="tag" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=971586497861&text=Hello%20UMC%20Dubai%2C%20I%20would%20like%20a%20quote%20for%20the%20Dubai%20-%20Ajman%20transfer.">Get quote</a></div>
      <div class="bd-row"><span class="rt">Dubai <span class="ar">&#8596;</span> Umm Al Quwain</span><span class="cell km">≈ 60 km</span><span class="cell">45 min</span><a class="tag" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=971586497861&text=Hello%20UMC%20Dubai%2C%20I%20would%20like%20a%20quote%20for%20the%20Dubai%20-%20Umm%20Al%20Quwain%20transfer.">Get quote</a></div>
      <div class="bd-row"><span class="rt">Dubai <span class="ar">&#8596;</span> Ras Al Khaimah</span><span class="cell km">≈ 115 km</span><span class="cell">75 min</span><a class="tag" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=971586497861&text=Hello%20UMC%20Dubai%2C%20I%20would%20like%20a%20quote%20for%20the%20Dubai%20-%20Ras%20Al%20Khaimah%20transfer.">Get quote</a></div>
      <div class="bd-row"><span class="rt">Dubai <span class="ar">&#8596;</span> Fujairah</span><span class="cell km">≈ 130 km</span><span class="cell">100 min</span><a class="tag" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=971586497861&text=Hello%20UMC%20Dubai%2C%20I%20would%20like%20a%20quote%20for%20the%20Dubai%20-%20Fujairah%20transfer.">Get quote</a></div>
      <div class="bd-row"><span class="rt">Dubai <span class="ar">&#8596;</span> Al Ain</span><span class="cell km">≈ 160 km</span><span class="cell">95 min</span><a class="tag" target="_blank" rel="noopener" href="https://api.whatsapp.com/send?phone=971586497861&text=Hello%20UMC%20Dubai%2C%20I%20would%20like%20a%20quote%20for%20the%20Dubai%20-%20Al%20Ain%20transfer.">Get quote</a></div>
    </div>
    <p class="muted center" style="font-size:.85rem;margin-top:1.8rem">Travelling from another emirate into Dubai, or between any two emirates, is arranged the same way. Our concierge confirms your quote within minutes.</p>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Good to know</span><h2>Inter-emirate questions</h2></div>
    <div class="faq rv">{faq_details(IE_FAQS)}</div>
  </div>
</section>
<section class="closing band-dark">
  <div class="wrap"><span class="lbl">Reservations</span><h2 class="rv">One chauffeur, door to door.</h2>
  <div class="btns rv"><a class="btn btn-ink" href="/booking">Reserve your transfer</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + "</body></html>"
(SITE/"inter-emirate.html").write_text(
 head("Inter-Emirate Transfers, Dubai & Abu Dhabi | UMC Dubai",
      "Chauffeur driven transfers between Dubai, Abu Dhabi and every emirate. One car and one chauffeur door to door, on a fixed quote agreed before departure.",
      "inter-emirate", faq_schema(IE_FAQS)) + ie_body)

# ---------- 404 ----------
notfound = header("index.html").replace('class="on"','') + f"""
<section class="phero" style="padding-bottom:4rem"><div class="wrap">
<span class="lbl">404</span><h1>This road does not exist.</h1>
<p class="lede">The page you were looking for has moved or never was. Your car, however, is ready.</p>
<div style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
<a class="btn btn-ink" href="/">Return home</a>
<a class="btn btn-ghost" href="/booking">Reserve your car</a>
</div></div></section>
""" + FOOTER + "</body></html>"
(SITE/"404.html").write_text(head("Page Not Found | UMC Dubai","","404") + notfound)

# ---------- fleet / s-class (flagship model page; template for the other 7 cars) ----------
# Single static hero image (no rotation, no dots).
SC_HERO_IMG = ("hero-2025.webp", "Mercedes Benz S Class, exterior")
SC_HERO_TAGLINE = "It is recognised before it stops."
# Four supporting cabin shots sit in a 2x2 grid beside the primary interior image. No hotspots on these.
SC_INT_DETAILS = [
  ("hero-2.webp", "Cabin detail"),
  ("hero-3.webp", "Cabin detail"),
  ("hero-4.webp", "Cabin detail"),
  ("hero-5.webp", "Cabin detail"),
]
# SC_AMENITIES = the FULL list, S Class and BMW 7 Series only. All other
# vehicles use STANDARD_AMENITIES (defined below), which is identical except
# item #3 swaps "Tissues &amp; wipes" for just "Tissues" (dry, no wipes).
SC_AMENITIES = [
  ('<svg viewBox="0 0 24 24"><path d="M10.2 2.5h3.6M12 2.5v3.4M9.6 9.2c-.7.8-1.1 1.7-1.1 2.8V19a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2v-7c0-1.1-.4-2-1.1-2.8l-.9-1V5.9h-3v2.3z"/><path d="M8.5 13.5h7"/></svg>',
   "Water", "Provided"),
  ('<svg viewBox="0 0 24 24"><path d="M13 2.5L5.5 13H11l-1 8.5L17.5 11H12z"/></svg>',
   "Phone chargers", "USB-C &amp; USB-A"),
  ('<svg viewBox="0 0 24 24"><rect x="4" y="9" width="16" height="11" rx="2"/><path d="M8 9c0-4 8-4 8 0M10 13c.8 1 3.2 1 4 0"/></svg>',
   "Tissues &amp; wipes", "Restocked daily"),
  ('<svg viewBox="0 0 24 24"><path d="M12 3c0 2.5-3 3.5-3 6.5a3 3 0 0 0 6 0C15 6.5 12 5.5 12 3z"/><path d="M5 14c0 3 3 5 7 5s7-2 7-5"/><path d="M6 18l1.4 2M18 18l-1.4 2"/></svg>',
   "A clean cabin", "Detailed between journeys"),
  ('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.2"/><path d="M12 4v2.4M12 17.6V20M4 12h2.4M17.6 12H20M6.3 6.3l1.7 1.7M16 16l1.7 1.7M6.3 17.7L8 16M16 8l1.7-1.7"/></svg>',
   "Climate your way", "Independent rear zone"),
  ('<svg viewBox="0 0 24 24"><path d="M4 10v4h3l4 4V6L7 10H4z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>',
   "Quiet on request", "Spoken or in writing"),
]

def sc_amenity_cell(a):
    svg, label, meta = a
    return f'<div class="sc-am__cell"><span class="ico">{svg}</span><b>{label}</b><span class="meta">{meta}</span></div>'

sc_amenities_html = "".join(sc_amenity_cell(a) for a in SC_AMENITIES)

# ---------- archetype configuration (per-class page structure) ----------
# Each fleet page renders one of three archetypes:
#   sedan ,executive/business sedans (S Class, BMW 7 Series, E Class, Lexus ES)
#   suv   ,SUVs and people-movers (Escalade, Yukon XL, V Class)
#   group ,group transport (Sprinter, King Long Coach)
# All three share the brand system, components, CSS, JS, modals and responsive-
# image pipeline. The archetype controls per-class section LABELS, the
# Configuration row in on-paper, the seating modal title, and small wording in
# the chauffeur section. Each car still carries its own h2, lede, seating_items
# and seo_body, the archetype is the *frame*, the per-car copy is the *content*.
#
# Amenities are a SEPARATE dimension (set per-car via the `amenities` field):
#   "full"    ,Water, Phone chargers, Tissues & wipes, Clean cabin,
#                Climate your way, Quiet on request. S Class + BMW 7 only.
#   "standard",same six items but Tissues only (no wipes). All other cars.
# Default if unset is "standard".

# STANDARD = SC_AMENITIES with item #3 (tissues) wipe-free; everything else
# identical so future icon/meta tweaks stay in one place.
STANDARD_AMENITIES = list(SC_AMENITIES)
STANDARD_AMENITIES[2] = (SC_AMENITIES[2][0], "Tissues", "Restocked daily")
standard_amenities_html = "".join(sc_amenity_cell(a) for a in STANDARD_AMENITIES)

# v90: the Lexus ES does not have an independent rear climate zone (that is
# an S Class / V Class feature). Override the climate amenity sub-line for
# this car only; everything else mirrors STANDARD_AMENITIES.
LEXUS_ES_AMENITIES = list(STANDARD_AMENITIES)
LEXUS_ES_AMENITIES[4] = (STANDARD_AMENITIES[4][0], "Climate your way", "Rear climate vents")
lexus_es_amenities_html = "".join(sc_amenity_cell(a) for a in LEXUS_ES_AMENITIES)

AMENITY_HTML = {
  "full": sc_amenities_html,
  "standard": standard_amenities_html,
  "lexus_es": lexus_es_amenities_html,
}

ARCHETYPES = {
  "sedan": {
    "int_lbl": "The interior",
    "am_heading": "Provided in every cabin.",
    "am_lede": "Included in the rate. Stocked before pick-up and replenished between journeys.",
    "config_row": False,
    "sd_title": "Who sits where",
    "chauffeur_close": "they keep the cabin quiet until you choose to speak",
    "chau_point_silence": "Silence is the standing instruction; conversation on request.",
  },
  "suv": {
    "int_lbl": "The interior",
    "am_heading": "Provided in every cabin.",
    "am_lede": "Included in the rate. Stocked before pick-up and replenished between journeys.",
    "config_row": True,
    "sd_title": "Who sits where",
    "chauffeur_close": "they keep the cabin composed, however full it is",
    "chau_point_silence": "Silence is the standing instruction; conversation on request.",
  },
  "group": {
    "int_lbl": "On board",
    "am_heading": "Comfort, at scale.",
    "am_lede": "Standing equipment across the cabin, for delegations, events, and corporate moves that have to arrive together.",
    "config_row": True,
    "sd_title": "Cabin layout",
    "chauffeur_close": "they keep the group on time",
    "chau_point_silence": "Briefed on the run sheet; in contact with operations as the move progresses.",
  },
}

sc_details_html = "".join(
    responsive_img(f"s-class/{src}", "sc-int__detail", f"{alt} {i+1}",
                   sizes_attr="(max-width:560px) 90vw, (max-width:980px) 45vw, 280px")
    for i, (src, alt) in enumerate(SC_INT_DETAILS)
)
sc_primary_html = responsive_img("s-class/interior.webp", "sc-int__photo",
                                 "Mercedes Benz S Class rear cabin interior",
                                 sizes_attr="(max-width:899px) 100vw, 720px")

sc_body = header("fleet.html") + f"""
<!-- HERO, single static exterior image (no rotation, no dots). Fits viewport minus header. -->
<section class="sc-hero" aria-label="Mercedes Benz S Class">
  <div class="sc-hero__stage">
    <!-- TEMPORARY hero image, replace with real UMC S Class photography. -->
    <img class="sc-hero__img" src="/assets/fleet/s-class/{SC_HERO_IMG[0]}" alt="{SC_HERO_IMG[1]}" fetchpriority="high" style="--hero-pos:50% 50%;--hero-pos-mobile:0% 50%">
  </div>
  <div class="sc-hero__caps">
    <div class="sc-hero__caps-inner">
      <div>
        <div class="sc-hero__kicker">Mercedes Benz S Class</div>
        <div class="sc-hero__tagline">{SC_HERO_TAGLINE}</div>
      </div>
      <div class="sc-hero__ctas">
        <a class="btn btn-ink" href="/booking?vehicle=mb-s-class">Reserve the S Class</a>
      </div>
    </div>
  </div>
</section>

<section class="sc-int" id="interior">
  <div class="sc-int__head">
    <div>
      <span class="lbl">The interior</span>
      <h2>The quiet room.</h2>
    </div>
    <p class="lede">The rear of an S Class is a private room that happens to move. <em>The light is warm, the line is straight, the world outside is muted.</em> Sit, recline, take a call, or stay silent.</p>
  </div>
  <div class="sc-int__canvas">
    <div class="sc-int__grid">
      <!-- Left ~55-60% : primary cabin image. TEMPORARY, to be replaced with HD interior
           photo from Usman. (Hotspot markers removed per request.) -->
      <div class="sc-int__primary">
        {sc_primary_html}
      </div>
      <!-- Right ~40-45% : 2x2 grid of supporting cabin shots. -->
      <div class="sc-int__details" aria-label="Cabin detail shots">
        {sc_details_html}
      </div>
    </div>
  </div>
</section>

<section class="sc-am" id="amenities">
  <div class="sc-am__head">
    <span class="lbl">On board</span>
    <h2>Provided in every cabin.</h2>
    <p class="lede">Included in the rate. Stocked before pick-up and replenished between journeys.</p>
  </div>
  <div class="sc-am__grid" role="list">{sc_amenities_html}</div>
</section>

<section class="sc-paper" id="on-paper">
  <div class="sc-paper__wrap">
    <div class="sc-paper__head">
      <span class="lbl">On paper</span>
      <h2>The plain facts.</h2>
    </div>
    <article class="card">
      <div class="rows">
        <div class="row"><span class="k">Passengers</span>
          <span class="v">
            <span class="vmain">Up to 4</span>
            <button type="button" class="sc-mt" aria-haspopup="dialog" aria-controls="sc-sd" aria-expanded="false">Seating detail</button>
          </span>
        </div>
        <div class="row"><span class="k">Luggage</span>
          <span class="v">
            <span class="vmain">Up to 2 medium suitcases</span>
            <button type="button" class="sc-mt" aria-haspopup="dialog" aria-controls="sc-sg" aria-expanded="false">Size guide</button>
          </span>
        </div>
        <div class="row"><span class="k">Suited to</span><span class="v"><span class="vmain">Executive travel</span></span></div>
      </div>
      <p>The Mercedes&#8209;Benz S&#8209;Class is the reference point for chauffeur travel in Dubai. Reclining rear seats, a hushed cabin, independent rear&#8209;zone climate and discreet charging at every seat. Suited to airport arrivals from DXB or DWC, board meetings across the DIFC, Downtown and Dubai Marina, and any journey where the room you arrive in should feel like the room you left.</p>
    </article>
  </div>
</section>

<!-- Size guide modal, centered, scrim backdrop, focus-trapped. -->
<div class="sc-modal" id="sc-sg" role="dialog" aria-modal="true" aria-labelledby="sc-sg-title" hidden>
  <div class="sc-modal__backdrop" data-modal-close></div>
  <div class="sc-modal__panel" tabindex="-1">
    <button type="button" class="sc-modal__close" aria-label="Close" data-modal-close>&times;</button>
    <span class="lbl">Size guide</span>
    <h3 id="sc-sg-title">Medium suitcase (M)</h3>
    <p>Roughly a standard check-in case, for example an Away Medium, Globe-Trotter Check-In Medium, or Rimowa Check-In.</p>
    <dl class="sc-modal__rows">
      <div><dt>Each, approximately</dt><dd>66 &times; 44 &times; 27 cm</dd></div>
      <div><dt>In the boot</dt><dd>Two cases of this size</dd></div>
    </dl>
  </div>
</div>

<!-- Seating detail modal, same pattern. -->
<div class="sc-modal" id="sc-sd" role="dialog" aria-modal="true" aria-labelledby="sc-sd-title" hidden>
  <div class="sc-modal__backdrop" data-modal-close></div>
  <div class="sc-modal__panel" tabindex="-1">
    <button type="button" class="sc-modal__close" aria-label="Close" data-modal-close>&times;</button>
    <span class="lbl">Seating detail</span>
    <h3 id="sc-sd-title">Who sits where</h3>
    <dl class="sc-modal__rows sc-modal__rows--stack">
      <div><dt>Two travelling</dt><dd>The rear bench gives each guest a full seat, with generous legroom.</dd></div>
      <div><dt>Three travelling</dt><dd>Two across the rear, the third in the front beside the chauffeur.</dd></div>
    </dl>
  </div>
</div>

<section class="sc-chau">
  <div class="sc-chau__wrap">
    <div>
      <span class="lbl">The chauffeur</span>
      <h2>Held to one standard.</h2>
      <p>Every S Class on our fleet travels with a chauffeur on UMC payroll. Vetted, trained, and bound to the same standing rules as the chauffeur before them. They hold the door, they know the route, and they keep the cabin quiet until you choose to speak.</p>
      <ul class="sc-chau__points">
        <li>Employed by UMC, not contracted, not supplied by a platform.</li>
        <li>Routes are planned before the engine starts; airport arrivals tracked from departure.</li>
        <li>Silence is the standing instruction; conversation on request.</li>
      </ul>
    </div>
    <aside class="sc-chau__quote">
      <span class="lbl">House standard</span>
      <blockquote>&ldquo;The standard is not the car. It is the person who arrives with it.&rdquo;</blockquote>
      <div class="attr"><span class="dash"></span>UMC Operations &bull; Dubai</div>
    </aside>
  </div>
</section>

<section class="closing band-dark">
  <div class="wrap">
    <span class="lbl">Reservations</span>
    <h2 class="rv">Reserve the S Class.</h2>
    <div class="btns rv">
      <a class="btn btn-ink" href="/booking?vehicle=mb-s-class">Reserve the S Class</a>
      <a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a>
    </div>
  </div>
</section>

<section class="sc-also">
  <div class="sc-also__head">
    <span class="lbl">Also consider</span>
    <h2>Other vehicles in this class of service.</h2>
  </div>
  <div class="sc-also__grid">
    <article class="acard">
      <div class="marque-row"><span class="mk">Bayerische Motoren Werke</span><span class="dash"></span><span>Flagship Sedan</span></div>
      <h3>BMW 7 Series</h3>
      <div class="strap">The same standard, a different marque.</div>
      <p>An equally composed flagship sedan for clients who prefer the seven to the star. Identical seating, identical luggage, identical chauffeur.</p>
      <div class="stats">
        <div class="it"><span class="k">Passengers</span><span class="v">Up to 4</span></div>
        <div class="it"><span class="k">Luggage</span><span class="v">2 medium</span></div>
      </div>
      <a class="btn-line" href="/fleet/bmw-7-series">Reserve the 7 Series</a>
    </article>
  </div>
</section>

<script>
(function(){{
  var rm = matchMedia("(prefers-reduced-motion:reduce)").matches;

  /* ---------- set --header-h CSS variable so the hero fits viewport minus header ---------- */
  var hdr = document.querySelector("header.site");
  function setHeaderH(){{
    if(!hdr) return;
    document.documentElement.style.setProperty("--header-h", hdr.offsetHeight + "px");
  }}
  setHeaderH();
  window.addEventListener("resize", setHeaderH);
  if(window.visualViewport) visualViewport.addEventListener("resize", setHeaderH);

  /* ---------- subtle load-in reveal (hero immediately; sections on intersection) ---------- */
  var hero = document.querySelector(".sc-hero");
  if(hero) requestAnimationFrame(function(){{ hero.classList.add("sc-in"); }});
  var revealTargets = document.querySelectorAll(".sc-int,.sc-am,.sc-paper,.sc-chau,.sc-also,.closing.band-dark");
  if(!rm && "IntersectionObserver" in window){{
    var io = new IntersectionObserver(function(entries){{
      entries.forEach(function(e){{
        if(e.isIntersecting){{ e.target.classList.add("sc-in"); io.unobserve(e.target); }}
      }});
    }}, {{ threshold: 0.1, rootMargin: "0px 0px -8% 0px" }});
    revealTargets.forEach(function(t){{ io.observe(t); }});
  }} else {{
    revealTargets.forEach(function(t){{ t.classList.add("sc-in"); }});
  }}

  /* ---------- modals (size guide + seating detail) ---------- */
  var openModal = null, lastTrigger = null;
  function focusables(m){{
    return m.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  }}
  function openM(id, trig){{
    var m = document.getElementById(id);
    if(!m) return;
    if(openModal) closeM();
    openModal = m; lastTrigger = trig || null;
    m.hidden = false;
    document.body.classList.add("sc-no-scroll");
    requestAnimationFrame(function(){{ m.classList.add("on"); }});
    if(trig) trig.setAttribute("aria-expanded", "true");
    var fs = focusables(m); if(fs.length) fs[0].focus();
  }}
  function closeM(){{
    if(!openModal) return;
    var m = openModal, trig = lastTrigger;
    m.classList.remove("on");
    setTimeout(function(){{ m.hidden = true; }}, rm ? 0 : 240);
    document.body.classList.remove("sc-no-scroll");
    if(trig){{ trig.setAttribute("aria-expanded", "false"); trig.focus(); }}
    openModal = null; lastTrigger = null;
  }}
  document.querySelectorAll(".sc-mt").forEach(function(b){{
    b.addEventListener("click", function(){{ openM(b.getAttribute("aria-controls"), b); }});
  }});
  document.querySelectorAll("[data-modal-close]").forEach(function(el){{
    el.addEventListener("click", closeM);
  }});
  document.addEventListener("keydown", function(e){{
    if(e.key === "Escape" && openModal) closeM();
    if(e.key === "Tab" && openModal){{
      var fs = focusables(openModal);
      if(!fs.length) return;
      var first = fs[0], last = fs[fs.length - 1];
      if(e.shiftKey && document.activeElement === first){{ e.preventDefault(); last.focus(); }}
      else if(!e.shiftKey && document.activeElement === last){{ e.preventDefault(); first.focus(); }}
    }}
  }});
}})();
</script>
""" + FOOTER + "</body></html>"

# Place the page at /fleet/s-class. Inject <base href="/"> immediately before <title>
# so that the shared head's relative URLs (assets/, favicon, nav links, extra link, FOOTER hrefs)
# all resolve from the document root regardless of subdirectory depth.
sc_head = head("Mercedes S-Class Chauffeur in Dubai | UMC Dubai",
               "Chauffeur driven Mercedes-Benz S-Class in Dubai and across the UAE: reclining rear seats, hushed cabin, vetted UMC chauffeur. Reserve in minutes.",
               "fleet/s-class",
               f'<link rel="stylesheet" href="/assets/s-class.css?v={V}">')
sc_head = sc_head.replace('<title>', '<base href="/">\n<title>', 1)
(SITE/"fleet").mkdir(parents=True, exist_ok=True)
(SITE/"fleet"/"s-class.html").write_text(sc_head + sc_body)

# ---------- sitemap & robots & headers ----------
# ---------- additional fleet model pages (S Class is generated above) ----------
# ALL_CARS: lookup for every fleet vehicle. Used by the also-consider renderer
# and by fleet-data.js (URLs propagated below) to wire card links. The S Class
# entry mirrors its already-published treatment; that page is NOT re-rendered.
ALL_CARS = {
  "mb-s-class": {
    "name": "Mercedes Benz S Class", "marque": "Mercedes Benz", "category": "Flagship Sedan",
    "page": "fleet/s-class", "strap": "The reference standard.",
    "ac_body": "The reference point for executive travel in Dubai, reclining rear seats, a hushed cabin.",
    "pax": 4, "luggage": "2 medium", "reserve_label": "Reserve the S Class",
  },
  "bmw-7": {
    "name": "BMW 7 Series", "marque": "Bayerische Motoren Werke", "category": "Flagship Sedan",
    "page": "fleet/bmw-7-series", "strap": "Composure, engineered.",
    "ac_body": "An equally composed flagship sedan for clients who prefer the seven to the star.",
    "pax": 4, "luggage": "2 medium", "reserve_label": "Reserve the 7 Series",
  },
  "mb-e-class": {
    "name": "Mercedes Benz E Class", "marque": "Mercedes Benz", "category": "Business Sedan",
    "page": "fleet/e-class", "strap": "The quiet professional.",
    "ac_body": "The business saloon that moves people who matter, without announcing it.",
    "pax": 4, "luggage": "2 medium", "reserve_label": "Reserve the E Class",
  },
  "lexus-es": {
    "name": "Lexus ES", "marque": "Lexus", "category": "Business Sedan",
    "page": "fleet/lexus-es", "strap": "Stillness, as standard.",
    "ac_body": "Japanese refinement and exceptional quiet, luxury as the absence of disturbance.",
    "pax": 4, "luggage": "2 medium", "reserve_label": "Reserve the Lexus ES",
  },
  "cadillac-escalade": {
    "name": "Cadillac Escalade", "marque": "Cadillac", "category": "Luxury SUV",
    "page": "fleet/cadillac-escalade", "strap": "Arrival, with presence.",
    "ac_body": "Full-size American SUV, presence at the kerb, room for the party and the luggage.",
    "pax": 7, "luggage": "4 large", "reserve_label": "Reserve the Escalade",
  },
  "gmc-yukon-xl": {
    "name": "GMC Yukon Elevation XL", "marque": "GMC", "category": "Executive SUV",
    "page": "fleet/gmc-yukon-xl", "strap": "Space, without compromise.",
    "ac_body": "Long-wheelbase SUV for the full car and the full boot.",
    "pax": 6, "luggage": "5 large", "reserve_label": "Reserve the Yukon XL",
  },
  "mb-v-class": {
    "name": "Mercedes Benz V Class", "marque": "Mercedes Benz", "category": "Luxury Van",
    "page": "fleet/v-class", "strap": "A room that travels together.",
    "ac_body": "Two facing benches in the rear cabin, seven travelling together face to face.",
    "pax": 7, "luggage": "5 large", "reserve_label": "Reserve the V Class",
  },
  "mb-sprinter": {
    "name": "Mercedes Benz Sprinter", "marque": "Mercedes Benz", "category": "Executive Van",
    "page": "fleet/sprinter", "strap": "The group, moved well.",
    "ac_body": "Premium group transport for delegations, teams and events.",
    "pax": 19, "luggage": "10 bags", "reserve_label": "Reserve the Sprinter",
  },
  # v83: "king-long" consolidated into "luxury-coach",entry removed. The
  # /fleet/king-long URL is 301'd to /fleet/luxury-coach; all also_consider
  # references repointed to "luxury-coach" or "mb-sprinter".
  # v70: Rolls-Royce, standalone page, DELIBERATELY OMITTED from the fleet
  # grid (UMC_FLEET in fleet-data.js). Reachable by direct URL, the 301 from
  # /our-fleet/rolls-royce/, the sitemap, and SEO only. ALL_CARS membership
  # is needed for the also-consider renderer and cross-linking out from
  # /fleet/rolls-royce. No other page lists rolls-royce in its also-consider,
  # so it never surfaces as a card on another model page either.
  "rolls-royce": {
    "name": "Rolls-Royce", "marque": "Rolls-Royce", "category": "Halo Saloon and SUV",
    "page": "fleet/rolls-royce", "strap": "Arrival, considered.",
    "ac_body": "The Ghost and the Cullinan, presence and craft for the occasion that asks for it.",
    "pax": 4, "luggage": "3 medium", "reserve_label": "Reserve a Rolls-Royce",
  },
  # v70: Luxury Coach, broader 35 and 55 seater group offering, distinct
  # from the single King Long model page. Standalone like Rolls: not in the
  # rates grid, has no per-emirate rate card.
  "luxury-coach": {
    "name": "Luxury Coach", "marque": "UMC", "category": "Group Coach",
    "page": "fleet/luxury-coach", "strap": "The group, taken together.",
    "ac_body": "35 and 55 seater coaches for conferences, roadshows and large events.",
    "pax": 55, "luggage": "Group hold", "reserve_label": "Reserve a coach",
  },
}

# DRAFT scaffolds, Usman + team to refine per-car.
FLEET_PAGES_DRAFT = [
  {"id":"bmw-7",
   "archetype":"sedan",
   "amenities":"full",
   "title_seo":"BMW 7 Series Chauffeur in Dubai, Flagship Sedan | UMC Dubai",
   "meta_seo":"Chauffeur driven BMW 7 Series in Dubai. Composed flagship sedan, vetted UMC chauffeur. Reserve in minutes.",
   "tagline":"Composure, engineered.",
   "hero_sub":"The executive saloon for those who know the difference. Quiet authority, precisely built.",
   # v73-C: real imagery wired in.
   "hero_img":"bmw-7/hero.png",
   # v94: final value chosen live at iPhone 17 Pro Max hero aspect ratio.
   # Front three-quarter centred in the visible window.
   "hero_object_pos_mobile":"82% 32%",
   "interior_primary":"bmw-7/interior.webp",
   "interior_details":["bmw-7/detail-1.webp","bmw-7/detail-2.webp","bmw-7/detail-3.webp","bmw-7/detail-4.webp"],
   "interior_heading":"The considered cabin.",
   "interior_intro":"The rear of a 7 Series is arranged around the passenger, space, silence and control, each placed with intent. The city continues; you are apart from it.",
   "chauffeur_heading":"The standard arrives with the car.",
   "suited_to":"Executive travel",
   "luggage_label":"Up to 2 medium suitcases","luggage_kind":"medium","luggage_count":2,
   "seating_items":[
     ("Two travelling","The rear bench gives each guest a full seat, with generous legroom."),
     ("Three travelling","Two across the rear, the third in the front beside the chauffeur."),
   ],
   "seo_body":"The BMW 7 Series stands as Munich&rsquo;s answer to the executive saloon, composed, engineered to a fine degree, and quiet in its authority. Reclining rear seats, controlled climate and discreet charging at every seat. Suited to airport arrivals from DXB or DWC, board meetings across the DIFC, Downtown and Dubai Marina, and the journey where the room you arrive in should feel like the room you left.",
   "also_consider":["mb-s-class"]},

  {"id":"mb-e-class",
   "archetype":"sedan",
   "title_seo":"Mercedes E-Class Chauffeur in Dubai | UMC Dubai",
   "meta_seo":"Chauffeur driven Mercedes-Benz E-Class in Dubai. The business sedan of choice for daily executive transfers.",
   "tagline":"The quiet professional.",
   "hero_sub":"The business saloon that does the daily work of moving people who matter, without announcing it.",
   # v73-G: hero + 1-left + 3-of-4 right details wired. Slot 4 stays on
   # placeholder because the netcarshow URLs return 403; pending alt source.
   "hero_img":"e-class/hero.jpg",
   "hero_object_pos_mobile":"28% 50%",
   "interior_primary":"e-class/interior.png",
   "interior_details":["e-class/detail-1.png","e-class/cabin-detail-2.jpg","e-class/detail-3.jpg","e-class/cabin-detail-4.jpg"],
   "interior_heading":"Room enough to work.",
   "interior_intro":"A composed, well-ordered cabin for the meeting you are heading to and the one you have just left. Space to think; quiet to do it in.",
   "chauffeur_heading":"Held to one standard.",
   "suited_to":"Daily business transfers",
   "luggage_label":"Up to 2 medium suitcases","luggage_kind":"medium","luggage_count":2,
   "seating_items":[
     ("Two travelling","The rear bench gives each guest a full seat, with generous legroom."),
     ("Three travelling","Two across the rear, the third in the front beside the chauffeur."),
   ],
   "seo_body":"The Mercedes Benz E Class is the business sedan of the Dubai professional class, composed, dependable, quietly equipped. Controlled climate, generous rear-seat space, and the same chauffeur standard as the rest of the fleet. Suited to daily transfers, between-meetings journeys, and the airport runs that need to be dignified without ceremony.",
   "also_consider":["lexus-es"]},

  {"id":"lexus-es",
   "archetype":"sedan",
   "amenities":"lexus_es",
   "title_seo":"Lexus ES Chauffeur in Dubai, Business Sedan | UMC Dubai",
   "meta_seo":"Chauffeur driven Lexus ES in Dubai. Japanese refinement, exceptional quiet, vetted UMC chauffeur.",
   "tagline":"Stillness, as standard.",
   "hero_sub":"A saloon built around quiet, the Japanese idea that true luxury is the absence of disturbance.",
   # v73-C: hero + interior primary wired. The 4 detail images on usnews.com
   # timed out repeatedly from this environment; they stay on placeholders
   # pending re-supply of alternative source URLs.
   "hero_img":"lexus-es/hero.jpeg",
   "hero_object_pos_mobile":"100% 50%",
   "interior_primary":"lexus-es/interior.jpg",
   "interior_details":["lexus-es/detail-1.jpg","lexus-es/detail-2.png","lexus-es/detail-3.jpg","lexus-es/detail-4.jpg"],
   "interior_heading":"The cabin that asks nothing of you.",
   "interior_intro":"Hushed, even-tempered, considered down to the last surface. The ES is for the passenger who wants the journey to simply disappear.",
   "chauffeur_heading":"Held to one standard.",
   "suited_to":"Executive travel",
   "luggage_label":"Up to 2 medium suitcases","luggage_kind":"medium","luggage_count":2,
   "seating_items":[
     ("Two travelling","The rear bench gives each guest a full seat, with generous legroom."),
     ("Three travelling","Two across the rear, the third in the front beside the chauffeur."),
   ],
   "seo_body":"The Lexus ES is built around the Japanese principle that true luxury is the absence of disturbance, a hushed cabin, an even-tempered ride, and considered surfaces throughout. Suited to executive transfers, longer journeys, and any client who values quiet over presence.",
   "also_consider":["mb-e-class"]},

  {"id":"cadillac-escalade",
   "archetype":"suv",
   "configuration_label":"Three rows. Front cabin; second-row captain&rsquo;s chairs as standard, third-row bench. A bench second row can be arranged on request to seat additional guests.",
   "title_seo":"Cadillac Escalade Chauffeur in Dubai, Luxury SUV | UMC Dubai",
   "meta_seo":"Chauffeur driven Cadillac Escalade in Dubai. Full-size luxury SUV for group arrivals and family transfers.",
   "tagline":"Arrival, with presence.",
   "hero_sub":"The full-size SUV for those who travel with people, with luggage, or with the need to be seen arriving, and the room to do all three.",
   # v73-C: real imagery wired in.
   "hero_img":"cadillac-escalade/hero.webp",
   "hero_object_pos_mobile":"0% 50%",
   "interior_primary":"cadillac-escalade/interior.jpg",
   "interior_details":["cadillac-escalade/detail-1.jpg","cadillac-escalade/detail-2.jpg","cadillac-escalade/detail-3.jpg","cadillac-escalade/detail-4.jpg"],
   "interior_heading":"Command, in the back.",
   "interior_intro":"Elevated, broad and commanding, the Escalade carries a party of guests in the same composure a saloon gives one. Height, space, and an unmistakable presence at the kerb.",
   "chauffeur_heading":"Held to one standard.",
   "suited_to":"Group arrivals and airport runs",
   "luggage_label":"Up to 4 cases, mixed sizes","luggage_kind":"large","luggage_count":4,
   "luggage_sg_title":"What fits in the Escalade",
   "luggage_sg_intro":"Behind the third row, the boot takes any one of these loads:",
   "luggage_sg_loads":["1 extra-large + 1 large + 1 medium case","2 large + 1 medium case","1 large + 1 medium + 2 cabin cases"],
   "seating_items":[
     ("Up to seven","Three rows. Front cabin, second-row captain&rsquo;s chairs as standard, and a third-row bench."),
     ("On request","A bench second row can be arranged on request to seat additional guests."),
     ("Luggage","Behind the third row, expandable by folding the third-row bench."),
   ],
   "seo_body":"The Cadillac Escalade is the full-size American luxury SUV, presence at the kerb, room for the party and the luggage, and a cabin that takes long distance comfortably. Suited to group arrivals from DXB or DWC, family transfers, and the journey where space matters as much as service.",
   "also_consider":["gmc-yukon-xl","mb-v-class"]},

  {"id":"gmc-yukon-xl",
   "archetype":"suv",
   "configuration_label":"Three rows in a long-wheelbase body. Second-row captain&rsquo;s chairs as standard, with a bench arrangeable on request to seat more.",
   "title_seo":"GMC Yukon Elevation XL Chauffeur in Dubai | UMC Dubai",
   "meta_seo":"Chauffeur driven GMC Yukon Elevation XL in Dubai. Long-wheelbase SUV for delegations and full-luggage transfers.",
   "tagline":"Space, without compromise.",
   "hero_sub":"The long-wheelbase SUV for the full car and the full boot, delegations, families, and the airport run that carries everything.",
   # v73-C: real imagery wired in.
   "hero_img":"gmc-yukon-xl/hero.jpg",
   "hero_object_pos_mobile":"10% 50%",
   "interior_primary":"gmc-yukon-xl/interior.jpg",
   "interior_details":["gmc-yukon-xl/detail-1.jpg","gmc-yukon-xl/detail-2.jpg","gmc-yukon-xl/detail-3.jpg","gmc-yukon-xl/detail-4.jpg"],
   "interior_heading":"Room for the whole party.",
   "interior_intro":"Three rows, genuine luggage space behind them, and a cabin that keeps its composure however full it is. Built for the journeys a saloon cannot take.",
   "chauffeur_heading":"Held to one standard.",
   "suited_to":"Family and delegation transfers",
   "luggage_label":"Up to 4 cases, mixed sizes","luggage_kind":"large","luggage_count":5,
   "luggage_sg_title":"What fits in the Yukon XL",
   "luggage_sg_intro":"Behind the third row, the boot takes any one of these loads:",
   "luggage_sg_loads":["1 extra-large + 1 large + 1 medium case","2 large + 1 medium case","1 large + 1 medium + 2 cabin cases"],
   "seating_items":[
     ("Up to six","Three rows in a long-wheelbase body. Second-row captain&rsquo;s chairs as standard."),
     ("On request","A bench second row can be arranged on request to seat more."),
     ("Luggage","Generous space behind the third row with the seats upright."),
   ],
   "seo_body":"The GMC Yukon Elevation XL combines long-wheelbase passenger room with genuine luggage space behind the third row. Suited to delegations travelling with full luggage, families heading to or from the airport, and the journey that has to carry everything in one car.",
   "also_consider":["cadillac-escalade","mb-v-class"]},

  {"id":"mb-v-class",
   "archetype":"suv",
   "configuration_label":"Two facing bench rows in the rear cabin, three seats to a row, so six travel together face to face rather than in rows.",
   "title_seo":"Mercedes V-Class Chauffeur in Dubai | Luxury Van | UMC Dubai",
   "meta_seo":"Chauffeur driven Mercedes-Benz V-Class in Dubai. Two facing benches in the rear cabin, seating up to seven, face-to-face layout.",
   "tagline":"A room that travels together.",
   "hero_sub":"When the group moves as one, a cabin arranged for conversation, where everyone faces in rather than forward.",
   # Real V Class photography self-hosted in assets/fleet/v-class/. v49
   # live-measured: source 1895x1813 (nearly square) in a wide-short hero;
   # at 1440 desktop the horizontal overflow is 0 (full width shown) so X is
   # a no-op, only Y crops. 50% 58% is the lock, both tyres fully visible
   # with ground beneath, van framed, roofline intact. Mobile container is
   # portrait so X matters and 50% centres the van.
   "hero_img":"v-class/hero.jpg",
   # v89: desktop crop now 50% 50% per calibrated values (was 50% 58%).
   "hero_object_pos_mobile":"72% 58%",
   "interior_primary":"v-class/interior.jpg",
   "interior_details":["v-class/detail-1.jpg","v-class/detail-2.jpg","v-class/detail-3.jpg","v-class/detail-4.jpg"],
   "interior_heading":"The shared cabin.",
   "interior_intro":"Not a back seat but a room, generous, sociable, and built so a travelling party arrives together, having spent the journey in each other&rsquo;s company rather than in rows.",
   "chauffeur_heading":"Held to one standard.",
   "suited_to":"Group travel, face-to-face",
   "luggage_label":"Up to 7 cases, mixed sizes","luggage_kind":"large","luggage_count":5,
   "luggage_sg_title":"What fits in the V Class",
   "luggage_sg_intro":"With the rear seats in place, the luggage area takes any one of these loads:",
   "luggage_sg_loads":["3 extra-large + 4 cabin cases","3 extra-large + 4 medium cases","3 large + 4 medium cases"],
   "seating_items":[
     ("Facing benches","Two facing bench rows in the rear cabin, three seats to a row, so six travel together face to face rather than in rows."),
     ("Total capacity","Up to seven passengers, including the front cabin."),
   ],
   "seo_body":"The Mercedes Benz V Class is the conversational people-mover, with two facing bench rows in the rear cabin, generous luggage, and the same chauffeur standard as the saloons. Suited to family travel, group transfers, and the journey that is meant to be spent in company rather than in rows.",
   "also_consider":["gmc-yukon-xl","cadillac-escalade"]},

  {"id":"mb-sprinter",
   "archetype":"group",
   # v73-E: real hero. Interior gallery is omitted (no_interior) because the
   # Sprinter is offered in several capacities and a single gallery oversells
   # one spec. The Configurations CTA section takes its place.
   "hero_img":"sprinter/hero.jpeg",
   "hero_object_pos_mobile":"72% 50%",
   "no_interior": True,
   "configurations_cta": {
     "kicker": "Configurations",
     "headline": "Sized to the group.",
     "body": "The Sprinter is offered in several layouts, from compact executive shuttles to higher capacity people movers, each with its own seating and interior. We match the right configuration to your group and confirm it at booking. Tell us the numbers and the occasion, and the concierge will place the correct vehicle.",
   },
   "configuration_label":"Forward-facing rows with aisle access; overhead luggage stowage. Available in several seating configurations, confirmed at booking.",
   "title_seo":"Mercedes Sprinter Chauffeur in Dubai | UMC Dubai",
   "meta_seo":"Chauffeur driven Mercedes-Benz Sprinter in Dubai. Premium group transport, 19-passenger capacity, vetted UMC chauffeur.",
   "tagline":"The group, moved well.",
   "hero_sub":"Premium group transport for delegations, teams and events, the capacity of a coach with the manners of a Mercedes.",
   "interior_heading":"Comfort, at scale.",
   "interior_intro":"A cabin that treats nineteen passengers with the care a saloon gives four, proper seating, climate, and quiet, for the corporate move that has to arrive together and composed.",
   "chauffeur_heading":"Held to one standard.",
   "suited_to":"Corporate group transport",
   "luggage_label":"Up to 10 large bags","luggage_kind":"bag","luggage_count":10,
   "seating_items":[
     ("Headline capacity","Up to 19 passengers, across forward-facing rows with aisle access throughout."),
     ("Configurations","Available in several seating configurations, confirmed at booking."),
     ("Storage","Overhead and rear-cabin luggage stowage."),
   ],
   "seo_body":"The Mercedes Benz Sprinter is the executive minibus, coach-scale capacity with the manners of a Mercedes. Forward-facing rows, aisle access, and integrated climate. Suited to corporate group transport, event shuttles, and the team that has to arrive together and composed.",
   "also_consider":["luxury-coach"]},

  # v83: King Long page consolidated into /fleet/luxury-coach. Hero, interior
  # gallery, and configurations CTA moved into the luxury-coach entry below;
  # /fleet/king-long is 301'd to /fleet/luxury-coach via _redirects.

  # v70: Rolls-Royce. Standalone halo page. Not in UMC_FLEET / fleet-data.js
  # grid; not in nav; not referenced by any other model's also_consider.
  # Ghost and Cullinan, occasion-led copy. Rates on request.
  {"id":"rolls-royce",
   "archetype":"sedan",
   "amenities":"full",
   "title_seo":"Rolls-Royce Chauffeur, Ghost & Cullinan | UMC Dubai",
   "meta_seo":"Rolls-Royce with chauffeur in Dubai. Ghost and Cullinan for weddings, milestone events and VIP arrivals. Vetted UMC chauffeur, rates on request.",
   "tagline":"Arrival, considered.",
   "hero_sub":"The Rolls-Royce Ghost and the Cullinan, reserved for the day the journey is also the moment.",
   "interior_heading":"The cabin built around the occasion.",
   "interior_intro":"A Rolls-Royce cabin is the quietest room in the building. Hand-finished hide, real veneers, deep carpet, and a silence the rest of the road cannot reach. The Ghost holds a saloon-grade rear cabin; the Cullinan adds the height and the presence of an SUV body, without losing the manners.",
   "chauffeur_heading":"Held to one standard.",
   "suited_to":"Weddings, milestones, VIP arrivals",
   "luggage_label":"Up to 3 medium suitcases","luggage_kind":"medium","luggage_count":3,
   "seating_items":[
     ("Ghost, saloon body","Seating for up to four guests in a hushed saloon cabin, with the chauffeur in the front."),
     ("Cullinan, SUV body","Seating for up to four guests in a commanding SUV body, with the chauffeur in the front."),
     ("On request","Rates are quoted per booking. Tell us the date, the time and the occasion; the quote is built around it."),
   ],
   "seo_body":"A Rolls-Royce is the car reserved for the day that asks for one. UMC offers the Rolls-Royce Ghost and the Cullinan with a vetted chauffeur in Dubai and across the UAE, for weddings, milestone events, VIP arrivals and the moments where the car is part of the photograph. Rates are quoted on request because the booking is built around the occasion.",
   "also_consider":["mb-s-class","cadillac-escalade"]},

  # v70: Luxury Coach. The broader group-coach offering (35 and 55 seater),
  # distinct from the single King Long Coach model page. Standalone like Rolls
  # (no rate card on the grid); reachable via direct URL, 301, sitemap and
  # SEO. May be cross-linked but is not in the fleet-data.js grid.
  {"id":"luxury-coach",
   "archetype":"group",
   "amenities":"standard",
   # v83: King Long page folded in here. Hero, interior gallery and
   # configurations CTA carried over; mobile crop "80% 50%" inherited from
   # the former King Long page. Title, tagline ("The group, taken together.")
   # and hero_sub kept from the original luxury-coach entry.
   # TODO: this hero is a 2:1 source, replace with a proper 3:2 coach photo.
   "hero_img":"luxury-coach/hero.jpg",
   # v94: final value chosen live at iPhone 17 Pro Max hero aspect ratio.
   # Coach front centred in the visible window.
   "hero_object_pos_mobile":"75% 50%",
   "interior_primary":"king-long/interior.jpg",
   "interior_details":["king-long/detail-1.jpg","king-long/detail-4.jpg","king-long/detail-3.jpg","king-long/detail-2.jpg"],
   "configurations_cta": {
     "kicker": "Configurations",
     "headline": "Coaches sized to the occasion.",
     "body": "Our coaches run in more than one capacity, including 35 and 55 seat layouts, each with its own interior and luggage provision. We match the right coach to your group size and route, and confirm it at booking. Share the headcount and the itinerary, and the concierge will assign the vehicle.",
   },
   "configuration_label":"Forward-facing rows with aisle access throughout. Overhead luggage stowage above, group luggage hold beneath. 35-seater and 55-seater configurations, confirmed at booking.",
   "title_seo":"Coach & Bus Rental with Driver, Dubai | UMC Dubai",
   "meta_seo":"Luxury coach and bus rental with driver in Dubai. 35 and 55-seater coaches for conferences, roadshows, events and group transport.",
   "tagline":"The group, taken together.",
   "hero_sub":"Larger group transport for conferences, roadshows and events. 35 and 55 seat coaches with a professional driver, across Dubai and the UAE.",
   "interior_heading":"Scale, kept civil.",
   "interior_intro":"A full coach, prepared and staffed to the standard of the rest of the fleet. When the movement is large, the experience should not feel like it.",
   "chauffeur_heading":"Held to one standard.",
   "suited_to":"Conferences, roadshows, large events",
   "luggage_label":"Group hold beneath, overhead above","luggage_kind":"mixed","luggage_count":50,
   "seating_items":[
     ("35-seater","Mid-size coach for departmental groups, smaller delegations and shorter conference transfers."),
     ("55-seater","Full-size coach for full conferences, large corporate moves and full-day group programmes."),
     ("Configuration","Forward-facing rows with aisle access throughout. Overhead luggage stowage; group hold beneath."),
   ],
   "seo_body":"When a group moves together, the coach is the thing the day depends on. UMC's luxury coach service runs 35-seater and 55-seater coaches with a professional driver across Dubai and the UAE, configured for the corporate roadshow, the conference shuttle, the large family movement and the event that asks for a single coordinated arrival. Larger luggage holds beneath, overhead stowage above, and the same standard that runs the rest of the fleet.",
   "also_consider":["mb-sprinter","mb-v-class"]},
]

def fleet_placeholder(label, slot, variant=0, css_class="sc-hero__img"):
    """Inline SVG placeholder for a fleet-page image (swap for real photography later)."""
    rot = (variant * 30) % 360
    return (
      f'<svg class="{css_class}" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Placeholder: {label}">'
      f'<defs><linearGradient id="fp-{slot}" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate({rot})">'
      '<stop offset="0" stop-color="#231B12"/><stop offset="1" stop-color="#4A4136"/>'
      '</linearGradient></defs>'
      f'<rect width="1600" height="900" fill="url(#fp-{slot})"/>'
      '<g font-family="Outfit, sans-serif" fill="#F6F1E7" text-anchor="middle">'
      '<text x="800" y="430" font-size="22" letter-spacing="6" opacity=".45">PLACEHOLDER</text>'
      '<text x="800" y="468" font-size="13" letter-spacing="3" opacity=".3">REPLACE WITH REAL PHOTOGRAPHY</text>'
      f'<text x="800" y="510" font-family="Marcellus, serif" font-size="22" opacity=".48">{label}</text>'
      '</g></svg>'
    )

def render_acard(c):
    # c["page"] is stored without a leading slash so it can also be used as the
    # canonical path (head() prepends https://umcdubai.ae/ to it). For the link
    # in the also-consider card we need a root-absolute href so the link works
    # from any page depth.
    page_abs = c["page"] if c["page"].startswith("/") else "/" + c["page"]
    return (
      '<article class="acard">'
      f'<div class="marque-row"><span class="mk">{c["marque"]}</span><span class="dash"></span><span>{c["category"]}</span></div>'
      f'<h3>{c["name"]}</h3>'
      f'<div class="strap">{c["strap"]}</div>'
      f'<p>{c["ac_body"]}</p>'
      '<div class="stats">'
      f'<div class="it"><span class="k">Passengers</span><span class="v">Up to {c["pax"]}</span></div>'
      f'<div class="it"><span class="k">Luggage</span><span class="v">{c["luggage"]}</span></div>'
      '</div>'
      f'<a class="btn-line" href="{page_abs}">{c["reserve_label"]}</a>'
      '</article>'
    )

def render_fleet_page_body(car):
    info = ALL_CARS[car["id"]]
    cid = car["id"]; name = info["name"]
    arc = ARCHETYPES[car.get("archetype", "sedan")]
    am_html = AMENITY_HTML[car.get("amenities", "standard")]
    config_row_html = ""
    if arc["config_row"] and car.get("configuration_label"):
        config_row_html = (
          '<div class="row"><span class="k">Configuration</span>'
          f'<span class="v"><span class="vmain">{car["configuration_label"]}</span></span></div>'
        )
    # Hero image: real if supplied (with optional per-car object-position).
    # Desktop and mobile crops can differ, emit both via inline style. The
    # mobile media query in style.css picks up --hero-pos-mobile; if a car
    # doesn't specify a mobile crop we just reuse the desktop value.
    if car.get("hero_img"):
        op = car.get("hero_object_pos", "50% 50%")
        op_m = car.get("hero_object_pos_mobile", op)
        hero_ph = (f'<!-- TEMPORARY hero image. Replace with final UMC {name} photography. -->'
                   f'<img class="sc-hero__img" src="/assets/fleet/{car["hero_img"]}?v={FV}" alt="{name}, exterior" fetchpriority="high" style="--hero-pos:{op};--hero-pos-mobile:{op_m}">')
    else:
        hero_ph = fleet_placeholder(name + ", exterior", f"{cid}-hero", variant=0, css_class="sc-hero__img")
    # Interior primary image, primary cell is ~712px on desktop, full-width below 980px.
    if car.get("interior_primary"):
        int_primary_ph = ('<!-- TEMPORARY interior image. Generated 360w/720w variants for srcset. -->'
                          + responsive_img(car["interior_primary"], "sc-int__photo",
                                           f"{name}, cabin",
                                           sizes_attr="(max-width:899px) 100vw, 720px"))
    else:
        int_primary_ph = fleet_placeholder(name + ", cabin", f"{cid}-cabin", variant=1, css_class="sc-int__photo")
    # 2x2 detail grid, each cell renders ~249px on desktop, ~45vw at tablet, ~90vw on phone.
    # A None / empty entry in interior_details falls back to a placeholder for that
    # one slot (so a partially-sourced gallery doesn't break the 2x2 layout).
    if car.get("interior_details"):
        int_details_ph = "".join(
          (responsive_img(p, "sc-int__detail",
                          f"{name}, cabin detail {i+1}",
                          sizes_attr="(max-width:560px) 90vw, (max-width:980px) 45vw, 280px")
           if p
           else fleet_placeholder(name + f", detail {i+1}", f"{cid}-det-{i+1}", variant=(i+2) % 4, css_class="sc-int__detail"))
          for i, p in enumerate(car["interior_details"])
        )
    else:
        int_details_ph = "".join(
          fleet_placeholder(name + f", detail {i+1}", f"{cid}-det-{i+1}", variant=(i+2) % 4, css_class="sc-int__detail")
          for i in range(4)
        )
    hero_sub_html = f'<div class="sc-hero__sub">{car["hero_sub"]}</div>' if car.get("hero_sub") else ""
    seating_html = "".join(f'<div><dt>{dt}</dt><dd>{dd}</dd></div>' for dt, dd in car["seating_items"])
    kind = car.get("luggage_kind", "medium"); lcount = car.get("luggage_count", 2)
    if kind == "medium":
        sg_title = "Medium suitcase (M)"
        sg_intro = "Roughly a standard check-in case, for example an Away Medium, Globe-Trotter Check-In Medium, or Rimowa Check-In."
        sg_rows = [("Each, approximately", "66 &times; 44 &times; 27 cm"), ("In the boot", f"Up to {lcount} cases of this size")]
    elif kind == "large":
        sg_title = "Large suitcase (L)"
        sg_intro = "Roughly an upright 28-inch case, for example an Away Large, Tumi Voyageur Continental, or Rimowa Original Check-In Large."
        sg_rows = [("Each, approximately", "76 &times; 52 &times; 30 cm"), ("In the boot", f"Up to {lcount} cases of this size")]
    else:
        sg_title = "Mixed luggage"
        sg_intro = "Cabin storage is configured for a mix of cabin-size bags and check-in cases up to large; total capacity reflects the realistic load for the vehicle."
        sg_rows = [("Total capacity", f"Up to {lcount} bags"), ("Notes", "Mix of overhead and rear / under-floor storage; arranged on arrival.")]
    sg_rows_html = "".join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in sg_rows)
    # v81: cars that carry mixed-size loads (V Class, Yukon XL, Escalade) use a
    # different modal: short intro, loading configurations as a list, then a
    # shared four-size case-size key. Opt-in per car via luggage_sg_loads.
    if car.get("luggage_sg_loads"):
        sg_title = car["luggage_sg_title"]
        sg_intro = car["luggage_sg_intro"]
        loads_html = "".join(f'<li>{l}</li>' for l in car["luggage_sg_loads"])
        case_key_html = (
            '<div><dt>Cabin</dt><dd>approx. 55 &times; 40 &times; 25 cm. Comparable to an Away The Carry-On, Globe-Trotter Carry-On or Rimowa Cabin.</dd></div>'
            '<div><dt>Medium</dt><dd>approx. 66 &times; 44 &times; 27 cm. Comparable to an Away The Medium, Globe-Trotter Check-In Medium or Rimowa Check-In M.</dd></div>'
            '<div><dt>Large</dt><dd>approx. 75 &times; 52 &times; 31 cm. Comparable to an Away The Large, Globe-Trotter Check-In Large or Rimowa Check-In L.</dd></div>'
            '<div><dt>Extra-large</dt><dd>approx. 81 &times; 55 &times; 36 cm. Comparable to an Away The Trunk, Globe-Trotter XL Trunk or Rimowa Trunk.</dd></div>'
        )
        sg_body_html = (
            f'<ul class="sc-modal__loads">{loads_html}</ul>'
            '<p class="lbl" style="margin:1.2rem 0 .55rem">Case sizes</p>'
            f'<dl class="sc-modal__rows sc-modal__rows--stack">{case_key_html}</dl>'
        )
    else:
        sg_body_html = f'<dl class="sc-modal__rows">{sg_rows_html}</dl>'
    ac_html = "".join(render_acard(ALL_CARS[other]) for other in car["also_consider"])
    chauffeur_heading = car.get("chauffeur_heading", "Held to one standard.")
    cta_label = info["reserve_label"]
    # v73-E: optional interior section + optional "Configurations" CTA section.
    # Sprinter has no_interior=True (sized in several layouts, a single gallery
    # oversells one); King Long keeps the gallery AND adds the CTA.
    if car.get("no_interior"):
        interior_section_html = ""
    else:
        interior_section_html = f"""
<section class="sc-int" id="interior">
  <div class="sc-int__head">
    <div>
      <span class="lbl">{arc["int_lbl"]}</span>
      <h2>{car["interior_heading"]}</h2>
    </div>
    <p class="lede">{car["interior_intro"]}</p>
  </div>
  <div class="sc-int__canvas">
    <div class="sc-int__grid">
      <div class="sc-int__primary">
        <!-- PLACEHOLDER interior image. Replace with real UMC {name} cabin photography. -->
        {int_primary_ph}
      </div>
      <div class="sc-int__details" aria-label="Cabin detail shots">
        <!-- PLACEHOLDER detail images. Replace with real UMC {name} cabin shots. -->
        {int_details_ph}
      </div>
    </div>
  </div>
</section>
"""
    configurations_html = ""
    if car.get("configurations_cta"):
        c = car["configurations_cta"]
        configurations_html = f"""
<section class="sc-config" id="configurations">
  <div class="sc-config__inner">
    <span class="lbl">{c['kicker']}</span>
    <h2>{c['headline']}</h2>
    <p class="lede">{c['body']}</p>
    <div class="sc-config__ctas">
      <a class="btn btn-ink" target="_blank" rel="noopener" href="{WA}">WhatsApp the concierge</a>
      <a class="btn btn-ghost" href="/contact">Contact us</a>
    </div>
  </div>
</section>
"""
    return header("fleet.html") + f"""
<section class="sc-hero" aria-label="{name}">
  <div class="sc-hero__stage">
    <!-- PLACEHOLDER hero. Replace with real UMC {name} photography. -->
    {hero_ph}
  </div>
  <div class="sc-hero__caps">
    <div class="sc-hero__caps-inner">
      <div>
        <div class="sc-hero__kicker">{info["marque"]}</div>
        <div class="sc-hero__tagline">{car["tagline"]}</div>
        {hero_sub_html}
      </div>
      <div class="sc-hero__ctas">
        <a class="btn btn-ink" href="/booking?vehicle={cid}">{cta_label}</a>
      </div>
    </div>
  </div>
</section>

{interior_section_html}{configurations_html}
<section class="sc-am" id="amenities">
  <div class="sc-am__head">
    <span class="lbl">On board</span>
    <h2>{arc["am_heading"]}</h2>
    <p class="lede">{arc["am_lede"]}</p>
  </div>
  <div class="sc-am__grid" role="list">{am_html}</div>
</section>

<section class="sc-paper" id="on-paper">
  <div class="sc-paper__wrap">
    <div class="sc-paper__head">
      <span class="lbl">On paper</span>
      <h2>The plain facts.</h2>
    </div>
    <article class="card">
      <div class="rows">
        <div class="row"><span class="k">Passengers</span>
          <span class="v">
            <span class="vmain">Up to {info["pax"]}</span>
            <button type="button" class="sc-mt" aria-haspopup="dialog" aria-controls="sc-sd" aria-expanded="false">Seating detail</button>
          </span>
        </div>
        <div class="row"><span class="k">Luggage</span>
          <span class="v">
            <span class="vmain">{car["luggage_label"]}</span>
            <button type="button" class="sc-mt" aria-haspopup="dialog" aria-controls="sc-sg" aria-expanded="false">Size guide</button>
          </span>
        </div>
        {config_row_html}
        <div class="row"><span class="k">Suited to</span><span class="v"><span class="vmain">{car["suited_to"]}</span></span></div>
      </div>
      <p>{car["seo_body"]}</p>
    </article>
  </div>
</section>

<div class="sc-modal" id="sc-sg" role="dialog" aria-modal="true" aria-labelledby="sc-sg-title" hidden>
  <div class="sc-modal__backdrop" data-modal-close></div>
  <div class="sc-modal__panel" tabindex="-1">
    <button type="button" class="sc-modal__close" aria-label="Close" data-modal-close>&times;</button>
    <span class="lbl">Size guide</span>
    <h3 id="sc-sg-title">{sg_title}</h3>
    <p>{sg_intro}</p>
    {sg_body_html}
  </div>
</div>

<div class="sc-modal" id="sc-sd" role="dialog" aria-modal="true" aria-labelledby="sc-sd-title" hidden>
  <div class="sc-modal__backdrop" data-modal-close></div>
  <div class="sc-modal__panel" tabindex="-1">
    <button type="button" class="sc-modal__close" aria-label="Close" data-modal-close>&times;</button>
    <span class="lbl">Seating detail</span>
    <h3 id="sc-sd-title">{arc["sd_title"]}</h3>
    <dl class="sc-modal__rows sc-modal__rows--stack">
      {seating_html}
    </dl>
  </div>
</div>

<section class="sc-chau">
  <div class="sc-chau__wrap">
    <div>
      <span class="lbl">The chauffeur</span>
      <h2>{chauffeur_heading}</h2>
      <p>Every {name} on our fleet travels with a chauffeur on UMC payroll. Vetted, trained, and held to a single standard. They hold the door, they know the route, and {arc["chauffeur_close"]}.</p>
      <ul class="sc-chau__points">
        <li>Employed by UMC, not contracted, not supplied by a platform.</li>
        <li>Routes are planned before the engine starts; airport arrivals tracked from departure.</li>
        <li>{arc["chau_point_silence"]}</li>
      </ul>
    </div>
    <aside class="sc-chau__quote">
      <span class="lbl">House standard</span>
      <blockquote>&ldquo;The standard is not the car. It is the person who arrives with it.&rdquo;</blockquote>
      <div class="attr"><span class="dash"></span>UMC Operations &bull; Dubai</div>
    </aside>
  </div>
</section>

<section class="closing band-dark">
  <div class="wrap">
    <span class="lbl">Reservations</span>
    <h2 class="rv">{cta_label}.</h2>
    <div class="btns rv">
      <a class="btn btn-ink" href="/booking?vehicle={cid}">{cta_label}</a>
      <a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a>
    </div>
  </div>
</section>

<section class="sc-also">
  <div class="sc-also__head">
    <span class="lbl">Also consider</span>
    <h2>Other vehicles in this class of service.</h2>
  </div>
  <div class="sc-also__grid">
    {ac_html}
  </div>
</section>

<script>
(function(){{
  var rm = matchMedia("(prefers-reduced-motion:reduce)").matches;
  var hdr = document.querySelector("header.site");
  function setHeaderH(){{ if(hdr) document.documentElement.style.setProperty("--header-h", hdr.offsetHeight + "px"); }}
  setHeaderH();
  window.addEventListener("resize", setHeaderH);
  if(window.visualViewport) visualViewport.addEventListener("resize", setHeaderH);

  /* ---------- subtle load-in reveal (hero immediately; sections on intersection) ---------- */
  var hero = document.querySelector(".sc-hero");
  if(hero) requestAnimationFrame(function(){{ hero.classList.add("sc-in"); }});
  var revealTargets = document.querySelectorAll(".sc-int,.sc-am,.sc-paper,.sc-chau,.sc-also,.closing.band-dark");
  if(!rm && "IntersectionObserver" in window){{
    var io = new IntersectionObserver(function(entries){{
      entries.forEach(function(e){{
        if(e.isIntersecting){{ e.target.classList.add("sc-in"); io.unobserve(e.target); }}
      }});
    }}, {{ threshold: 0.1, rootMargin: "0px 0px -8% 0px" }});
    revealTargets.forEach(function(t){{ io.observe(t); }});
  }} else {{
    revealTargets.forEach(function(t){{ t.classList.add("sc-in"); }});
  }}

  /* ---------- modals (size guide + seating detail) ---------- */
  var openModal = null, lastTrigger = null;
  function focusables(m){{
    return m.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  }}
  function openM(id, trig){{
    var m = document.getElementById(id);
    if(!m) return;
    if(openModal) closeM();
    openModal = m; lastTrigger = trig || null;
    m.hidden = false;
    document.body.classList.add("sc-no-scroll");
    requestAnimationFrame(function(){{ m.classList.add("on"); }});
    if(trig) trig.setAttribute("aria-expanded", "true");
    var fs = focusables(m); if(fs.length) fs[0].focus();
  }}
  function closeM(){{
    if(!openModal) return;
    var m = openModal, trig = lastTrigger;
    m.classList.remove("on");
    setTimeout(function(){{ m.hidden = true; }}, rm ? 0 : 240);
    document.body.classList.remove("sc-no-scroll");
    if(trig){{ trig.setAttribute("aria-expanded", "false"); trig.focus(); }}
    openModal = null; lastTrigger = null;
  }}
  document.querySelectorAll(".sc-mt").forEach(function(b){{
    b.addEventListener("click", function(){{ openM(b.getAttribute("aria-controls"), b); }});
  }});
  document.querySelectorAll("[data-modal-close]").forEach(function(el){{
    el.addEventListener("click", closeM);
  }});
  document.addEventListener("keydown", function(e){{
    if(e.key === "Escape" && openModal) closeM();
    if(e.key === "Tab" && openModal){{
      var fs = focusables(openModal);
      if(!fs.length) return;
      var first = fs[0], last = fs[fs.length - 1];
      if(e.shiftKey && document.activeElement === first){{ e.preventDefault(); last.focus(); }}
      else if(!e.shiftKey && document.activeElement === last){{ e.preventDefault(); first.focus(); }}
    }}
  }});
}})();
</script>
""" + FOOTER + "</body></html>"

# Write the 7 draft fleet pages.
for car in FLEET_PAGES_DRAFT:
    info = ALL_CARS[car["id"]]
    slug = info["page"].split("/")[-1]
    head_html = head(
        car["title_seo"],
        car["meta_seo"],
        info["page"],
        f'<link rel="stylesheet" href="/assets/s-class.css?v={V}">'
    )
    head_html = head_html.replace('<title>', '<base href="/">\n<title>', 1)
    (SITE/"fleet").mkdir(parents=True, exist_ok=True)
    (SITE/"fleet"/f"{slug}.html").write_text(head_html + render_fleet_page_body(car))

# ---------- blog (Phase A) ----------
# Posts live at their EXACT legacy flat slugs at site root (e.g. /guide-salik-dubai/)
#,not under /blog/. This preserves the URLs Google already indexed. A separate
# /blog/ index hub lists all posts. Each post is rendered as site/<slug>/index.html.
# Content is hand-written (calm, institutional voice),no /city-tour/ internal
# links anywhere (city tours are being removed).
BLOG_AUTHOR_DEFAULT = "UMC Dubai"
BLOG_PUBLISHED_DEFAULT = "2024-08-15"
BLOG_POSTS = [
  {
    "slug": "guide-salik-dubai",
    "title": "Salik in Dubai 2026: Toll Gates & How to Save",
    "meta": "How Salik works in Dubai, every toll gate location, when Salik is free, and practical ways to cut your monthly toll costs. A clear 2026 guide.",
    "date": "2025-07-07",
    "date_label": "7 July 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "How Salik works, where the gates are, when crossings are free, and practical ways to keep monthly tolls down.",
    "kicker": "City guide",
    "body": """
<p class="lede">Salik is Dubai's automated road-toll system. For anyone driving the city regularly, residents and visitors alike, it quietly adds up. This guide explains how it works, where the gates are, when you pass through free, and how to keep the monthly cost down.</p>

<h2>How Salik works</h2>
<p>Salik (Arabic for "clear" or "open") is a small RFID tag fixed to a vehicle's windscreen. As the car passes under a toll gantry, a sensor reads the tag and deducts the fee automatically. No stopping, no booths, even at speed. The standard charge is AED 4 per gate crossing, with dynamic pricing introduced at some gates during peak periods in recent years. Rates can change, so check the official <a href="https://www.salik.gov.ae" target="_blank" rel="noopener">Salik portal</a> for the current tariff.</p>
<p>The tag is transferable and removable when you sell the vehicle. For most daily commuters, several crossings a day means monthly tolls often exceed AED 100.</p>

<h2>Salik toll gate locations in Dubai</h2>
<p>The established Salik gates include:</p>
<ul>
  <li>Al Barsha (Sheikh Zayed Road)</li>
  <li>Al Mamzar, North and South</li>
  <li>Al Safa, North and South</li>
  <li>Al Garhoud Bridge</li>
  <li>Business Bay Crossing</li>
  <li>Al Maktoum Bridge</li>
  <li>Airport Tunnel</li>
  <li>Jebel Ali</li>
</ul>
<p>Newer gates such as Al Khail have been added over time. Always verify the live list on the official <a href="https://www.salik.gov.ae" target="_blank" rel="noopener">Salik portal</a> rather than relying on a fixed list.</p>

<h2>When is Salik free in Dubai?</h2>
<p>Salik has historically not charged during certain late-night and early-morning windows, on specific public holidays, and a daily-cap concept has applied at some gates. These rules are periodically updated and the precise free hours, holidays and caps change. We deliberately don't quote a fixed "free from X to Y" rule here because it goes stale quickly.</p>
<p>The reliable approach: confirm the current free windows and holiday rules on the <a href="https://www.salik.gov.ae" target="_blank" rel="noopener">Salik portal</a> before planning around them.</p>

<h2>Managing your Salik account</h2>
<p>Top up online via the Salik app or website (or through RTA channels), keep a positive balance to avoid violation fines, register your plate, and check statements for crossings. Fines apply for passing a gate with insufficient balance if you don't top up within the grace window.</p>

<h2>Practical ways to reduce Salik costs</h2>
<ul>
  <li>Plan routes that avoid unnecessary gate crossings where a parallel road makes sense.</li>
  <li>Travel in off-peak windows where dynamic pricing applies.</li>
  <li>For visitors and busy professionals, a chauffeur service folds tolls, fuel and parking into one transparent rate. You never think about Salik at all.</li>
</ul>
""",
    "cta_heading": "Drive Dubai without the meter.",
    "cta_body": "With UMC, Salik, fuel and parking are already included in every quote. One all-inclusive rate, chauffeur driven.",
    "cta_primary": ("/booking", "Reserve your transfer"),
    "cta_secondary": ("/airport-transfers", "Airport transfers"),
  },
  {
    "slug": "private-car-service-vs-uber",
    "title": "Private Chauffeur vs Uber vs Car Rental in Dubai",
    "meta": "Private chauffeur, Uber, or a self-drive rental in Dubai? A clear side-by-side on cost, comfort, safety and control so you can pick the right ride.",
    "date": "2025-04-25",
    "date_label": "25 April 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "An honest side-by-side on cost, comfort, safety and control across the four main ways to get around Dubai.",
    "kicker": "Comparison",
    "body": """
<p class="lede">Dubai gives you options for getting around: taxis, the Metro, ride-hailing, self-drive rentals, and private chauffeur services. Each suits a different trip. Here's an honest side-by-side.</p>

<h2>The main ways to get around Dubai</h2>
<p><b>Metro and taxi.</b> Cheapest, least private, fixed to public infrastructure and fares. Excellent for short hops along well-served corridors. Harder when you have luggage, multiple stops, or you want a quiet space to take a call.</p>
<p><b>Uber or Careem.</b> Convenient and on-demand, but the car and driver you get are whatever happens to be nearby, and peak-hour surge makes the price unpredictable.</p>
<p><b>Self-drive rental.</b> Genuine freedom. You control the route and the schedule. The trade-offs: you handle Dubai's roads, the parking, the Salik account, and the time lost to navigating an unfamiliar city.</p>
<p><b>Private chauffeur service.</b> A vetted, professional driver in a consistent luxury vehicle, at an all-inclusive rate. No surge, no Salik admin, no parking decisions. Designed for transfers, full days, multi-stop itineraries and any moment a guest needs to be impressed.</p>

<h2>Cost: what you actually pay</h2>
<p>For a single short hop, ride-hailing is the cheapest option, until peak-time surge multiplies the fare. A chauffeur is a fixed, all-inclusive rate that already includes fuel, Salik and parking. For airport transfers, full days, multi-stop programmes or several passengers, that fixed rate is usually the better value once you net out the meter, the surge, the toll surprises and the time saved.</p>

<h2>Comfort and consistency</h2>
<p>With ride-hailing you get whatever car and driver arrive. A chauffeur service gives you the same standard of vehicle and a professional, presentable driver every time, which matters for business meetings, guests, or first impressions where consistency counts.</p>

<h2>Safety</h2>
<p>Ride-hailing in Dubai is regulated, and most rides are uneventful. A chauffeur service is a different proposition: the driver is employed, vetted, trained and accountable to the company, and the vehicle is maintained to a fixed standard. You're choosing a known professional rather than a rotating pool.</p>

<h2>Control and the experience</h2>
<p>A chauffeur wins on door-to-door service, flight tracking and meet-and-greet for airport runs, multi-stop days across the Emirates, and discretion. Self-drive wins if you specifically want to drive yourself. Ride-hailing wins for casual short trips when the schedule isn't tight.</p>

<h2>Frequently asked questions</h2>
<h3>Can I rent a car with a driver in Dubai?</h3>
<p>Yes. UMC offers chauffeur driven vehicles by the hour, half-day, full-day, or for airport transfers. You get the car and a professional driver together.</p>
<h3>How much does it cost to hire a private driver in Dubai?</h3>
<p>It depends on the vehicle and the duration. UMC's rates are all-inclusive (fuel, Salik, parking). See the current rates on the <a href="/fleet">fleet</a> and <a href="/airport-transfers">airport transfer</a> pages.</p>
<h3>Who is the safer choice?</h3>
<p>A vetted, professional chauffeur in a maintained luxury vehicle offers consistent, accountable safety, the same standard every time.</p>
<h3>Is it better to rent a car or use a chauffeur in Dubai?</h3>
<p>For self-drive freedom, rent. For comfort, time and zero hassle with parking, Salik and navigation, a chauffeur.</p>
""",
    "cta_heading": "One driver. One standard. One rate.",
    "cta_body": "All-inclusive chauffeur service across Dubai and the UAE. No surge, no meter.",
    "cta_primary": ("/booking", "Reserve a car"),
    "cta_secondary": ("/fleet", "See the fleet"),
  },
  {
    "slug": "usman-hanif-pioneering-luxury-chauffeur-services-in-dubai",
    "title": "Usman Hanif, Founder of UMC Dubai Luxury Chauffeur Services",
    "meta": "Meet Usman Hanif, founder of UMC Dubai, and how a globally-formed view of luxury travel shaped a chauffeur service built on consistency.",
    "date": "2024-11-18",
    "date_label": "18 November 2024",
    "author": "Usman Hanif",
    "excerpt": "How a globally-formed perspective on luxury travel shaped a chauffeur service built on consistency, discretion and detail.",
    "kicker": "Founder",
    "body": """
<p class="lede">UMC Dubai was founded by Usman Hanif on a simple conviction: that private travel should be consistent, discreet, and quietly excellent, every single time.</p>

<h2>A globally-formed perspective</h2>
<p>Usman's view of service was shaped by time spent across major international cities. That exposure to how the best operators work, and what discerning travellers actually expect, became the standard UMC was built to meet: not occasional brilliance, but reliability you can count on.</p>

<h2>What UMC was built to do</h2>
<p>A fleet of meticulously maintained luxury sedans, SUVs and vans, but the vehicles are only half of it. The point is the service around them: professional chauffeurs, punctuality, discretion, and a booking experience that's effortless. Every ride should feel anticipated, not transactional.</p>

<h2>Built on detail and technology</h2>
<p>UMC pairs old-fashioned service standards with a modern, frictionless booking experience. Request a vehicle in moments, with confirmation handled personally. Flight tracking, meet-and-greet, all-inclusive pricing: the details that remove friction for the client.</p>

<h2>The standard, going forward</h2>
<p>Usman's intent for UMC is consistency at scale, the same standard whether it's a single airport transfer or a full day across the Emirates. That's the through-line: dependable, understated, and held to a high bar.</p>
""",
    "cta_heading": "Travel held to a higher standard.",
    "cta_body": "Read more about the philosophy behind UMC, or reserve a car for your next journey.",
    "cta_primary": ("/booking", "Reserve a car"),
    "cta_secondary": ("/about", "About UMC"),
  },
  {
    "slug": "safe-driver-service-dubai",
    "title": "Safe Driver Service in Dubai: A Client's Checklist",
    "meta": "What to look for in a safe driver service in Dubai: RTA licensing, insurance, professional chauffeurs and transparent pricing.",
    "date": "2025-09-18",
    "date_label": "18 September 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "RTA licensing, full insurance, vetted chauffeurs, a maintained fleet and transparent pricing. The checklist worth running before you book.",
    "kicker": "Service standards",
    "body": """
<p class="lede">A safe driver service in Dubai is more than a ride from A to B. For clients used to a higher standard, "safe" means a chauffeur who has been vetted, a vehicle that is maintained, a price that holds, and a company that is accountable when something needs to change. This is the checklist worth running before you book.</p>

<h2>The non-negotiable foundations</h2>

<h3>RTA licensing and compliance</h3>
<p>Every commercial driver carrying passengers in Dubai must be properly licensed by the RTA, with the right category for chauffeur work. Ask for confirmation. A legitimate operator will be straightforward about it. RTA licensing is the floor, not the ceiling.</p>

<h3>Comprehensive insurance</h3>
<p>Both the vehicle and the passengers should be covered by full commercial insurance. This protects you in the rare event of an incident and is a clear signal that the company runs on the level. Personal-use cover on a vehicle being used for paid passenger work is not the same thing.</p>

<h2>A discerning client's checklist</h2>

<h3>A professional chauffeur</h3>
<p>Vetted, trained, presentable, discreet. A chauffeur is not a taxi driver in a nicer car. The job is to anticipate, hold the door, manage the route quietly, and leave the cabin to the client. References, training records and turnover rates all say something about how a company treats its drivers, which in turn shows up in every ride.</p>

<h3>A maintained, modern fleet</h3>
<p>Late-model luxury vehicles, serviced on a schedule, kept clean inside and out. Asking when the cars were last serviced is a fair question. The answer should be unhesitating.</p>

<h3>Transparent pricing</h3>
<p>The quote you accept should be the quote you pay. All-inclusive means fuel, Salik and parking are already in the rate. Surge pricing, mystery surcharges and "the meter ran long" are the opposite of a safe service. A good operator confirms inclusions in writing.</p>

<h2>How UMC measures up</h2>
<p>UMC meets every item on this list as standard: licensed drivers, full passenger and vehicle cover, vetted chauffeurs, a maintained luxury fleet, and a transparent all-inclusive rate confirmed at booking. Nothing on this list is optional for us.</p>

<h2>Frequently asked questions</h2>
<h3>What licences should a chauffeur in Dubai hold?</h3>
<p>A commercial driving permit issued by the RTA, valid for the category of work being performed. A reputable operator can show this on request.</p>
<h3>Is insurance included for passengers?</h3>
<p>With a proper chauffeur service, yes. Both vehicle and passenger cover should be in place. With informal arrangements this can be unclear, which is itself a reason to use a licensed operator.</p>
<h3>Are tips included in the rate?</h3>
<p>UMC's quoted rate is the full rate. Tips are appreciated but never required, and the chauffeur is paid a proper salary either way.</p>
""",
    "cta_heading": "Safe is the floor, not the ceiling.",
    "cta_body": "Vetted chauffeurs, a maintained fleet and one all-inclusive rate. That is what a safe service looks like.",
    "cta_primary": ("/booking", "Reserve a car"),
    "cta_secondary": ("/fleet", "See the fleet"),
  },
  {
    "slug": "emirates-chauffeur-tips",
    "title": "Tipping a Chauffeur in Dubai: A First-Timer's Guide",
    "meta": "How tipping works for chauffeurs and private drivers in Dubai: what's customary, how much, airport-transfer etiquette, and whether tips are already included.",
    "date": "2025-09-16",
    "date_label": "16 September 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "What's customary, how much, airport-transfer etiquette, and whether tips are already included.",
    "kicker": "Etiquette",
    "body": """
<p class="lede">Tipping a chauffeur in Dubai sits somewhere between an obligation and a habit. It is appreciated, not enforced. Here is how it actually works for visitors and residents, and what to consider for a private driver specifically.</p>

<h2>Key takeaways</h2>
<ul>
  <li>Tipping in Dubai is appreciated, not obligatory.</li>
  <li>For a private chauffeur, customary tips fall in the 10 to 15 percent range, often expressed as rounding the rate up.</li>
  <li>Service charges may already be included in restaurant or hotel bills. Check the bill.</li>
  <li>UMC's quoted rate is the full rate. Anything additional is at your discretion.</li>
</ul>

<h2>Dubai's tipping culture</h2>
<p>Dubai is a service-led city, and tipping is a friendly acknowledgement rather than a fixed rule. Locals and long-term residents tip when the service was good, and the amount tends to scale with the setting. Nobody will chase you for a tip, and a polite thank you is never out of place.</p>

<h2>How much should you tip a private driver?</h2>
<p>For a private chauffeur in Dubai, a customary tip falls somewhere between 10 and 15 percent of the fare, often rounded up to a clean note. For a short airport transfer, rounding up by AED 20 to AED 50 is common. For a full day or a multi-stop programme, tipping at the upper end of the range or a flat AED 100 to AED 200 is a kind acknowledgement of a long day on the road.</p>
<p>These are not fixed rules. The amount is at your discretion and should reflect the quality of the service.</p>

<h2>Airport-transfer tipping etiquette</h2>
<p>For an airport pickup or drop-off, the chauffeur typically meets you at arrivals with a name board, handles luggage and walks with you to the car. A rounded-up tip in cash at the end of the ride is the simplest way to say thank you. There is no obligation to tip on every leg of a return booking.</p>

<h2>Tipping a taxi vs a private driver</h2>
<p>For a Dubai taxi, most people round the meter up to a clean number. An extra AED 5 to AED 10 on a short ride is typical. A private chauffeur is a different category of service: trained, dedicated to your booking, and accountable to the company that employs them. Tips tend to be a little more generous to reflect that.</p>

<h2>Other tipping customs for visitors</h2>
<ul>
  <li><b>Restaurants:</b> a service charge may already be included. If not, 10 to 15 percent is customary for good service.</li>
  <li><b>Hotels:</b> AED 5 to AED 20 for porters and housekeeping is typical, more for concierge requests.</li>
  <li><b>Valet:</b> AED 10 to AED 20 on collection is common.</li>
</ul>

<h2>Frequently asked questions</h2>
<h3>Is tipping respectful in Emirati culture?</h3>
<p>Yes. Tipping is welcomed across the UAE's service industry. Polite, discreet tipping in cash is the norm.</p>
<h3>Are tips included in the chauffeur fee?</h3>
<p>UMC's quoted rate is the full rate. Any tip is entirely at your discretion and goes to the chauffeur.</p>
<h3>Should I tip the chauffeur?</h3>
<p>A tip at the end of a long day is appreciated but never expected.</p>
<h3>Should I tip taxi drivers in Dubai?</h3>
<p>Rounding the meter up to the next clean note is customary. A larger tip is welcome for help with luggage or a long ride.</p>
<h3>Should I tip in AED or USD?</h3>
<p>AED is best. It can be used immediately and avoids any currency exchange overhead.</p>
""",
    "cta_heading": "The rate stays the rate.",
    "cta_body": "Book a chauffeur for the day or the trip. Anything else is at your discretion.",
    "cta_primary": ("/booking", "Reserve a car"),
    "cta_secondary": ("/airport-transfers", "Airport transfers"),
  },
  {
    "slug": "dubai-to-abu-dhabi-trip",
    "title": "Dubai to Abu Dhabi: Routes, Travel Time & How to Get There",
    "meta": "Travelling Dubai to Abu Dhabi? The main routes (E11, E66), journey time, and your transport options from public transport to a private chauffeur.",
    "date": "2025-04-06",
    "date_label": "6 April 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "The main routes, the journey time, and your options from intercity bus to private chauffeur.",
    "kicker": "Travel",
    "body": """
<p class="lede">Dubai to Abu Dhabi is the UAE's busiest intercity corridor. The drive is straightforward on a good day, with one main artery and a quieter alternative. Here is how to think about routes, time and the best way to make the journey.</p>

<h2>Routes and major roads</h2>

<h3>E11 (Sheikh Zayed Road)</h3>
<p>E11 is the main coastal artery between the two cities. It runs from central Dubai down through Jebel Ali and on to Abu Dhabi, with multiple lanes and steady traffic at most hours. Expect light congestion in rush hour around either end of the trip.</p>

<h3>E66 (Dubai to Al Ain Road)</h3>
<p>E66 cuts inland through quieter desert country and connects to Abu Dhabi via Al Ain. It is a longer route and typically slower than E11, but it is an alternative when E11 has an incident, or for travellers heading to Al Ain itself.</p>

<h2>Travel time and distance</h2>
<p>The Dubai to Abu Dhabi run on E11 covers roughly 140 kilometres and typically takes around 90 minutes door to door, depending on origin, destination and traffic. Allow a margin in either rush hour or during major events.</p>

<h2>Transport options</h2>

<h3>Public transport</h3>
<p>The intercity bus is the cheapest option, running frequently between Ibn Battuta in Dubai and the main Abu Dhabi bus station. It is reliable for budget travel but the least flexible, and the longest end-to-end once the connections at either side are added in.</p>

<h3>Taxi and ride-hailing</h3>
<p>Both standard taxis and ride-hailing apps run between the two cities. Fares vary by time of day, traffic and provider. Surge pricing can push the cost up sharply at peak times, and not every driver will be enthusiastic about the return leg.</p>

<h3>Private chauffeur</h3>
<p>For comfort and predictability over a 90-minute trip, a private chauffeur is the most relaxed option. The rate is fixed and all-inclusive (fuel, Salik and parking), the vehicle is consistent, and the chauffeur knows the route. It is the obvious choice for an Abu Dhabi airport transfer, a meeting on the Corniche, or a day in the capital.</p>

<h2>Frequently asked questions</h2>
<h3>How do I get from Dubai to Abu Dhabi?</h3>
<p>By car (via E11 or E66), by intercity bus, or with a private chauffeur. The right answer depends on your priorities: cost, flexibility or comfort.</p>
<h3>How long is the drive?</h3>
<p>Roughly 90 minutes for the 140 kilometre run on E11, traffic permitting.</p>
<h3>How much is a taxi to Abu Dhabi?</h3>
<p>Taxi and ride-hailing fares vary widely by time, provider and surge. There is no fixed published rate, so confirm the estimate before you set off.</p>
<h3>What is the cheapest way to travel?</h3>
<p>The intercity bus is the cheapest option for a budget traveller comfortable with the connections at either end.</p>
<h3>What is best for comfort or a luxury trip?</h3>
<p>A private chauffeur. Fixed rate, consistent car, door to door, and the chauffeur takes care of the rest.</p>
""",
    "cta_heading": "Dubai to Abu Dhabi, the calm way.",
    "cta_body": "All-inclusive chauffeur service between Dubai and Abu Dhabi. Fixed rate, comfortable car, no surprises.",
    "cta_primary": ("/booking", "Reserve your transfer"),
    "cta_secondary": ("/airport-transfers/abu-dhabi", "Abu Dhabi airport transfers"),
  },
  {
    "slug": "dubai-date-night-ideas",
    "title": "7 Dubai Date Night Ideas (With a Chauffeur to Match)",
    "meta": "Seven memorable Dubai date night ideas, from Burj Khalifa dining to Love Lake, and how a private chauffeur makes the whole evening effortless.",
    "date": "2025-10-20",
    "date_label": "20 October 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "Seven memorable Dubai evenings, from Burj Khalifa dining to Love Lake, made effortless with a chauffeur for the night.",
    "kicker": "Evenings out",
    "body": """
<p class="lede">A great Dubai evening usually involves a great view, a thoughtful table, and the absence of friction. The right setting is half of it. A chauffeur for the evening is the other half. No parking searches, no navigating, no being the designated driver. Just the date.</p>

<h2>Best Dubai date night ideas</h2>

<h3>1. Dinner with a view at Burj Khalifa</h3>
<p>At.mosphere or one of the upper-floor restaurants in the tower sets a very particular tone. Book in advance, dress for the room, and arrive at the kerb with the evening already underway.</p>

<h3>2. The Dubai Fountain after dinner</h3>
<p>The fountain shows in front of Burj Khalifa run on the half hour through the evening. A walk along the waterfront after dinner is the obvious follow-on, and it costs nothing.</p>

<h3>3. Sunset at Jumeirah</h3>
<p>Jumeirah's beach stretch turns honey-coloured an hour before sunset. A short walk, a drink at one of the seafront hotels, then dinner nearby. Quiet, elegant, on-brand for the city.</p>

<h3>4. Love Lake Dubai</h3>
<p>The pair of heart-shaped lakes at Al Qudra is a popular sunset spot for couples. Bring a blanket or a packed dinner, and a chauffeur who can wait for you on the way back into town.</p>

<h3>5. Dubai Marina sunset stroll</h3>
<p>The Marina Walk shifts from working harbour to evening promenade as the light goes. Dinner on the waterfront, a slow walk along the boardwalk, then home.</p>

<h3>6. Dubai Miracle Garden</h3>
<p>Open in the cooler months, the Miracle Garden is a gentle evening for couples who enjoy the unexpected. Best timed for early evening when the lighting comes up.</p>

<h3>7. Dubai Opera</h3>
<p>An opera, a ballet or a touring production at Dubai Opera is a proper occasion. Pair it with a pre-show dinner downtown and a car waiting at the steps when the curtain comes down.</p>

<h2>Scenic drives for two</h2>
<p>For something quieter, the Hatta mountain road and the Al Qudra desert loop both make a relaxed evening out of Dubai. Sunset on either is worth the drive.</p>

<h2>Why a chauffeur for the evening</h2>
<p>An evening should not be interrupted by parking, traffic or the question of who is driving home. A chauffeur for the evening, on the hour or for a fixed block, removes every one of those friction points. You arrive, you leave, the car is there.</p>

<h2>Frequently asked questions</h2>
<h3>How do I book a chauffeur for the evening?</h3>
<p>Reserve by the hour or for a fixed block via the booking page. Five hours is a comfortable date-night minimum for a downtown evening with dinner.</p>
<h3>Can the chauffeur recommend the route or stops?</h3>
<p>Yes. UMC chauffeurs know the city well and can sequence stops sensibly, with discretion.</p>
""",
    "cta_heading": "An evening, undisturbed.",
    "cta_body": "Book a chauffeur for the evening, on the hour or for a fixed block. Arrive, leave, the car is there.",
    "cta_primary": ("/booking", "Reserve your car"),
    "cta_secondary": ("/fleet", "See the fleet"),
  },
  {
    "slug": "failure-of-a-light-vehicle-to-abide-by-lane-discipline",
    "title": "Lane Discipline Fines in Dubai: 10 Violations to Avoid",
    "meta": "Dubai Police enforce lane discipline strictly. The 10 most common lane violations for light vehicles, what they mean, and how to avoid the fine.",
    "date": "2025-07-04",
    "date_label": "4 July 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "The ten lane-discipline violations Dubai Police enforce most, what they mean, and how to drive around them.",
    "kicker": "Driving in Dubai",
    "body": """
<p class="lede">Dubai's roads are fast, well-engineered and tightly policed. Lane discipline is taken seriously because it has to be: at the speeds people travel here, a careless lane change is the difference between a calm Wednesday and a Police report. Here are the ten lane-discipline violations Dubai Police enforce most, in plain language, and how to avoid each one.</p>

<h2>Why lane discipline is enforced</h2>
<p>The rationale is straightforward. Predictable driving keeps traffic flowing and keeps people alive. The RTA and Dubai Police use both human patrols and automated camera systems to enforce the rules, and the penalty system applies fines and black points to the registered driver. Amounts and points are revised periodically. Always confirm current penalties on the official Dubai Police or RTA channels rather than relying on a stale online figure.</p>

<h2>10 lane-discipline violations to avoid</h2>

<h3>1. Passing on a no-passing line</h3>
<p>Solid white or yellow lane markings are not suggestions. If the line is solid on your side, you may not cross it to overtake. Wait for a broken line, or for an opportunity in your own lane.</p>

<h3>2. Not stopping at a stop line</h3>
<p>A stop line at a junction means stop fully before the line, look, and only then proceed. Rolling stops are routinely captured by camera at signalled junctions.</p>

<h3>3. Not giving way at a give-way line</h3>
<p>Give-way (yield) markings require you to slow and let crossing traffic pass before you commit. Forcing yourself in is a violation and a common cause of side impacts.</p>

<h3>4. Not yielding to pedestrians at a crossing</h3>
<p>Marked pedestrian crossings give pedestrians priority. Stop in time, even if the road is otherwise clear.</p>

<h3>5. Cutting in line</h3>
<p>Jumping a queue by darting in from a parallel lane (or from the shoulder) is fined separately from a normal lane change. Queue properly; merge where the road permits.</p>

<h3>6. Overtaking from the right</h3>
<p>In the UAE, overtaking is from the left in normal conditions. Undertaking on the right is a violation and a particular hazard on multi-lane highways.</p>

<h3>7. Sudden lane changes</h3>
<p>A safe lane change is signalled, mirrored, and committed once it is clear. Sudden, unsignalled changes are penalised and are a leading cause of collisions on Sheikh Zayed Road.</p>

<h3>8. Not staying in your designated lane</h3>
<p>Drifting across lanes (or straddling two) is itself a violation. Pick a lane, hold it, and change it deliberately.</p>

<h3>9. Not following lane arrows</h3>
<p>Where arrows are painted on the road (right turn only, straight only) follow them. Doing the opposite at the last moment is both fined and dangerous.</p>

<h3>10. Stopping inside a box junction</h3>
<p>Yellow box junctions are kept clear by rule. Do not enter unless your exit is clear, even if your signal is green.</p>

<h2>How to avoid the fine</h2>
<p>Most lane fines are avoided by three habits: signal early, hold your lane, and treat road markings as instructions, not preferences. Read the road well ahead and commit cleanly to each manoeuvre. If a route or stretch is unfamiliar, slow a notch.</p>
<p>For visitors and busy professionals, there is a simpler answer: a professional chauffeur. UMC's chauffeurs drive Dubai's roads every day and to a high standard. Lane discipline, traffic flow and route choice are simply not your problem.</p>
""",
    "cta_heading": "Drive Dubai without watching the mirrors.",
    "cta_body": "A professional chauffeur, a maintained car, an all-inclusive rate. The lane discipline is on us.",
    "cta_primary": ("/booking", "Reserve a car"),
    "cta_secondary": ("/fleet", "See the fleet"),
  },
  {
    "slug": "abu-dhabi-city-tour-private-driver",
    "title": "Exploring Abu Dhabi with a Private Chauffeur: A Day Guide",
    "meta": "See the best of Abu Dhabi with a private chauffeur at your disposal: palaces, landmarks, souks and parks, on your schedule and in comfort.",
    "date": "2025-10-26",
    "date_label": "26 October 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "A private chauffeur at your disposal turns the capital into a calm day out: palaces, museums, the Corniche, the souks, in your own order.",
    "kicker": "Abu Dhabi",
    "body": """
<p class="lede">Abu Dhabi is the kind of city that rewards an unhurried visit. A chauffeur at your disposal for the day makes the difference. No parking decisions, no taxi negotiations between stops, no map on your knee. The day belongs to you, the chauffeur handles the rest.</p>

<h2>Where a private day in Abu Dhabi can take you</h2>

<h3>Palaces and museums</h3>
<p>Qasr Al Watan, the Presidential Palace, is a serious half-day on its own. Pair it with Louvre Abu Dhabi for the morning, and you have a strong cultural opening to the day. Both reward an early start.</p>

<h3>Modern landmarks</h3>
<p>The Sheikh Zayed Grand Mosque is the city's defining building. The Corniche is best driven slowly with a stop near the breakwater. Yas Island, with Ferrari World, Yas Marina Circuit and the seafront promenade, makes a complete afternoon.</p>

<h3>Shopping and souks</h3>
<p>The Galleria on Al Maryah, the boutiques along Etihad Towers, and the more traditional Iranian Souk and Al Mina market each offer a different shopping mood. With a chauffeur, you arrive at the door and leave the bags in the car.</p>

<h3>Nature and parks</h3>
<p>Mangrove National Park, Umm Al Emarat Park, and the Saadiyat beachfront are calm counterweights to a city day. They are easy stops on the way back into town as the light softens.</p>

<h2>Why a chauffeur-at-disposal day works</h2>

<h3>Build your own itinerary</h3>
<p>You decide the order, the dwell time, and what to skip. A by-the-hour chauffeur block adapts to the day rather than fixing it to a script.</p>

<h3>See more in less time</h3>
<p>You aren't queueing for taxis between stops, or hunting for parking at the Mosque or the Louvre. The car waits for you.</p>

<h3>Step out of the heat into comfort</h3>
<p>Cabin temperature, cold water, charged phone. The car is the constant. The city is the variable.</p>

<h3>Local knowledge</h3>
<p>UMC's chauffeurs know the entry routes, the parking layouts, and the realistic time between sites. They sequence your day so it actually works.</p>

<h3>Privacy</h3>
<p>A discreet professional in the front, your space in the back. Conversations stay in the car. Itineraries are not discussed.</p>

<h2>Frequently asked questions</h2>
<h3>How do I book a chauffeur for a day in Abu Dhabi?</h3>
<p>Reserve a chauffeur-at-disposal block via the booking page. Five hours or ten hours are the common configurations for a half or full day.</p>
<h3>Is the rate all-inclusive?</h3>
<p>Yes. UMC's rate includes the chauffeur, fuel, Salik and parking. The quote is the quote.</p>
<h3>Can the chauffeur suggest stops?</h3>
<p>Yes. Tell us what you enjoy, or what you have already seen, and the chauffeur will sequence the day accordingly.</p>
""",
    "cta_heading": "A day in Abu Dhabi, on your terms.",
    "cta_body": "Reserve a chauffeur-at-disposal block. Build the day as you go. Five hours, ten hours, or longer.",
    "cta_primary": ("/booking", "Reserve your car"),
    "cta_secondary": ("/fleet", "See the fleet"),
  },
  {
    "slug": "half-day-city-tour-dubai",
    "title": "Half a Day in Dubai: Seeing the Best of It with a Chauffeur",
    "meta": "Short on time in Dubai? How to see the city's highlights in half a day with a private chauffeur, from the coast to the souks to the modern icons.",
    "date": "2025-10-28",
    "date_label": "28 October 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "Five hours, the right sequence, and a chauffeur who handles the city for you.",
    "kicker": "Dubai",
    "body": """
<p class="lede">Five hours is enough to see Dubai properly, if it is sequenced well and somebody else is doing the driving. A chauffeur at your disposal for the half day is the simplest way to make the city deliver. Here is how to use the time.</p>

<h2>Seeing the best of Dubai in half a day</h2>

<h3>By the shore</h3>
<p>Start on the coast. Dubai Marina, the boardwalk at JBR, and a slow drive along Palm Jumeirah set the city's modern register before you go anywhere else. Atlantis at the tip of the Palm is the natural turnaround.</p>

<h3>Culture and heritage</h3>
<p>From the coast, head inland to Al Fahidi Historical Neighbourhood for a sense of the older city. Cross the Creek by abra (the chauffeur picks you up on the other side) and walk through the Gold and Spice Souks. This is the slow half of the half-day, and the part most visitors remember.</p>

<h3>Retail</h3>
<p>Dubai Mall and Mall of the Emirates are an obvious anchor if your visit needs one. With a chauffeur, you arrive at the door, drop the bags in the car between stops, and don't think about parking.</p>

<h3>Modern icons</h3>
<p>Finish at the modern landmarks: Burj Khalifa for the height, the Museum of the Future for the architecture, and the Dubai Frame for the contrast between old and new on either side of it. These are best in the late afternoon as the light softens.</p>

<h2>How to plan the five hours</h2>
<p>Treat your chauffeur block as a planning tool, not a schedule. A half-day works best with two anchor stops (45 to 60 minutes each) and a couple of brief visits in between. UMC's chauffeurs will sequence the route so the driving time is minimal and you are not crossing the city twice.</p>

<h2>Frequently asked questions</h2>
<h3>How do I book a half-day chauffeur in Dubai?</h3>
<p>Reserve a five-hour chauffeur-at-disposal block via the booking page. The chauffeur stays with you for the full block.</p>
<h3>Is the rate all-inclusive?</h3>
<p>Yes. Fuel, Salik and parking are included. There is no meter.</p>
<h3>Which vehicle should I choose?</h3>
<p>A Mercedes E Class or BMW 7 Series is comfortable for two. A V Class is the practical choice for families or four to six guests.</p>
""",
    "cta_heading": "Five hours, properly used.",
    "cta_body": "Reserve a half-day chauffeur block. Anchor stops, easy transitions, the car at the door.",
    "cta_primary": ("/booking", "Reserve your car"),
    "cta_secondary": ("/fleet", "See the fleet"),
  },
  {
    "slug": "dubai-shopping-with-driver",
    "title": "Dubai Shopping with a Chauffeur: Malls, Boutiques & Souks",
    "meta": "Shop Dubai in comfort with a private chauffeur: arrive at the malls, boutiques and souks of your choice, with someone to handle the bags and the driving.",
    "date": "2025-12-24",
    "date_label": "24 December 2025",
    "author": BLOG_AUTHOR_DEFAULT,
    "excerpt": "Door-to-door shopping with a chauffeur: no parking, no taxis between stops, bags in the car.",
    "kicker": "Shopping",
    "body": """
<p class="lede">A serious shopping day in Dubai is mostly logistics: parking, traffic between malls, the bags, the heat, the taxis. A chauffeur for the day removes every one of those friction points. You arrive at the door, you leave with the chauffeur at the kerb, and the bags travel in the car.</p>

<h2>Why shop with a chauffeur</h2>
<p>The malls, boutiques and souks are not within walking distance of each other. The afternoons are hot. Parking at peak times is real. A chauffeur at your disposal turns a chained-together morning of taxis and queues into one clean day, on your schedule.</p>

<h2>How a private shopping day works</h2>

<h3>Choose dates and your pick-up</h3>
<p>Tell us when, where you would like to be collected, and where you intend to start. A morning start with a quiet first mall is usually the calmest opening.</p>

<h3>Select your vehicle</h3>
<p>A Mercedes E Class for two, a V Class for a family or three to six guests, or an SUV like the Cadillac Escalade when comfort and boot space matter. See the <a href="/fleet">fleet</a> for the full set.</p>

<h3>Get a quote</h3>
<p>All-inclusive for the block you need (fuel, Salik, parking). The quote you receive is the quote you pay.</p>

<h3>Book</h3>
<p>Confirm via the booking page or WhatsApp. You will get a written confirmation with the chauffeur's contact details for the day.</p>

<h3>Plan the itinerary, loosely</h3>
<p>A loose plan is the best plan. The chauffeur can sequence the route, swap an order around when something runs long, and circle back if you forget a piece.</p>

<h2>Suggested half-day and full-day itineraries</h2>

<h3>Mall of the Emirates and City Walk</h3>
<p>A long morning at Mall of the Emirates for the flagship brands, lunch at City Walk, and a slower afternoon along its boulevards. Easy parking access, two distinct moods, and the bags between stops are not your concern.</p>

<h3>Jumeirah boutiques</h3>
<p>For independent shops and quieter showrooms, the Jumeirah strip is the right call. Pair it with lunch at one of the beachfront hotels. A chauffeur is the difference between a relaxed afternoon and a parking puzzle.</p>

<h3>The Dubai souks</h3>
<p>The Gold and Spice Souks across Deira are an experience as much as a shop. The chauffeur drops you near the souk, waits while you walk through, and meets you on the other side. The Creek abra crossing is included in any decent route.</p>

<h3>A full day across the city</h3>
<p>Coast to inland: Dubai Mall in the morning, Mall of the Emirates around lunch, Jumeirah boutiques mid-afternoon, the souks at golden hour. Ten hours is comfortable. The chauffeur will sequence it so the drives stay short.</p>

<h2>Frequently asked questions</h2>
<h3>How do I book a chauffeur for shopping?</h3>
<p>Reserve a chauffeur-at-disposal block via the booking page. Five or ten hours are the common configurations.</p>
<h3>Will the chauffeur help with bags?</h3>
<p>Yes. Loading the car between stops is part of the service.</p>
<h3>Can the car wait outside while I am inside the mall?</h3>
<p>The chauffeur waits at a sensible nearby spot and meets you at the door when you are ready.</p>
<h3>Which vehicle is best for shopping?</h3>
<p>For two, an E Class. For three or four with larger bags, a V Class or Cadillac Escalade. The full range is on the <a href="/fleet">fleet</a> page.</p>
""",
    "cta_heading": "Shop Dubai, calmly.",
    "cta_body": "Reserve a chauffeur for the day. Door to door, bags in the car, the route handled.",
    "cta_primary": ("/booking", "Reserve your car"),
    "cta_secondary": ("/fleet", "See the fleet"),
  },
]

def render_article_schema(p):
    """JSON-LD Article schema for the post."""
    canon = f"https://umcdubai.ae/{p['slug']}/"
    data = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": p["title"],
        "description": p["meta"],
        "datePublished": p["date"],
        "dateModified": p["date"],
        "author": {"@type": "Person" if p["author"] == "Usman Hanif" else "Organization",
                   "name": p["author"]},
        "publisher": {
            "@type": "Organization", "name": "UMC Dubai",
            "logo": {"@type": "ImageObject", "url": f"{OG_BASE}/assets/og-image.png"}
        },
        "mainEntityOfPage": {"@type": "WebPage", "@id": canon},
        "image": [f"{OG_BASE}/assets/og-image.png"],
    }
    return '<script type="application/ld+json">' + json.dumps(data, separators=(",", ":")) + '</script>'

def render_post(p):
    """Render a single blog post at site/<slug>/index.html."""
    canon = f"{p['slug']}/"
    head_extra = render_article_schema(p)
    primary_href, primary_label = p["cta_primary"]
    sec_href, sec_label = p["cta_secondary"]
    body = header(canon) + f"""
<article class="article">
  <header class="article-hero">
    <div class="wrap article-wrap">
      <span class="lbl">{p['kicker']}</span>
      <h1>{p['title']}</h1>
      <p class="article-meta"><time datetime="{p['date']}">{p['date_label']}</time> &middot; <span>By {p['author']}</span></p>
    </div>
  </header>
  <div class="article-body">
    <div class="wrap article-wrap rv">
      {p['body']}
    </div>
  </div>
  <section class="closing band-dark article-closing">
    <div class="wrap">
      <span class="lbl">{p['kicker']}</span>
      <h2 class="rv">{p['cta_heading']}</h2>
      <p class="lede rv" style="color:#D9D0C0;max-width:54ch;margin:0 auto 1.6rem">{p['cta_body']}</p>
      <div class="btns rv">
        <a class="btn btn-ink" href="{primary_href}">{primary_label}</a>
        <a class="btn btn-ghost" href="{sec_href}">{sec_label}</a>
      </div>
    </div>
  </section>
""" + FOOTER + "</body></html>"
    out_dir = SITE / p["slug"]
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.html").write_text(head(p["title"], p["meta"], canon, head_extra) + body)

def render_blog_index():
    """List of all posts at /blog/."""
    cards = []
    for p in BLOG_POSTS:
        cards.append(f"""
      <article class="blog-card rv">
        <span class="lbl">{p['kicker']}</span>
        <h3><a href="/{p['slug']}/">{p['title']}</a></h3>
        <p class="blog-card-meta"><time datetime="{p['date']}">{p['date_label']}</time> &middot; {p['author']}</p>
        <p>{p['excerpt']}</p>
        <a class="btn btn-line" href="/{p['slug']}/">Read</a>
      </article>""")
    body = header("blog/") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">Journal</span>
    <h1>Field notes on driving in Dubai.</h1>
    <p class="lede">Practical guides, comparisons and the occasional perspective from the team behind UMC.</p>
  </div>
</section>
<section class="sec">
  <div class="wrap">
    <div class="blog-grid">
      {''.join(cards)}
    </div>
  </div>
</section>
""" + FOOTER + "</body></html>"
    (SITE / "blog").mkdir(parents=True, exist_ok=True)
    (SITE / "blog" / "index.html").write_text(
        head("UMC Journal, Field Notes on Driving in Dubai",
             "Practical guides and comparisons from UMC Dubai, Salik, chauffeur vs ride-hailing, and the perspective behind the service.",
             "blog/") + body)

for _p in BLOG_POSTS:
    render_post(_p)
render_blog_index()

# v72 (Phase F): sitemap rebuilt to match each page's CANONICAL exactly.
# Pages served as <slug>.html (no-slash form is the direct 200) live in the
# no-slash list. Pages served as <dir>/index.html (trailing-slash form is the
# direct 200) live in the slash list. The string form here must be byte-equal
# to the page's <link rel="canonical">. Removing .html-suffixed entries that
# 301-normalize, and the legacy/trailing-slash variants that 307-normalize.
import datetime as _dt
_LASTMOD = _dt.date.today().isoformat()

# Trailing-slash canonical URLs (served as <dir>/index.html).
_pages_slash = (
    ["",  # homepage = /
     "blog/",
     "rent-a-car-with-driver/"]
    + [f"rent-a-car-with-driver/{em['slug']}/" for em in RENT_EMIRATES]
    + [p["slug"] + "/" for p in BLOG_POSTS]
)
# No-slash canonical URLs (served as <slug>.html at a clean path).
_pages_noslash = [
    "fleet",
    "airport-transfers",
    "inter-emirate",
    "corporate",
    "events",
    "about",
    "contact",
    "booking",
    "terms",
    "privacy",
    # Fleet model pages (10,v83: king-long consolidated into luxury-coach)
    "fleet/s-class", "fleet/bmw-7-series", "fleet/e-class", "fleet/lexus-es",
    "fleet/cadillac-escalade", "fleet/gmc-yukon-xl", "fleet/v-class",
    "fleet/sprinter", "fleet/rolls-royce", "fleet/luxury-coach",
    # Airport-transfer emirate pages (5)
    "airport-transfers/dubai", "airport-transfers/abu-dhabi",
    "airport-transfers/sharjah", "airport-transfers/rak", "airport-transfers/al-ain",
]
pages = _pages_slash + _pages_noslash
urls = "".join(f"<url><loc>https://umcdubai.ae/{p}</loc><lastmod>{_LASTMOD}</lastmod></url>" for p in pages)
(SITE/"sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>')
(SITE/"robots.txt").write_text("User-agent: *\nAllow: /\nSitemap: https://umcdubai.ae/sitemap.xml\n")
# ---------- legacy 301 redirects (Cloudflare Workers Static Assets _redirects) ----------
# Phase C: 8 indexed legacy fleet model URLs from the WordPress sitemap that
# 404 on the new site. The new pages already live at /fleet/<model>; these
# redirects preserve ranking equity and stop the legacy URLs 404ing at cutover.
# Both trailing-slash and non-slash variants are listed because Cloudflare's
# _redirects matcher is path-exact. Status 301 (permanent).
(SITE/"_redirects").write_text(
"""# v71,Phase E: remaining 25 legacy URLs (50 rules incl. non-slash forms).
# These EXPLICIT rules go ABOVE every catch-all so they always win. Cloudflare
# _redirects evaluates top to bottom, first match wins. Status 301 permanent.

# Pages / services (9)
/about-us/                             /about                            301
/about-us                              /about                            301
/contact-us/                           /contact                          301
/contact-us                            /contact                          301
/privacy-policy/                       /privacy                          301
/privacy-policy                        /privacy                          301
/corporate-transfers/                  /corporate                        301
/corporate-transfers                   /corporate                        301
/city-to-city-rides/                   /inter-emirate                    301
/city-to-city-rides                    /inter-emirate                    301
/online-booking/                       /booking                          301
/online-booking                        /booking                          301
/tour-online-booking/                  /booking                          301
/tour-online-booking                   /booking                          301
/thank-you/                            /booking                          301
/thank-you                             /booking                          301
/chauffeur-service-dubai/              /rent-a-car-with-driver/dubai/    301
/chauffeur-service-dubai               /rent-a-car-with-driver/dubai/    301

# Fleet hub + brand pages (5). Brand pages with multiple models go to /fleet hub.
/our-fleet/                            /fleet                            301
/our-fleet                             /fleet                            301
/our-fleet/lexus/                      /fleet/lexus-es                   301
/our-fleet/lexus                       /fleet/lexus-es                   301
/our-fleet/bmw/                        /fleet/bmw-7-series               301
/our-fleet/bmw                         /fleet/bmw-7-series               301
/our-fleet/cadillac-escalade/          /fleet/cadillac-escalade          301
/our-fleet/cadillac-escalade           /fleet/cadillac-escalade          301
/our-fleet/mercedes-benz/              /fleet                            301
/our-fleet/mercedes-benz               /fleet                            301

# Airport-transfers edge cases (2). UAQ has no airport page; closest live
# UAQ-specific service is the chauffeur page.
/airport-transfers/rak-2/              /airport-transfers/rak            301
/airport-transfers/rak-2               /airport-transfers/rak            301
/airport-transfers/umm-al-quwain/      /rent-a-car-with-driver/umm-al-quwain/   301
/airport-transfers/umm-al-quwain       /rent-a-car-with-driver/umm-al-quwain/   301

# Removed city-tour SERVICE pages (3). NOTE: this is the SERVICE, NOT the
# blog posts at /abu-dhabi-city-tour-private-driver/ and /half-day-city-tour-dubai/
# which stay LIVE at 200 (DO NOT redirect those).
/city-tour/                            /rent-a-car-with-driver/                 301
/city-tour                             /rent-a-car-with-driver/                 301
/city-tour/dubai/                      /rent-a-car-with-driver/dubai/           301
/city-tour/dubai                       /rent-a-car-with-driver/dubai/           301
/city-tour/abu-dhabi/                  /rent-a-car-with-driver/abu-dhabi/       301
/city-tour/abu-dhabi                   /rent-a-car-with-driver/abu-dhabi/       301

# Testimonials, not ported; homepage carries reviews + Google rating (6).
/testimonial/iqra-nadeem/              /                                 301
/testimonial/iqra-nadeem               /                                 301
/testimonial/usman-hanif/              /                                 301
/testimonial/usman-hanif               /                                 301
/testimonial/ehsan-lone/               /                                 301
/testimonial/ehsan-lone                /                                 301
/testimonial/abe/                      /                                 301
/testimonial/abe                       /                                 301
/testimonial/benjamin/                 /                                 301
/testimonial/benjamin                  /                                 301
/testimonial/hameed-bin-latif/         /                                 301
/testimonial/hameed-bin-latif          /                                 301

# v70,/our-fleet/* legacy 301s to the new dedicated pages. These EXPLICIT
# rules must precede any future /our-fleet/* catch-all so they win on match.
/our-fleet/rolls-royce/                /fleet/rolls-royce         301
/our-fleet/rolls-royce                 /fleet/rolls-royce         301
/our-fleet/luxury-bus-rental/          /fleet/luxury-coach        301
/our-fleet/luxury-bus-rental           /fleet/luxury-coach        301

# v69,legacy fleet model 301s
/fleet/cadillac-escalade/2024/         /fleet/cadillac-escalade   301
/fleet/cadillac-escalade/2024          /fleet/cadillac-escalade   301
/fleet/mercedes-benz/v-class/          /fleet/v-class             301
/fleet/mercedes-benz/v-class           /fleet/v-class             301
/fleet/gmc-yukon-elevation-xl/         /fleet/gmc-yukon-xl        301
/fleet/gmc-yukon-elevation-xl          /fleet/gmc-yukon-xl        301
/fleet/mercedes-sprinter/              /fleet/sprinter            301
/fleet/mercedes-sprinter               /fleet/sprinter            301
/fleet/bmw/7-series/                   /fleet/bmw-7-series        301
/fleet/bmw/7-series                    /fleet/bmw-7-series        301
/fleet/mercedes-benz/s-class-2024/     /fleet/s-class             301
/fleet/mercedes-benz/s-class-2024      /fleet/s-class             301
/fleet/king-long/                      /fleet/luxury-coach        301
/fleet/king-long                       /fleet/luxury-coach        301
/fleet/king-long-model-2025/           /fleet/luxury-coach        301
/fleet/king-long-model-2025            /fleet/luxury-coach        301
/fleet/mercedes-benz-e-class/          /fleet/e-class             301
/fleet/mercedes-benz-e-class           /fleet/e-class             301
""")
(SITE/"_headers").write_text("""/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://www.googletagmanager.com https://www.google-analytics.com https://challenges.cloudflare.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' data: https://www.google-analytics.com https://*.analytics.google.com https://*.googleapis.com https://*.google.com https://stats.g.doubleclick.net https://challenges.cloudflare.com; frame-src https://www.googletagmanager.com https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self' https://api.whatsapp.com; frame-ancestors 'none'; upgrade-insecure-requests
""")
# v85: Cache-Control headers are now set by the Worker (src/index.js) so HTML
# responses force a revalidate per deploy and /assets/* get a year-long
# immutable cache. Setting them here in _headers caused the rules to
# concatenate (e.g. "max-age=0, ..., max-age=31536000, immutable"), which
# browsers handled inconsistently and left stale HTML on the edge.
import shutil as _shutil_variants
# Generate 360w + 720w variants for every fleet card source image so renderFleet()
# in fleet-data.js can emit srcset by naming convention. Walks every raster file
# under site/assets/fleet/<car>/ and skips files that are themselves variants
# (filenames ending in -360 / -720). SVGs are vector and need no variants.
# Belt-and-suspenders: cardImg() in fleet-data.js hard-codes a 360w + 720w srcset,
# so when a source is smaller than a target width (ensure_image_variants would
# skip it) we copy the source verbatim so the URL exists. Safer than a 404.
for card in (SITE/"assets"/"fleet").glob("*/*"):
    if card.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"): continue
    if card.stem.endswith("-360") or card.stem.endswith("-720"): continue
    ensure_image_variants(card)
    for w in (360, 720):
        var = card.with_name(f"{card.stem}-{w}{card.suffix}")
        if not var.exists():
            _shutil_variants.copy2(card, var)
print("all pages written")
