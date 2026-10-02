# -*- coding: utf-8 -*-
# Уменьшенные копии своих снимков точек для карточек и обложек маршрутов (02.10.2026).
# Карточка места на экране не шире 340 px (на телефоне около 750 точек, но снимок там обрезан до 16:10),
# обложка маршрута — 220 px, а оригиналы весят 150–390 КБ. Копия 520 px — 20–110 КБ.
# Запускать после того, как в «фото-точек» положили новый снимок:
#   python инструменты/мини-снимки.py
import os
from PIL import Image, ImageOps

КОРЕНЬ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'фото-точек')
МИНИ = os.path.join(КОРЕНЬ, 'мини')
ШИРИНА = 520
os.makedirs(МИНИ, exist_ok=True)
сделано = 0
for имя in sorted(os.listdir(КОРЕНЬ)):
    путь = os.path.join(КОРЕНЬ, имя)
    if not os.path.isfile(путь) or not имя.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
        continue
    if имя.startswith('hero'):
        continue   # шапка главной — свои размеры, не трогаем
    куда = os.path.join(МИНИ, os.path.splitext(имя)[0] + '.jpg')
    if os.path.exists(куда) and os.path.getmtime(куда) >= os.path.getmtime(путь):
        continue
    с = ImageOps.exif_transpose(Image.open(путь)).convert('RGB')
    if с.width > ШИРИНА:
        с = с.resize((ШИРИНА, round(с.height * ШИРИНА / с.width)), Image.LANCZOS)
    с.save(куда, 'JPEG', quality=74, optimize=True, progressive=True)
    сделано += 1
    print('%4d КБ -> %3d КБ  %s' % (os.path.getsize(путь) // 1024, os.path.getsize(куда) // 1024, имя))
print('готово, новых копий:', сделано)
