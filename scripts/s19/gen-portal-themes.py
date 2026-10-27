#!/usr/bin/env python3
"""Portal theme generator (S19).

Palette values from the Lumière ClientDesk design system (approved for Portal use by the owner).
Only colour definitions and semantic roles are used; no ClientDesk application code.

Emits client/src/styles/themes.css. Every theme, including the default Lumière Desk, is built from
the ClientDesk palette below, then bridged onto the Portal's consumer variables:
  * --t-*            raw ClientDesk roles (see ROLE_MAP, the inspectable ClientDesk-role -> Portal-token table)
  * shadcn HSL vars  --background, --card, --primary, ... (global, on html[data-theme])
  * --s-* / --st-*   student + staff layer (.student-surface / .staff-surface / body.staff-shell)
  * --sidebar-*      navigation rail (body.student-shell / body.staff-shell)

Usage:  python3 scripts/s19/gen-portal-themes.py            write client/src/styles/themes.css
        python3 scripts/s19/gen-portal-themes.py --check    exit 1 if the file differs from generator output
        python3 scripts/s19/gen-portal-themes.py --audit    WCAG audit (same rules as ClientDesk's generator)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'client' / 'src' / 'styles' / 'themes.css'

# ---------------------------------------------------------------------------------------------------------------
# ClientDesk palette (source data). Keys: label, note, dark, bg, side, panel, p2, p3, text..., acc, acc2, acct, ink,
# brand, brandsub, red/amber/green/blue, optional rail{}.
# ---------------------------------------------------------------------------------------------------------------
# v1.3: 'lumiere' is the Lumière Desk default (dark navy rail + warm light canvas + white cards, per the
# approved UI review); the former all-dark default is kept, unchanged, as 'lumiere-dark'.
T = {
    'lumiere': dict(label='Lumière Desk', note='Default', dark=0, default=1, lines='20,27,45',
        bg='#f4f3ef', side='#0f1522', panel='#ffffff', p2='#fbfaf8', p3='#efede7',
        text='#1b1f27', text2='#3a404b', muted='#535a66', faint='#5c6370', heading='#10141c', figure='#141922',
        acc='#c29a4e', acc2='#d0aa62', acct='#74561b', ink='#1a1407', brand='#1b1f27', brandsub='#535a66',
        red='#b42318', amber='#8a5300', green='#1c6b43', blue='#2b53b8',
        rail=dict(bg='#0f1522', bg2='#121a2a', text='#c9cfda', muted='#98a1b2', head='#f4efe4', sub='#c9b27f',
                  act='#e8cc8e', actbg='rgba(201,170,108,0.15)', line='rgba(255,255,255,0.08)', hover='rgba(255,255,255,0.05)', alert='#ffb4a8', alertbg='rgba(255,140,120,0.18)')),
    'lumiere-dark': dict(label='Lumière Dark', note='Classic', dark=1,
        bg='#09090a', side='#0c0c0e', panel='#0f0f11', p2='#141417', p3='#1a1a1e',
        text='#ebe6de', text2='#bdb7ae', muted='#99948b', faint='#8a857d', heading='#f1ece4', figure='#ebe6de',
        acc='#c9aa6c', acc2='#e2cb98', acct='#e2cb98', ink='#17130b', brand='#efe9df', brandsub='#b3ada3',
        red='#d98b7f', amber='#d7b56d', green='#9ec4a7'),
    'midnight': dict(label='Midnight Slate', note='', dark=1,
        bg='#0b0e14', side='#0e121a', panel='#121722', p2='#161c29', p3='#1c2331',
        text='#e7eaf0', text2='#c2c8d2', muted='#9ca4b2', faint='#8a92a0', heading='#f2f4f8', figure='#eef1f5',
        acc='#8b9fbb', acc2='#a3b4cc', acct='#b3c2d8', ink='#0b0e14', brand='#eef1f5', brandsub='#a9b1bf',
        red='#d49a91', amber='#cdb17c', green='#9dbca7'),
    'monaco': dict(label='Monaco Navy', note='', dark=1,
        bg='#0b1120', side='#0d1425', panel='#111a2e', p2='#151f36', p3='#1b2640',
        text='#f2ede3', text2='#d2ccc0', muted='#aaa599', faint='#989388', heading='#f7f2e8', figure='#f4efe5',
        acc='#c8ae76', acc2='#d9c393', acct='#ddca9e', ink='#0a1020', brand='#f4efe5', brandsub='#b9b2a4',
        red='#d99a90', amber='#d4b57a', green='#a3c2ab'),
    'forest': dict(label='Forest Ledger', note='', dark=1,
        bg='#0b100d', side='#0e1411', panel='#111915', p2='#16201a', p3='#1c2821',
        text='#ece8dc', text2='#cbc7b9', muted='#a1a496', faint='#909487', heading='#f3efe3', figure='#efebdf',
        acc='#b09a64', acc2='#c4b07e', acct='#cdbd90', ink='#0b100d', brand='#efebdf', brandsub='#aab09f',
        red='#d49b8e', amber='#cdb178', green='#a4bd9c'),
    'bordeaux': dict(label='Bordeaux Reserve', note='', dark=1,
        bg='#120a0c', side='#160d10', panel='#1b1013', p2='#211419', p3='#29191f',
        text='#f0e8e2', text2='#d1c3bc', muted='#ab9993', faint='#9b8984', heading='#f6eee8', figure='#f3ebe5',
        acc='#c09a85', acc2='#d2af9c', acct='#d9bcab', ink='#150c0e', brand='#f3ebe5', brandsub='#b8a69f',
        red='#dca195', amber='#d1b47d', green='#a9bea3'),
    'graphite': dict(label='Graphite Executive', note='', dark=1,
        bg='#131416', side='#161719', panel='#1a1b1e', p2='#1f2124', p3='#26282c',
        text='#f1efeb', text2='#cfcdc8', muted='#a7a6a2', faint='#949390', heading='#f7f5f1', figure='#f3f1ed',
        acc='#b7bdc5', acc2='#ccd1d7', acct='#d4d9de', ink='#131416', brand='#f3f1ed', brandsub='#afaeaa',
        red='#d69c93', amber='#cfb47f', green='#a3bfaa'),
    'sandstone': dict(label='Sandstone Light', note='Light', dark=0,
        bg='#f3efe7', side='#ece6da', panel='#faf7f1', p2='#efe9de', p3='#e6dfd1',
        text='#23201b', text2='#45403a', muted='#58514a', faint='#625b52', heading='#1b1915', figure='#1f1c18',
        acc='#8a6d3c', acc2='#765c30', acct='#634c24', ink='#fffcf6', brand='#23201b', brandsub='#5d564d',
        red='#9e4035', amber='#7f5a12', green='#3b6a49'),
    'teal': dict(label='Teal Reserve', note='', dark=1,
        bg='#091214', side='#0c1719', panel='#0f1c1e', p2='#142325', p3='#192b2e',
        text='#edefe9', text2='#c8d0cc', muted='#9daba8', faint='#8a9895', heading='#f3f5f0', figure='#f0f2ed',
        acc='#86aba7', acc2='#9fbfbb', acct='#b0cfcb', ink='#091214', brand='#f0f2ed', brandsub='#a4b1ae',
        red='#d69b91', amber='#cfb27b', green='#a1c3a6'),
}


def hx(c):
    c = c.lstrip('#'); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def rgba(c, a):
    r, g, b = hx(c); return f"rgba({r},{g},{b},{a})"


def mix(fg, bg, a):
    f, b = hx(fg), hx(bg)
    return '#' + ''.join(f"{round(f[i] * a + b[i] * (1 - a)):02x}" for i in range(3))


def lum(c):
    def ch(v):
        v /= 255; return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = hx(c); return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def cr(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True); return (la + 0.05) / (lb + 0.05)



# Portal-only statuses with no ClientDesk role (provider / submitted / attention), kept from the S17 pass as HSL
# triples per theme. Everything else in the status language derives from ClientDesk roles.
EXTRAS = json.loads(r"""{
 "lumiere-dark": {
  "st-provider": "269.4 47.7% 79%",
  "st-provider-soft": "257.1 9.6% 14.3%",
  "st-submitted": "186 44% 64.3%",
  "st-submitted-soft": "196.4 16.9% 12.7%",
  "st-attention": "19.5 78.5% 70.8%",
  "st-attention-soft": "10.9 15.9% 13.5%"
 },
 "midnight": {
  "st-provider": "269.4 47.7% 79%",
  "st-provider-soft": "232.9 18.3% 18.2%",
  "st-submitted": "186 44% 64.3%",
  "st-submitted-soft": "208.7 27.7% 16.3%",
  "st-attention": "19.5 78.5% 70.8%",
  "st-attention-soft": "280 7.3% 16.1%"
 },
 "monaco": {
  "st-provider": "269.4 47.7% 79%",
  "st-provider-soft": "227.6 28.2% 20.2%",
  "st-submitted": "186 44% 64.3%",
  "st-submitted-soft": "211.8 37% 18%",
  "st-attention": "19.5 78.5% 70.8%",
  "st-attention-soft": "240 13.7% 18.6%"
 },
 "forest": {
  "st-provider": "269.4 47.7% 79%",
  "st-provider-soft": "197.1 8.6% 15.9%",
  "st-submitted": "186 44% 64.3%",
  "st-submitted-soft": "168 20.5% 14.3%",
  "st-attention": "19.5 78.5% 70.8%",
  "st-attention-soft": "53.3 12.3% 14.3%"
 },
 "bordeaux": {
  "st-provider": "269.4 47.7% 79%",
  "st-provider-soft": "320 15% 15.7%",
  "st-submitted": "186 44% 64.3%",
  "st-submitted-soft": "280 4% 14.7%",
  "st-attention": "19.5 78.5% 70.8%",
  "st-attention-soft": "6 25% 15.7%"
 },
 "graphite": {
  "st-provider": "269.4 47.7% 79%",
  "st-provider-soft": "253.3 9.5% 18.6%",
  "st-submitted": "186 44% 64.3%",
  "st-submitted-soft": "195 14% 16.9%",
  "st-attention": "19.5 78.5% 70.8%",
  "st-attention-soft": "13.3 10.1% 17.5%"
 },
 "sandstone": {
  "st-provider": "274.3 37.9% 39.8%",
  "st-provider-soft": "342.9 15.6% 91.2%",
  "st-submitted": "187.5 81.4% 23.1%",
  "st-submitted-soft": "140 11.5% 89.8%",
  "st-attention": "19 75% 31.4%",
  "st-attention-soft": "27 38.5% 89.8%"
 },
 "teal": {
  "st-provider": "269.4 47.7% 79%",
  "st-provider-soft": "208.2 19.5% 17.1%",
  "st-submitted": "186 44% 64.3%",
  "st-submitted-soft": "188.2 28.9% 14.9%",
  "st-attention": "19.5 78.5% 70.8%",
  "st-attention-soft": "120 3.6% 16.3%"
 },
 "lumiere": {
  "st-provider": "275 38% 34%",
  "st-provider-soft": "275 30% 93%",
  "st-submitted": "188 90% 19%",
  "st-submitted-soft": "188 45% 91%",
  "st-attention": "18 78% 31%",
  "st-attention-soft": "25 90% 93%"
 }
}""")

# ClientDesk role (custom property in ClientDesk's themes.css)  ->  Portal token
ROLE_MAP = {
    '--bg': '--t-bg', '--panel': '--t-panel', '--panel-2': '--t-panel-2', '--panel-3': '--t-panel-3',
    '--card': '--t-card', '--card-shadow': '--t-card-shadow', '--side-top': '--t-side-top',
    '--line': '--t-line', '--line-2': '--t-line-2', '--line-3': '--t-line-3',
    '--text': '--t-text', '--text-2': '--t-text-2', '--muted': '--t-muted', '--faint': '--t-faint',
    '--heading': '--t-heading', '--figure': '--t-figure', '--placeholder': '--t-placeholder',
    '--gold': '--t-accent', '--gold-2': '--t-accent-2', '--gold-ink': '--t-accent-ink', '--accent-text': '--t-accent-text',
    '--gold-dim': '--t-accent-dim', '--gold-line': '--t-accent-line',
    '--brand-text': '--t-brand-text', '--brand-sub': '--t-brand-sub',
    '--red': '--t-red', '--red-dim': '--t-red-dim', '--red-line': '--t-red-line',
    '--amber': '--t-amber', '--amber-dim': '--t-amber-dim', '--amber-line': '--t-amber-line',
    '--green': '--t-green', '--green-dim': '--t-green-dim', '--green-line': '--t-green-line',
    '--blue': '--t-blue', '--blue-dim': '--t-blue-dim', '--blue-line': '--t-blue-line',
    '--sel': '--t-sel', '--hover': '--t-hover', '--hover-soft': '--t-hover-soft', '--backdrop': '--t-backdrop',
    '--shadow': '--t-shadow-color', '--subnav-bg': '--t-subnav-bg', '--toast-err': '--t-toast-err',
    '--picker-filter': '--t-picker-filter', '--focus': '--t-focus', '--option-bg': '--t-option-bg',
    '--rail-bg': '--t-rail-bg', '--rail-bg2': '--t-rail-bg2', '--rail-text': '--t-rail-text', '--rail-muted': '--t-rail-muted',
    '--rail-head': '--t-rail-head', '--rail-sub': '--t-rail-sub', '--rail-act': '--t-rail-act', '--rail-actbg': '--t-rail-actbg',
    '--rail-line': '--t-rail-line', '--rail-hover': '--t-rail-hover', '--rail-alert': '--t-rail-alert', '--rail-alertbg': '--t-rail-alertbg',
    '--logo-glow': '--t-logo-glow',
}
# S17 names kept for existing consumers (Flight Deck, auth): same value as the ClientDesk role they mirror.
ALIASES = {'--t-rail-accent': '--rail-actbg', '--t-shadow': '--card-shadow'}


def blue(t):
    return t.get('blue') or ('#a9bde6' if t['dark'] else '#2b53b8')


def rail(t):
    if 'rail' in t:
        return t['rail']
    d = t['dark']
    return dict(bg=t['side'], bg2=t['bg'], text=t['text2'], muted=t['muted'], head=t['brand'], sub=t['brandsub'],
                act=t['acct'], actbg=rgba(t['acc'], .12 if d else .13), line=('rgba(255,255,255,0.065)' if d else 'rgba(52,42,26,0.11)'),
                hover=('rgba(255,255,255,0.04)' if d else 'rgba(52,42,26,0.05)'), alert=t['red'] if d else mix(t['red'], '#000000', .78), alertbg=rgba(t['red'], .16 if d else .07))


def tokens(t):
    """ClientDesk's token function, verbatim (so the values are identical by construction)."""
    d = t['dark']
    ln = t.get('lines') or ('255,255,255' if d else '52,42,26')
    la = (.065, .11, .18) if d else (.11, .17, .28)
    return {
        '--bg': t['bg'], '--panel': t['panel'], '--panel-2': t['p2'], '--panel-3': t['p3'], '--side-top': t['side'],
        '--line': f"rgba({ln},{la[0]})", '--line-2': f"rgba({ln},{la[1]})", '--line-3': f"rgba({ln},{la[2]})",
        '--text': t['text'], '--text-2': t['text2'], '--muted': t['muted'], '--faint': t['faint'],
        '--heading': t['heading'], '--figure': t['figure'], '--placeholder': t['faint'],
        '--gold': t['acc'], '--gold-2': t['acc2'], '--gold-ink': t['ink'], '--accent-text': t['acct'],
        '--gold-dim': rgba(t['acc'], .12 if d else .13), '--gold-line': rgba(t['acc'], .38 if d else .5),
        '--brand-text': t['brand'], '--brand-sub': t['brandsub'],
        '--red': t['red'], '--red-dim': rgba(t['red'], .1 if d else .08), '--red-line': rgba(t['red'], .32 if d else .38),
        '--amber': t['amber'], '--amber-dim': rgba(t['amber'], .1 if d else .09), '--amber-line': rgba(t['amber'], .32 if d else .38),
        '--green': t['green'], '--green-dim': rgba(t['green'], .09 if d else .08), '--green-line': rgba(t['green'], .26 if d else .36),
        '--sel': rgba(t['acc'], .3), '--hover': 'rgba(255,255,255,.04)' if d else 'rgba(52,42,26,.05)',
        '--hover-soft': 'rgba(255,255,255,.025)' if d else 'rgba(52,42,26,.035)',
        '--backdrop': rgba(t['bg'], .74 if d else .55), '--shadow': 'rgba(0,0,0,.5)' if d else 'rgba(52,42,26,.16)',
        '--subnav-bg': rgba(t['bg'], .93), '--toast-err': mix(t['red'], t['text'], .55) if d else t['red'],
        '--picker-filter': 'invert(.7)' if d else 'none', '--focus': rgba(t['acc'], .6 if d else .7),
        '--option-bg': t['p2'],
        '--blue': blue(t), '--blue-dim': rgba(blue(t), .1 if d else .08), '--blue-line': rgba(blue(t), .32 if d else .3),
        '--card': t['panel'], '--card-shadow': 'none' if d else '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.05)',
        **{f'--rail-{k}': v for k, v in rail(t).items()},
        '--logo-glow': f"drop-shadow(0 10px 28px {rgba(t['acc'], .13)})" if d else 'drop-shadow(0 6px 16px rgba(52,42,26,.22))',
    }


# ---- bridge: ClientDesk roles -> the Portal's shadcn / student / sidebar variables ---------------------------------
def hsl(c):
    r, g, b = [v / 255 for v in hx(c)]
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        h = s = 0.0
    else:
        dd = mx - mn
        s = dd / (2 - mx - mn) if l > .5 else dd / (mx + mn)
        if mx == r:
            h = (g - b) / dd + (6 if g < b else 0)
        elif mx == g:
            h = (b - r) / dd + 2
        else:
            h = (r - g) / dd + 4
        h *= 60
    return f"{round(h, 1):g} {round(s * 100, 1):g}% {round(l * 100, 1):g}%"


def over(rgba_s, base):
    """Composite an rgba(r,g,b,a) string over an opaque hex -> hex."""
    r, g, b, a = [float(x) for x in rgba_s[rgba_s.index('(') + 1:-1].split(',')]
    bb = hx(base)
    return '#' + ''.join(f"{round(c * a + bb[i] * (1 - a)):02x}" for i, c in enumerate((r, g, b)))


def bridge(t, k):
    d = t['dark']
    tk = tokens(t)
    r = rail(t)
    chip = mix(t['acc'], t['bg'], .12 if d else .13)  # accent tint on the canvas
    card_border = over(tk['--line-2'], t['panel'])
    control = mix(t['text'] if d else '#342a1a', t['p2'], .28 if d else .4)  # ClientDesk's audited control-border formula
    g = {
        '--background': t['bg'], '--foreground': t['text'], '--card': t['panel'], '--card-foreground': t['text'], '--card-border': card_border,
        '--popover': t['p2'], '--popover-foreground': t['text'], '--popover-border': over(tk['--line-3'], t['p2']), '--border': over(tk['--line-2'], t['bg']),
        '--input': control, '--primary': t['acc'], '--primary-foreground': t['ink'], '--secondary': t['p3'], '--secondary-foreground': t['text'],
        '--muted': t['p2'], '--muted-foreground': t['muted'], '--accent': chip, '--accent-foreground': t['text'],
        '--destructive': t['red'], '--destructive-foreground': '#14100c' if d else '#ffffff', '--ring': t['acc'],
        '--gold': t['acc'], '--gold-strong': t['acct'], '--gold-soft': chip,
        '--attention': t['amber'], '--attention-soft': mix(t['amber'], t['bg'], .1),
        '--chart-1': t['acc'], '--chart-2': blue(t), '--chart-3': t['green'], '--chart-4': t['amber'], '--chart-5': t['red'],
    }
    soft = lambda c: mix(c, t['bg'], .1 if d else .09)
    s = {
        '--s-bg': t['bg'], '--s-card': t['panel'], '--s-ink': t['text'], '--s-muted': t['muted'],
        '--s-gold': t['acc'], '--s-gold-fill': t['acc'], '--s-gold-bright': t['acct'] if d else t['acc2'], '--s-gold-bright-ink': t['ink'],
        '--s-gold-ink': t['acct'], '--s-gold-soft': chip, '--s-line': card_border, '--s-line-strong': control,
        '--s-attn': t['amber'], '--s-attn-soft': mix(t['amber'], t['bg'], .1),
        '--s-seal': t['heading'], '--s-seal-ink': t['bg'],
        '--st-official': t['heading'], '--st-official-soft': mix(t['heading'], t['bg'], .1 if d else .07),
        '--st-applied': t['green'], '--st-applied-soft': soft(t['green']),
        '--st-progress': blue(t), '--st-progress-soft': soft(blue(t)),
        '--st-notstarted': t['muted'], '--st-notstarted-soft': mix(t['muted'], t['bg'], .1 if d else .08),
        '--st-urgent': t['red'], '--st-urgent-soft': soft(t['red']),
    }
    sb = {
        '--sidebar': r['bg'], '--sidebar-foreground': r['text'], '--sidebar-border': over(r['line'], r['bg']),
        '--sidebar-primary': r['act'], '--sidebar-primary-foreground': r['bg'],
        '--sidebar-accent': over(r['actbg'], r['bg']), '--sidebar-accent-foreground': r['act'], '--sidebar-ring': r['act'],
    }
    return g, s, sb, EXTRAS[k]


def hv(v):
    return hsl(v) if v.startswith('#') else v


def block(k, t):
    d = t['dark']
    sel = f'html[data-theme="{k}"]'
    head = (':root,\n' + sel) if t.get('default') else sel
    note = f" ({t['note']})" if t['note'] else ''
    L = [f"/* {t['label']}{note} */", head + ' {']
    tk = tokens(t)
    for cd, pt in ROLE_MAP.items():
        L.append(f'  {pt}: {tk[cd]};')
    for a, src in ALIASES.items():
        L.append(f'  {a}: {tk[src]};')
    scheme = 'dark' if d else 'light'
    L += [f'  color-scheme: {scheme};', '}']
    g, s, sb, ex = bridge(t, k)
    L.append(sel + ' {')
    L += [f'  {n}: {hv(v)};' for n, v in g.items()]
    L.append('}')
    L.append(',\n'.join(f'{sel} {x}' for x in ('.student-surface', '.staff-surface', 'body.staff-shell')) + ' {')
    L += [f'  {n}: {hv(v)};' for n, v in s.items()]
    for n in ('st-provider', 'st-provider-soft', 'st-submitted', 'st-submitted-soft', 'st-attention', 'st-attention-soft'):
        L.append(f'  --{n}: {ex[n]};')
    L += [f'  color-scheme: {scheme};', '}']
    L.append(f'{sel} body.student-shell,\n{sel} body.staff-shell {{')
    L += [f'  {n}: {hv(v)};' for n, v in sb.items()]
    L.append('}')
    return '\n'.join(L)


HEAD = """/*
 * Lumière Portal themes (S19). GENERATED by scripts/s19/gen-portal-themes.py - do not edit by hand.
 * Palette values from the Lumière ClientDesk design system (approved for Portal use by the owner).
 * All nine packs, including the default Lumière Desk, are built from the ClientDesk palette; the generator
 * holds the ClientDesk-role -> Portal-token table (ROLE_MAP). tests/s19-themes-parity.test.ts pins the values.
 *
 *  - --t-*            raw roles (canvas, panel tiers, card, rail-*, text, accent, status, lines, focus, ...).
 *  - shadcn variables --background/--card/--primary/... plus --s-*, --st-* and --sidebar-* are bridged from them.
 *  - Dark themes also carry the .dark class (set by lib/themes.ts) so Tailwind dark: variants keep working.
 */
"""


def render():
    return HEAD + '\n' + '\n\n'.join(block(k, t) for k, t in T.items()) + '\n'


def audit():
    fails = []
    for k, t in T.items():
        surfaces = {'bg': t['bg'], 'panel': t['panel'], 'panel-3': t['p3']}
        for role in ('text', 'text2', 'muted', 'faint', 'heading', 'figure', 'acct', 'red', 'amber', 'green'):
            for sname, sv in surfaces.items():
                if cr(t[role], sv) < 4.5:
                    fails.append(f"{k}: {role} on {sname} = {cr(t[role], sv):.2f}")
        for sname, sv in surfaces.items():
            if cr(blue(t), sv) < 4.5:
                fails.append(f"{k}: blue on {sname} = {cr(blue(t), sv):.2f}")
        r = rail(t)
        for role in ('text', 'muted', 'head', 'sub', 'act', 'alert'):
            for rs in (r['bg'], r['bg2']):
                if cr(r[role], rs) < 4.5:
                    fails.append(f"{k}: rail {role} = {cr(r[role], rs):.2f}")
        for lab, bgc in (('accent', t['acc']), ('hover', t['acc2'])):
            if cr(t['ink'], bgc) < 4.5:
                fails.append(f"{k}: button label on {lab} = {cr(t['ink'], bgc):.2f}")
        g = bridge(t, k)[0]
        if cr(g['--destructive-foreground'], t['red']) < 4.5:
            fails.append(f"{k}: destructive label = {cr(g['--destructive-foreground'], t['red']):.2f}")
    return fails


if __name__ == '__main__':
    if '--audit' in sys.argv:
        f = audit()
        print('\n'.join(f) or 'audit ok')
        sys.exit(1 if f else 0)
    out = render()
    if '--check' in sys.argv:
        ok = OUT.read_text('utf-8') == out
        print('themes.css matches generator' if ok else 'themes.css is STALE: run python3 scripts/s19/gen-portal-themes.py')
        sys.exit(0 if ok else 1)
    OUT.write_text(out, 'utf-8')
    print('wrote', OUT)
