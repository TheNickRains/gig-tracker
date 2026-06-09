## Design system

### Colors — amber accent (primary brand)
```
--amber-50:  #FAEEDA  (backgrounds, selected states)
--amber-100: #FAC775  (hover)
--amber-400: #EF9F27  (borders, progress fills)
--amber-600: #854F0B  (secondary text on amber)
--amber-800: #633806  (primary text on amber, CTA backgrounds)
--amber-900: #412402  (darkest)
```

### Status badge colors
```
Won:      bg #EAF3DE  text #3B6D11
Follow up: bg #FAEEDA  text #854F0B
Waiting:  bg #E6F1FB  text #185FA5
Outreach: bg #F1EFE8  text #5F5E5A
Dead end: bg #FCEBEB  text #A32D2D
```

### Typography
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
- Weights: 400 (body), 500 (headings, labels), 600 (avatars/initials only)
- Sizes: 11px (labels, timestamps), 12–13px (secondary), 14px (body), 18–20px (page titles)
- Sentence case everywhere. No ALL CAPS, no Title Case.

### Icons
Tabler icons webfont — outline only. CDN: `https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css`

### Layout decisions
- Max width: 480px (mobile-first, centered on desktop)
- Nav height: 54px, sticky
- Hamburger menu — not tabs, not a three-column header
- Avatar click → profile screen (toggles, tap again to close)
- No `position: fixed` except the toast notification
- Dark mode via `prefers-color-scheme` — all colors use CSS custom properties

### Border / radius
- Cards: `border-radius: 12px`, `border: 0.5px solid var(--border-light)`
- Inputs, buttons: `border-radius: 8px`
- Badges, chips: `border-radius: 20px`
- 0.5px borders throughout (not 1px)

---