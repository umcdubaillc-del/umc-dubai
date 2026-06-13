#!/usr/bin/env python3
import json, pathlib
HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE / "site"
WA = "https://api.whatsapp.com/send?phone=971586497861&text=Hello%2C%20I%20would%20like%20to%20reserve%20a%20car%20with%20UMC%20Dubai."
MAPS_KEY = "AIzaSyBx8uKzaCk5fFG8a0D8zqW82HLwOsb7px0"
V = "1781302360"
OG_BASE = "https://umc-dubai.pages.dev"  # flip to https://umcdubai.ae at production cutover
GTM_ID = "GTM-PNM6MRS7"
GTM_HEAD = ("<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});"
 "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;"
 "j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','" + GTM_ID + "');</script>\n<!-- End Google Tag Manager -->")
PAY = json.load(open(HERE / "payicons.json"))
def paysvg(k):
    i = PAY[k]
    return '<svg role="img" aria-label="' + i["title"] + '" viewBox="0 0 24 24" fill="' + i["hex"] + '"><path d="' + i["path"] + '"/></svg>'
PAYLINE = ('<div class="payline">' + paysvg("visa") + paysvg("mastercard") + paysvg("amex") + paysvg("applepay") + paysvg("googlepay")
 + '<span class="payplus">+</span></div>')
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
<meta property="og:image" content="{OG_BASE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{OG_BASE}/og-image.png">
<meta name="msvalidate.01" content="1848923491E08E0A57EBF89D946D8B19">
<meta name="facebook-domain-verification" content="sx2v5hd4o6p3f8ve51c385hcojspbn">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://maps.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Marcellus&family=Outfit:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/style.css?v={V}">
{extra}
{GTM_HEAD}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{GTM_BODY}
"""

def header(active):
    items = [("index.html","Home"),("fleet.html","Fleet"),("airport-transfers.html","Airport Transfers"),
             ("corporate.html","Corporate"),("about.html","About"),("contact.html","Contact")]
    parts = []
    for h, t in items:
        cls = ' class="on"' if h == active else ''
        parts.append('<li><a href="' + h + '"' + cls + '>' + t + '</a></li>')
    nav = "".join(parts)
    return f"""<header class="site">
  <div class="topbar">
    <div class="left"><button class="burger" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button></div>
    <a class="masthead" href="index.html" aria-label="UMC Dubai — home"><span class="mark">UMC</span><span class="rule"></span><span class="sub">Dubai</span></a>
    <div class="right">
      <a class="pill" href="booking.html">Reserve</a>
      <a class="top-phone" href="tel:+971586497861" aria-label="Call UMC Dubai"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>
    </div>
  </div>
  <nav class="mainnav" aria-label="Main"><ul>{nav}</ul></nav>
</header>
<main id="main">
"""

MCTA = f"""<div class="mcta"><a class="btn btn-ink" href="booking.html">Reserve your car</a>
<a class="mwa" target="_blank" rel="noopener" href="{WA}" aria-label="WhatsApp"><svg viewBox="0 0 32 32"><path d="M16 .8C7.6.8.8 7.6.8 16c0 2.7.7 5.3 2 7.6L.7 31.3l7.9-2.1c2.2 1.2 4.7 1.9 7.4 1.9 8.4 0 15.2-6.8 15.2-15.1S24.4.8 16 .8zm0 27.7c-2.4 0-4.7-.7-6.7-1.9l-.5-.3-4.7 1.2 1.3-4.6-.3-.5a12.4 12.4 0 0 1-1.9-6.6C3.2 9 8.9 3.3 16 3.3S28.8 9 28.8 16 23.1 28.5 16 28.5zm7-9.4c-.4-.2-2.3-1.1-2.6-1.2-.4-.1-.6-.2-.9.2-.3.4-1 1.2-1.2 1.5-.2.3-.4.3-.8.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.2-2.1-2.6-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.6.1-.3 0-.5 0-.7l-1.2-2.8c-.3-.7-.6-.6-.9-.6h-.7c-.3 0-.7.1-1 .5-.4.4-1.3 1.3-1.3 3.2s1.4 3.7 1.6 4c.2.3 2.7 4.1 6.6 5.8.9.4 1.6.6 2.2.8.9.3 1.8.3 2.4.2.7-.1 2.3-.9 2.6-1.8.3-.9.3-1.7.2-1.8-.1-.2-.3-.3-.7-.5z"/></svg></a></div>"""

FOOTER = f"""</main>
<footer class="site">
  <div class="wrap">
    <div class="fgrid">
      <div>
        <a class="masthead" href="index.html"><span class="mark">UMC</span><span class="rule"></span><span class="sub">Dubai</span></a>
        <p style="max-width:34ch;margin-top:1.2rem;font-size:.92rem">Luxury chauffeur service in Dubai and across the UAE. Airport transfers, corporate programmes, hourly and full-day hire — 24 hours a day.</p>
        <h4 style="margin-top:1.4rem">Payments</h4>
        {PAYLINE}
      </div>
      <div>
        <h4>Services</h4>
        <ul>
          <li><a href="airport-transfers.html">Airport transfer Dubai</a></li>
          <li><a href="corporate.html">Corporate chauffeur</a></li>
          <li><a href="inter-emirate.html">Inter-emirate transfers</a></li>
          <li><a href="fleet.html">Hourly &amp; daily hire</a></li>
          <li><a href="booking.html">Reserve a car</a></li>
        </ul>
      </div>
      <div>
        <h4>Company</h4>
        <ul>
          <li><a href="about.html">About UMC</a></li>
          <li><a href="fleet.html">Our fleet</a></li>
          <li><a href="contact.html">Contact</a></li>
          <li><a href="terms.html">Terms &amp; conditions</a></li>
          <li><a href="privacy.html">Privacy</a></li>
        </ul>
      </div>
      <div>
        <h4>Concierge — 24/7</h4>
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
{MCTA}
<a class="wa-float" aria-label="WhatsApp UMC Dubai" target="_blank" rel="noopener" href="{WA}">
  <svg viewBox="0 0 32 32"><path d="M16 .8C7.6.8.8 7.6.8 16c0 2.7.7 5.3 2 7.6L.7 31.3l7.9-2.1c2.2 1.2 4.7 1.9 7.4 1.9 8.4 0 15.2-6.8 15.2-15.1S24.4.8 16 .8zm0 27.7c-2.4 0-4.7-.7-6.7-1.9l-.5-.3-4.7 1.2 1.3-4.6-.3-.5a12.4 12.4 0 0 1-1.9-6.6C3.2 9 8.9 3.3 16 3.3S28.8 9 28.8 16 23.1 28.5 16 28.5zm7-9.4c-.4-.2-2.3-1.1-2.6-1.2-.4-.1-.6-.2-.9.2-.3.4-1 1.2-1.2 1.5-.2.3-.4.3-.8.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.2-2.1-2.6-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.6.1-.3 0-.5 0-.7l-1.2-2.8c-.3-.7-.6-.6-.9-.6h-.7c-.3 0-.7.1-1 .5-.4.4-1.3 1.3-1.3 3.2s1.4 3.7 1.6 4c.2.3 2.7 4.1 6.6 5.8.9.4 1.6.6 2.2.8.9.3 1.8.3 2.4.2.7-.1 2.3-.9 2.6-1.8.3-.9.3-1.7.2-1.8-.1-.2-.3-.3-.7-.5z"/></svg>
</a>
<script src="assets/fleet-data.js?v={V}"></script>
<script src="assets/main.js?v={V}"></script>
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
 ("Is waiting time included?",
  "Yes. Sixty minutes from the actual landing time is included with every airport transfer."),
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
  "Yes — coordinated multi-vehicle movements, investor roadshows and delegation logistics are planned to the minute with a single point of contact."),
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
 ("Delays and waiting time","Any waiting time exceeding the agreed grace period will be charged at the applicable hourly rate."),
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
 "image":"https://umcdubai.ae/wp-content/uploads/2024/07/mercedes-benz-s-class-interior-1.jpg",
 "areaServed":["Dubai","Abu Dhabi","Sharjah","Ras Al Khaimah","Al Ain","Umm Al Quwain"],
 "priceRange":"AED 350 - AED 2400","openingHours":"Mo-Su 00:00-24:00",
 "aggregateRating":{"@type":"AggregateRating","ratingValue":"5.0","reviewCount":"25"}})+'</script>'

index_body = header("index.html") + f"""
<section class="hero2" id="book">
  <div class="h2bg" role="img" aria-label="Sheikh Zayed Road at dusk"></div>
  <div class="h2scrim"></div>
  <div class="wrap h2grid">
    <div class="h2copy">
      <span class="lbl">Dubai &middot; Serving all seven emirates</span>
      <h1>Chauffeur-driven, without compromise.</h1>
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
        <button class="btn btn-ink" type="submit">Check availability</button>
        <p class="note">Confirmed by our concierge within minutes &middot; Free cancellation up to 48 hours</p>
      </form>
    </div>
  </div>
</section>

<div class="authority rv">
  <div class="wrap">
    <span class="lbl">Guests and delegations served for</span>
    <p class="names">Emirates <i>&middot;</i> Jetex <i>&middot;</i> IIFA Awards <i>&middot;</i> Gulfood</p>
  </div>
</div>

{JL}

<section class="sec" id="fleet">
  <div class="wrap wide">
    <div class="shead rv">
      <span class="lbl">The fleet</span>
      <h2>Every car. One standard.</h2>
      <p class="lede">Detailed before every journey and driven by vetted chauffeurs, whichever car you choose. Each rate is final, with the chauffeur, fuel, Salik and parking included.</p>
    </div>
    <div class="fleet-grid" id="homeFleet"></div>
    <div class="center rv" style="margin-top:2.6rem"><a class="btn btn-ghost" href="fleet.html">View the complete fleet</a></div>
  </div>
</section>

{JL}

<section class="sec" id="services">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Services</span><h2>One company. Every journey.</h2></div>
    <div class="svc rv">
      <div class="svc-tabs" role="tablist">
        <button class="on" data-s="airport" role="tab">Airport transfers</button>
        <button data-s="hourly" role="tab">By the hour</button>
        <button data-s="corporate" role="tab">Corporate</button>
        <button data-s="emirates" role="tab">Inter-emirate</button>
      </div>
      <div class="svc-stage">
        <svg viewBox="0 0 760 150" aria-hidden="true">
          <g class="jr" data-s="airport">
            <path class="jl" d="M70 100 C 220 100, 300 40, 420 40 S 640 95, 690 95"/>
            <path class="jicon" d="M60 96 l14-5 m-14 5 l5 14 m-5-14 l22 8" transform="translate(0,-18)"/>
            <circle class="jdot" cx="70" cy="100" r="4"/><circle class="jdot" cx="690" cy="95" r="4"/>
            <path class="jicon" d="M683 88 l7-6 7 6 m-12-1 v9 h10 v-9"/>
          </g>
          <g class="jr hide" data-s="hourly">
            <circle class="jl" cx="380" cy="78" r="48"/>
            <path class="jicon" d="M380 52 v26 l17 10"/>
            <circle class="jdot" cx="380" cy="30" r="4"/>
          </g>
          <g class="jr hide" data-s="corporate">
            <path class="jicon" d="M120 110 v-50 h36 v50 m-26-38 h6 m4 0 h6 m-16 12 h6 m4 0 h6"/>
            <path class="jl" d="M160 95 C 300 95, 460 60, 600 60"/>
            <path class="jicon" d="M600 110 v-62 h40 v62 m-30-50 h7 m6 0 h7 m-20 14 h7 m6 0 h7 m-20 14 h7 m6 0 h7"/>
          </g>
          <g class="jr hide" data-s="emirates">
            <circle class="jdot" cx="110" cy="105" r="5"/><text class="jt" x="110" y="130">DXB</text>
            <path class="jl" d="M118 100 C 260 30, 520 30, 648 96"/>
            <circle class="jdot" cx="655" cy="100" r="5"/><text class="jt" x="655" y="125">AUH</text>
          </g>
        </svg>
      </div>
      <p class="svc-desc" id="svcDesc">Met at arrivals, tracked from departure, driven door to door.</p>
      <div class="btns" style="justify-content:center"><a class="btn btn-ink" id="svcCta" href="airport-transfers.html">Airport transfers</a></div>
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
    <a class="btn-line" href="corporate.html">Open a corporate account</a>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Guests</span><h2>Judged by the people we drive.</h2></div>
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
      <a class="btn btn-ink" href="booking.html">Reserve your car</a>
      <a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a>
    </div>
  </div>
</section>
""" + FOOTER + """
<script src="assets/vendor/flatpickr.min.js"></script>
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
      "UMC Dubai is the luxury chauffeur service trusted across the UAE. Airport transfers, corporate chauffeur and private drivers in Dubai &amp; the UAE — one all-inclusive rate, 24/7.",
      "", ld_home + faq_schema(HOME_FAQS) + '<link rel="stylesheet" href="assets/vendor/flatpickr.min.css">') + index_body)

# ---------- booking ----------
booking_body = header("booking.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">Reservations</span>
    <h1>Reserve your car</h1>
    <p class="lede">Your reservation is confirmed by our concierge on WhatsApp within minutes. No payment is taken online.</p>
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
          <div class="two">
            <div class="f hide" id="rowFlight"><label for="kFlight">Flight number</label><input id="kFlight" placeholder="EK 202"></div>
            <div class="f hide" id="rowSign"><label for="kSign">Welcome sign name</label><input id="kSign" placeholder="Name on the board"></div>
          </div>
          <div class="f"><label for="kNotes">Notes for your chauffeur</label><textarea id="kNotes" rows="2" placeholder="Child seat, extra stop, preferences&hellip;"></textarea></div>
          <div class="bk-inc-title">Included in every journey</div>
          <div class="bk-inc" aria-label="Included in every journey">
            <span><svg viewBox="0 0 24 24"><path d="M8.2 6.5h7.6l-.7-2.4a1 1 0 0 0-1-.7h-4.2a1 1 0 0 0-1 .7z"/><path d="M7 6.5h10M12 6.5v2"/><circle cx="12" cy="11.4" r="2.9"/><path d="M5.5 21c.7-3.6 3.3-5.4 6.5-5.4s5.8 1.8 6.5 5.4"/><path d="M12 15.6l-1.2 2.2 1.2 2.4 1.2-2.4z"/></svg><i id="incMeetTxt" style="font-style:normal">Professional chauffeur</i></span>
            <span id="incFlight" class="hide"><svg viewBox="0 0 24 24"><path d="M21.5 4.6c.8-.8.6-2-.5-2.1-.9-.1-1.9.2-2.6.9l-3.5 3.4-9.3-2.4a1 1 0 0 0-1 .3l-.8.9 7.4 4.5-3.3 3.4-2.7-.4-.9.9 3 1.9 1.9 3 .9-.9-.4-2.7 3.4-3.3 4.5 7.4.9-.8a1 1 0 0 0 .3-1l-2.4-9.3z"/></svg>Live flight tracking</span>
            <span id="incWait" class="hide"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.5 2"/></svg>60 minutes of airport waiting</span>
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
                    <p class="bk-note" style="margin-top:1rem">By sending this request you agree to the <a href="terms.html" id="openTerms" style="border-bottom:1px solid var(--amber);color:var(--ink)">Terms of Service</a>.</p>
          <button class="btn btn-ink" type="submit" id="btnConfirm" style="width:100%;margin-top:.7rem" disabled>Confirm reservation request</button>
          <p class="bk-note">Sending opens WhatsApp with your request pre-filled. Our concierge confirms availability and shares a secure payment link — nothing is charged online.</p>
          <p class="bk-note hide" id="bkDone" style="color:var(--amber-deep)">Request sent — our concierge will confirm shortly. If WhatsApp did not open, call +971 58 649 7861.</p>
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
  </div>
</section>
""" + TERMS_DLG + FOOTER.replace(MCTA, "") + f"""
<script src="assets/vendor/flatpickr.min.js"></script>
<script src="assets/booking.js?v={V}"></script>
<script async src="https://maps.googleapis.com/maps/api/js?key={MAPS_KEY}&libraries=places&callback=umcMapsInit"></script>
</body>
</html>"""

(SITE/"booking.html").write_text(
 head("Reserve Your Car — Online Booking | UMC Dubai",
      "Reserve a chauffeur-driven car in Dubai in minutes. Route preview, flight tracking on airport transfers and a concierge confirmation within minutes, 24/7.",
      "online-booking/",
      '<link rel="stylesheet" href="assets/vendor/flatpickr.min.css">') + booking_body)

# ---------- fleet ----------
fleet_body = header("fleet.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">The fleet</span>
    <h1>Chauffeur-driven cars in Dubai &amp; the UAE</h1>
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
        <div class="pick"><a href="booking.html?vehicle=s-class">S-Class</a><a href="booking.html?vehicle=escalade">Escalade</a><a href="booking.html?vehicle=v-class">V-Class</a></div></div>
      <div class="sc"><svg viewBox="0 0 24 24"><path d="M9 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM17 11a2.5 2.5 0 1 0-2.5-2.5A2.5 2.5 0 0 0 17 11z"/><path d="M2.5 20c.5-3.2 2.8-4.8 6.5-4.8s6 1.6 6.5 4.8M14.8 15.6c2.8.2 4.5 1.7 4.9 4.4"/></svg>
        <h3>The family season</h3><p>School pick-ups, the mall, the beach club. Seven seats, cases and a pushchair, one calm cabin.</p>
        <div class="pick"><a href="booking.html?vehicle=v-class">V-Class</a><a href="booking.html?vehicle=yukon">Yukon XL</a></div></div>
      <div class="sc"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="13" rx="2"/><path d="M3 9.5h18M8 18v2.5M16 18v2.5"/></svg>
        <h3>The roadshow</h3><p>Investor days and delegations. Multi-car movements coordinated to the minute under one contact.</p>
        <div class="pick"><a href="booking.html?vehicle=sprinter">Sprinter</a><a href="contact.html?vehicle=Roadshow">Convoy desk</a></div></div>
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
  <div class="btns rv"><a class="btn btn-ink" href="booking.html">Reserve your car</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
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
 head("Luxury Fleet — Chauffeur-Driven Cars in Dubai & the UAE | UMC Dubai",
      "The UMC Dubai fleet: Mercedes S-Class, BMW 7 Series, Cadillac Escalade, V-Class, Sprinter and coaches — all-inclusive chauffeur rates across the UAE.",
      "our-fleet/", faq_schema(FLEET_FAQS)) + fleet_body)

# ---------- airport ----------
airport_body = header("airport-transfers.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">DXB &middot; DWC &middot; AUH &middot; SHJ &middot; RKT &middot; AAN</span>
    <h1>Airport transfers in Dubai &amp; the UAE</h1>
    <p class="lede">Met at arrivals. Driven without delay.</p>
    <div class="btns rv" style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="booking.html">Reserve your transfer</a>
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
        <div><h3>Arrived<span class="lbl">Door to door</span></h3><p>Up to sixty minutes of waiting was already included, and the journey ends at your door.</p></div></div>
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
          <li role="listitem"><b class="t">Waiting time</b><span>Sixty minutes included at every airport before any additional charge is considered.</span></li>
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
  <div class="btns rv"><a class="btn btn-ink" href="booking.html">Reserve your transfer</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + """
<script>document.addEventListener("DOMContentLoaded",function(){renderFleet(document.getElementById("airportFleet"),{})});</script>
</body></html>"""
(SITE/"airport-transfers.html").write_text(
 head("Airport Transfer Dubai & UAE — Flight Tracked, Meet & Greet | UMC Dubai",
      "Fixed-price airport transfers across the UAE. Live flight tracking, meet & greet at baggage claim, 60 minutes waiting included. From AED 350, all-inclusive.",
      "airport-transfers/dubai/", faq_schema(AIRPORT_FAQS)) + airport_body)

# ---------- corporate ----------
corp_body = header("corporate.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">DIFC &middot; Business Bay &middot; Downtown</span>
    <h1>Corporate chauffeur in Dubai &amp; the UAE</h1>
    <p class="lede">Ground transport your company can rely on. Confirmed cars, vetted chauffeurs, consolidated invoicing and a human on the line at any hour.</p>
    <div style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="contact.html?vehicle=Corporate%20Account">Open a corporate account</a>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Corporate accounts</span><h2>What your programme receives.</h2></div>
    <div class="std rv">
      <div><span class="lbl">Account</span><h3>One account, one invoice</h3><p>A dedicated account contact, consolidated monthly invoicing with per-journey breakdowns, and cost-centre references on request.</p></div>
      <div><span class="lbl">Booking</span><h3>Book for anyone</h3><p>Assistants and travel managers reserve for executives and guests in minutes by phone, WhatsApp or email. A name board waits at every arrival.</p></div>
      <div><span class="lbl">Duty of care</span><h3>Vetted and accountable</h3><p>Employed and background-checked chauffeurs in maintained late-model vehicles, with live flight tracking and a human escalation path at any hour.</p></div>
      <div><span class="lbl">Roadshows</span><h3>Movements, to the minute</h3><p>Investor roadshows, delegations and multi-car convoys coordinated under a single point of contact.</p></div>
      <div><span class="lbl">Discretion</span><h3>Confidential by default</h3><p>Our chauffeurs serve senior executives daily. Conversations, documents and itineraries stay in the car.</p></div>
      <div><span class="lbl">Certainty</span><h3>Fixed corporate rates</h3><p>Agreed rates that include the chauffeur, fuel, Salik and parking, so finance sees no surprises.</p></div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Onboarding</span><h2>Operational in 48 hours.</h2></div>
    <div class="hsteps rv">
      <div class="hstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 7l8 6 8-6"/></svg></div><span class="when">Hour zero</span><h3>The enquiry</h3><p>Share your company details and typical movement patterns by email or one call.</p></div>
      <div class="hstep"><div class="node"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg></div><span class="when">Within a day</span><h3>Your rate card</h3><p>Fixed corporate rates for the classes you use, with everything included and nothing metered.</p></div>
      <div class="hstep"><div class="node"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/></svg></div><span class="when">Within 48 hours</span><h3>Account live</h3><p>Your team books for anyone, a name board waits at every arrival, and one invoice arrives monthly.</p></div>
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
  <div class="btns rv"><a class="btn btn-ink" href="contact.html?vehicle=Corporate%20Account">Open a corporate account</a><a class="btn btn-ghost" href="tel:+971586497861">Call the desk</a></div></div>
</section>
""" + FOOTER + "</body></html>"
(SITE/"corporate.html").write_text(
 head("Corporate Chauffeur Service Dubai — Executive Accounts | UMC Dubai",
      "Corporate chauffeur programmes in Dubai: consolidated invoicing, book-for-a-guest, vetted chauffeurs, roadshow logistics and 24/7 support. Operational in 48 hours.",
      "corporate-chauffeur-dubai/", faq_schema(CORP_FAQS)) + corp_body)

# ---------- about ----------
about_body = header("about.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">The company</span>
    <h1>A chauffeur company built on a single, stubborn standard.</h1>
    <p class="lede">UMC Dubai exists because &ldquo;good enough&rdquo; ground transport is not good enough for the people we serve. Every car immaculate. Every chauffeur vetted. Every detail attended to. Every hour of every day.</p>
  </div>
</section>
<figure class="frame wrap rv">
  <img src="https://umcdubai.ae/wp-content/uploads/2024/07/mercedes-benz-s-class-rear-executive-seats-1-768x1365.jpg" alt="Executive rear seats — UMC Dubai chauffeur fleet" style="aspect-ratio:16/8;object-fit:cover" width="768" height="680">
  <figcaption class="lbl">Detail is the discipline</figcaption>
</figure>
<section class="closing band-dark numband-sec" style="padding:3.6rem 0">
  <div class="wrap">
    <div class="numband rv">
      <div><div class="n">5.0<sup>&#9733;</sup></div><div class="d">Google rating</div></div>
      <div><div class="n">2,500<sup>+</sup></div><div class="d">Clients served</div></div>
      <div><div class="n">7</div><div class="d">Emirates covered</div></div>
      <div><div class="n">24<sup>/7</sup></div><div class="d">Concierge desk</div></div>
    </div>
  </div>
</section>
{JL}
<section class="sec">
  <div class="wrap">
    <div class="shead rv"><span class="lbl">Who we serve</span><h2>Trusted by the people Dubai trusts.</h2>
    <p class="lede">Executives between DIFC meetings. Families arriving for the season. High-profile guests whose schedules forgive nothing — and the assistants and travel managers who orchestrate it all. Guests and delegations served for Emirates, Jetex, IIFA Awards and Gulfood.</p></div>
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
  <div class="btns rv"><a class="btn btn-ink" href="booking.html">Reserve your car</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + "</body></html>"
(SITE/"about.html").write_text(
 head("About UMC Dubai — A Chauffeur Company Built on Standards",
      "UMC Dubai is the luxury chauffeur company serving executives, families and high-profile guests across the UAE — one standard, 24 hours a day.",
      "about-us/") + about_body)

# ---------- contact (with verbatim terms) ----------
contact_body = header("contact.html") + f"""
<section class="phero">
  <div class="wrap">
    <span class="lbl">Concierge — 24/7</span>
    <h1>A human answers. At any hour.</h1>
    <p class="lede">Call, WhatsApp or write — for reservations, changes, corporate accounts or special requests.</p>
  </div>
</section>
<section class="sec" style="padding-top:2.4rem">
  <div class="wrap">
    <div class="bk-layout">
      <div class="bk-card">
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
        <div class="f"><label for="cVehicle">Vehicle or service</label><input id="cVehicle" name="vehicle" placeholder="S-Class, airport transfer, corporate account&hellip;"></div>
        <div class="f"><label for="cMsg">Your request</label><textarea id="cMsg" rows="4" placeholder="Route, date and time, number of guests&hellip;"></textarea></div>
        <button class="btn btn-ink" style="width:100%" id="cSend" type="button">Send via WhatsApp</button>
        <p class="bk-note">Prefer email? <a href="mailto:contact@umcdubai.ae" style="border-bottom:1px solid var(--amber)">contact@umcdubai.ae</a></p>
      </div>
      <div class="bk-card">
        <div class="chatcard rv" aria-hidden="true">
          <div class="ch-top"><span class="ch-dot">U</span><span><b>UMC Concierge</b><em>Online now</em></span></div>
          <div class="bub in">Landing at DXB T3 at 23:40 tonight, EK 004 &mdash; book an S&#8209;Class for my transfer.</div>
          <div class="bub out">Your chauffeur will be waiting at arrivals with a name board at 23:40. EK 004 is being tracked &mdash; written confirmation follows here.</div>
          <div class="stamp">Typical reply &mdash; under five minutes</div>
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
  let m = "Hello UMC Dubai,%0A%0AName: " + encodeURIComponent(g("cName")) +
          "%0APhone: +" + encodeURIComponent(cCCEl.value) + " " + encodeURIComponent(cPhoneOut) +
          "%0AEmail: " + encodeURIComponent(g("cEmail")) +
          "%0AService: " + encodeURIComponent(g("cVehicle")) +
          "%0ARequest: " + encodeURIComponent(g("cMsg"));
  window.open("https://api.whatsapp.com/send?phone=971586497861&text=" + m, "_blank", "noopener");
});
</script>
</body>
</html>"""
(SITE/"contact.html").write_text(
 head("Contact UMC Dubai — Reserve Your Car, 24/7",
      "Reach the UMC Dubai concierge desk 24/7 by phone, WhatsApp or email for reservations, corporate accounts and special requests.",
      "contact-us/") + contact_body)

# ---------- privacy ----------
privacy_body = header("contact.html").replace('class="on"','') + f"""
<section class="phero"><div class="wrap"><span class="lbl">Privacy</span><h1>Privacy notice</h1>
<p class="lede">What we collect, why, and how to reach us about it.</p></div></section>
<section class="sec" style="padding-top:2rem"><div class="wrap narrow">
<p>UMC Dubai collects the details you provide when reserving — name, contact details, pick-up and drop-off information, and flight details where relevant — solely to operate your journey and to confirm and invoice your booking. We do not sell personal data. Booking communications take place over WhatsApp, phone or email at your choice; payment is handled through secure third-party payment links and we do not store card numbers. The reservation map and address suggestions on this site are provided by Google Maps, which processes the addresses you type under Google&rsquo;s own privacy policy. For any privacy request, including deletion of your booking history, write to <a href="mailto:contact@umcdubai.ae" style="border-bottom:1px solid var(--amber)">contact@umcdubai.ae</a>.</p>
</div></section>
""" + FOOTER + "</body></html>"
(SITE/"privacy.html").write_text(
 head("Privacy Notice | UMC Dubai","How UMC Dubai handles personal information from your bookings, contact and payment, and the choices you have over how your data is used.","privacy/") + privacy_body)

# ---------- terms ----------
terms_body = header("contact.html").replace('class="on"','') + f"""
<section class="phero"><div class="wrap"><span class="lbl">Terms &amp; conditions</span><h1>Terms of Service</h1>
<p class="lede">The conditions that apply to every reservation with UMC Dubai.</p></div></section>
<section class="sec" style="padding-top:2rem"><div class="wrap narrow">
<ol style="padding-left:1.2rem;display:grid;gap:1rem;color:var(--ink-soft);font-size:.95rem">{TERMS_OL}</ol>
</div></section>
""" + FOOTER + "</body></html>"
(SITE/"terms.html").write_text(
 head("Terms of Service | UMC Dubai","Terms and conditions for UMC Dubai chauffeur reservations — cancellation, conduct, liability and the laws of the UAE that govern every booking.","terms/") + terms_body)

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
    <span class="lbl">Dubai &middot; Abu Dhabi &middot; The Northern Emirates</span>
    <h1>Inter-emirate transfers</h1>
    <p class="lede">Dubai to Abu Dhabi and every emirate beyond. One car and one chauffeur, door to door.</p>
    <div style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
      <a class="btn btn-ink" href="booking.html">Reserve your transfer</a>
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
  <div class="btns rv"><a class="btn btn-ink" href="booking.html">Reserve your transfer</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="{WA}">WhatsApp concierge</a></div></div>
</section>
""" + FOOTER + "</body></html>"
(SITE/"inter-emirate.html").write_text(
 head("Inter-Emirate Chauffeur Transfers — Dubai to Abu Dhabi & Beyond | UMC Dubai",
      "Chauffeur-driven transfers between Dubai, Abu Dhabi and every emirate. One car and one chauffeur door to door, on a fixed quote agreed before departure.",
      "inter-emirate/", faq_schema(IE_FAQS)) + ie_body)

# ---------- 404 ----------
notfound = header("index.html").replace('class="on"','') + f"""
<section class="phero" style="padding-bottom:4rem"><div class="wrap">
<span class="lbl">404</span><h1>This road does not exist.</h1>
<p class="lede">The page you were looking for has moved or never was. Your car, however, is ready.</p>
<div style="display:flex;gap:.9rem;justify-content:center;margin-top:1.8rem">
<a class="btn btn-ink" href="index.html">Return home</a>
<a class="btn btn-ghost" href="booking.html">Reserve your car</a>
</div></div></section>
""" + FOOTER + "</body></html>"
(SITE/"404.html").write_text(head("Page Not Found | UMC Dubai","","404") + notfound)

# ---------- sitemap & robots & headers ----------
pages = ["", "fleet.html","airport-transfers.html","inter-emirate.html","corporate.html","about.html","contact.html","booking.html","terms.html","privacy.html"]
urls = "".join(f"<url><loc>https://umcdubai.ae/{p}</loc><changefreq>weekly</changefreq></url>" for p in pages)
(SITE/"sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>')
(SITE/"robots.txt").write_text("User-agent: *\nAllow: /\nSitemap: https://umcdubai.ae/sitemap.xml\n")
(SITE/"_headers").write_text("""/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://www.googletagmanager.com https://www.google-analytics.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' data: https://www.google-analytics.com https://*.analytics.google.com https://*.googleapis.com https://*.google.com https://stats.g.doubleclick.net; frame-src https://www.googletagmanager.com; object-src 'none'; base-uri 'self'; form-action 'self' https://api.whatsapp.com; frame-ancestors 'none'; upgrade-insecure-requests
  Cache-Control: public, max-age=0, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable
""")
print("all pages written")
