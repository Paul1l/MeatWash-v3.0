"""§6.4 п. 4 (ссылки), п. 10 (закрыто от поиска), п. 11 (кэш) — по пакету превью по HTTP.

Адрес превью — --preview (после загрузки https://new.meatwash.ru или локальный Apache с
пакетом; за nginx хостинга https сообщает заголовок X-Forwarded-Proto — его можно передать
--forwarded-proto, иначе правила .htaccess отправят http-запрос на https://<host>).
Владелец: WP7.
"""
import html as htmllib
import re
import urllib.error
import urllib.request
from urllib.parse import urljoin, urlsplit


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def fetch(url, headers, method='GET'):
    req = urllib.request.Request(url, headers=headers, method=method)
    try:
        with OPENER.open(req, timeout=20) as r:
            return r.status, dict(r.headers), r.read() if method == 'GET' else b''
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read() if method == 'GET' else b''


def run(preview, host, headers, pages, res):
    base = preview.rstrip('/')
    get = lambda path, method='GET': fetch(base + path, headers, method)
    st, hd, body = get('/PREVIEW.txt')
    sha = re.search(r'sha: ([0-9a-f]+)', body.decode('utf-8', 'replace')).group(1) if st == 200 else None
    landing = [p for p in pages if p['file'] != 'kit.html']

    # ── п. 4: обход всех внутренних адресов ──────────────────────────────────
    seen, bad, ids, docs = {}, [], {}, {}
    queue = ['/' + p['path'] for p in landing]
    yclients = set()
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        st, hd, body = get(path)
        seen[path] = st
        if st != 200:
            bad.append(f'{path} → {st}')
            continue
        ctype = hd.get('Content-Type', '')
        text = body.decode('utf-8', 'replace')
        if 'text/html' in ctype:
            docs[path] = text
            ids[path.split('?')[0]] = set(re.findall(r'\bid="([^"]+)"', text))
            refs = re.findall(r'(?:src|href)="([^"]+)"', text)
            for s in re.findall(r'(?:srcset|imagesrcset)="([^"]+)"', text):
                refs += [part.strip().split()[0] for part in s.split(',')]
            yclients.update(re.findall(r'https://[\w.-]*yclients\.com[^"\'\s<]*', text))
        elif 'css' in ctype:
            refs = re.findall(r'url\(\s*[\'"]?([^\'")\s]+)', text)
        elif 'javascript' in ctype:
            refs = re.findall(r'(?:from\s*|import\s*\(?\s*)[\'"](\.[^\'"]+)[\'"]', text)
        else:
            continue
        for ref in refs:
            ref = htmllib.unescape(ref)
            if re.match(r'^(https?:|tel:|mailto:|data:|#)', ref) or ref.startswith('//'):
                continue
            full = urlsplit(urljoin('http://x' + path, ref))
            target = full.path + (('?' + full.query) if full.query else '')
            if full.fragment and 'text/html' in ctype:
                docs.setdefault('#anchors', []).append((path, full.path, full.fragment))
            if target not in seen:
                queue.append(target)
    anchors_bad = []
    for src, page, frag in docs.get('#anchors', []):
        if page in ids and frag not in ids[page]:
            anchors_bad.append(f'{src} → {page}#{frag}')
    # /<slug>.html → 301 на https://<host>/<slug>
    redirects = []
    for p in landing:
        if p['file'] == 'index.html':
            st, hd, _ = get('/index.html')
            want = f'https://{host}/'
        else:
            st, hd, _ = get('/' + p['file'])
            want = f"https://{host}/{p['path']}"
        loc = hd.get('Location', '')
        if st != 301 or loc != want:
            redirects.append(f"/{p['file']} → {st} {loc} (нужно 301 {want})")
    studio = {'https://n975571.yclients.com/company/906067/personal/select-services', 'https://n1982508.yclients.com/company/1743348/personal/select-services'}
    other_yc = sorted(yclients - studio)
    st404, _, b404 = get('/nope')
    ok4 = not bad and not anchors_bad and not redirects and not other_yc and st404 == 404 and 'Страница не найдена' in b404.decode('utf-8', 'replace')
    res.add('4', 'Ссылки', ok4,
            f'{len(seen)} внутренних адресов: 200 — {sum(1 for s in seen.values() if s == 200)}, иначе {len(bad)}; якорей проверено {len(docs.get("#anchors", []))}, битых {len(anchors_bad)}; '
            f'/<slug>.html → 301 https://{host}/<slug>: {len(landing) - len(redirects)}/{len(landing)}; YCLIENTS в разметке — только 2 ссылки студий ({len(yclients)}); /nope → {st404}',
            bad + anchors_bad + redirects + [f'чужая ссылка YCLIENTS {u}' for u in other_yc])

    # ── п. 10: закрыто от поиска ─────────────────────────────────────────────
    issues = []
    for p in landing + [{'path': 'nope'}]:
        st, hd, body = get('/' + p['path'])
        if (hd.get('X-Robots-Tag') or '').lower() != 'noindex, nofollow':
            issues.append(f"/{p['path']}: X-Robots-Tag = {hd.get('X-Robots-Tag')}")
        if '<meta name="robots" content="noindex, nofollow">' not in body.decode('utf-8', 'replace'):
            issues.append(f"/{p['path']}: нет meta robots noindex, nofollow")
    st, _, robots = get('/robots.txt')
    if st != 200 or robots.decode() != 'User-agent: *\nDisallow: /\n':
        issues.append(f'robots.txt: {st} {robots[:60]!r}')
    for path in ['/sitemap.xml', '/kit', '/kit.html', '/api/request.php', '/yandex_58e9b738e3e02ac7.html']:
        st, _, _ = get(path)
        if st != 404:
            issues.append(f'{path} → {st} (нужно 404)')
    head_leak = [p for p, t in docs.items() if p != '#anchors' and 'https://meatwash.ru/' in t.split('</head>')[0]]
    issues += [f'{p}: в <head> адрес боевого сайта' for p in head_leak]
    res.add('10', 'Закрыто от поиска', not issues,
            f'{len(landing) + 1} адресов: X-Robots-Tag noindex, nofollow и meta robots; robots.txt Disallow: /; sitemap.xml, kit, api, yandex_*.html → 404', issues)

    # ── п. 11: кэш ───────────────────────────────────────────────────────────
    issues, versioned = [], 0
    for path, text in docs.items():
        if path == '#anchors':
            continue
        for u in re.findall(r'<(?:link\b[^>]*\bhref|script\b[^>]*\bsrc)="(/?(?:css|js)/[^"]+)"', text):
            if sha and f'?v={sha}' in u:
                versioned += 1
            else:
                issues.append(f'{path}: {u} без ?v={sha}')
    for path in [p for p in seen if p.startswith('/js/')]:
        st, hd, body = get(path)
        for imp in re.findall(r'(?:from\s*|import\s*\(?\s*)[\'"](\./[^\'"]+)[\'"]', body.decode('utf-8', 'replace')):
            if f'?v={sha}' not in imp:
                issues.append(f'{path}: импорт {imp} без ?v')
    st, hd, _ = get(f'/css/base.css?v={sha}', 'HEAD')
    if st != 200 or not hd.get('Content-Type', '').startswith('text/css'):
        issues.append(f'/css/base.css?v={sha} → {st} {hd.get("Content-Type")}')
    res.add('11', 'Кэш', not issues,
            f'адресов CSS/JS в HTML с ?v={sha}: {versioned}; импорты модулей с ?v; HEAD /css/base.css?v={sha} → {st} {hd.get("Content-Type")}', issues)
