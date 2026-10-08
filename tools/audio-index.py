"""Liste les sons pour le site : public/audio/salutations/*, public/audio/baleines.mp3 (après le bonjour)
et public/audio/musiques/* → public/audio/index.json.
À relancer après avoir ajouté ou retiré des fichiers.  Usage : python3 tools/audio-index.py"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, '..', 'public', 'audio')
EXT = ('.mp3', '.ogg', '.oga', '.opus', '.wav', '.m4a', '.aac', '.flac', '.webm')
out = {}
for b in ('salutations', 'musiques'):
    d = os.path.join(A, b); os.makedirs(d, exist_ok=True)
    out[b] = sorted(b + '/' + f for f in os.listdir(d) if f.lower().endswith(EXT) and not f.startswith('.'))
if os.path.exists(os.path.join(A, 'baleines.mp3')): out['baleines'] = 'baleines.mp3'
json.dump(out, open(os.path.join(A, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out['salutations']), 'salutations,', len(out['musiques']), 'musiques')
