#!/usr/bin/env python3
"""Загрузка пакета превью на хостинг по FTPS (явный TLS, порт 21, сертификат сервера проверяется) —
шаг автовыкладки .github/workflows/deploy-new.yml. Боевой meatwash.ru этот скрипт не выкладывает.

  python3 -I scripts/deploy-ftp.py <папка пакета> [<корень на сервере>]

Доступ — только из переменных окружения FTP_HOST, FTP_USER, FTP_PASSWORD (в Actions — секреты
репозитория); пароль не печатается. FTP-пользователь выкладки видит только папку поддомена, поэтому
корень по умолчанию — «/».

Порядок: сначала всё, кроме страниц (.htaccess, CSS, JS, картинки, видео), потом страницы *.html,
последним — PREVIEW.txt: новая страница не появляется раньше своих стилей, а метка версии меняется,
только когда загружено всё. Текстовые файлы загружаются всегда; медиа (картинки, видео, шрифты, модели) —
только если их нет на сервере или размер другой: медиа при замене переименовывают, адрес меняется.
Серверный код (.php и подобное) и .htaccess не в корне не загружаются — пакет отклоняется целиком.
Ничего не удаляет; файлы на сервере, которых нет в пакете, перечисляет в конце.
"""
import ftplib
import os
import posixpath
import ssl
import sys
import time

TEXT = ('.html', '.css', '.js', '.mjs', '.json', '.txt', '.xml', '.svg', '.webmanifest', '.htaccess')
FORBIDDEN = ('.php', '.phtml', '.phar', '.php3', '.php4', '.php5', '.php7', '.pht', '.cgi', '.pl',
             '.py', '.sh', '.asp', '.aspx', '.jsp', '.shtml', '.user.ini')
ATTEMPTS = 3
NO_SECRET = ('Нет FTP_HOST, FTP_USER или FTP_PASSWORD: секреты репозитория для выкладки не заданы. '
             'Их ставит Влад (docs/meat-auto/PREVIEW.md, п. 0). Пароль у исполнителя не спрашивать '
             'и вручную по FTP не заливать — написать Владу. Загрузка не начата.')


def connect():
    host = os.environ.get('FTP_HOST', '')
    user = os.environ.get('FTP_USER', '')
    password = os.environ.get('FTP_PASSWORD', '')
    if not (host and user and password):
        sys.exit(NO_SECRET)
    ftp = ftplib.FTP_TLS(host, timeout=60, context=ssl.create_default_context())
    ftp.login(user, password)
    ftp.prot_p()
    return ftp


def remote_files(ftp, root):
    """Размеры файлов на сервере: {путь от корня: размер} и множество папок."""
    sizes, dirs = {}, set()
    def walk(path):
        for name, facts in ftp.mlsd(path, facts=['type', 'size']):
            if name in ('.', '..'):
                continue
            full = posixpath.join(path, name)
            rel = posixpath.relpath(full, root)
            if facts.get('type') == 'dir':
                dirs.add(rel)
                walk(full)
            elif facts.get('type') == 'file':
                sizes[rel] = int(facts.get('size', -1))
    walk(root)
    return sizes, dirs


def local_files(folder):
    files = []
    for dirpath, _, names in os.walk(folder):
        for name in names:
            files.append(os.path.relpath(os.path.join(dirpath, name), folder).replace(os.sep, '/'))
    # Страницы — после остального, PREVIEW.txt — самым последним.
    return sorted(files, key=lambda rel: (rel == 'PREVIEW.txt', rel.endswith('.html'), rel))


def refuse(files):
    bad = [rel for rel in files
           if rel.lower().endswith(FORBIDDEN) or (os.path.basename(rel) == '.htaccess' and rel != '.htaccess')]
    if bad:
        sys.exit('В пакете серверный код или .htaccess не в корне — загрузка не начата:\n  ' + '\n  '.join(bad))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    folder = sys.argv[1]
    root = sys.argv[2] if len(sys.argv) > 2 else '/'
    if not os.path.isfile(os.path.join(folder, 'PREVIEW.txt')):
        sys.exit(f'{folder}: нет PREVIEW.txt — это не пакет preview-pack, загрузка не начата.')
    files = local_files(folder)
    refuse(files)

    ftp = connect()
    sizes, dirs = remote_files(ftp, root)
    plan = [rel for rel in files
            if rel.endswith(TEXT) or sizes.get(rel) != os.path.getsize(os.path.join(folder, rel))]

    sent_bytes = 0
    for rel in plan:
        local = os.path.join(folder, rel)
        parts = rel.split('/')[:-1]
        for attempt in range(1, ATTEMPTS + 1):
            try:
                if ftp is None:
                    ftp = connect()
                for i in range(1, len(parts) + 1):
                    sub = '/'.join(parts[:i])
                    if sub not in dirs:
                        try:
                            ftp.mkd(posixpath.join(root, sub))
                        except ftplib.error_perm:
                            pass          # уже есть
                        dirs.add(sub)
                with open(local, 'rb') as data:
                    ftp.storbinary('STOR ' + posixpath.join(root, rel), data)
                break
            except (ftplib.error_temp, OSError, EOFError) as error:
                if attempt == ATTEMPTS:
                    sys.exit(f'{rel}: не загрузился за {ATTEMPTS} попытки ({type(error).__name__}). '
                             'Сайт мог остаться частично обновлённым — перезапустить выкладку '
                             '(Re-run all jobs) или сделать новый push.')
                try:
                    ftp.close()
                except Exception:
                    pass
                ftp = None
                time.sleep(3 * attempt)
        sent_bytes += os.path.getsize(local)

    stale = sorted(set(sizes) - set(files))
    ftp.quit()
    print(f'Загружено {len(plan)} из {len(files)} файлов ({sent_bytes / 1048576:.1f} МБ), '
          f'медиа без изменений пропущено: {len(files) - len(plan)}.')
    if stale:
        print(f'На сервере есть файлы не из пакета ({len(stale)}), не удалены:')
        for rel in stale:
            print('  ' + rel)


if __name__ == '__main__':
    main()
