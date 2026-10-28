# Jeevan Jyoti logo

These files rebuild the logo from a photo of a printed page, because no source file exists.
Everything is vector paths: no embedded images and no `<text>`, so the logo looks the same on every device.

## Which file to use

| File | Use it for |
|---|---|
| `jeevan-jyoti-logo.svg` | The full logo (torch, words, flags) on a transparent background. Use this on the website and anywhere it can be large. |
| `jeevan-jyoti-logo-no-flags.svg` | The torch and words only, for small or narrow spaces such as headers and footers |
| `jeevan-jyoti-mark.svg` | The torch alone in a square. Use it for app icons and social avatars. Its strokes are 1.6× heavier so it stays readable when small. |
| `jeevan-jyoti-logo-600/1200/2400.png` | The full logo as transparent PNGs, for places that can't take SVG |
| `jeevan-jyoti-logo-on-white.png` | The full logo, 1200 px wide on solid white, for email and Word/PDF documents |
| `jeevan-jyoti-mark-512.png` | App icon / PWA icon |
| `jeevan-jyoti-mark-180.png` | `apple-touch-icon` |
| `favicon-32.png` | Browser tab icon. The strokes are 2.4× heavier so it reads at 32 px. |

Inside the SVGs the groups are named `torch`, `word-jeevan`, `word-jyoti` and `flags`.

## Colours

| Role | Hex | Notes |
|---|---|---|
| Brand orange ("Jeevan", torch handle) | `#D26A23` | Sampled from the print after removing the grey cast of the paper. It is a deeper, burnt saffron than the flag's `#FF9933`. |
| Brand green ("Jyoti", flame) | `#779A52` | Sampled the same way. It is a softer leaf green than the flag's `#138808`. |
| Flag poles | `#E6D3A2`, outline `#6B5C3B` | |
| Flags | US `#B22234` / `#3C3B6E` / white; India `#FF9933` / white / `#138808`, chakra `#000080` | Official flag colours, not the faded print |

## Typeface

The two words are set in **Bodoni Moda** at Black weight (opsz 28 instance), which is by indestructible type and licensed under the
SIL Open Font License 1.1 (https://openfontlicense.org). The letters were converted to outlines, so the font
does not need to be installed or shipped. The OFL allows using a font's outlines in artwork like this.

The original was printed in a heavy "fat face" Bodoni, probably Bodoni MT Black / Poster Bodoni, which is
not freely licensed. The original was also **stretched horizontally by about 35–39%**: its round ball terminals print
as wide ovals. To match it, the rebuild applies the same stretch: "Jeevan" is 139% wide and "Jyoti" is 135% wide.

## How it was made

1. The photo was flattened (the paper's grey and its lighting gradient were divided out) and rotated by 0.8° so the baselines are level.
   Colours were then sampled from the solid parts of the letters.
2. About a dozen open-licence fat-face fonts were tested (Abril Fatface, Gravitas One, Rozha One, Chonburi, Ultra, Yeseva One, Playfair Display, Fraunces and others) by fitting each one to the letter shapes in the photo. Scale,
   horizontal stretch, baseline and the position of each letter were fitted by template matching. Bodoni Moda Black matched best,
   and its J with the ball on the left is very close to the original. Each letter was then nudged to within about 1 px of the photo.
   "Jyoti" is drawn on top of "Jeevan" where they overlap, as in the print. The dot to the right of the "n" is the dot of the "i"
   in "Jyoti". There is no separate dot.
3. The torch was redrawn by hand as smooth strokes with round caps and joins, following the photo's lines:
   four orange strokes for the rim and the converging handle, and five green flame strokes.
4. The flags are drawn, not traced. Each is a gently waving surface fitted to the outline in the photo.
   The US flag has 13 stripes and 50 stars in the official 9-row grid. The Indian flag has a 24-spoke Ashoka Chakra. There is light shading
   along the wave, and gold poles with ball finials cross with the US pole in front.

## Known differences from the print

- The typeface is a close open-licence match, not the original font. Hairlines and serifs are crisper than the
  soft print, and the "y" and "i" of "Jyoti" sit about 3 px off the photo in opposite directions.
- The flame strokes have an even width. In the print they swell and taper like brush strokes.
- The flags use official colours and are cleaner than the printed clip-art.
